/**
 * googleCalendarService.js — NutriPolo
 * ======================================
 * Wrapper over Tauri IPC commands for Google Calendar integration.
 * The Rust backend handles the actual HTTP requests; this module
 * translates between NutriPolo data structures and Google Calendar
 * event format, and orchestrates read-only sync (Google → NutriPolo).
 * NEVER writes, updates or deletes events in Google Calendar.
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

  // ── Read-only sync ─────────────────────────────────────────────────────

  /**
   * Sync consultations ±30 days from all enabled Google Calendars into NutriPolo.
   * READ-ONLY: never creates, updates or deletes events in Google Calendar.
   *
   * @param {object} store  Zustand store state (useStore.getState())
   * @returns {{ pulled: number, updated: number, errors: number }}
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
    // Backwards compat: old single-calendar format (always readonly now)
    if (!enabledCalendars.length && gcalConfig.calendarId) {
      enabledCalendars = [{ id: gcalConfig.calendarId, syncMode: 'readonly' }];
    }
    if (!enabledCalendars.length) {
      if (import.meta.env.DEV) console.warn('[GCal Sync] No enabled calendars found');
      return { pushed: 0, pulled: 0, updated: 0, deleted: 0, errors: 0 };
    }

    const totalStats = { pulled: 0, updated: 0, errors: 0 };
    for (const cal of enabledCalendars) {
      try {
        const freshStore = useStore.getState();
        const stats = await this.syncCalendar(freshStore, token, cal);
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
   * Sync consultations ±30 days for a single Google Calendar.
   * READ-ONLY: pulls events from Google into NutriPolo. Never writes to Google.
   * Cancelled events in Google update the local status to "cancelada" (no deletion).
   *
   * @param {object} store           Zustand store state (useStore.getState())
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode }
   * @returns {{ pulled: number, updated: number }}
   */
  async syncCalendar(store, token, calendarConfig) {
    const { clients, updateConsultation, addConsultation } = store;
    const calId = calendarConfig.id;

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

    const stats = { pulled: 0, updated: 0 };

    // Index remote events for O(1) lookups
    const remoteByGoogleId = {};
    for (const ev of remoteEvents) {
      if (ev.id) remoteByGoogleId[ev.id] = ev;
    }

    // Update existing local consultations from remote data
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
          localUpdatedAt: ev.updated || new Date().toISOString(),
        });
        stats.pulled++;
      }
    }

    // Cancelled events in Google → mark local consultation as "cancelada" (never delete)
    const cancelledSet = new Set(deletedIds);
    const freshConsultations = useStore.getState().consultations;
    for (const c of freshConsultations) {
      if (c.googleEventId && c.sourceCalendarId === calId && cancelledSet.has(c.googleEventId)) {
        if (c.estado !== 'cancelada') {
          updateConsultation(c.id, { estado: 'cancelada' });
          stats.updated++;
        }
      }
    }

    return stats;
  },
};
