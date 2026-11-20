import React, { useState } from 'react';
import { CloudOff, RefreshCw, Settings2, Loader2 } from 'lucide-react';
import { Button, useToast } from './UI';
import useStore from '../stores/store';
import { useT, useLocale } from '../i18n';
import { googleCalendar } from '../services/googleCalendarService';
import { driveBackupStatus, uploadDriveBackup } from '../services/driveBackupService';
import { driveBackupAlert } from '../services/backupPolicy';

// "Later" hides it for a few hours, until the app is opened again at most:
// the notice can be put off, never switched off (only the copy itself can).
const SNOOZE_MS = 4 * 60 * 60 * 1000;
let snoozedUntil = 0;

/** Errors fixed by connecting Google again (same as the expired / missing permission cases). */
const RECONNECT_ERRORS = new Set(['drive_reauth', 'drive_no_scope']);

/**
 * Notice on the Dashboard while the copy in Google Drive is not working:
 * Google not connected, connection expired, Drive not allowed, failed uploads
 * or no copy for more than a day. One click reconnects Google when it was
 * set up before; otherwise it opens the right place in Settings.
 */
export function DriveBackupBanner() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const reason = useStore(s => driveBackupStatus(s).reason);
  const drive = useStore(s => s.driveBackup);
  const canReconnect = useStore(s => googleCalendar.canReconnect(s.config.googleCalendar));
  const openSettingsAt = useStore(s => s.openSettingsAt);
  const [, setTick] = useState(0);
  const [working, setWorking] = useState(false);

  const alert = driveBackupAlert({ reason, drive: drive || {} });
  if (!alert || Date.now() < snoozedUntil) return null;

  const reconnectFixes = alert.reason === 'needs_reauth' || alert.reason === 'no_scope'
    || (alert.reason === 'error' && RECONNECT_ERRORS.has(alert.error));
  const oneClick = reconnectFixes && canReconnect;

  const message = alert.reason === 'error'
    ? t.drive_alert_error.replace('{error}', t[alert.error] || alert.error)
    : alert.reason === 'stale'
      ? t.drive_alert_stale.replace('{date}', new Date(alert.since).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' }))
      : t[`drive_alert_${alert.reason}`];

  const reconnect = async () => {
    setWorking(true);
    try {
      await googleCalendar.reconnect();
      const result = await uploadDriveBackup();
      if (result.ok && !result.skipped) toast.success(t.drive_backup_done);
      else if (result.error) toast.error(t.drive_backup_failed.replace('{error}', t[result.error] || result.error));
      else toast.success(t.gcal_reconnected);
    } catch (e) {
      if (e?.message === 'gcal_scope_missing') toast.error(t.gcal_scope_missing);
      else toast.error(t.gcal_connect_error.replace('{error}', e?.message || String(e)));
    } finally {
      setWorking(false);
    }
  };

  const goToSettings = () => openSettingsAt(reconnectFixes || alert.reason === 'not_connected' ? 'settings-gcal' : 'settings-data');

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-3 bg-warning-light border border-warning/30 rounded-soft">
      <CloudOff size={18} className="text-warning shrink-0" />
      <div className="flex-1 min-w-[16rem]">
        <p className="text-sm font-medium text-sage-900">{t.drive_alert_title}</p>
        <p className="text-xs text-sage-700">{message}</p>
      </div>
      <div className="flex items-center gap-2">
        {oneClick ? (
          <Button size="sm" icon={working ? undefined : RefreshCw} onClick={reconnect} disabled={working}>
            {working ? <Loader2 size={13} className="animate-spin" /> : t.drive_alert_reconnect}
          </Button>
        ) : (
          <Button size="sm" icon={Settings2} onClick={goToSettings}>{t.drive_alert_settings}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => { snoozedUntil = Date.now() + SNOOZE_MS; setTick(n => n + 1); }} disabled={working}>
          {t.drive_alert_later}
        </Button>
      </div>
    </div>
  );
}

export default DriveBackupBanner;
