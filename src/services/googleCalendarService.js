/**
 * googleCalendarService.js — NutriPolo
 * ======================================
 * Wrapper over Tauri IPC commands for Google Calendar integration.
 * The Rust backend handles the actual HTTP requests; this module
 * translates between NutriPolo data structures and Google Calendar
 * event format, and orchestrates bidirectional sync.
 */

import { invoke } from '@tauri-apps/api/tauri';
import useStore from '../stores/store';

let _refreshPromise = null;
let _syncPromise = null;

export const googleCalendar = {
  // ── OAuth flow ─────────────────────────────────────────────────────────────

  async startAuth(clientId, clientSecret) {
    return await invoke('gcal_start_auth', { clientId, clientSecret });
  },

  async exchangeToken(clientId, clientSecret, code, redirectUri) {
    return await invoke('gcal_exchange_token', { clientId, clientSecret, code, redirectUri });
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
   * Convert a NutriPolo consultation + client into a Google Calendar event payload.
   *
   * @param {object} consultation
   * @param {object|null} client
   * @param {Array|null} locations   config.locations array
   */
  consultationToEvent(consultation, client, locations) {
    const loc = locations?.find(l => l.id === consultation.locationId);
    // Use Number() so that string "0" doesn't falsely fall back to 60
    const dur = Number(consultation.duracion) || 60;

    // Build Date objects treating fecha+hora as LOCAL time
    const startDate = new Date(`${consultation.fecha}T${consultation.hora || '09:00'}:00`);
    const endDate   = new Date(startDate.getTime() + dur * 60000);

    // Format as RFC 3339 with local timezone offset (e.g. "2026-04-01T09:00:00+02:00")
    // Google Calendar requires an explicit offset so it does not misinterpret the time.
    const toRFC3339Local = (d) => {
      const pad  = (n, w = 2) => String(n).padStart(w, '0');
      const off  = -d.getTimezoneOffset();          // minutes, positive = east of UTC
      const sign = off >= 0 ? '+' : '-';
      const hh   = pad(Math.floor(Math.abs(off) / 60));
      const mm   = pad(Math.abs(off) % 60);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
             `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
             `${sign}${hh}:${mm}`;
    };

    return {
      summary: `Consulta - ${client?.nombre || 'Cliente'}`,
      description: [consultation.tipo, consultation.notasCliente].filter(Boolean).join('\n'),
      location: loc ? `${loc.name}${loc.address ? ' - ' + loc.address : ''}` : null,
      start_datetime: toRFC3339Local(startDate),
      end_datetime:   toRFC3339Local(endDate),
      status: consultation.estado === 'cancelada' ? 'cancelled' : 'confirmed',
      nutripolo_id: consultation.id,
    };
  },

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

  // ── Bulk delete ────────────────────────────────────────────────────────────

  /**
   * Delete all Google Calendar events linked to local consultations.
   * Returns { deleted, errors } stats.
   */
  async deleteAllEvents(store) {
    const { config, consultations } = store;
    const gcalConfig = config.googleCalendar;
    if (!gcalConfig?.connected) return { deleted: 0, errors: 0 };

    const tokenResult = await this.getValidToken(gcalConfig);
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
    if (typeof tokenResult !== 'string') {
      store.updateConfig({
        googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
      });
    }

    const linked = consultations.filter(c => c.googleEventId && c.sourceCalendarId);
    let deleted = 0;
    let errors = 0;

    for (const c of linked) {
      try {
        await this.deleteEvent(token, c.sourceCalendarId, c.googleEventId);
        deleted++;
      } catch (e) {
        if (import.meta.env.DEV) console.error(`Failed to delete event ${c.googleEventId}:`, e);
        errors++;
      }
    }
    return { deleted, errors };
  },

  // ── Bidirectional sync ─────────────────────────────────────────────────────

  /**
   * Sync consultations ±30 days between NutriPolo and all enabled Google Calendars.
   *
   * Iterates over gcalConfig.calendars, calling syncCalendar() for each enabled one
   * and aggregating stats. Backwards-compatible with the old single gcalConfig.calendarId
   * format: if calendars is empty but calendarId exists, it is treated as a single
   * bidirectional calendar.
   *
   * @param {object} store  Zustand store state (useStore.getState())
   * @returns {{ pushed: number, pulled: number, updated: number, deleted: number, errors: number }}
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

    const tokenResult = await this.getValidToken(gcalConfig);
    const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
    if (typeof tokenResult !== 'string') {
      store.updateConfig({
        googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
      });
    }

    // Get enabled calendars
    let enabledCalendars = (gcalConfig.calendars || []).filter(c => c.syncMode !== 'disabled');
    // Backwards compat: old single-calendar format
    if (!enabledCalendars.length && gcalConfig.calendarId) {
      enabledCalendars = [{ id: gcalConfig.calendarId, syncMode: 'bidirectional' }];
    }
    if (!enabledCalendars.length) {
      if (import.meta.env.DEV) console.warn('[GCal Sync] No enabled calendars found');
      return { pushed: 0, pulled: 0, updated: 0, deleted: 0, errors: 0 };
    }

    const totalStats = { pushed: 0, pulled: 0, updated: 0, deleted: 0, errors: 0 };
    for (const cal of enabledCalendars) {
      try {
        // Use fresh store state for each calendar to avoid stale data from previous iteration
        const freshStore = useStore.getState();
        const stats = await this.syncCalendar(freshStore, token, cal);
        totalStats.pushed  += stats.pushed;
        totalStats.pulled  += stats.pulled;
        totalStats.updated += stats.updated;
        totalStats.deleted += stats.deleted;
      } catch (e) {
        if (import.meta.env.DEV) console.error(`[GCal Sync] Error for calendar ${cal.name || cal.id}:`, e);
        totalStats.errors++;
      }
    }
    return totalStats;
  },

  /**
   * Sync consultations ±30 days for a single Google Calendar.
   *
   * Last-write-wins strategy for bidirectional calendars; remote-always-wins for
   * readonly ones. Cross-calendar protection: consultations are only pushed to the
   * calendar they originated from (sourceCalendarId matches or is absent).
   *
   * @param {object} store           Zustand store state (useStore.getState())
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode }
   * @returns {{ pushed: number, pulled: number, updated: number, deleted: number }}
   */
  async syncCalendar(store, token, calendarConfig) {
    const { clients, config, updateConsultation, addConsultation } = store;
    const calId = calendarConfig.id;
    const isReadonly = calendarConfig.syncMode === 'readonly';

    // Tolerance window (ms) to avoid false diffs from clock skew between local and Google
    const SYNC_TOLERANCE_MS = 2000;

    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + 30 * 86400000).toISOString();

    const [remoteEvents, deletedIds] = await Promise.all([
      this.listEvents(token, calId, timeMin, timeMax),
      this.listDeletedEventIds(token, calId, timeMin, timeMax),
    ]);

    const consultations = store.consultations;
    const localConsultations = consultations.filter(c => {
      const d = new Date(c.fecha);
      return d >= new Date(timeMin) && d <= new Date(timeMax);
    });

    const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0 };

    // Index remote events for O(1) lookups
    const remoteByNpId     = {};
    const remoteByGoogleId = {};
    for (const ev of remoteEvents) {
      if (ev.nutripolo_id) remoteByNpId[ev.nutripolo_id] = ev;
      if (ev.id)           remoteByGoogleId[ev.id] = ev;
    }

    // Set of explicitly cancelled Google event IDs (safe delete detection)
    const cancelledSet = new Set(deletedIds);

    // Push local → Google (only for bidirectional calendars)
    if (!isReadonly) {
      for (const c of localConsultations) {
        // Cross-calendar protection: only push if this consultation belongs to this calendar or has no source
        if (c.sourceCalendarId && c.sourceCalendarId !== calId) continue;

        if (!c.googleEventId && !remoteByNpId[c.id]) {
          // Local-only: create on Google
          const client = clients.find(cl => cl.id === c.clienteId);
          const event = this.consultationToEvent(c, client, config.locations);
          const created = await this.createEvent(token, calId, event);
          updateConsultation(c.id, { googleEventId: created.id, sourceCalendarId: calId, lastSyncedAt: new Date().toISOString() });
          stats.pushed++;
        } else if (c.googleEventId && remoteByGoogleId[c.googleEventId]) {
          // Both exist — last-write-wins with tolerance window
          const remote = remoteByGoogleId[c.googleEventId];
          const remoteUpdated = remote.updated ? new Date(remote.updated) : new Date(0);
          // localUpdatedAt = user edit timestamp; lastSyncedAt = fallback for old records
          const localUpdated = c.localUpdatedAt
            ? new Date(c.localUpdatedAt)
            : (c.lastSyncedAt ? new Date(c.lastSyncedAt) : new Date(0));

          const diff = localUpdated.getTime() - remoteUpdated.getTime();

          if (diff > SYNC_TOLERANCE_MS) {
            // Local is newer → push to Google
            const client = clients.find(cl => cl.id === c.clienteId);
            const event = this.consultationToEvent(c, client, config.locations);
            await this.updateEvent(token, calId, c.googleEventId, event);
            updateConsultation(c.id, { lastSyncedAt: new Date().toISOString() });
            stats.updated++;
          } else if (diff < -SYNC_TOLERANCE_MS) {
            // Remote is newer → pull from Google, align localUpdatedAt to prevent re-sync
            const partial = this.eventToConsultation(remote, clients, calId);
            updateConsultation(c.id, {
              ...partial,
              lastSyncedAt: new Date().toISOString(),
              localUpdatedAt: remote.updated || new Date().toISOString(),
            });
            stats.updated++;
          }
          // else: within tolerance → already in sync, skip
        }
      }
    } else {
      // Readonly: for paired records, remote always wins; align timestamps
      for (const c of localConsultations) {
        if (c.googleEventId && remoteByGoogleId[c.googleEventId]) {
          const remote = remoteByGoogleId[c.googleEventId];
          const partial = this.eventToConsultation(remote, clients, calId);
          updateConsultation(c.id, {
            ...partial,
            lastSyncedAt: new Date().toISOString(),
            localUpdatedAt: remote.updated || new Date().toISOString(),
          });
          stats.updated++;
        }
      }
    }

    // Re-read FRESH store state so the pull-loop sees googleEventIds created in the push-loop above.
    // store.consultations is a stale snapshot — useStore.getState() gives the live state.
    const currentConsultations = useStore.getState().consultations;
    const localByGoogleId = {};
    for (const c of currentConsultations) {
      if (c.googleEventId) localByGoogleId[c.googleEventId] = c;
    }

    // Pull remote-only → local (create new consultations from Google events not in NutriPolo)
    for (const ev of remoteEvents) {
      const hasLocalByNpId = ev.nutripolo_id
        ? currentConsultations.find(c => c.id === ev.nutripolo_id)
        : null;
      const hasLocalByGId = ev.id ? localByGoogleId[ev.id] : null;
      if (!hasLocalByNpId && !hasLocalByGId && ev.status !== 'cancelled') {
        const partial = this.eventToConsultation(ev, clients, calId);
        // Pass remote.updated as localUpdatedAt so it matches Google's timestamp — prevents push-back
        addConsultation({
          ...partial,
          tipo: partial.tipo || 'Google Calendar',
          sourceCalendarId: calId,
          localUpdatedAt: ev.updated || new Date().toISOString(),
        });
        stats.pulled++;
      }
    }

    // Delete local consultations only when Google explicitly cancelled the event.
    // Never delete based on absence from search results — that would cause false
    // deletions when a consultation's Google event was moved outside ±30 days.
    // Re-read fresh state for delete phase too.
    const freshConsultations = useStore.getState().consultations;
    const freshLocal = freshConsultations.filter(c => {
      const d = new Date(c.fecha);
      return d >= new Date(timeMin) && d <= new Date(timeMax);
    });

    if (!isReadonly) {
      for (const c of freshLocal) {
        if (c.googleEventId && cancelledSet.has(c.googleEventId)) {
          store.deleteConsultation(c.id);
          stats.deleted++;
        }
      }
    } else {
      // For readonly calendars, also handle deletions from Google
      for (const c of freshLocal) {
        if (c.googleEventId && c.sourceCalendarId === calId && cancelledSet.has(c.googleEventId)) {
          store.deleteConsultation(c.id);
          stats.deleted++;
        }
      }
    }

    return stats;
  },
};
