/**
 * googleCalendarService.js — NutriPolo
 * ======================================
 * Wrapper over Tauri IPC commands for Google Calendar integration.
 * The Rust backend handles the actual HTTP requests; this module
 * translates between NutriPolo data structures and Google Calendar
 * event format, and orchestrates bidirectional sync.
 *
 * Bidirectional calendars: push local changes to Google, pull remote changes.
 * Read-only calendars: pull only, never write.
 *
 * Guarantees:
 *  - Every Google write (push, delete, sync) runs through one queue, so a
 *    save in the modal never races the background sync.
 *  - Events are created with a deterministic id derived from the consultation
 *    id, so a retry or a race can never create the same appointment twice.
 *  - Writes made here are flagged `{ sync: true }` so they never look like
 *    user edits (which would bounce them back to Google).
 */

import { invoke } from '@tauri-apps/api/tauri';
import useStore, { canPushToCalendar, getLoadFailure, localISODate } from '../stores/store';
import { buildClientIndex, matchPatient, normalizeEmail } from './fuzzyMatcher.js';

/** Sync window: days before / after today. */
export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 90;
/** Scope the app needs; checked against what the user granted. */
export const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
/** A failing push is retried this many times before it waits for a new edit. */
const MAX_SYNC_ATTEMPTS = 5;
/** Linked events missing from the window that are looked up one by one per sync. */
const MAX_RECONCILE_PER_SYNC = 25;
/** Read-only tombstones only need to outlive the sync window. */
const TOMBSTONE_TTL_DAYS = SYNC_PAST_DAYS + SYNC_FUTURE_DAYS + 30;

const SYNC = { sync: true };
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

let _refreshPromise = null;
let _syncPromise = null;
let _queue = Promise.resolve();

/** Run `task` after every Google write queued before it, one at a time. */
function enqueue(task) {
  const run = _queue.then(task, task);
  _queue = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ts = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);
const nowISO = () => new Date().toISOString();

// ── Error classification ─────────────────────────────────────────────────

/**
 * Parse an error from the Rust backend:
 * `"<op> failed (<status>) [<reason>]: <message>"`, network errors carry no status.
 */
export function parseGcalError(e) {
  const message = String(e?.message || e || '');
  const m = message.match(/\((\d{3})\)(?:\s*\[([^\]]+)\])?/);
  return { status: m ? Number(m[1]) : 0, reason: m?.[2] || '', message };
}

/** Network errors, 5xx and rate limits are worth retrying. */
export function isRetryableError(e) {
  const { status, reason, message } = parseGcalError(e);
  if (status === 0) return !message.startsWith('oauth_') || message === 'oauth_network_error';
  return status >= 500 || status === 429 || (status === 403 && RATE_LIMIT_REASONS.has(reason));
}

const isGoneError = (e) => [404, 410].includes(parseGcalError(e).status);

/** The token cannot be used any more: stop the whole sync and ask to reconnect. */
function isAuthFailure(e) {
  const { status, reason, message } = parseGcalError(e);
  return message.includes('oauth_invalid_grant')
    || message.includes('No valid token available')
    || (status === 403 && (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'));
}

/** Short, user-facing version of an error. */
export function shortGcalError(e) {
  const { status, message } = parseGcalError(e);
  const text = message.replace(/^.*?failed\s*/, '').replace(/^\(\d{3}\)\s*(\[[^\]]*\])?:?\s*/, '');
  return (status ? `${status} ` : '') + (text || message).slice(0, 160);
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Parse a Google start/end value into local wall time. Timed values are
 * converted to the computer's timezone (an event stored in `Z` or another
 * timezone shows at the right local hour); all-day values keep their date.
 * Returns null for an empty or invalid value (e.g. a deleted event).
 */
export function parseGoogleDateTime(str) {
  if (!str) return null;
  if (!str.includes('T')) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str.slice(0, 10)) ? { fecha: str.slice(0, 10), hora: null, allDay: true, ms: null } : null;
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return { fecha: localISODate(d), hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false, ms: d.getTime() };
}

/** Local fecha / hora / duration of an event, or null when it has no usable start. */
function eventTiming(event, allDayHora, allDayMinutes) {
  const start = parseGoogleDateTime(event.start_datetime);
  if (!start) return null;
  if (start.allDay) return { fecha: start.fecha, hora: allDayHora, duracion: allDayMinutes, allDay: true };
  const end = parseGoogleDateTime(event.end_datetime);
  const endMs = end && !end.allDay ? end.ms : start.ms + 3600000;
  return { fecha: start.fecha, hora: start.hora, duracion: Math.max(1, Math.round((endMs - start.ms) / 60000)), allDay: false };
}

/**
 * Deterministic Google event id for a consultation: `np` + hex of its id.
 * Google accepts base32hex ids ([a-v0-9], 5–1024 chars), which hex satisfies.
 */
export function googleEventIdFor(consultationId) {
  const bytes = new TextEncoder().encode(String(consultationId));
  return 'np' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Sync window as UTC instants (for Google) and local dates (for consultations). */
export function syncWindow(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - SYNC_PAST_DAYS);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SYNC_FUTURE_DAYS + 1);
  return {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    fromFecha: localISODate(from),
    toFecha: localISODate(new Date(to.getTime() - 1)),
  };
}

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

/** The local copy changed since it was last pushed or pulled. */
function hasLocalChange(c) {
  return !!c.localUpdatedAt && ts(c.localUpdatedAt) > ts(c.lastSyncedAt);
}

/** The consultation has something to send to Google. */
function needsPush(c) {
  if (c.restoreRemote) return true;
  // A failure that gave up waits for the next user edit.
  if (c.syncError && !c.syncPending && c.syncErrorFor === (c.localUpdatedAt || null)) return false;
  return !!c.syncPending || hasLocalChange(c);
}

/**
 * Whether a consultation whose Google event was deleted holds data worth
 * keeping (notes, measurements, invoices, or a past outcome). Those stay as a
 * record; empty scheduled appointments are deleted like in Google.
 */
function hasOwnRecord(state, c) {
  if (c.estado !== 'programada') return true;
  if ((c.notasPrivadas || '').trim()) return true;
  if ((state.measurements || []).some(m => m.consultaId === c.id)) return true;
  return (state.invoices || []).some(inv => (inv.items || []).some(it => it.consultationId === c.id));
}

/**
 * The patient of this consultation is settled and the sync never matches it
 * again: chosen or dismissed by the user, or linked for sure (email, phone,
 * unique exact name).
 */
function isMatchDecided(c) {
  return c.matchedBy === 'user' || c.matchStatus === 'manual' || c.matchStatus === 'exact' || c.matchStatus === 'dismissed';
}

// Client lookup maps, rebuilt only when the clients array changes (once per
// sync at most), never per event.
const _clientIndexes = new WeakMap();
function clientIndex(clients) {
  const list = clients || [];
  let index = _clientIndexes.get(list);
  if (!index) {
    index = buildClientIndex(list);
    _clientIndexes.set(list, index);
  }
  return index;
}

const tombstonedIds = (calId) => new Set(
  (useStore.getState().gcalPendingDeletes || []).filter(d => d.calendarId === calId).map(d => d.eventId)
);

/** "Synced — 2 uploaded, 1 imported" style summary for a toast. */
export function formatSyncStats(stats, t) {
  const parts = [];
  if (stats.pushed) parts.push(`${stats.pushed} ${t.gcal_sync_pushed}`);
  if (stats.pulled) parts.push(`${stats.pulled} ${t.gcal_sync_pulled}`);
  if (stats.updated) parts.push(`${stats.updated} ${t.gcal_sync_updated}`);
  if (stats.deleted) parts.push(`${stats.deleted} ${t.gcal_sync_deleted}`);
  return `${t.gcal_synced}${parts.length ? ' — ' + parts.join(', ') : ''}`;
}

/** Which calendars failed and why, for an error toast. */
export function formatSyncErrors(stats, t) {
  const details = (stats.errorDetails || []).slice(0, 3).map(d => `${d.calendar}: ${d.message}`).join(' · ');
  return t.gcal_sync_errors_detail.replace('{n}', stats.errors).replace('{details}', details);
}

export const googleCalendar = {
  // ── OAuth flow ─────────────────────────────────────────────────────────────

  async startAuth(clientId, clientSecret) {
    return await invoke('gcal_start_auth', { clientId, clientSecret });
  },

  async exchangeToken(clientId, clientSecret, code, redirectUri, codeVerifier) {
    return await invoke('gcal_exchange_token', { clientId, clientSecret, code, redirectUri, codeVerifier });
  },

  async refreshToken(clientId, clientSecret, refreshToken) {
    return await invoke('gcal_refresh_token', { clientId, clientSecret, refreshToken });
  },

  async revokeToken(token) {
    return invoke('gcal_revoke_token', { token });
  },

  /** True when the granted scopes let the app edit events. */
  hasRequiredScope(scope) {
    const granted = String(scope || '').split(/\s+/);
    return granted.includes(REQUIRED_SCOPE) || granted.includes('https://www.googleapis.com/auth/calendar');
  },

  // ── Calendar / Events API ──────────────────────────────────────────────────

  async listCalendars(accessToken) {
    return await invoke('gcal_list_calendars', { accessToken });
  },

  /** Live and cancelled events (recurring series expanded) in the range. */
  async listEvents(accessToken, calendarId, timeMin, timeMax) {
    return await invoke('gcal_list_events', { accessToken, calendarId, timeMin, timeMax, timeZone: localTimeZone() });
  },

  async getEvent(accessToken, calendarId, eventId) {
    return await invoke('gcal_get_event', { accessToken, calendarId, eventId });
  },

  async createEvent(accessToken, calendarId, event) {
    return await invoke('gcal_create_event', { accessToken, calendarId, event });
  },

  async updateEvent(accessToken, calendarId, eventId, event) {
    return await invoke('gcal_update_event', { accessToken, calendarId, eventId, event });
  },

  async deleteEvent(accessToken, calendarId, eventId) {
    return await invoke('gcal_delete_event', { accessToken, calendarId, eventId });
  },

  // ── Token management ───────────────────────────────────────────────────────

  /**
   * Ensure we have a valid (non-expired) access token.
   * Returns a plain string when the existing token is still valid,
   * or an object { newToken, expiresAt, refreshToken } when a refresh
   * was performed so the caller can persist the updated values.
   *
   * @param {object} config  { clientId, clientSecret, accessToken, refreshToken, expiresAt }
   */
  async getValidToken(config) {
    if (config.accessToken && config.expiresAt && Date.now() < config.expiresAt - 60000) {
      return config.accessToken;
    }
    if (!config.refreshToken) {
      throw new Error('No valid token available. Please reconnect Google Calendar.');
    }
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = this.refreshToken(config.clientId, config.clientSecret, config.refreshToken)
      .then(result => ({
        newToken: result.access_token,
        expiresAt: Date.now() + (result.expires_in * 1000),
        refreshToken: result.refresh_token || config.refreshToken,
      }))
      .catch(e => {
        // Revoked / expired refresh token (e.g. the 7-day limit of OAuth apps
        // in "Testing" mode): stop retrying and ask the user to reconnect.
        if (String(e).includes('oauth_invalid_grant')) {
          const gc = useStore.getState().config.googleCalendar;
          useStore.getState().updateConfig({
            googleCalendar: { ...gc, connected: false, accessToken: '', refreshToken: '', expiresAt: 0, needsReauth: true },
          });
        }
        throw e;
      })
      .finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  },

  /**
   * Store a refreshed token, merging into the *current* config so concurrent
   * settings changes are not overwritten with a stale snapshot.
   */
  persistToken(tokenResult) {
    if (!tokenResult || typeof tokenResult === 'string') return;
    const gc = useStore.getState().config.googleCalendar;
    useStore.getState().updateConfig({
      googleCalendar: {
        ...gc,
        accessToken: tokenResult.newToken,
        expiresAt: tokenResult.expiresAt,
        refreshToken: tokenResult.refreshToken,
        needsReauth: false,
      },
    });
  },

  /** Valid access token string, refreshing and persisting it when needed. */
  async ensureToken({ force = false } = {}) {
    const gc = useStore.getState().config.googleCalendar;
    const tokenResult = await this.getValidToken(force ? { ...gc, expiresAt: 0 } : gc);
    this.persistToken(tokenResult);
    return typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
  },

  /**
   * Local `completada` / `no_show` are decisions Google cannot represent:
   * a remote "confirmed" event must not turn them back into `programada`.
   */
  mergeRemoteEstado(localEstado, remoteEstado) {
    if (remoteEstado === 'programada' && (localEstado === 'completada' || localEstado === 'no_show')) {
      return localEstado;
    }
    return remoteEstado;
  },

  // ── Data conversion helpers ────────────────────────────────────────────────

  /**
   * Convert a Google Calendar event into a partial consultation object
   * suitable for merging into the NutriPolo store, or null when the event
   * has no usable start (e.g. a deleted event).
   * Timed events are shown at the local hour; all-day events get 09:00 / 60 min.
   * Carries no `clienteId`: the patient is decided by _resolvePatient, and a
   * remote edit must never overwrite a link.
   *
   * @param {object} event            Google Calendar event (as returned by Rust backend)
   * @param {string} sourceCalendarId  ID of the calendar this event was fetched from
   */
  eventToConsultation(event, sourceCalendarId) {
    const timing = eventTiming(event, '09:00', 60);
    if (!timing) return null;

    return {
      fecha: timing.fecha,
      hora: timing.hora,
      duracion: timing.duracion,
      googleEventId: event.id,
      googleSummary: event.summary || '',
      estado: event.status === 'cancelled' ? 'cancelada' : 'programada',
      notasCliente: event.description || '',
      lastSyncedAt: nowISO(),
      sourceCalendarId: sourceCalendarId || null,
    };
  },

  // ── Event → PersonalEvent conversion ───────────────────────────────────

  /**
   * Convert a Google Calendar event into a partial personalEvent object, or
   * null when the event has no usable start.
   * Used for calendars whose purpose === 'personal' (ballet, birthdays, etc.).
   * No client matching, no clinical fields — stays strictly isolated from
   * consultations so these events never contaminate billing / stats / dashboard.
   */
  eventToPersonalEvent(event, sourceCalendarId) {
    const timing = eventTiming(event, '00:00', 24 * 60);
    if (!timing) return null;
    return {
      googleEventId: event.id,
      sourceCalendarId: sourceCalendarId || null,
      title: event.summary || '(sin título)',
      fecha: timing.fecha,
      hora: timing.hora,
      duracion: timing.duracion,
      allDay: timing.allDay,
      lastSyncedAt: nowISO(),
      remoteUpdated: event.updated || null,
      cancelled: event.status === 'cancelled',
    };
  },

  // ── Consultation → Google Event conversion ─────────────────────────────

  /**
   * Convert a NutriPolo consultation into a CalendarEvent object
   * matching the Rust CalendarEvent struct. `id` is the event id to use when
   * creating (deterministic, see googleEventIdFor).
   *
   * @param {object} consultation  NutriPolo consultation
   * @param {Array}  clients       All clients (to resolve clienteId → name)
   * @returns {object}             CalendarEvent for Rust IPC
   */
  consultationToEvent(consultation, clients) {
    const client = clients?.find(c => c.id === consultation.clienteId);
    // An event linked by the sync keeps the title it had in Google: the
    // automatic match must never rename it.
    const keepTitle = consultation.matchedBy === 'system' && consultation.googleSummary;
    const summary = keepTitle ? consultation.googleSummary
      : client ? `Consulta - ${client.nombre}` : (consultation.googleSummary || 'Consulta');

    const fecha = consultation.fecha; // "YYYY-MM-DD"
    const hora = consultation.hora || '09:00'; // "HH:MM"
    const durMin = parseInt(consultation.duracion) || 45;

    // Build ISO 8601 datetime with timezone offset from the browser
    const startDate = new Date(`${fecha}T${hora}:00`);
    const endDate = new Date(startDate.getTime() + durMin * 60000);
    const formatLocalISO = (d) => {
      const off = -d.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const hh = pad(Math.floor(Math.abs(off) / 60));
      const mm = pad(Math.abs(off) % 60);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
    };

    const statusMap = { programada: 'confirmed', completada: 'confirmed', cancelada: 'cancelled', no_show: 'confirmed' };

    return {
      id: consultation.googleEventId || (consultation.id ? googleEventIdFor(consultation.id) : null),
      summary,
      description: consultation.notasCliente || null,
      location: null,
      start_datetime: formatLocalISO(startDate),
      end_datetime: formatLocalISO(endDate),
      status: statusMap[consultation.estado] || 'confirmed',
      updated: null,
      nutripolo_id: consultation.id || null,
      timezone: localTimeZone(),
    };
  },

  // ── Retry utility ─────────────────────────────────────────────────────

  /**
   * Retry an async operation with exponential backoff and jitter.
   * `fn` receives the access token to use. Retries network errors, 5xx and
   * rate limits (429, 403 rateLimitExceeded). On 401 the token is refreshed
   * once and `fn` is called again with the new token. Other errors are thrown.
   */
  async withRetry(fn, { maxRetries = 3, backoffMs = 1000, token = null } = {}) {
    let currentToken = token;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(currentToken);
      } catch (e) {
        if (parseGcalError(e).status === 401 && !refreshed) {
          refreshed = true;
          currentToken = await this.ensureToken({ force: true });
          continue;
        }
        if (attempt >= maxRetries || !isRetryableError(e)) throw e;
        const delay = backoffMs * Math.pow(2, attempt);
        await sleep(delay + Math.random() * delay * 0.25);
      }
    }
  },

  // ── Push (App → Google) ───────────────────────────────────────────────

  /** Calendar a consultation should be written to, or null (pull-only / not connected). */
  pushTargetFor(gcalConfig, consultation) {
    if (!gcalConfig?.connected || !consultation) return null;
    if (consultation.sourceCalendarId) {
      return canPushToCalendar(gcalConfig, consultation.sourceCalendarId) ? consultation.sourceCalendarId : null;
    }
    if (consultation.detachedFromGoogle) return null;
    return canPushToCalendar(gcalConfig, gcalConfig.defaultPushCalendarId) ? gcalConfig.defaultPushCalendarId : null;
  },

  /**
   * Push one consultation to Google (create or update) right after a save.
   * Queued behind any running sync. Returns the sync fields written, or null
   * when there is nothing to push. On failure the consultation keeps its
   * local change and the next sync retries it.
   */
  async pushConsultation(consultationId) {
    return enqueue(async () => {
      const state = useStore.getState();
      const c = state.consultations.find(x => x.id === consultationId);
      const calId = this.pushTargetFor(state.config.googleCalendar, c);
      if (!calId || !this._shouldPush(c)) return null;
      const token = await this.ensureToken();
      return this._pushOne(token, calId, c);
    });
  },

  /** Skip writes that would resurrect or upload something by mistake. */
  _shouldPush(c) {
    if (c.restoreRemote) return true;
    if (!c.googleEventId && c.estado === 'cancelada') return false;
    if (c.remoteDeleted && c.estado !== 'programada') return false;
    return true;
  },

  /**
   * Create or update the event for `c` in `calId` and record the result.
   * `lastSyncedAt` is the time *before* the request, so an edit made while it
   * was in flight still counts as a local change and is pushed next time.
   * Throws after recording a failure.
   */
  async _pushOne(token, calId, c) {
    const pushedAt = nowISO();
    const event = this.consultationToEvent(c, useStore.getState().clients);
    if (c.restoreRemote) event.status = c.estado === 'cancelada' ? 'cancelled' : 'confirmed';
    try {
      const result = c.googleEventId
        ? await this.withRetry(tk => this.updateEvent(tk, calId, c.googleEventId, event), { token })
        : await this.withRetry(tk => this.createEvent(tk, calId, event), { token });
      const fields = {
        googleEventId: result?.id || c.googleEventId || event.id,
        sourceCalendarId: calId,
        lastSyncedAt: pushedAt,
        // Google's own timestamp for our write, so the next pull does not
        // mistake it for a remote edit.
        remoteUpdated: result?.updated || pushedAt,
        syncPending: false,
        syncError: undefined,
        syncErrorFor: undefined,
        syncAttempts: 0,
        remoteDeleted: false,
        restoreRemote: false,
      };
      useStore.getState().updateConsultation(c.id, fields, SYNC);
      return fields;
    } catch (e) {
      if (isAuthFailure(e)) throw e;
      if (c.googleEventId && isGoneError(e) && !c.restoreRemote) {
        // Deleted in Google meanwhile: the deletion wins over the local edit.
        this._applyRemoteRemoval([c.id], { conflict: true });
        throw e;
      }
      const attempts = (c.syncAttempts || 0) + 1;
      const giveUp = !isRetryableError(e) || attempts >= MAX_SYNC_ATTEMPTS;
      useStore.getState().updateConsultation(c.id, {
        syncPending: !giveUp,
        syncAttempts: attempts,
        syncError: shortGcalError(e),
        syncErrorFor: c.localUpdatedAt || null,
      }, SYNC);
      throw e;
    }
  },

  /**
   * Delete a consultation here and its event in Google. Read-only calendars
   * keep their event (a tombstone stops the pull from importing it again).
   * Returns { remote: 'none' | 'deleted' | 'pending' | 'kept' }.
   */
  async deleteConsultation(consultationId) {
    const state = useStore.getState();
    const c = state.consultations.find(x => x.id === consultationId);
    if (!c) return { remote: 'none' };
    const gc = state.config.googleCalendar;
    // Not linked yet but bound for Google: its create may already be there (a
    // lost response, or a push still queued). Delete the event it would have,
    // or the next pull imports it again. Google answers 404 if there is none.
    const unlinkedTarget = c.googleEventId ? null : this.pushTargetFor(gc, c);
    const calendarId = unlinkedTarget || c.sourceCalendarId;
    const eventId = c.googleEventId || (unlinkedTarget ? googleEventIdFor(c.id) : null);
    state.deleteConsultation(consultationId);
    if (!eventId || !calendarId) return { remote: 'none' };

    const remote = canPushToCalendar(gc, calendarId);
    useStore.getState().addGcalPendingDelete({ calendarId, eventId, consultationId, remote });
    if (!remote) return { remote: 'kept' };
    // The user never saw an unlinked consultation in Google: nothing to report.
    const shown = (status) => (unlinkedTarget ? 'none' : status);
    if (!gc?.connected) return { remote: shown('pending') };
    try {
      await enqueue(async () => {
        const token = await this.ensureToken();
        await this.withRetry(tk => this.deleteEvent(tk, calendarId, eventId), { token });
        useStore.getState().removeGcalPendingDelete(calendarId, eventId);
      });
      return { remote: shown('deleted') };
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[GCal Delete] queued for retry:', e);
      return { remote: shown('pending'), error: e };
    }
  },

  /** Retry the Google deletions that could not be sent earlier; prune old tombstones. */
  async _flushPendingDeletes(token, totals) {
    const store = useStore.getState();
    const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
    for (const d of store.gcalPendingDeletes || []) {
      if (!d.remote) {
        if (ts(d.at) < cutoff) store.removeGcalPendingDelete(d.calendarId, d.eventId);
        continue;
      }
      // Restored by undo, or the calendar is no longer writable: nothing to delete.
      const restored = useStore.getState().consultations.some(c => c.googleEventId === d.eventId);
      if (restored || !canPushToCalendar(useStore.getState().config.googleCalendar, d.calendarId)) {
        store.removeGcalPendingDelete(d.calendarId, d.eventId);
        continue;
      }
      try {
        await this.withRetry(tk => this.deleteEvent(tk, d.calendarId, d.eventId), { token });
        store.removeGcalPendingDelete(d.calendarId, d.eventId);
        totals.deleted++;
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        // Permanent errors drop the tombstone; transient ones keep it for later.
        if (!isRetryableError(e)) store.removeGcalPendingDelete(d.calendarId, d.eventId);
        totals.errors++;
        totals.errorDetails.push({ calendarId: d.calendarId, calendar: d.calendarId, message: shortGcalError(e) });
      }
    }
  },

  // ── Remote deletions (Google → App) ───────────────────────────────────

  /**
   * Apply the deletion of the Google events of these consultations.
   * Empty scheduled appointments are deleted; consultations holding notes,
   * measurements, invoices or a past outcome are kept as a record
   * (scheduled ones become `cancelada`). Returns how many changed.
   */
  _applyRemoteRemoval(consultationIds, { conflict = false } = {}) {
    const state = useStore.getState();
    const ids = new Set(consultationIds);
    const toDelete = [];
    let changed = 0;
    for (const c of state.consultations) {
      if (!ids.has(c.id) || c.restoreRemote) continue;
      if (!hasOwnRecord(state, c)) {
        toDelete.push(c.id);
        continue;
      }
      if (c.remoteDeleted && c.estado !== 'programada') continue;
      state.updateConsultation(c.id, {
        estado: c.estado === 'programada' ? 'cancelada' : c.estado,
        remoteDeleted: true,
        syncPending: false,
        syncError: undefined,
        syncAttempts: 0,
        lastSyncedAt: nowISO(),
        ...(conflict || hasLocalChange(c) ? { syncConflict: true } : {}),
      }, SYNC);
      changed++;
    }
    if (toDelete.length) state.removeConsultationsSync(toDelete);
    return changed + toDelete.length;
  },

  // ── Sync (bidirectional + read-only) ──────────────────────────────────

  /**
   * Sync every enabled Google Calendar (window: SYNC_PAST_DAYS back,
   * SYNC_FUTURE_DAYS ahead). Bidirectional calendars: push local changes,
   * then pull remote. Read-only calendars: pull only.
   * Concurrent calls share the running sync.
   *
   * Throws when the session is no longer valid (reconnect needed) or when
   * every calendar failed; otherwise returns the stats, with `errorDetails`
   * listing the calendars that failed.
   *
   * @returns {{ pushed, pulled, updated, deleted, conflicts, errors, suggested, errorDetails }}
   *   `suggested`: new patient suggestions waiting in the inbox.
   */
  async syncAll() {
    if (_syncPromise) return _syncPromise;
    _syncPromise = enqueue(() => this._syncAllImpl()).finally(() => { _syncPromise = null; });
    return _syncPromise;
  },

  async _syncAllImpl() {
    const gcalConfig = useStore.getState().config.googleCalendar;
    if (!gcalConfig?.connected) throw new Error('Google Calendar not connected');
    // The data file could not be read: nothing may be written, here or in Google.
    if (getLoadFailure()) throw new Error('Data file not loaded');

    const enabledIds = (gcalConfig.calendars || []).filter(c => c.syncMode !== 'disabled').map(c => c.id);
    const totals = { pushed: 0, pulled: 0, updated: 0, deleted: 0, conflicts: 0, errors: 0, suggested: 0, errorDetails: [] };
    const openSuggestions = () => (useStore.getState().patientSuggestions || [])
      .filter(sg => sg.status === 'pending' || sg.status === 'pending-confirm').map(sg => sg.id);
    const openBefore = new Set(openSuggestions());

    try {
      let token = await this.ensureToken();
      await this._flushPendingDeletes(token, totals);

      for (const calId of enabledIds) {
        // Fresh calendar config: an earlier calendar may have changed it.
        const cal = (useStore.getState().config.googleCalendar?.calendars || []).find(c => c.id === calId);
        if (!cal || cal.syncMode === 'disabled') continue;
        try {
          token = await this.ensureToken();
          const stats = await this.syncCalendar(token, cal);
          for (const k of ['pushed', 'pulled', 'updated', 'deleted', 'conflicts', 'errors']) totals[k] += stats[k] || 0;
          if (stats.errorDetails) totals.errorDetails.push(...stats.errorDetails);
        } catch (e) {
          if (isAuthFailure(e)) throw e;
          if (import.meta.env.DEV) console.error(`[GCal Sync] Error for calendar ${cal.name || cal.id}:`, e);
          totals.errors++;
          totals.errorDetails.push({ calendarId: cal.id, calendar: cal.name || cal.id, message: shortGcalError(e), failed: true });
        }
      }
    } catch (e) {
      if (isAuthFailure(e) && !String(e).includes('oauth_invalid_grant')) {
        // Missing permission (scope unticked or old grant): keep the settings
        // but ask the user to reconnect.
        const gc = useStore.getState().config.googleCalendar;
        useStore.getState().updateConfig({ googleCalendar: { ...gc, needsReauth: true } });
      }
      throw e;
    }

    // Patients this sync could not settle on its own, for a notice that leads to the inbox.
    totals.suggested = openSuggestions().filter(id => !openBefore.has(id)).length;

    const failedCalendars = totals.errorDetails.filter(d => d.failed).length;
    if (enabledIds.length && failedCalendars === enabledIds.length) {
      const err = new Error(totals.errorDetails[0].message);
      err.stats = totals;
      throw err;
    }

    const { errorDetails, ...summary } = totals;
    useStore.getState().setSyncAudit({ lastFullSyncAt: nowISO(), lastSyncStats: summary });
    return totals;
  },

  /**
   * Mass-delete guard: returns true if the number of remote events has dropped
   * suspiciously compared to the last known baseline.
   *
   * Triggers when BOTH conditions hold:
   *   - Absolute drop ≥ 5 events
   *   - Percentage drop ≥ 50%
   *
   * A 7-day clock-drift guard prevents false positives after long offline periods
   * or system clock jumps (during which the event window simply shifts).
   */
  _detectMassDelete(calendarConfig, remoteEvents) {
    const prev = calendarConfig.lastKnownRemoteCount;
    if (prev == null || prev < 5) return false;   // No baseline yet or too small to be meaningful

    const lastSyncAt = calendarConfig.lastKnownRemoteSyncAt;
    if (lastSyncAt) {
      const daysSince = (Date.now() - new Date(lastSyncAt).getTime()) / 86400000;
      if (daysSince > 7) return false;             // Clock drift / long offline period
    }

    const now = remoteEvents.length;
    const drop = prev - now;
    const dropPct = drop / prev;
    return drop >= 5 && dropPct >= 0.5;
  },

  /**
   * Fetch a calendar's events in the window and split them into live events
   * and cancelled ids. Returns { suspended: true } when the mass-delete guard
   * trips (nothing must be applied then).
   */
  async _fetchCalendar(token, calendarConfig, label) {
    const { timeMin, timeMax } = syncWindow();
    const all = await this.withRetry(tk => this.listEvents(tk, calendarConfig.id, timeMin, timeMax), { token });
    const active = all.filter(ev => ev.id && ev.status !== 'cancelled');
    const cancelledIds = new Set(all.filter(ev => ev.id && ev.status === 'cancelled').map(ev => ev.id));

    if (this._detectMassDelete(calendarConfig, active)) {
      const prev = calendarConfig.lastKnownRemoteCount;
      useStore.getState().markCalendarMassDeletePending(calendarConfig.id, {
        prevCount: prev, newCount: active.length, drop: prev - active.length,
      });
      if (import.meta.env.DEV) console.warn(`[GCal ${label}] Mass-delete detected on ${calendarConfig.id} — sync suspended`);
      return { suspended: true };
    }
    return { active, cancelledIds };
  },

  /**
   * Linked records inside the window that Google did not list (moved far
   * away, or deleted long ago) are looked up one by one. Moved events are
   * returned to be applied like any other; gone ones join `cancelledIds`.
   */
  async _reconcileMissing(token, calId, records, active, cancelledIds) {
    const { fromFecha, toFecha } = syncWindow();
    const listed = new Set(active.map(ev => ev.id));
    const missing = records
      .filter(r => r.googleEventId && r.fecha >= fromFecha && r.fecha <= toFecha
        && !listed.has(r.googleEventId) && !cancelledIds.has(r.googleEventId))
      .slice(0, MAX_RECONCILE_PER_SYNC);
    const moved = [];
    for (const r of missing) {
      try {
        const ev = await this.withRetry(tk => this.getEvent(tk, calId, r.googleEventId), { token });
        if (!ev?.id || ev.status === 'cancelled') cancelledIds.add(r.googleEventId);
        else moved.push(ev);
      } catch (e) {
        if (isGoneError(e)) cancelledIds.add(r.googleEventId);
        else if (isAuthFailure(e)) throw e;
        // Anything else: try again next sync.
      }
    }
    return moved;
  },

  /**
   * Dispatcher: picks the correct sync strategy based on the calendar's
   * `purpose` field (introduced in store v8). Preserves pre-v8 behavior when
   * `purpose` is missing by falling through to the consultation-based sync.
   *
   *   personal         → _syncPersonalCalendar  (personalEvents, NEVER consultations)
   *   holidays         → noop (skipped)
   *   primary          → _syncConsultationsCalendar (bidirectional with three-way merge)
   *   external-clinic  → _syncExternalClinic (pull-only)
   * Both consultation strategies match imported events to patients the same
   * way (_resolvePatient / _rematch).
   *   other / missing  → _syncConsultationsCalendar (legacy behavior)
   *
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode, purpose, ... }
   */
  async syncCalendar(token, calendarConfig) {
    const purpose = calendarConfig.purpose || 'other';
    if (purpose === 'holidays') {
      return { pushed: 0, pulled: 0, updated: 0, skipped: true };
    }

    // Suspend sync while a mass-delete is waiting for user resolution.
    if (calendarConfig.massDeletePending) {
      if (import.meta.env.DEV) console.warn(`[GCal Sync] Calendar ${calendarConfig.id} suspended — mass-delete pending review`);
      return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    }

    if (purpose === 'personal') {
      return this._syncPersonalCalendar(token, calendarConfig);
    }
    if (purpose === 'external-clinic') {
      return this._syncExternalClinic(token, calendarConfig);
    }
    return this._syncConsultationsCalendar(token, calendarConfig);
  },

  /**
   * Matching context for one calendar sync: the client index (built once per
   * clients array, see clientIndex), the names the user dismissed for this
   * calendar and the thresholds.
   */
  _matchContext(calendarConfig) {
    const state = useStore.getState();
    const calId = calendarConfig.id;
    // The calendar's own address (and Raquel's) is never a patient's.
    const ignoreEmails = new Set([normalizeEmail(calId), normalizeEmail(state.config?.email)].filter(Boolean));
    return {
      calId,
      index: clientIndex(state.clients),
      dismissed: new Set((state.patientSuggestions || [])
        .filter(sg => sg.status === 'dismissed' && sg.sourceCalendarId === calId)
        .map(sg => sg.normalizedName)),
      opts: {
        autoThreshold: calendarConfig.fuzzyAutoThreshold ?? 0.92,
        suggestThreshold: calendarConfig.fuzzySuggestThreshold ?? 0.75,
        ignoreEmails,
      },
    };
  },

  /**
   * Decide the patient of an imported event (matchPatient) and record the
   * suggestion it needs. Returns the match fields for the consultation and
   * the suggestion to attach it to, or null when there is nothing to record
   * (noise: blocks, lunch, untitled…).
   *
   *   assign  → clienteId + matchStatus 'exact' (by email, phone or unique name)
   *   confirm → 'auto-pending-review' + pending-confirm suggestion, no clienteId
   *   review  → 'suggested' + pending suggestion with the candidates
   *   new     → 'unknown' + pending suggestion without candidates ("create client")
   * A name the user dismissed for this calendar → 'dismissed', no suggestion.
   */
  _resolvePatient(ev, ctx, timing) {
    const m = matchPatient({
      summary: ev.summary, description: ev.description, attendees: ev.attendees,
      allDay: !!ev.start_datetime && !ev.start_datetime.includes('T'),
    }, ctx.index, ctx.opts);
    if (m.result === 'noise') return null;

    const sys = { matchedBy: 'system', matchedAt: nowISO() };
    if (m.result === 'assign') {
      return { fields: { clienteId: m.clienteId, matchStatus: 'exact', matchedVia: m.via, matchScore: 1, ...sys } };
    }
    if (ctx.dismissed.has(m.normalizedName)) return { fields: { matchStatus: 'dismissed', ...sys } };

    const candidates = m.candidates.map(c => ({ clienteId: c.clienteId, score: c.score, nombre: c.nombre }));
    const sg = useStore.getState().addPatientSuggestion({
      sourceCalendarId: ctx.calId,
      rawSummary: ev.summary || '',
      normalizedName: m.normalizedName,
      displayName: m.rawName,
      contactEmail: m.contact.email,
      contactPhone: m.contact.phone,
      firstSeenFecha: timing?.fecha || null,
      firstSeenHora: timing?.hora || null,
      candidates,
      topScore: candidates[0]?.score ?? null,
      ...(m.result === 'confirm' ? { status: 'pending-confirm', suggestedClienteId: m.clienteId, topScore: m.score } : {}),
    });
    const matchStatus = { confirm: 'auto-pending-review', review: 'suggested', new: 'unknown' }[m.result];
    return {
      suggestionId: sg?.id || null,
      fields: {
        matchStatus,
        suggestedFromId: sg?.id || undefined,
        suggestedClienteId: m.result === 'confirm' ? m.clienteId : undefined,
        matchScore: m.score ?? undefined,
        ...sys,
      },
    };
  },

  /**
   * Re-run the match of an already imported consultation when it is still
   * open: no client, not decided by the user, not created by NutriPolo, and
   * either without a live suggestion (imported before this existed, or its
   * suggestion is gone) or with a new title in Google. Idempotent: a
   * consultation attached to a live suggestion with the same title is left alone.
   *
   * @param {object} local       The consultation before this sync's update
   * @param {object} ev          The Google event
   * @returns {boolean}          Whether anything was written
   */
  _rematch(local, ev, ctx) {
    if (local.clienteId || ev.nutripolo_id || isMatchDecided(local)) return false;
    const state = useStore.getState();
    const live = local.suggestedFromId && (state.patientSuggestions || []).find(sg =>
      sg.id === local.suggestedFromId && (sg.status === 'pending' || sg.status === 'pending-confirm'));
    const retitled = (ev.summary || '') !== (local.googleSummary || '');
    if (live && !retitled) return false;
    if (live) state.detachConsultationFromSuggestion(live.id, local.id);

    const match = this._resolvePatient(ev, ctx, local);
    if (!match) {
      // Now noise (e.g. renamed to "Bloqueo"): drop what pointed to the old match.
      if (!local.matchStatus && !local.suggestedFromId) return false;
      useStore.getState().updateConsultation(local.id, {
        matchStatus: undefined, suggestedFromId: undefined, suggestedClienteId: undefined, matchScore: undefined,
      }, SYNC);
      return true;
    }
    useStore.getState().updateConsultation(local.id, {
      suggestedFromId: undefined, suggestedClienteId: undefined, matchScore: undefined, ...match.fields,
    }, SYNC);
    if (match.suggestionId) useStore.getState().attachConsultationToSuggestion(match.suggestionId, local.id);
    return true;
  },

  /** Import a new Google event as a consultation, with its patient resolved. */
  _importEvent(ev, partial, ctx, extra = {}) {
    // Created by NutriPolo (another device or a lost response): its patient is
    // already in the title, never guessed again.
    const match = ev.nutripolo_id ? null : this._resolvePatient(ev, ctx, partial);
    const newC = useStore.getState().addConsultation({
      ...partial,
      clienteId: null,
      ...extra,
      remoteUpdated: ev.updated || nowISO(),
      ...(match?.fields || {}),
    }, SYNC);
    if (match?.suggestionId && newC?.id) useStore.getState().attachConsultationToSuggestion(match.suggestionId, newC.id);
    return newC;
  },

  /**
   * Sync an external-clinic calendar (e.g. Sinergia receptionist agenda).
   * Pull-only: never pushes back to Google. New events and still-open
   * consultations get their patient from _resolvePatient / _rematch, like the
   * consultation calendars. Events deleted in Google are removed / cancelled
   * via _applyRemoteRemoval.
   */
  async _syncExternalClinic(token, calendarConfig) {
    const calId = calendarConfig.id;

    const fetched = await this._fetchCalendar(token, calendarConfig, 'ExternalClinic');
    if (fetched.suspended) return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    const { cancelledIds } = fetched;
    const ownRecords = useStore.getState().consultations.filter(c => c.sourceCalendarId === calId);
    const moved = await this._reconcileMissing(token, calId, ownRecords, fetched.active, cancelledIds);
    const remoteEvents = [...fetched.active, ...moved];

    const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0 };

    // Re-read store after async I/O to get the freshest state
    const freshStore = useStore.getState();
    const ctx = this._matchContext(calendarConfig);
    const tombstoned = tombstonedIds(calId);
    const allGoogleIds = new Set(freshStore.consultations.map(c => c.googleEventId).filter(Boolean));

    // Index existing consultations from this calendar for O(1) lookups
    const existingByGoogleId = {};
    for (const c of freshStore.consultations) {
      if (c.sourceCalendarId === calId && c.googleEventId) {
        existingByGoogleId[c.googleEventId] = c;
      }
    }

    for (const ev of remoteEvents) {
      const existing = existingByGoogleId[ev.id];
      const partial = this.eventToConsultation(ev, calId);
      if (!partial) continue;

      if (existing) {
        // Update only if the remote version is newer than our last known snapshot.
        // `partial` has no clienteId, so a link (the user's or the sync's) survives.
        if (ts(ev.updated) > ts(existing.remoteUpdated) || existing.remoteDeleted) {
          // Once the patient is settled, the local notes are kept too.
          const { notasCliente, ...clinical } = partial;
          useStore.getState().updateConsultation(existing.id, {
            ...(isMatchDecided(existing) ? clinical : partial),
            estado: this.mergeRemoteEstado(existing.estado, partial.estado),
            remoteUpdated: ev.updated || null,
            lastSyncedAt: nowISO(),
            remoteDeleted: false,
          }, SYNC);
          stats.updated++;
        }
        this._rematch(existing, ev, ctx);
        continue;
      }

      // Brand-new event. Skip ones already imported from another calendar
      // (shared events keep their id) and ones deleted here by the user.
      if (allGoogleIds.has(ev.id) || tombstoned.has(ev.id)) continue;
      this._importEvent(ev, partial, ctx);
      allGoogleIds.add(ev.id);
      stats.pulled++;
    }

    // Deleted / cancelled in Google
    const removed = useStore.getState().consultations
      .filter(c => c.sourceCalendarId === calId && c.googleEventId && cancelledIds.has(c.googleEventId))
      .map(c => c.id);
    stats.deleted += this._applyRemoteRemoval(removed);

    useStore.getState().updateCalendarTracking(calId, fetched.active.length);
    return stats;
  },

  /**
   * Sync a personal calendar (ballet, birthdays, etc.) into `personalEvents`.
   * Pull-only mirror. Never touches `consultations` — keeps clinical data clean.
   *
   * @returns {{ pushed: number, pulled: number, updated: number }}
   */
  async _syncPersonalCalendar(token, calendarConfig) {
    const calId = calendarConfig.id;
    const fetched = await this._fetchCalendar(token, calendarConfig, 'Personal');
    if (fetched.suspended) return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    const { cancelledIds } = fetched;
    const own = useStore.getState().personalEvents.filter(e => e.sourceCalendarId === calId);
    const moved = await this._reconcileMissing(token, calId, own, fetched.active, cancelledIds);

    const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0 };
    const store = useStore.getState();

    // Index existing personalEvents from THIS calendar for O(1) lookups.
    const existingByGoogleId = {};
    for (const e of store.personalEvents) {
      if (e.sourceCalendarId === calId && e.googleEventId) {
        existingByGoogleId[e.googleEventId] = e;
      }
    }

    for (const ev of [...fetched.active, ...moved]) {
      const partial = this.eventToPersonalEvent(ev, calId);
      if (!partial) continue;
      const existing = existingByGoogleId[ev.id];
      if (!existing) {
        store.addPersonalEvent(partial);
        existingByGoogleId[ev.id] = partial;
        stats.pulled++;
      } else if (ts(ev.updated) > ts(existing.remoteUpdated)) {
        // Update only if remote is newer (remoteUpdated shadow)
        store.updatePersonalEvent(existing.id, partial);
        stats.updated++;
      }
    }

    // Deleted in Google → gone here too (personal events are a pure mirror).
    for (const e of useStore.getState().personalEvents) {
      if (e.sourceCalendarId === calId && e.googleEventId && cancelledIds.has(e.googleEventId)) {
        useStore.getState().deletePersonalEvent(e.id);
        stats.deleted++;
      }
    }

    useStore.getState().updateCalendarTracking(calId, fetched.active.length);
    return stats;
  },

  /**
   * Sync consultations for a single Google Calendar.
   * Bidirectional calendars: push locally-modified consultations (three-way
   * merge on conflicts), then pull. Unlinked local consultations are created
   * only in the default push calendar. Read-only calendars: pull only.
   *
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode }
   * @returns {{ pushed, pulled, updated, deleted, conflicts, errors, errorDetails }}
   */
  async _syncConsultationsCalendar(token, calendarConfig) {
    const calId = calendarConfig.id;
    const gc = useStore.getState().config.googleCalendar;
    const canPush = canPushToCalendar(gc, calId);
    const isDefaultPush = canPush && gc.defaultPushCalendarId === calId;
    const { fromFecha } = syncWindow();

    const fetched = await this._fetchCalendar(token, calendarConfig, 'Primary');
    if (fetched.suspended) return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    const { cancelledIds } = fetched;
    const ownRecords = useStore.getState().consultations.filter(c => c.sourceCalendarId === calId);
    const moved = await this._reconcileMissing(token, calId, ownRecords, fetched.active, cancelledIds);
    const remoteEvents = [...fetched.active, ...moved];
    const remoteById = new Map(remoteEvents.map(ev => [ev.id, ev]));

    const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0, conflicts: 0, errors: 0, errorDetails: [] };
    const handled = new Set(); // consultation ids settled by the push phase

    // ── PUSH phase (bidirectional only) ──────────────────────────────────
    if (canPush) {
      const candidates = useStore.getState().consultations
        .filter(c => (c.fecha || '') >= fromFecha)
        .filter(c => c.sourceCalendarId === calId
          || (isDefaultPush && !c.sourceCalendarId && !c.googleEventId && !c.detachedFromGoogle))
        .map(c => c.id);

      for (const id of candidates) {
        // Re-read: the user may have edited it while earlier requests ran.
        const c = useStore.getState().consultations.find(x => x.id === id);
        if (!c || !this._shouldPush(c)) continue;
        try {
          if (!c.googleEventId) {
            // Not linked yet → create (idempotent id, see googleEventIdFor)
            await this._pushOne(token, calId, c);
            stats.pushed++;
            handled.add(c.id);
            continue;
          }
          if (!needsPush(c)) continue;
          // Deleted in Google: the deletion wins (applied below), unless the
          // user restored the consultation with undo.
          if (cancelledIds.has(c.googleEventId) && !c.restoreRemote) continue;

          const remote = remoteById.get(c.googleEventId);
          const remoteChanged = !!remote && ts(remote.updated) > ts(c.remoteUpdated);
          if (remoteChanged && hasLocalChange(c) && ts(c.localUpdatedAt) < ts(remote.updated)) {
            // ── True conflict, remote is newer → pull it, keep local as shadow
            const partial = this.eventToConsultation(remote, calId);
            if (partial) {
              useStore.getState().updateConsultation(c.id, {
                ...partial,
                estado: this.mergeRemoteEstado(c.estado, partial.estado),
                lastSyncedAt: nowISO(),
                remoteUpdated: remote.updated || nowISO(),
                syncPending: false,
                syncError: undefined,
                syncConflict: true,
                conflictShadow: { fecha: c.fecha, hora: c.hora, duracion: c.duracion },
              }, SYNC);
              stats.conflicts++;
              handled.add(c.id);
            }
            continue;
          }

          // Local wins (only local changed, or both changed and local is newer)
          const conflictShadow = remoteChanged ? (() => {
            const timing = eventTiming(remote, undefined, undefined);
            return timing ? { fecha: timing.fecha, hora: timing.hora, duracion: timing.duracion } : null;
          })() : null;
          await this._pushOne(token, calId, c);
          if (remoteChanged) {
            useStore.getState().updateConsultation(c.id, { syncConflict: true, conflictShadow }, SYNC);
            stats.conflicts++;
          } else {
            stats.pushed++;
          }
          handled.add(c.id);
        } catch (e) {
          if (isAuthFailure(e)) throw e;
          if (import.meta.env.DEV) console.error(`[GCal Push] Error for consultation ${c.id}:`, e);
          stats.errors++;
          stats.errorDetails.push({ calendarId: calId, calendar: calendarConfig.name || calId, message: shortGcalError(e) });
          handled.add(c.id);
        }
      }
    }

    // ── PULL phase (all calendars) ───────────────────────────────────────
    const ctx = this._matchContext(calendarConfig);
    const tombstoned = tombstonedIds(calId);

    for (const ev of remoteEvents) {
      const state = useStore.getState();
      let local = state.consultations.find(c => c.googleEventId === ev.id && c.sourceCalendarId === calId);

      // Created by NutriPolo but the response was lost: re-link it.
      if (!local && ev.nutripolo_id) {
        const own = state.consultations.find(c => c.id === ev.nutripolo_id && !c.googleEventId && !c.sourceCalendarId);
        if (own) {
          state.updateConsultation(own.id, {
            googleEventId: ev.id, sourceCalendarId: calId, remoteUpdated: ev.updated || nowISO(),
          }, SYNC);
          continue; // its local data is pushed next sync if it changed
        }
      }

      if (local) {
        // A pending local change is pushed (not overwritten) unless the push failed for good.
        const apply = !handled.has(local.id) && !(canPush && needsPush(local))
          && (ts(ev.updated) > ts(local.remoteUpdated) || local.remoteDeleted);
        const partial = apply && this.eventToConsultation(ev, calId);
        if (partial) {
          // `partial` has no clienteId: a link (the user's or the sync's) survives.
          state.updateConsultation(local.id, {
            ...partial,
            estado: this.mergeRemoteEstado(local.estado, partial.estado),
            lastSyncedAt: nowISO(),
            remoteUpdated: ev.updated || nowISO(),
            remoteDeleted: false,
            syncPending: false,
            syncConflict: false,
          }, SYNC);
          stats.updated++;
        }
        // Imported without a patient (before matching existed, or retitled): try again.
        this._rematch(local, ev, ctx);
        continue;
      }

      // Remote-only → import. Skip events already imported (from another
      // calendar, or created by NutriPolo) and ones deleted here.
      if (tombstoned.has(ev.id)) continue;
      if (state.consultations.some(c => c.googleEventId === ev.id || (ev.nutripolo_id && c.id === ev.nutripolo_id))) continue;
      const partial = this.eventToConsultation(ev, calId);
      if (!partial) continue;
      this._importEvent(ev, partial, ctx, { tipo: 'Google Calendar' });
      stats.pulled++;
    }

    // ── Deleted in Google (skipping events this sync just restored) ──────
    const removed = useStore.getState().consultations
      .filter(c => c.sourceCalendarId === calId && c.googleEventId && cancelledIds.has(c.googleEventId) && !handled.has(c.id))
      .map(c => c.id);
    stats.deleted += this._applyRemoteRemoval(removed);

    // ── Update baseline tracking for next mass-delete check ───────────────────
    useStore.getState().updateCalendarTracking(calId, fetched.active.length);

    return stats;
  },
};
