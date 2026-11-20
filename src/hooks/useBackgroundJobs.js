import { useEffect, useRef } from 'react';
import useStore, { filterVisibleConsultations } from '../stores/store';
import { googleCalendar, shortGcalError } from '../services/googleCalendarService';
import { getReminderCandidates, getReminderConfig, isAutoSendable, isQuietTime, reminderState } from '../services/reminderService';
import { getReviewCandidates, getReviewConfig, isReviewAutoSendable, reviewState } from '../services/reviewRequestService';
import { deliverEmailReminder, deliverReviewEmail } from './useReminderActions';
import { plural, useT } from '../i18n';
import { driveBackupStatus, uploadDriveBackup } from '../services/driveBackupService';
import { driveBackupAlert, driveNoticeOnOpen } from '../services/backupPolicy';

const TICK_MS = 5 * 60 * 1000;

// Emails in flight ('<id>' reminders, 'review:<id>' reviews), so overlapping ticks never send twice.
const inFlight = new Set();
// The "reconnect Google" toast is shown once, not on every tick.
let reauthNotified = false;
// The "automatic backup failed" toast is shown once until a backup works again.
let backupFailureNotified = false;
// Same for "reminders held: the calendar is not up to date".
let staleNotified = false;
// And for "the copy in Google Drive failed".
let driveFailureNotified = false;

// Data whose change refreshes the copies (what a backup holds, see backupCollections).
const BACKED_UP_FIELDS = ['clients', 'measurements', 'consultations', 'nutritionPlans', 'services', 'invoices',
  'clientDocuments', 'emailTemplates', 'planLibrary', 'patientSuggestions', 'sentByEvent'];
const LOCAL_DELAY_MS = 60 * 1000;
const LOCAL_MAX_WAIT_MS = 5 * 60 * 1000;
const DRIVE_CHECK_MS = 60 * 1000;
const DRIVE_QUIET_MS = 3 * 60 * 1000;
const DRIVE_MAX_WAIT_MS = 15 * 60 * 1000;
const DRIVE_STALE_MS = 12 * 60 * 60 * 1000;
const DRIVE_MIN_INTERVAL_MS = 10 * 60 * 1000;   // a few MB each: not more often than this
const DRIVE_ERROR_RETRY_MS = 60 * 60 * 1000;

/** Discreet notice after a sync left new patients in the inbox, with a shortcut to it. */
export function notifySuggestions(toast, t, n) {
  toast.info(plural(t, 'gcal_new_suggestions', n), 8000, {
    label: t.gcal_review_action,
    onClick: () => useStore.getState().setCurrentView('inbox'),
  });
}

const SYNC_FRESH_MS = 60 * 60 * 1000;

/**
 * Google calendars whose appointments may be out of date in the app: the
 * sync failed for them in this tick, or did not run (disconnected, token
 * revoked, automatic sync off and no full sync in the last hour), or the
 * calendar is held by the mass-delete guard. Their appointments may have
 * moved or been cancelled in Google: no automatic reminder for them.
 */
export function staleCalendarIds(gc = {}, { syncRan, syncFailed, failedIds = [], lastFullSyncAt, now = Date.now() }) {
  const enabled = (gc.calendars || []).filter(c => c.syncMode !== 'disabled');
  if (!enabled.length) return new Set();
  const recent = !!lastFullSyncAt && now - new Date(lastFullSyncAt).getTime() < SYNC_FRESH_MS;
  if (!gc.connected || gc.needsReauth || syncFailed || (!syncRan && !recent)) return new Set(enabled.map(c => c.id));
  return new Set([...failedIds, ...enabled.filter(c => c.massDeletePending).map(c => c.id)]);
}

/** Whether a consultation comes from (or lives in) one of the `stale` calendars. */
const fromStaleCalendar = (c, stale) => !!c.googleEventId && (stale.has(c.sourceCalendarId) || (!c.sourceCalendarId && stale.size > 0));

/**
 * Send the email reminders whose window is open. Runs only with automatic
 * sending enabled, SMTP configured and outside quiet hours. Appointments of
 * `stale` calendars wait (see staleCalendarIds); they stay in the panel.
 * Returns { sent, failed, held }.
 */
async function runEmailReminders(stale = new Set()) {
  const { config, consultations, clients } = useStore.getState();
  const rc = getReminderConfig(config);
  if (!rc.email.enabled || !rc.email.auto || !config.smtp?.host) return { sent: 0, failed: 0 };
  if (isQuietTime(new Date(), rc.quietHours)) return { sent: 0, failed: 0 };

  const visible = filterVisibleConsultations(consultations, config.googleCalendar);
  const candidates = getReminderCandidates({ consultations: visible, clients, config }).filter(isAutoSendable);
  const due = candidates.filter(entry => !fromStaleCalendar(entry.consultation, stale));
  const held = candidates.length - due.length;
  let sent = 0, failed = 0;
  for (const entry of due) {
    const id = entry.consultation.id;
    if (inFlight.has(id)) continue;
    inFlight.add(id);
    try {
      // Re-check against fresh state: while earlier emails were sending, this
      // one may have been sent by hand, rescheduled, unlinked or opted out.
      const state = useStore.getState();
      const fresh = state.consultations.find(c => c.id === id);
      if (!fresh || fresh.estado !== 'programada' || !fresh.clienteId) continue;
      const client = state.clients.find(c => c.id === fresh.clienteId);
      if (!client) continue;
      const current = reminderState({ consultation: fresh, client, channel: 'email', config: state.config, now: Date.now() });
      if (!isAutoSendable({ ...entry, consultation: fresh, client, state: current, record: fresh.reminders?.email })) continue;
      const result = await deliverEmailReminder(fresh, client);
      if (result.success) sent++; else failed++;
    } finally {
      inFlight.delete(id);
    }
  }
  return { sent, failed, held };
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
      if (!fresh || !fresh.clienteId) continue;
      const client = state.clients.find(c => c.id === fresh.clienteId);
      if (!client) continue;
      const current = reviewState({
        consultation: fresh, client, channel: 'email',
        config: state.config, now: Date.now(), history: state.consultations,
      });
      if (!isReviewAutoSendable({ ...entry, consultation: fresh, client, state: current, record: fresh.reviewRequest?.email })) continue;
      const result = await deliverReviewEmail(fresh, client);
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
 *  - Daily automatic backup, checked now and every 5 min (also offline),
 *    and today's copy refreshed a minute after every change.
 *  - Copy in Google Drive a few minutes after changes (driveBackupService).
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

  // The app may live in the tray for weeks: the daily copy cannot wait for a restart.
  useEffect(() => {
    // Only in the desktop app (the browser preview has no data folder).
    if (typeof window.__TAURI_IPC__ !== 'function') return undefined;
    const backup = async () => {
      const result = await useStore.getState().runAutoBackup();
      if (result?.ok === false && !backupFailureNotified) {
        backupFailureNotified = true;
        toastRef.current.error(tRef.current.backup_auto_failed.replace('{error}', result.error), 15000);
      } else if (result?.ok) {
        backupFailureNotified = false;
      }
    };
    backup();
    const interval = setInterval(backup, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Copies that follow the data: today's local copy is rewritten a minute
  // after the last change (5 at most while changes keep coming), and the
  // copy in Google Drive 3 minutes after (15 at most, never more often than
  // every 10). Drive also gets one when its last copy is older than 12 hours.
  useEffect(() => {
    if (typeof window.__TAURI_IPC__ !== 'function') return undefined;
    let localTimer = null;
    let localFirstChange = 0;
    let driveDirtySince = 0;
    let driveLastChange = 0;

    const refreshLocal = async () => {
      localTimer = null;
      localFirstChange = 0;
      const result = await useStore.getState().runAutoBackup({ refresh: true });
      if (result?.ok === false && !backupFailureNotified) {
        backupFailureNotified = true;
        toastRef.current.error(tRef.current.backup_auto_failed.replace('{error}', result.error), 15000);
      }
    };

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (!BACKED_UP_FIELDS.some(k => state[k] !== prev[k])) return;
      const now = Date.now();
      // Local: debounced, but never more than LOCAL_MAX_WAIT behind
      if (!localFirstChange) localFirstChange = now;
      clearTimeout(localTimer);
      const wait = Math.max(0, Math.min(LOCAL_DELAY_MS, localFirstChange + LOCAL_MAX_WAIT_MS - now));
      localTimer = setTimeout(refreshLocal, wait);
      // Drive: picked up by the check below
      if (!driveDirtySince) driveDirtySince = now;
      driveLastChange = now;
    });

    const checkDrive = async () => {
      if (!navigator.onLine || !driveBackupStatus().available) return;
      const st = useStore.getState().driveBackup || {};
      const now = Date.now();
      // Errors that need the user (permission, API off, full Drive): not every minute
      if (st.lastError && st.lastError !== 'drive_network' && st.lastErrorAt && now - new Date(st.lastErrorAt).getTime() < DRIVE_ERROR_RETRY_MS) return;
      const sinceUpload = st.lastUploadAt ? now - new Date(st.lastUploadAt).getTime() : Infinity;
      const stale = sinceUpload > DRIVE_STALE_MS;
      const due = driveDirtySince && sinceUpload >= DRIVE_MIN_INTERVAL_MS
        && (now - driveLastChange >= DRIVE_QUIET_MS || now - driveDirtySince >= DRIVE_MAX_WAIT_MS);
      if (!stale && !due) return;
      driveDirtySince = 0;
      const result = await uploadDriveBackup();
      if (result?.ok === false && !result.skipped && result.error !== 'drive_network' && !driveFailureNotified) {
        driveFailureNotified = true;
        toastRef.current.error(tRef.current.drive_backup_failed.replace('{error}', tRef.current[result.error] || result.error), 15000);
      } else if (result?.ok) {
        driveFailureNotified = false;
      }
    };
    // On opening: if the Drive copy is not working and there has been none for
    // days (or ever), say it once, besides the notice on the Dashboard.
    const openNotice = setTimeout(() => {
      const state = useStore.getState();
      const alert = driveBackupAlert({ reason: driveBackupStatus(state).reason, drive: state.driveBackup || {} });
      if (!driveNoticeOnOpen(alert, state.driveBackup || {})) return;
      toastRef.current.warning(tRef.current.drive_notice_open, 15000, {
        label: tRef.current.drive_notice_action,
        onClick: () => useStore.getState().setCurrentView('dashboard'),
      });
    }, 90_000);   // after the first upload attempt
    const driveInterval = setInterval(checkDrive, DRIVE_CHECK_MS);
    const firstDrive = setTimeout(checkDrive, 30_000);   // after the first sync settles
    window.addEventListener('online', checkDrive);

    // Closing the window for good: try to give today's copy the last changes (best effort)
    const onQuit = () => { if (localTimer) { clearTimeout(localTimer); refreshLocal(); } };
    window.addEventListener('beforeunload', onQuit);

    return () => {
      unsubscribe();
      clearTimeout(localTimer);
      clearInterval(driveInterval);
      clearTimeout(firstDrive);
      clearTimeout(openNotice);
      window.removeEventListener('online', checkDrive);
      window.removeEventListener('beforeunload', onQuit);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const run = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try { await tick(); } finally { running = false; }
    };
    const tick = async () => {
      let syncRan = false, syncFailed = false, failedIds = [];
      if (connected && autoSync) {
        syncRan = true;
        try {
          const stats = await googleCalendar.syncAll();
          failedIds = (stats.errorDetails || []).filter(d => d.failed).map(d => d.calendarId);
          // Shown in the Agenda until a sync works for every calendar
          const failed = (stats.errorDetails || []).filter(d => d.failed);
          useStore.getState().setSyncAudit({ lastError: failed.length ? failed.map(d => `${d.calendar}: ${d.message}`).join(' · ') : null });
          reauthNotified = false;
          if (!cancelled && stats.conflicts > 0) {
            toastRef.current.info(tRef.current.gcal_bg_conflicts.replace('{n}', stats.conflicts));
          }
          if (!cancelled && stats.suggested > 0) notifySuggestions(toastRef.current, tRef.current, stats.suggested);
        } catch (e) {
          syncFailed = true;
          useStore.getState().setSyncAudit({ lastError: shortGcalError(e) });
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
      const state = useStore.getState();
      const stale = staleCalendarIds(state.config.googleCalendar, {
        syncRan, syncFailed, failedIds, lastFullSyncAt: state.syncAudit?.lastFullSyncAt,
      });
      const { sent, failed, held } = await runEmailReminders(stale);
      if (held && !staleNotified) {
        staleNotified = true;
        toastRef.current.warning(plural(tRef.current, 'reminders_held_stale', held), 12000);
      } else if (!held) {
        staleNotified = false;
      }
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
