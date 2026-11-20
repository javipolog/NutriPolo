// Copy of the data in the user's Google Drive, through the Google connection
// of the calendar (scope drive.file: the app only sees its own folder).
// One file per day, updated during the day; DRIVE_KEEP_DAYS days kept.
import { invoke } from '@tauri-apps/api/tauri';
import useStore, { currentBackupSnapshot, hasData, readBackup, todayISO } from '../stores/store';
import { googleCalendar } from './googleCalendarService';
import {
  DRIVE_FOLDER_NAME, driveFileName, driveFilesToPrune, sortDriveCopies,
  backupCounts, looksShrunk, hasDriveScope, driveErrorCode,
} from './backupPolicy';

/**
 * Whether the Drive copy can run, and why not:
 *   disabled       switched off in Settings
 *   not_connected  Google is not connected
 *   needs_reauth   the Google connection expired
 *   no_scope       connected without the Drive permission (reconnect)
 *   encrypted      the data is encrypted at rest: the copy would leave it in
 *                  plain text in Drive, so it does not run
 */
export function driveBackupStatus(state = useStore.getState()) {
  const gc = state.config?.googleCalendar || {};
  if (state.config?.driveBackup?.enabled === false) return { available: false, reason: 'disabled' };
  if (state.driveBackup?.vaultEncrypted) return { available: false, reason: 'encrypted' };
  if (gc.needsReauth) return { available: false, reason: 'needs_reauth' };
  if (!gc.connected) return { available: false, reason: 'not_connected' };
  if (!hasDriveScope(gc.grantedScopes)) return { available: false, reason: 'no_scope' };
  return { available: true, reason: null };
}

/** Whether the data is encrypted at rest. If it cannot be told, taken as yes: never risk plain text. */
const vaultEncrypted = () => invoke('encryption_is_enabled').then(Boolean).catch(() => true);

const isEncryptedRefusal = (e) => String(e?.message || e).includes('drive_encrypted');

const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

async function backupFolder(token, { fresh = false } = {}) {
  const known = useStore.getState().driveBackup?.folderId;
  if (known && !fresh) return known;
  const id = await invoke('gdrive_find_or_create_folder', { accessToken: token, name: DRIVE_FOLDER_NAME });
  useStore.getState().setDriveBackupState({ folderId: id });
  return id;
}

async function listFolder(token) {
  let folderId = await backupFolder(token);
  try {
    return { folderId, files: await invoke('gdrive_list_files', { accessToken: token, folderId }) };
  } catch (e) {
    // The folder was deleted in Drive: make a new one
    if (!/\(404\)/.test(String(e))) throw e;
    folderId = await backupFolder(token, { fresh: true });
    return { folderId, files: [] };
  }
}

let running = null;

/**
 * Upload the current data. Today's file is replaced with the latest state;
 * if the data dropped suddenly since the last upload (see looksShrunk), the
 * new state goes to a separate file of that moment for the rest of the day,
 * so the day's good copy stays as it was. Copies older than the kept days
 * are deleted. Returns { ok, skipped?, reason?, error? }.
 */
export function uploadDriveBackup() {
  if (running) return running;
  running = (async () => {
    // With at-rest encryption on, never send the data out in plain text
    const encrypted = await vaultEncrypted();
    if (!!useStore.getState().driveBackup?.vaultEncrypted !== encrypted) {
      useStore.getState().setDriveBackupState({ vaultEncrypted: encrypted });
    }
    const state = useStore.getState();
    const status = driveBackupStatus(state);
    if (!status.available) return { ok: false, skipped: true, reason: status.reason };
    if (!hasData(state)) return { ok: true, skipped: true };
    const setStatus = useStore.getState().setDriveBackupState;
    try {
      const token = await googleCalendar.ensureToken();
      const snapshot = currentBackupSnapshot();
      const counts = backupCounts(snapshot.data);
      const today = todayISO();
      const { folderId, files } = await listFolder(token);

      const prev = useStore.getState().driveBackup || {};
      let name = prev.target?.date === today ? prev.target.name : driveFileName(today);
      let target = prev.target?.date === today ? prev.target : null;
      const existing = files.find(f => f.name === name);
      if (existing && looksShrunk(prev.lastCounts, counts)) {
        name = driveFileName(today, hhmm());
        target = { date: today, name };
      }
      const fileId = files.find(f => f.name === name)?.id || null;
      // Encryption may have been turned on while the token and the folder
      // were fetched: check again right before the data leaves (the backend
      // refuses too, at the moment of sending).
      if (await vaultEncrypted()) {
        setStatus({ vaultEncrypted: true });
        return { ok: false, skipped: true, reason: 'encrypted' };
      }
      await invoke('gdrive_upload_file', { accessToken: token, folderId, name, content: JSON.stringify(snapshot), fileId });

      for (const old of driveFilesToPrune(files, today)) {
        await invoke('gdrive_delete_file', { accessToken: token, fileId: old.id }).catch(() => {});
      }
      setStatus({ lastUploadAt: new Date().toISOString(), lastFile: name, lastCounts: counts, target, lastError: null, lastErrorAt: null });
      return { ok: true };
    } catch (e) {
      if (isEncryptedRefusal(e)) {
        setStatus({ vaultEncrypted: true });
        return { ok: false, skipped: true, reason: 'encrypted' };
      }
      const code = driveErrorCode(e);
      setStatus({ lastError: code, lastErrorAt: new Date().toISOString() });
      if (import.meta.env.DEV) console.warn('[Drive backup]', e);
      return { ok: false, error: code };
    }
  })().finally(() => { running = null; });
  return running;
}

/** The copies in Drive, newest first ({ id, name, modifiedTime, size }). */
export async function listDriveCopies() {
  const token = await googleCalendar.ensureToken();
  const { files } = await listFolder(token);
  return sortDriveCopies(files);
}

/** Download and check a Drive copy (like loadAutoBackup); nothing changes yet. */
export async function loadDriveCopy(fileId) {
  const token = await googleCalendar.ensureToken();
  const raw = await invoke('gdrive_download_file', { accessToken: token, fileId });
  return readBackup(JSON.parse(raw));
}
