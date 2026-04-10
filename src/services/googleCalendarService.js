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
 */

import { invoke } from '@tauri-apps/api/tauri';
import useStore from '../stores/store';
import { extractPatientName, findBestMatches } from './fuzzyMatcher.js';

let _refreshPromise = null;
let _syncPromise = null;

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

  // ── Calendar / Events API ──────────────────────────────────────────────────

  async listCalendars(accessToken) {
    return await invoke('gcal_list_calendars', { accessToken });
  },

  async listEvents(accessToken, calendarId, timeMin, timeMax) {
    return await invoke('gcal_list_events', { accessToken, calendarId, timeMin, timeMax });
  },

  async listDeletedEventIds(accessToken, calendarId, timeMin, timeMax) {
    return await invoke('gcal_list_deleted_events', { accessToken, calendarId, timeMin, timeMax });
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
      .finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  },

  // ── Data conversion helpers ────────────────────────────────────────────────

  /**
   * Convert a Google Calendar event into a partial consultation object
   * suitable for merging into the NutriPolo store.
   *
   * Parses date/time directly from the ISO string to avoid UTC conversion
   * issues that arise when using new Date() across different timezones.
   * All-day events (no "T" in the datetime string) get a default 09:00 / 60 min.
   *
   * @param {object} event            Google Calendar event (as returned by Rust backend)
   * @param {Array}  clients
   * @param {string} sourceCalendarId  ID of the calendar this event was fetched from
   */
  eventToConsultation(event, clients, sourceCalendarId) {
    const startStr = event.start_datetime || '';
    const endStr   = event.end_datetime   || '';

    // All-day events have no "T" separator — just a date like "2026-04-01"
    const isAllDay = !startStr.includes('T');

    let fecha, hora, durMin;

    if (isAllDay) {
      fecha  = startStr.slice(0, 10);
      hora   = '09:00';
      durMin = 60;
    } else {
      // Parse date and time directly from the string — no UTC conversion.
      // Format: "2026-04-01T09:00:00+02:00" or "2026-04-01T09:00:00Z"
      fecha = startStr.slice(0, 10);   // "YYYY-MM-DD"
      hora  = startStr.slice(11, 16);  // "HH:MM"

      // Duration: use UTC timestamps so offset differences cancel out correctly
      const startMs = new Date(startStr).getTime();
      const endMs   = endStr ? new Date(endStr).getTime() : startMs + 3600000;
      durMin = Math.max(1, Math.round((endMs - startMs) / 60000));
    }

    // Try to match a client by name from the event summary (accent-insensitive)
    let clienteId = null;
    const normalize = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const summaryName = (event.summary || '').replace(/^Consulta\s*-\s*/i, '').trim();
    const normalizedSummary = normalize(summaryName);
    if (normalizedSummary && clients) {
      const match = clients.find(cl => normalize(cl.nombre) === normalizedSummary);
      if (match) clienteId = match.id;
    }

    return {
      fecha,
      hora,
      duracion: durMin,
      clienteId,
      googleEventId: event.id,
      googleSummary: event.summary || '',
      estado: event.status === 'cancelled' ? 'cancelada' : 'programada',
      notasCliente: event.description || '',
      lastSyncedAt: new Date().toISOString(),
      sourceCalendarId: sourceCalendarId || null,
    };
  },

  // ── Event → PersonalEvent conversion ───────────────────────────────────

  /**
   * Convert a Google Calendar event into a partial personalEvent object.
   * Used for calendars whose purpose === 'personal' (ballet, birthdays, etc.).
   * No client matching, no clinical fields — stays strictly isolated from
   * consultations so these events never contaminate billing / stats / dashboard.
   */
  eventToPersonalEvent(event, sourceCalendarId) {
    const startStr = event.start_datetime || '';
    const endStr   = event.end_datetime   || '';
    const isAllDay = !startStr.includes('T');

    let fecha, hora, durMin;
    if (isAllDay) {
      fecha  = startStr.slice(0, 10);
      hora   = '00:00';
      durMin = 24 * 60;
    } else {
      fecha = startStr.slice(0, 10);
      hora  = startStr.slice(11, 16);
      const startMs = new Date(startStr).getTime();
      const endMs   = endStr ? new Date(endStr).getTime() : startMs + 3600000;
      durMin = Math.max(1, Math.round((endMs - startMs) / 60000));
    }

    return {
      googleEventId: event.id,
      sourceCalendarId: sourceCalendarId || null,
      title: event.summary || '(sin título)',
      fecha,
      hora,
      duracion: durMin,
      allDay: isAllDay,
      lastSyncedAt: new Date().toISOString(),
      remoteUpdated: event.updated || null,
      cancelled: event.status === 'cancelled',
    };
  },

  // ── Consultation → Google Event conversion ─────────────────────────────

  /**
   * Convert a NutriPolo consultation into a CalendarEvent object
   * matching the Rust CalendarEvent struct.
   *
   * @param {object} consultation  NutriPolo consultation
   * @param {Array}  clients       All clients (to resolve clienteId → name)
   * @returns {object}             CalendarEvent for Rust IPC
   */
  consultationToEvent(consultation, clients) {
    const client = clients?.find(c => c.id === consultation.clienteId);
    const summary = client ? `Consulta - ${client.nombre}` : (consultation.googleSummary || 'Consulta');

    const fecha = consultation.fecha; // "YYYY-MM-DD"
    const hora = consultation.hora || '09:00'; // "HH:MM"
    const durMin = parseInt(consultation.duracion) || 45;

    // Build ISO 8601 datetime with timezone offset from the browser
    const startDate = new Date(`${fecha}T${hora}:00`);
    const endDate = new Date(startDate.getTime() + durMin * 60000);
    const formatLocalISO = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const hh = pad(Math.floor(Math.abs(off) / 60));
      const mm = pad(Math.abs(off) % 60);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
    };

    const statusMap = { programada: 'confirmed', completada: 'confirmed', cancelada: 'cancelled', no_show: 'confirmed' };

    return {
      id: consultation.googleEventId || null,
      summary,
      description: consultation.notasCliente || null,
      location: null,
      start_datetime: formatLocalISO(startDate),
      end_datetime: formatLocalISO(endDate),
      status: statusMap[consultation.estado] || 'confirmed',
      updated: null,
      nutripolo_id: consultation.id || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
    };
  },

  // ── Retry utility ─────────────────────────────────────────────────────

  /**
   * Retry an async operation with exponential backoff.
   * Retries on network errors and 5xx. On 401, refreshes token and retries once.
   * Does NOT retry on 400/404 (client errors).
   */
  async withRetry(fn, { maxRetries = 3, backoffMs = 1000, gcalConfig = null } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        const msg = String(e?.message || e);
        // Don't retry client errors
        if (msg.includes('(400)') || msg.includes('(404)') || msg.includes('(403)')) throw e;
        // On 401, try refreshing token once
        if (msg.includes('(401)') && gcalConfig && attempt === 0) {
          try {
            const refreshed = await this.getValidToken({ ...gcalConfig, expiresAt: 0 });
            if (typeof refreshed !== 'string') {
              useStore.getState().updateConfig({
                googleCalendar: {
                  ...useStore.getState().config.googleCalendar,
                  accessToken: refreshed.newToken,
                  expiresAt: refreshed.expiresAt,
                  refreshToken: refreshed.refreshToken,
                },
              });
            }
          } catch { /* refresh failed, will retry anyway */ }
          continue;
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        }
      }
    }
    throw lastError;
  },

  // ── Push (App → Google) ───────────────────────────────────────────────

  /**
   * Push a consultation to Google Calendar (create or update).
   * Returns the updated consultation fields to persist (googleEventId, etc.).
   */
  async pushConsultation(store, consultation) {
    const gcalConfig = store.config.googleCalendar;
    if (!gcalConfig?.connected || !gcalConfig.defaultPushCalendarId) return null;

    const pushCalId = gcalConfig.defaultPushCalendarId;
    const pushCal = (gcalConfig.calendars || []).find(c => c.id === pushCalId);
    if (!pushCal || pushCal.syncMode !== 'bidirectional') return null;

    const tokenResult = await this.getValidToken(gcalConfig);
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
    if (typeof tokenResult !== 'string') {
      store.updateConfig({
        googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
      });
    }

    const event = this.consultationToEvent(consultation, store.clients);

    let result;
    if (consultation.googleEventId) {
      result = await this.withRetry(
        () => this.updateEvent(token, pushCalId, consultation.googleEventId, event),
        { gcalConfig }
      );
    } else {
      result = await this.withRetry(
        () => this.createEvent(token, pushCalId, event),
        { gcalConfig }
      );
    }

    // Persist Google event link — use sync-op pattern to avoid bumping localUpdatedAt
    const syncFields = {
      googleEventId: result.id,
      sourceCalendarId: pushCalId,
      lastSyncedAt: new Date().toISOString(),
    };
    store.updateConsultation(consultation.id, syncFields);

    return syncFields;
  },

  /**
   * Delete a consultation's linked Google Calendar event.
   * Only acts if the consultation was pushed to the default push calendar.
   */
  async deleteConsultationFromGoogle(store, consultation) {
    const gcalConfig = store.config.googleCalendar;
    if (!gcalConfig?.connected || !consultation.googleEventId) return;
    if (consultation.sourceCalendarId !== gcalConfig.defaultPushCalendarId) return;

    const tokenResult = await this.getValidToken(gcalConfig);
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
    if (typeof tokenResult !== 'string') {
      store.updateConfig({
        googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
      });
    }

    await this.withRetry(
      () => this.deleteEvent(token, gcalConfig.defaultPushCalendarId, consultation.googleEventId),
      { gcalConfig }
    );
  },

  // ── Sync (bidirectional + read-only) ──────────────────────────────────

  /**
   * Sync consultations ±30 days from all enabled Google Calendars.
   * Bidirectional calendars: push local changes, then pull remote.
   * Read-only calendars: pull only.
   *
   * @param {object} store  Zustand store state (useStore.getState())
   * @returns {{ pushed: number, pulled: number, updated: number, errors: number }}
   */
  async syncAll(store) {
    // Mutex: prevent concurrent syncs (auto-sync interval vs manual trigger)
    if (_syncPromise) return _syncPromise;
    _syncPromise = this._syncAllImpl(store).finally(() => { _syncPromise = null; });
    return _syncPromise;
  },

  async _syncAllImpl(store) {
    const { config } = store;
    const gcalConfig = config.googleCalendar;
    if (!gcalConfig?.connected) throw new Error('Google Calendar not connected');

    // Get enabled calendars
    let enabledCalendars = (gcalConfig.calendars || []).filter(c => c.syncMode !== 'disabled');
    // Backwards compat: old single-calendar format (always readonly now)
    if (!enabledCalendars.length && gcalConfig.calendarId) {
      enabledCalendars = [{ id: gcalConfig.calendarId, syncMode: 'readonly' }];
    }
    if (!enabledCalendars.length) {
      if (import.meta.env.DEV) console.warn('[GCal Sync] No enabled calendars found');
      return { pushed: 0, pulled: 0, updated: 0, deleted: 0, errors: 0 };
    }

    const totalStats = { pushed: 0, pulled: 0, updated: 0, errors: 0 };
    for (const cal of enabledCalendars) {
      try {
        // Re-validate token per calendar to handle mid-sync expiration
        const freshConfig = useStore.getState().config.googleCalendar;
        const tokenResult = await this.getValidToken(freshConfig);
        const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
        if (typeof tokenResult !== 'string') {
          useStore.getState().updateConfig({
            googleCalendar: { ...freshConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
          });
        }

        const freshStore = useStore.getState();
        const stats = await this.syncCalendar(freshStore, token, cal);
        totalStats.pushed  += stats.pushed || 0;
        totalStats.pulled  += stats.pulled;
        totalStats.updated += stats.updated;
      } catch (e) {
        if (import.meta.env.DEV) console.error(`[GCal Sync] Error for calendar ${cal.name || cal.id}:`, e);
        totalStats.errors++;
      }
    }
    return totalStats;
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
   * Dispatcher: picks the correct sync strategy based on the calendar's
   * `purpose` field (introduced in store v8). Preserves pre-v8 behavior when
   * `purpose` is missing by falling through to the consultation-based sync.
   *
   *   personal         → _syncPersonalCalendar  (personalEvents, NEVER consultations)
   *   holidays         → noop (skipped)
   *   primary          → _syncConsultationsCalendar (bidirectional with three-way merge)
   *   external-clinic  → _syncExternalClinic (pull-only + fuzzy patient matching)
   *   other / missing  → _syncConsultationsCalendar (legacy behavior)
   *
   * Mass-delete detection runs here — BEFORE any sync strategy — for all calendars.
   *
   * @param {object} store           Zustand store state (useStore.getState())
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode, purpose, ... }
   */
  async syncCalendar(store, token, calendarConfig) {
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
      return this._syncPersonalCalendar(store, token, calendarConfig);
    }
    if (purpose === 'external-clinic') {
      return this._syncExternalClinic(store, token, calendarConfig);
    }
    return this._syncConsultationsCalendar(store, token, calendarConfig);
  },

  /**
   * Sync an external-clinic calendar (e.g. Sinergia receptionist agenda).
   * Pull-only: never pushes back to Google.
   *
   * For each new event:
   *   1. Extract a clean patient name via extractPatientName().
   *   2. Try exact name match against known clients.
   *   3. If no exact match, run fuzzy matching:
   *      - score ≥ fuzzyAutoThreshold (0.92) → auto-link silently (fuzzyAutoLinked: true)
   *      - score ≥ fuzzySuggestThreshold (0.75) → add to patientSuggestions inbox
   *      - score < 0.75 → add as unknown-patient suggestion (no candidates)
   *   4. Dismissed suggestions skip re-creation for that normalizedName + calendar.
   *   5. Imports the consultation with optional suggestedFromId so linkPatientSuggestion
   *      can back-fill clienteId on every affected consultation in one shot.
   */
  async _syncExternalClinic(store, token, calendarConfig) {
    const calId = calendarConfig.id;
    const autoThreshold    = calendarConfig.fuzzyAutoThreshold    ?? 0.92;
    const suggestThreshold = calendarConfig.fuzzySuggestThreshold ?? 0.75;

    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    const [remoteEvents, deletedIds] = await Promise.all([
      this.listEvents(token, calId, timeMin, timeMax),
      this.listDeletedEventIds(token, calId, timeMin, timeMax),
    ]);

    // ── Mass-delete guard ──────────────────────────────────────────────────────
    if (this._detectMassDelete(calendarConfig, remoteEvents)) {
      const prev = calendarConfig.lastKnownRemoteCount;
      useStore.getState().markCalendarMassDeletePending(calId, {
        prevCount: prev, newCount: remoteEvents.length, drop: prev - remoteEvents.length,
      });
      if (import.meta.env.DEV) console.warn(`[GCal ExternalClinic] Mass-delete detected on ${calId} — sync suspended`);
      return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    }

    const stats = { pushed: 0, pulled: 0, updated: 0 };

    // Re-read store after async I/O to get the freshest state
    let freshStore = useStore.getState();
    const { clients } = freshStore;

    // Names already dismissed by the user for this calendar → skip re-proposing
    const dismissedNames = new Set(
      freshStore.patientSuggestions
        .filter(sg => sg.status === 'dismissed' && sg.sourceCalendarId === calId)
        .map(sg => sg.normalizedName)
    );

    // Index existing consultations from this calendar for O(1) lookups
    const existingByGoogleId = {};
    for (const c of freshStore.consultations) {
      if (c.sourceCalendarId === calId && c.googleEventId) {
        existingByGoogleId[c.googleEventId] = c;
      }
    }

    const _normalize = (s) =>
      (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    for (const ev of remoteEvents) {
      if (!ev.id) continue;
      const existing = existingByGoogleId[ev.id];

      if (existing) {
        // Update only if the remote version is newer than our last known snapshot
        const remoteTs = ev.updated ? new Date(ev.updated).getTime() : 0;
        const knownTs  = existing.remoteUpdated ? new Date(existing.remoteUpdated).getTime() : 0;
        const needsUpdate = remoteTs > knownTs || (ev.status === 'cancelled' && existing.estado !== 'cancelada');
        if (needsUpdate) {
          // If the user has already manually approved a match, never override their
          // decision — only update clinical fields (fecha, hora, estado, summary).
          const isUserDecision = existing.matchedBy === 'user' || existing.matchStatus === 'manual' || existing.matchStatus === 'exact';
          const partial = this.eventToConsultation(ev, clients, calId);
          if (isUserDecision) {
            // Protect clienteId / matchStatus — only sync mutable clinical fields
            useStore.getState().updateConsultation(existing.id, {
              fecha: partial.fecha,
              hora: partial.hora,
              duracion: partial.duracion,
              estado: partial.estado,
              googleSummary: partial.googleSummary,
              remoteUpdated: ev.updated || null,
              lastSyncedAt: new Date().toISOString(),
            });
          } else if (existing.matchStatus === 'auto-pending-review' && ev.summary !== existing.googleSummary) {
            // Summary changed on a still-pending-confirm consultation — re-run fuzzy match
            const newRawName = extractPatientName(ev.summary || '');
            const newNormName = _normalize(newRawName);
            const latestStore = useStore.getState();
            const { auto: newAuto, candidates: newCandidates } = findBestMatches(
              newRawName, latestStore.clients, { autoThreshold, suggestThreshold }
            );
            useStore.getState().updateConsultation(existing.id, {
              ...partial,
              clienteId: null, // still unconfirmed
              suggestedClienteId: newAuto?.clienteId || null,
              matchScore: newAuto?.score ?? (newCandidates[0]?.score ?? null),
              remoteUpdated: ev.updated || null,
              lastSyncedAt: new Date().toISOString(),
            });
          } else {
            useStore.getState().updateConsultation(existing.id, {
              ...partial,
              // Preserve user-linked clienteId — eventToConsultation only
              // exact-matches, so it would nuke the link on any receptionist edit.
              clienteId: partial.clienteId || existing.clienteId,
              remoteUpdated: ev.updated || null,
            });
          }
          stats.updated++;
        }
        continue;
      }

      // Brand-new event — skip cancelled ones (nothing to import)
      if (ev.status === 'cancelled') continue;

      // ── Patient name extraction + matching ──────────────────────────────────
      const rawName        = extractPatientName(ev.summary || '');
      const normalizedName = _normalize(rawName);

      // eventToConsultation already tries exact-match via its internal normalize
      const partial = this.eventToConsultation(ev, clients, calId);
      let { clienteId } = partial;
      let matchStatus, suggestedClienteId = null, matchScore = null, suggestedFromId;
      const matchedAt = new Date().toISOString();

      if (clienteId) {
        // Exact match found by eventToConsultation
        matchStatus = 'exact';
      } else if (normalizedName) {
        // Exact match by normalizedName didn't fire in eventToConsultation;
        // try the richer extractPatientName variant through fuzzy engine
        const latestStore = useStore.getState();
        const { auto, candidates } = findBestMatches(
          rawName,
          latestStore.clients,
          { autoThreshold, suggestThreshold },
        );

        if (dismissedNames.has(normalizedName)) {
          // User dismissed this name — import as dismissed record (no inbox card)
          matchStatus = 'dismissed';
        } else if (auto) {
          // High-confidence fuzzy match — pre-select but require 1-click confirmation
          matchStatus = 'auto-pending-review';
          suggestedClienteId = auto.clienteId;
          matchScore = auto.score;
          const sg = latestStore.addPatientSuggestion({
            sourceCalendarId: calId,
            rawSummary: ev.summary || '',
            normalizedName,
            firstSeenFecha: partial.fecha || null,
            firstSeenHora:  partial.hora  || null,
            candidates: candidates.map(c => ({ clienteId: c.clienteId, score: c.score, nombre: c.nombre })),
            suggestedClienteId: auto.clienteId,
            topScore: auto.score,
            status: 'pending-confirm',
          });
          suggestedFromId = sg?.id;
        } else if (candidates.length > 0) {
          // Ambiguous — create review suggestion
          matchStatus = 'suggested';
          matchScore = candidates[0].score;
          const sg = latestStore.addPatientSuggestion({
            sourceCalendarId: calId,
            rawSummary: ev.summary || '',
            normalizedName,
            firstSeenFecha: partial.fecha || null,
            firstSeenHora:  partial.hora  || null,
            candidates: candidates.map(c => ({ clienteId: c.clienteId, score: c.score, nombre: c.nombre })),
            topScore: candidates[0].score,
          });
          suggestedFromId = sg?.id;
        } else {
          // No candidates — new unknown patient
          matchStatus = 'unknown';
          const sg = latestStore.addPatientSuggestion({
            sourceCalendarId: calId,
            rawSummary: ev.summary || '',
            normalizedName,
            firstSeenFecha: partial.fecha || null,
            firstSeenHora:  partial.hora  || null,
            candidates: [],
          });
          suggestedFromId = sg?.id;
        }
      } else {
        // No extractable name — import without matching
        matchStatus = 'unknown';
      }

      const newC = useStore.getState().addConsultation({
        ...partial,
        // For non-exact matches: clienteId stays null until user confirms
        clienteId: matchStatus === 'exact' ? clienteId : null,
        remoteUpdated: ev.updated || null,
        matchStatus,
        matchedBy: 'system',
        matchedAt,
        ...(suggestedClienteId != null ? { suggestedClienteId } : {}),
        ...(matchScore != null         ? { matchScore }          : {}),
        ...(suggestedFromId            ? { suggestedFromId }     : {}),
      });

      // Attach the new consultation ID to the suggestion for back-fill tracking
      if (suggestedFromId && newC?.id) {
        useStore.getState().attachConsultationToSuggestion(suggestedFromId, newC.id);
      }
      stats.pulled++;
    }

    // Cancelled / deleted remote events → mark consultation cancelled (never hard-delete)
    const cancelledSet = new Set(deletedIds);
    for (const c of useStore.getState().consultations) {
      if (c.sourceCalendarId === calId && c.googleEventId && cancelledSet.has(c.googleEventId)) {
        if (c.estado !== 'cancelada') {
          useStore.getState().updateConsultation(c.id, {
            estado: 'cancelada',
            lastSyncedAt: new Date().toISOString(),
          });
          stats.updated++;
        }
      }
    }

    useStore.getState().updateCalendarTracking(calId, remoteEvents.length);
    return stats;
  },

  /**
   * Sync a personal calendar (ballet, birthdays, etc.) into `personalEvents`.
   * Pull-only. Never touches `consultations` — keeps clinical data clean.
   *
   * @returns {{ pushed: number, pulled: number, updated: number }}
   */
  async _syncPersonalCalendar(store, token, calendarConfig) {
    const calId = calendarConfig.id;
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    const [remoteEvents, deletedIds] = await Promise.all([
      this.listEvents(token, calId, timeMin, timeMax),
      this.listDeletedEventIds(token, calId, timeMin, timeMax),
    ]);

    // ── Mass-delete guard ──────────────────────────────────────────────────────
    if (this._detectMassDelete(calendarConfig, remoteEvents)) {
      const prev = calendarConfig.lastKnownRemoteCount;
      useStore.getState().markCalendarMassDeletePending(calId, {
        prevCount: prev, newCount: remoteEvents.length, drop: prev - remoteEvents.length,
      });
      if (import.meta.env.DEV) console.warn(`[GCal Personal] Mass-delete detected on ${calId} — sync suspended`);
      return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    }

    const stats = { pushed: 0, pulled: 0, updated: 0 };

    // Index existing personalEvents from THIS calendar for O(1) lookups.
    const freshStore = useStore.getState();
    const existingByGoogleId = {};
    for (const e of freshStore.personalEvents) {
      if (e.sourceCalendarId === calId && e.googleEventId) {
        existingByGoogleId[e.googleEventId] = e;
      }
    }

    for (const ev of remoteEvents) {
      if (!ev.id) continue;
      const existing = existingByGoogleId[ev.id];
      const partial = this.eventToPersonalEvent(ev, calId);

      if (!existing) {
        // Never add cancelled events as brand-new entries
        if (ev.status === 'cancelled') continue;
        freshStore.addPersonalEvent(partial);
        stats.pulled++;
      } else {
        // Update only if remote is newer (remoteUpdated shadow)
        const remoteTs = ev.updated ? new Date(ev.updated).getTime() : 0;
        const knownTs  = existing.remoteUpdated ? new Date(existing.remoteUpdated).getTime() : 0;
        if (remoteTs > knownTs) {
          freshStore.updatePersonalEvent(existing.id, partial);
          stats.updated++;
        }
      }
    }

    // Cancelled events → mark personalEvent.cancelled = true (never hard-delete).
    const cancelledSet = new Set(deletedIds);
    const latest = useStore.getState().personalEvents;
    for (const e of latest) {
      if (e.sourceCalendarId === calId && e.googleEventId && cancelledSet.has(e.googleEventId)) {
        if (!e.cancelled) {
          useStore.getState().updatePersonalEvent(e.id, { cancelled: true });
          stats.updated++;
        }
      }
    }

    useStore.getState().updateCalendarTracking(calId, remoteEvents.length);
    return stats;
  },

  /**
   * Sync consultations ±30 days for a single Google Calendar.
   * Bidirectional calendars: push locally-modified consultations, then pull.
   * Read-only calendars: pull only. Cancelled events → "cancelada" (never delete).
   *
   * @param {object} store           Zustand store state (useStore.getState())
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode }
   * @returns {{ pushed: number, pulled: number, updated: number }}
   */
  async _syncConsultationsCalendar(store, token, calendarConfig) {
    const { clients, updateConsultation, addConsultation } = store;
    const calId = calendarConfig.id;
    const isBidirectional = calendarConfig.syncMode === 'bidirectional';

    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    const [remoteEvents, deletedIds] = await Promise.all([
      this.listEvents(token, calId, timeMin, timeMax),
      this.listDeletedEventIds(token, calId, timeMin, timeMax),
    ]);

    // ── Mass-delete guard ──────────────────────────────────────────────────────
    if (this._detectMassDelete(calendarConfig, remoteEvents)) {
      const prev = calendarConfig.lastKnownRemoteCount;
      useStore.getState().markCalendarMassDeletePending(calId, {
        prevCount: prev, newCount: remoteEvents.length, drop: prev - remoteEvents.length,
      });
      if (import.meta.env.DEV) console.warn(`[GCal Primary] Mass-delete detected on ${calId} — sync suspended`);
      return { pushed: 0, pulled: 0, updated: 0, suspended: true };
    }

    const consultations = store.consultations;
    const localConsultations = consultations.filter(c => {
      const d = new Date(c.fecha);
      return d >= new Date(timeMin) && d <= new Date(timeMax);
    });

    const stats = { pushed: 0, pulled: 0, updated: 0, conflicts: 0 };

    // Index remote events for O(1) lookups
    const remoteByGoogleId = {};
    for (const ev of remoteEvents) {
      if (ev.id) remoteByGoogleId[ev.id] = ev;
    }

    // ── PUSH phase (bidirectional only) ──────────────────────────────────
    if (isBidirectional) {
      const gcalConfig = useStore.getState().config.googleCalendar;
      for (const c of localConsultations) {
        try {
          // Case 0: Retry previously failed pushes
          if (c.syncPending && c.googleEventId && c.sourceCalendarId === calId) {
            const event = this.consultationToEvent(c, clients);
            await this.withRetry(
              () => this.updateEvent(token, calId, c.googleEventId, event),
              { gcalConfig }
            );
            updateConsultation(c.id, {
              lastSyncedAt: new Date().toISOString(),
              syncPending: false,
              remoteUpdated: remoteByGoogleId[c.googleEventId]?.updated || c.remoteUpdated,
            });
            stats.pushed++;
            continue;
          }

          // Case 1: Local consultation not yet linked → create on Google
          if (!c.googleEventId && !c.sourceCalendarId) {
            const event = this.consultationToEvent(c, clients);
            const result = await this.withRetry(
              () => this.createEvent(token, calId, event),
              { gcalConfig }
            );
            updateConsultation(c.id, {
              googleEventId: result.id,
              sourceCalendarId: calId,
              lastSyncedAt: new Date().toISOString(),
              remoteUpdated: result.updated || new Date().toISOString(),
            });
            stats.pushed++;
            continue;
          }

          // Case 2: Three-way merge — linked consultation, detect local+remote change
          if (c.googleEventId && c.sourceCalendarId === calId && c.localUpdatedAt && c.lastSyncedAt) {
            const localTs  = new Date(c.localUpdatedAt).getTime();
            const syncTs   = new Date(c.lastSyncedAt).getTime();
            const localChanged = localTs > syncTs;

            const remote = remoteByGoogleId[c.googleEventId];
            const remoteTs   = remote?.updated ? new Date(remote.updated).getTime() : 0;
            const knownTs    = c.remoteUpdated  ? new Date(c.remoteUpdated).getTime()  : 0;
            const remoteChanged = remoteTs > 0 && remoteTs > knownTs;

            if (localChanged && remoteChanged) {
              // ── True conflict: both sides changed since last sync ─────────────
              if (localTs >= remoteTs) {
                // Local wins → push to Google; save remote as shadow for possible undo
                const conflictShadow = remote ? {
                  fecha: remote.start?.dateTime?.slice(0, 10) || remote.start?.date,
                  hora:  remote.start?.dateTime?.slice(11, 16),
                  duracion: remote.end?.dateTime && remote.start?.dateTime
                    ? Math.round((new Date(remote.end.dateTime) - new Date(remote.start.dateTime)) / 60000)
                    : undefined,
                } : null;
                const event = this.consultationToEvent(c, clients);
                await this.withRetry(
                  () => this.updateEvent(token, calId, c.googleEventId, event),
                  { gcalConfig }
                );
                updateConsultation(c.id, {
                  lastSyncedAt: new Date().toISOString(),
                  remoteUpdated: remote?.updated || new Date().toISOString(),
                  syncConflict: true,
                  conflictShadow,
                });
              } else {
                // Remote wins → pull remote; save local as shadow for possible undo
                const conflictShadow = {
                  fecha: c.fecha, hora: c.hora, duracion: c.duracion,
                };
                const partial = this.eventToConsultation(remote, clients, calId);
                updateConsultation(c.id, {
                  ...partial,
                  clienteId: partial.clienteId || c.clienteId, // preserve manual/fuzzy link
                  lastSyncedAt: new Date().toISOString(),
                  remoteUpdated: remote.updated || new Date().toISOString(),
                  syncConflict: true,
                  conflictShadow,
                });
              }
              stats.conflicts++;
            } else if (localChanged) {
              // Only local changed → push to Google
              const event = this.consultationToEvent(c, clients);
              await this.withRetry(
                () => this.updateEvent(token, calId, c.googleEventId, event),
                { gcalConfig }
              );
              updateConsultation(c.id, {
                lastSyncedAt: new Date().toISOString(),
                remoteUpdated: remote?.updated || c.remoteUpdated,
                syncConflict: false,
              });
              stats.pushed++;
            }
            // If only remoteChanged (no local change) → handled in PULL phase below
          }
        } catch (e) {
          if (import.meta.env.DEV) console.error(`[GCal Push] Error for consultation ${c.id}:`, e);
          updateConsultation(c.id, { syncPending: true });
        }
      }
    }

    // ── PULL phase (all calendars) ───────────────────────────────────────

    // Re-read store after push phase may have modified consultations
    const freshStore = useStore.getState();
    const freshConsultations = freshStore.consultations;
    const freshLocal = freshConsultations.filter(c => {
      const d = new Date(c.fecha);
      return d >= new Date(timeMin) && d <= new Date(timeMax);
    });

    // Update existing local consultations from remote data
    for (const c of freshLocal) {
      if (c.googleEventId && remoteByGoogleId[c.googleEventId]) {
        const remote = remoteByGoogleId[c.googleEventId];

        // For bidirectional: skip if we already handled this above (local changed)
        if (isBidirectional && c.localUpdatedAt && c.lastSyncedAt) {
          const localTs = new Date(c.localUpdatedAt).getTime();
          const syncTs  = new Date(c.lastSyncedAt).getTime();
          if (localTs > syncTs) continue;  // handled in push phase
        }

        const remoteTs = remote.updated ? new Date(remote.updated).getTime() : 0;
        const knownTs  = c.remoteUpdated ? new Date(c.remoteUpdated).getTime() : 0;
        if (remoteTs <= knownTs) continue;  // no change on remote side

        const partial = this.eventToConsultation(remote, clients, calId);
        updateConsultation(c.id, {
          ...partial,
          clienteId: partial.clienteId || c.clienteId, // preserve manual/fuzzy link
          lastSyncedAt: new Date().toISOString(),
          remoteUpdated: remote.updated || new Date().toISOString(),
          syncPending: false,
          syncConflict: false,
        });
        stats.updated++;
      }
    }

    // Pull remote-only → local (new events from Google not yet in NutriPolo)
    const currentConsultations = useStore.getState().consultations;
    const localByGoogleId = {};
    for (const c of currentConsultations) {
      if (c.googleEventId) localByGoogleId[c.googleEventId] = c;
    }

    for (const ev of remoteEvents) {
      const hasLocalByNpId = ev.nutripolo_id
        ? currentConsultations.find(c => c.id === ev.nutripolo_id)
        : null;
      const hasLocalByGId = ev.id ? localByGoogleId[ev.id] : null;
      if (!hasLocalByNpId && !hasLocalByGId && ev.status !== 'cancelled') {
        const partial = this.eventToConsultation(ev, clients, calId);
        addConsultation({
          ...partial,
          tipo: partial.tipo || 'Google Calendar',
          sourceCalendarId: calId,
          remoteUpdated: ev.updated || new Date().toISOString(),
        });
        stats.pulled++;
      }
    }

    // Cancelled events in Google → mark local consultation as "cancelada" (never delete)
    const cancelledSet = new Set(deletedIds);
    const latestConsultations = useStore.getState().consultations;
    for (const c of latestConsultations) {
      if (c.googleEventId && c.sourceCalendarId === calId && cancelledSet.has(c.googleEventId)) {
        if (c.estado !== 'cancelada') {
          updateConsultation(c.id, { estado: 'cancelada' });
          stats.updated++;
        }
      }
    }

    // ── Update baseline tracking for next mass-delete check ───────────────────
    useStore.getState().updateCalendarTracking(calId, remoteEvents.length);

    return stats;
  },
};
