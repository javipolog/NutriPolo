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
   * Sync consultations ±30 days for a single Google Calendar.
   * Bidirectional calendars: push locally-modified consultations, then pull.
   * Read-only calendars: pull only. Cancelled events → "cancelada" (never delete).
   *
   * @param {object} store           Zustand store state (useStore.getState())
   * @param {string} token           Valid Google OAuth access token
   * @param {object} calendarConfig  { id, syncMode }
   * @returns {{ pushed: number, pulled: number, updated: number }}
   */
  async syncCalendar(store, token, calendarConfig) {
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

    const consultations = store.consultations;
    const localConsultations = consultations.filter(c => {
      const d = new Date(c.fecha);
      return d >= new Date(timeMin) && d <= new Date(timeMax);
    });

    const stats = { pushed: 0, pulled: 0, updated: 0 };

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
            updateConsultation(c.id, { lastSyncedAt: new Date().toISOString(), syncPending: false });
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
            });
            stats.pushed++;
            continue;
          }

          // Case 2: Linked consultation, locally modified since last sync → update on Google
          if (c.googleEventId && c.sourceCalendarId === calId && c.localUpdatedAt && c.lastSyncedAt) {
            const localTs = new Date(c.localUpdatedAt).getTime();
            const syncTs = new Date(c.lastSyncedAt).getTime();
            if (localTs > syncTs) {
              const remote = remoteByGoogleId[c.googleEventId];
              // Last-write-wins: only push if local is newer than remote
              const remoteTs = remote?.updated ? new Date(remote.updated).getTime() : 0;
              if (localTs > remoteTs) {
                const event = this.consultationToEvent(c, clients);
                await this.withRetry(
                  () => this.updateEvent(token, calId, c.googleEventId, event),
                  { gcalConfig }
                );
                updateConsultation(c.id, { lastSyncedAt: new Date().toISOString() });
                stats.pushed++;
              }
            }
          }
        } catch (e) {
          if (import.meta.env.DEV) console.error(`[GCal Push] Error for consultation ${c.id}:`, e);
          // Mark as pending sync for retry on next cycle
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

        // For bidirectional: skip if local is newer (already pushed above)
        if (isBidirectional && c.localUpdatedAt) {
          const localTs = new Date(c.localUpdatedAt).getTime();
          const remoteTs = remote.updated ? new Date(remote.updated).getTime() : 0;
          if (localTs > remoteTs) continue;
        }

        const partial = this.eventToConsultation(remote, clients, calId);
        updateConsultation(c.id, {
          ...partial,
          lastSyncedAt: new Date().toISOString(),
          localUpdatedAt: remote.updated || new Date().toISOString(),
          syncPending: false,
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
    const latestConsultations = useStore.getState().consultations;
    for (const c of latestConsultations) {
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
