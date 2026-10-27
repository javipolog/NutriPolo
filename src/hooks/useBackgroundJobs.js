import { useEffect, useRef } from 'react';
import useStore, { filterVisibleConsultations } from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';
import { getReminderCandidates, getReminderConfig, isAutoSendable, isQuietTime } from '../services/reminderService';
import { deliverEmailReminder } from './useReminderActions';
import { useT } from '../i18n';

const TICK_MS = 5 * 60 * 1000;

// Consultations with an email in flight, so overlapping ticks never send twice.
const inFlight = new Set();

/**
 * Send the email reminders whose window is open. Runs only with automatic
 * sending enabled, SMTP configured and outside quiet hours.
 * Returns { sent, failed }.
 */
async function runEmailReminders() {
  const { config, consultations, clients } = useStore.getState();
  const rc = getReminderConfig(config);
  if (!rc.email.enabled || !rc.email.auto || !config.smtp?.host) return { sent: 0, failed: 0 };
  if (isQuietTime(new Date(), rc.quietHours)) return { sent: 0, failed: 0 };

  const visible = filterVisibleConsultations(consultations, config.googleCalendar);
  const due = getReminderCandidates({ consultations: visible, clients, config }).filter(isAutoSendable);
  let sent = 0, failed = 0;
  for (const entry of due) {
    const id = entry.consultation.id;
    if (inFlight.has(id)) continue;
    inFlight.add(id);
    try {
      // Re-read: the consultation may have changed while earlier emails were sending.
      const fresh = useStore.getState().consultations.find(c => c.id === id);
      if (!fresh || fresh.estado !== 'programada') continue;
      const result = await deliverEmailReminder(fresh, entry.client);
      if (result.success) sent++; else failed++;
    } finally {
      inFlight.delete(id);
    }
  }
  return { sent, failed };
}

/**
 * Background work that must run while the app is open, whatever view is on
 * screen. Mounted once by AppContent (i.e. after hydration and unlock).
 *
 *  - Google Calendar auto-sync (when connected + autoSync), every 5 min.
 *  - Automatic email reminders, every 5 min (after the sync, when enabled).
 *
 * The app keeps running in the tray with the window closed, so this also
 * runs in the background. Ticks are skipped while offline (e.g. right after
 * waking from sleep) and a run starts as soon as the network is back.
 */
export function useBackgroundJobs({ toast }) {
  const connected = useStore(s => s.config.googleCalendar?.connected);
  const autoSync = useStore(s => s.config.googleCalendar?.autoSync);
  const t = useT();
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  toastRef.current = toast;
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const run = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try { await tick(); } finally { running = false; }
    };
    const tick = async () => {
      if (connected && autoSync) {
        try {
          const stats = await googleCalendar.syncAll(useStore.getState());
          if (!cancelled && stats.conflicts > 0) {
            toastRef.current.info(`${stats.conflicts} conflicto(s) de sincronización resuelto(s) — se conservó la versión más reciente`);
          }
        } catch (e) {
          if (cancelled) return;
          if (useStore.getState().config.googleCalendar?.needsReauth) {
            toastRef.current.error('La sesión de Google Calendar ha caducado. Vuelve a conectar en Configuración.');
          } else if (import.meta.env.DEV) {
            console.warn('[Background sync]', e);
          }
        }
      }
      if (cancelled) return;
      const { sent, failed } = await runEmailReminders();
      if (cancelled) return;
      if (sent) toastRef.current.success(tRef.current.reminders_auto_sent.replace('{n}', sent));
      if (failed) toastRef.current.error(tRef.current.reminders_auto_errors.replace('{n}', failed));
    };
    run();
    const interval = setInterval(run, TICK_MS);
    window.addEventListener('online', run);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', run); };
  }, [connected, autoSync]);
}
