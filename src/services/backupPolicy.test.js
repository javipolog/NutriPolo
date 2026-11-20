import { describe, it, expect } from 'vitest';
import {
  backupCounts, looksShrunk, driveFileName, driveFileDate, driveFilesToPrune, sortDriveCopies,
  hasDriveScope, driveErrorCode, DRIVE_SCOPE, driveBackupAlert, driveNoticeOnOpen,
} from './backupPolicy';

const counts = (clients, consultations = 0, nutritionPlans = 0, invoices = 0) => ({ clients, consultations, nutritionPlans, invoices });

describe('backupCounts', () => {
  it('counts the four lists, treating anything else as empty', () => {
    expect(backupCounts({ clients: [1, 2], consultations: [1], invoices: 'x' })).toEqual(counts(2, 1, 0, 0));
    expect(backupCounts(null)).toEqual(counts(0));
  });
});

describe('looksShrunk', () => {
  it('flags a list emptied or a large list halved', () => {
    expect(looksShrunk(counts(113, 298), counts(0, 298))).toBe(true);
    expect(looksShrunk(counts(113, 298), counts(113, 120))).toBe(true);
    expect(looksShrunk(counts(3), counts(0))).toBe(true);
  });

  it('does not flag everyday deletions nor growth', () => {
    expect(looksShrunk(counts(113, 298), counts(111, 290))).toBe(false);
    expect(looksShrunk(counts(4), counts(1))).toBe(false);   // small lists: only emptying counts
    expect(looksShrunk(counts(0), counts(0))).toBe(false);
    expect(looksShrunk(counts(10), counts(50))).toBe(false);
    expect(looksShrunk(null, counts(0))).toBe(false);
  });
});

describe('Drive copies', () => {
  it('names one file per day, and separate copies with the time', () => {
    expect(driveFileName('2026-11-20')).toBe('nutripolo-copia-2026-11-20.json');
    expect(driveFileName('2026-11-20', '1636')).toBe('nutripolo-copia-2026-11-20-1636.json');
    expect(driveFileDate('nutripolo-copia-2026-11-20-1636.json')).toBe('2026-11-20');
    expect(driveFileDate('nutripolo-copia-2026-11-20.json')).toBe('2026-11-20');
    expect(driveFileDate('Mi documento.json')).toBeNull();
  });

  it('prunes only its own copies older than the kept days', () => {
    const files = [
      { id: 'a', name: 'nutripolo-copia-2026-10-20.json' },
      { id: 'b', name: 'nutripolo-copia-2026-10-20-0930.json' },
      { id: 'c', name: 'nutripolo-copia-2026-10-21.json' },
      { id: 'd', name: 'nutripolo-copia-2026-11-20.json' },
      { id: 'e', name: 'otra-cosa-2020-01-01.json' },
    ];
    expect(driveFilesToPrune(files, '2026-11-20', 30).map(f => f.id)).toEqual(['a', 'b']);
  });

  it('lists copies newest first', () => {
    const files = [
      { name: 'nutripolo-copia-2026-11-19.json' },
      { name: 'nutripolo-copia-2026-11-20.json' },
      { name: 'nutripolo-copia-2026-11-20-1636.json' },
      { name: 'notas.txt' },
    ];
    expect(sortDriveCopies(files).map(f => f.name)).toEqual([
      'nutripolo-copia-2026-11-20.json', 'nutripolo-copia-2026-11-20-1636.json', 'nutripolo-copia-2026-11-19.json',
    ]);
  });

  it('knows whether Drive was allowed when connecting Google', () => {
    expect(hasDriveScope(`https://www.googleapis.com/auth/calendar.events ${DRIVE_SCOPE}`)).toBe(true);
    expect(hasDriveScope('https://www.googleapis.com/auth/calendar.events')).toBe(false);
    expect(hasDriveScope(undefined)).toBe(false);
  });

  it('turns backend errors into codes the settings can explain', () => {
    expect(driveErrorCode('Drive upload failed (403) [accessNotConfigured]: Google Drive API has not been used in project 1')).toBe('drive_api_disabled');
    expect(driveErrorCode('Drive list failed (403) [insufficientPermissions]: Insufficient Permission')).toBe('drive_no_scope');
    expect(driveErrorCode('Drive upload failed (403) [storageQuotaExceeded]: full')).toBe('drive_quota');
    expect(driveErrorCode(new Error('oauth_invalid_grant'))).toBe('drive_reauth');
    expect(driveErrorCode('Drive upload failed: network error: dns')).toBe('drive_network');
    expect(driveErrorCode('Drive upload failed (500) [backendError]: oops')).toBe('drive_error');
  });
});

describe('Drive copy notice', () => {
  const now = Date.parse('2026-11-20T18:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();

  it('warns until Google is connected with the Drive permission', () => {
    expect(driveBackupAlert({ reason: 'not_connected', now })).toEqual({ reason: 'not_connected' });
    expect(driveBackupAlert({ reason: 'no_scope', now })).toEqual({ reason: 'no_scope' });
    expect(driveBackupAlert({ reason: 'needs_reauth', now })).toEqual({ reason: 'needs_reauth' });
  });

  it('respects the copy switched off, and is quiet while it works', () => {
    expect(driveBackupAlert({ reason: 'disabled', now })).toBeNull();
    expect(driveBackupAlert({ reason: 'encrypted', now })).toBeNull();
    expect(driveBackupAlert({ reason: null, drive: { lastUploadAt: hoursAgo(2) }, now })).toBeNull();
    // Offline for a while: only once it is a day behind
    expect(driveBackupAlert({ reason: null, drive: { lastUploadAt: hoursAgo(5), lastError: 'drive_network' }, now })).toBeNull();
  });

  it('warns about failed uploads and about a copy more than a day old', () => {
    expect(driveBackupAlert({ reason: null, drive: { lastUploadAt: hoursAgo(1), lastError: 'drive_api_disabled' }, now }))
      .toEqual({ reason: 'error', error: 'drive_api_disabled' });
    expect(driveBackupAlert({ reason: null, drive: { lastUploadAt: hoursAgo(30), lastError: 'drive_network' }, now }))
      .toEqual({ reason: 'stale', since: hoursAgo(30) });
  });

  it('also says it on opening when there has never been a copy or none for 3 days', () => {
    const alert = { reason: 'no_scope' };
    expect(driveNoticeOnOpen(alert, {}, now)).toBe(true);
    expect(driveNoticeOnOpen(alert, { lastUploadAt: hoursAgo(80) }, now)).toBe(true);
    expect(driveNoticeOnOpen(alert, { lastUploadAt: hoursAgo(30) }, now)).toBe(false);
    expect(driveNoticeOnOpen(null, {}, now)).toBe(false);
  });
});
