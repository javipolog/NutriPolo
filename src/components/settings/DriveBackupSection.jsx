import React, { useState } from 'react';
import { Cloud, UploadCloud, RotateCcw, RefreshCw, Loader2 } from 'lucide-react';
import { Button, useToast, useConfirm } from '../UI';
import useStore, { errMsg } from '../../stores/store';
import { useT, useLocale } from '../../i18n';
import { driveBackupStatus, uploadDriveBackup, listDriveCopies, loadDriveCopy } from '../../services/driveBackupService';
import { driveFileDate, DRIVE_KEEP_DAYS, hasDriveScope } from '../../services/backupPolicy';
import { googleCalendar } from '../../services/googleCalendarService';
import { Toggle } from './SettingsFields';

/**
 * Copy of the data in the user's Google Drive: switch, status, upload now
 * and restore one of the copies (checked and confirmed like an automatic one).
 */
export function DriveBackupSection({ onRestored }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const enabled = useStore(s => s.config.driveBackup?.enabled !== false);
  const drive = useStore(s => s.driveBackup) || {};
  // A string (not a new object per render): the selector result must be stable
  const reason = useStore(s => driveBackupStatus(s).reason);
  const updateConfig = useStore(s => s.updateConfig);
  const applyBackup = useStore(s => s.applyBackup);
  const canReconnect = useStore(s => googleCalendar.canReconnect(s.config.googleCalendar));
  // Restoring only needs Google with the Drive permission: it stays available
  // with the uploads switched off or held by encryption (it writes through
  // the local store, encrypted when encryption is on).
  const canRestore = useStore(s => {
    const gc = s.config.googleCalendar || {};
    return !!gc.connected && !gc.needsReauth && hasDriveScope(gc.grantedScopes);
  });
  const [uploading, setUploading] = useState(false);
  const [copies, setCopies] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const when = (iso) => new Date(iso).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
  const copyLabel = (f) => {
    const date = driveFileDate(f.name);
    const time = f.modifiedTime ? new Date(f.modifiedTime).toLocaleTimeString(locale, { timeStyle: 'short' }) : '';
    const day = new Date(`${date}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'long' });
    return time ? `${day} · ${time}` : day;
  };

  const uploadNow = async () => {
    setUploading(true);
    const result = await uploadDriveBackup();
    setUploading(false);
    if (result.ok && !result.skipped) toast.success(t.drive_backup_done);
    else if (result.error) toast.error(t.drive_backup_failed.replace('{error}', t[result.error] || result.error));
  };

  const reconnect = async () => {
    setBusy(true);
    try {
      await googleCalendar.reconnect();
      const result = await uploadDriveBackup();
      if (result.ok && !result.skipped) toast.success(t.drive_backup_done);
      else if (result.error) toast.error(t.drive_backup_failed.replace('{error}', t[result.error] || result.error));
    } catch (e) {
      if (e?.message === 'gcal_scope_missing') toast.error(t.gcal_scope_missing);
      else toast.error(t.gcal_connect_error.replace('{error}', e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const showCopies = async () => {
    setBusy(true);
    try {
      const list = await listDriveCopies();
      setCopies(list);
      setSelected(list[0]?.id || '');
    } catch (e) {
      toast.error(t.drive_backup_failed.replace('{error}', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const backup = await loadDriveCopy(selected);
      const summary = t.backup_summary
        .replace('{date}', backup.date ? when(backup.date) : t.backup_summary_no_date)
        .replace('{clients}', backup.counts.clients)
        .replace('{consultations}', backup.counts.consultations)
        .replace('{invoices}', backup.counts.invoices)
        .replace('{plans}', backup.counts.nutritionPlans);
      const ok = await confirm({
        title: t.drive_backup_restore,
        message: `${summary}\n\n${t.backup_auto_restore_confirm}`,
        danger: true,
        confirmText: t.backup_restore_action,
      });
      if (!ok) return;
      const result = await applyBackup(backup);
      toast.success(t.backup_import_success);
      onRestored?.(result);
    } catch (e) {
      toast.error(t.backup_restore_error + ': ' + (e?.code ? t[`backup_${e.code}`] : errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-sage-100 pt-4 space-y-3">
      {ConfirmDialog}
      <p className="text-sm font-medium text-sage-800 flex items-center gap-2"><Cloud size={14} /> {t.drive_backup_title}</p>
      <Toggle
        checked={enabled}
        onChange={v => updateConfig({ driveBackup: { enabled: v } })}
        label={t.drive_backup_enable}
        hint={t.drive_backup_hint.replace('{days}', DRIVE_KEEP_DAYS)}
      />
      {enabled && reason && reason !== 'disabled' && (
        <p className="text-xs text-warning-dark bg-warning-light border border-warning/30 rounded-button px-3 py-2">
          {t[`drive_backup_${reason}`]}
        </p>
      )}
      {enabled && (reason === 'needs_reauth' || reason === 'no_scope') && canReconnect && (
        <Button size="sm" icon={busy ? undefined : RefreshCw} onClick={reconnect} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : t.drive_alert_reconnect}
        </Button>
      )}
      {enabled && !reason && (
        <>
          <p className="text-xs text-sage-500">
            {drive.lastUploadAt
              ? <>{t.drive_backup_last}: <strong className="text-sage-700">{when(drive.lastUploadAt)}</strong></>
              : t.drive_backup_never}
          </p>
          {drive.lastError && (
            <p role="alert" className="text-xs text-danger">{t[drive.lastError] || drive.lastError}</p>
          )}
        </>
      )}
      {(canRestore || (enabled && !reason)) && (
        <div className="flex flex-wrap items-center gap-2">
          {enabled && !reason && (
            <Button variant="ghost" size="sm" icon={UploadCloud} onClick={uploadNow} disabled={uploading || busy}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : t.drive_backup_now}
            </Button>
          )}
          {copies === null ? (
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={showCopies} disabled={busy || uploading}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : t.drive_backup_restore}
            </Button>
          ) : copies.length === 0 ? (
            <span className="text-xs text-sage-500">{t.drive_backup_no_copies}</span>
          ) : (
            <>
              <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                aria-label={t.drive_backup_restore}
                className="text-xs border border-sage-300 rounded-button px-2 py-1.5 bg-white text-sage-700 focus:border-wellness-400 focus:ring-1 focus:ring-wellness-400 outline-none"
              >
                {copies.map(f => <option key={f.id} value={f.id}>{copyLabel(f)}</option>)}
              </select>
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={restore} disabled={busy || !selected}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : t.backup_restore_action}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default DriveBackupSection;
