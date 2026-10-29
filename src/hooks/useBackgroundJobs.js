import { useEffect, useRef } from 'react';
import useStore, { filterVisibleConsultations } from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';
import { getReminderCandidates, getReminderConfig, isAutoSendable, isQuietTime } from '../services/reminderService';
import { getReviewCandidates, getReviewConfig, isReviewAutoSendable, reviewState } from '../services/reviewRequestService';
import { deliverEmailReminder, deliverReviewEmail } from './useReminderActions';
import { useT } from '../i18n';

const TICK_MS = 5 * 60 * 1000;

// Emails in flight ('<id>' reminders, 'review:<id>' reviews), so overlapping ticks never send twice.
const inFlight = new Set();
// The "reconnect Google" toast is shown once, not on every tick.
let reauthNotified = false;

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
 * Send the Google review requests by email whose delay has passed. Same
 * conditions as runEmailReminders (auto + SMTP, outside quiet hours).
 */
async function runReviewEmails() {
  const { config, consultations, clients } = useStore.getState();
  const rv = getReviewConfig(config);
  if (!rv.enabled || !rv.email.enabled || !rv.email.auto || !config.smtp?.host) return { sent: 0, failed: 0 };
  if (isQuietTime(new Date(), getReminderConfig(config).quietHours)) return { sent: 0, failed: 0 };

  const visible = filterVisibleConsultations(consultations, config.googleCalendar);
  const due = getReviewCandidates({ consultations: visible, history: consultations, clients, config })
    .filter(isReviewAutoSendable);
  let sent = 0, failed = 0;
  for (const entry of due) {
    const id = entry.consultation.id;
    const key = `review:${id}`;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    try {
      // Re-check against fresh state: an earlier email in this run may have
      // asked the same client already.
      const state = useStore.getState();
      const fresh = state.consultations.find(c => c.id === id);
      if (!fresh) continue;
      const current = reviewState({
        consultation: fresh, client: entry.client, channel: 'email',
        config: state.config, now: Date.now(), history: state.consultations,
      });
      if (!isReviewAutoSendable({ ...entry, consultation: fresh, state: current, record: fresh.reviewRequest?.email })) continue;
      const result = await deliverReviewEmail(fresh, entry.client);
      if (result.success) sent++; else failed++;
    } finally {
      inFlight.delete(key);
    }
  }
  return { sent, failed };
}

/**
 * Background work that must run while the app is open, whatever view is on
 * screen. Mounted once by AppContent (i.e. after hydration and unlock).
 *
 *  - Google Calendar auto-sync (when connected + autoSync), every 5 min.
 *  - Automatic email reminders and Google review requests, every 5 min
 *    (after the sync, when enabled).
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
          const stats = await googleCalendar.syncAll();
          reauthNotified = false;
          if (!cancelled && stats.conflicts > 0) {
            toastRef.current.info(tRef.current.gcal_bg_conflicts.replace('{n}', stats.conflicts));
          }
        } catch (e) {
          if (cancelled) return;
          if (useStore.getState().config.googleCalendar?.needsReauth) {
            // Once per session: the sync stops until the user reconnects.
            if (!reauthNotified) toastRef.current.error(tRef.current.gcal_bg_reauth);
            reauthNotified = true;
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
      const reviews = await runReviewEmails();
      if (cancelled) return;
      if (reviews.sent) toastRef.current.success(tRef.current.review_auto_sent.replace('{n}', reviews.sent));
      if (reviews.failed) toastRef.current.error(tRef.current.review_auto_errors.replace('{n}', reviews.failed));
    };
    run();
    const interval = setInterval(run, TICK_MS);
    window.addEventListener('online', run);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', run); };
  }, [connected, autoSync]);
}
