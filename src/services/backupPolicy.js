// Rules for the automatic backups (local and Google Drive). Pure, with tests.

/** The data whose loss hurts: what a drop in it means something went wrong. */
export const CORE_COLLECTIONS = ['clients', 'consultations', 'nutritionPlans', 'invoices'];

/** How many patients, appointments, plans and invoices a backup's data holds. */
export function backupCounts(data) {
  const counts = {};
  for (const key of CORE_COLLECTIONS) counts[key] = Array.isArray(data?.[key]) ? data[key].length : 0;
  return counts;
}

/**
 * A sudden drop from one copy to the next: a list that had data is empty, or
 * a list of 10 or more lost half of it. Deleting a patient or two never
 * counts; a wipe (whatever its cause) does, and then the copy from before it
 * is kept apart instead of being overwritten.
 */
export function looksShrunk(before, after) {
  if (!before || !after) return false;
  return CORE_COLLECTIONS.some(key => {
    const b = before[key] || 0;
    const a = after[key] || 0;
    return b > 0 && (a === 0 || (b >= 10 && a < b / 2));
  });
}

// ── Google Drive ────────────────────────────────────────────────────────────

/** Only the files the app itself creates: it never sees the rest of the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'NutriPolo - Copias de seguridad';
/** Days of copies kept in Drive (one file per day, the last state of that day). */
export const DRIVE_KEEP_DAYS = 30;

export const hasDriveScope = (scopes) => String(scopes || '').split(/\s+/).includes(DRIVE_SCOPE);

/**
 * `nutripolo-copia-2026-11-20.json`; with `time` ('1636') a separate copy of
 * that moment (`nutripolo-copia-2026-11-20-1636.json`), used so a copy after a
 * sudden drop never replaces the day's good one.
 */
export const driveFileName = (date, time = '') => `nutripolo-copia-${date}${time ? `-${time}` : ''}.json`;

const DRIVE_FILE = /^nutripolo-copia-(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?\.json$/;

/** The day of a Drive copy from its name, or null for any other file. */
export function driveFileDate(name) {
  return DRIVE_FILE.exec(String(name || ''))?.[1] || null;
}

/** Copies older than `keepDays` days before `today` ('YYYY-MM-DD'). Other files are never touched. */
export function driveFilesToPrune(files, today, keepDays = DRIVE_KEEP_DAYS) {
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const limit = cutoff.toISOString().slice(0, 10);
  return (files || []).filter(f => {
    const date = driveFileDate(f.name);
    return date && date < limit;
  });
}

/** Drive copies newest first (by name: date, then the time of a separate copy). */
export function sortDriveCopies(files) {
  return (files || []).filter(f => driveFileDate(f.name)).sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Stable code for a Drive error, shown translated:
 *   drive_reauth       the Google connection expired or was revoked
 *   drive_no_scope     Drive was not allowed when connecting Google
 *   drive_api_disabled the Google Drive API is off in the Google Cloud project
 *   drive_quota        the Drive is full
 *   drive_network      no connection (retried on the next run)
 *   drive_error        anything else
 */
export function driveErrorCode(error) {
  const msg = String(error?.message || error || '');
  if (/oauth_invalid_grant|No valid token|\(401\)/.test(msg)) return 'drive_reauth';
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) return 'drive_api_disabled';
  if (/storageQuotaExceeded|quotaExceeded/i.test(msg)) return 'drive_quota';
  if (/insufficientPermissions|insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|\(403\)/i.test(msg)) return 'drive_no_scope';
  if (/network|oauth_network_error|timed? ?out/i.test(msg)) return 'drive_network';
  return 'drive_error';
}

// ── Notice when the Drive copy is not working ──────────────────────────────

/** The Drive copy counts as behind after this long without an upload. */
export const DRIVE_ALERT_STALE_MS = 24 * 60 * 60 * 1000;
/** On opening the app, a notice if the last Drive copy is older than this (or there is none). */
export const DRIVE_OPEN_NOTICE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Why the Dashboard warns about the Drive copy, or null when it is fine (or
 * switched off on purpose). `reason` comes from driveBackupStatus:
 *   { reason: 'not_connected' | 'needs_reauth' | 'no_scope' }
 *   { reason: 'error', error }   the last upload failed (not just offline)
 *   { reason: 'stale', since }   no copy for more than a day (e.g. offline for long)
 */
export function driveBackupAlert({ reason, drive = {}, now = Date.now() }) {
  // Off on purpose, or held because the data is encrypted (said in Settings)
  if (reason === 'disabled' || reason === 'encrypted') return null;
  if (reason) return { reason };
  if (drive.lastError && drive.lastError !== 'drive_network') return { reason: 'error', error: drive.lastError };
  if (drive.lastUploadAt && now - Date.parse(drive.lastUploadAt) > DRIVE_ALERT_STALE_MS) {
    return { reason: 'stale', since: drive.lastUploadAt };
  }
  return null;
}

/** Whether to also say it with a notice on opening the app: never a copy, or none for days. */
export function driveNoticeOnOpen(alert, drive = {}, now = Date.now()) {
  if (!alert) return false;
  return !drive.lastUploadAt || now - Date.parse(drive.lastUploadAt) > DRIVE_OPEN_NOTICE_MS;
}
