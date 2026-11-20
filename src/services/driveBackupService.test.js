import { describe, it, expect, vi, beforeEach } from 'vitest';

// A Drive in memory instead of the Rust commands
const drive = { folders: {}, files: {}, nextId: 1 };
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(async (cmd, args) => {
    const id = () => `id${drive.nextId++}`;
    switch (cmd) {
      case 'gdrive_find_or_create_folder': {
        const found = Object.entries(drive.folders).find(([, name]) => name === args.name);
        if (found) return found[0];
        const fid = id(); drive.folders[fid] = args.name; return fid;
      }
      case 'gdrive_list_files':
        if (!drive.folders[args.folderId]) throw 'Drive list failed (404) [notFound]: File not found';
        return Object.values(drive.files).filter(f => f.parent === args.folderId);
      case 'gdrive_upload_file': {
        if (args.fileId && drive.files[args.fileId]) {
          drive.files[args.fileId].content = args.content;
          return drive.files[args.fileId];
        }
        const f = { id: id(), name: args.name, parent: args.folderId, content: args.content };
        drive.files[f.id] = f;
        return f;
      }
      case 'gdrive_delete_file': delete drive.files[args.fileId]; return null;
      case 'gdrive_download_file': return drive.files[args.fileId].content;
      default: return null;
    }
  }),
}));

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: useStore, todayISO } = await import('../stores/store');
const { uploadDriveBackup, listDriveCopies, loadDriveCopy, driveBackupStatus } = await import('./driveBackupService');
const { DRIVE_SCOPE, driveFileName } = await import('./backupPolicy');

const initial = useStore.getState();
const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, nombre: `Cliente ${i}` }));
const connected = (extra = {}) => ({
  ...initial.config,
  googleCalendar: {
    ...initial.config.googleCalendar,
    connected: true,
    grantedScopes: `https://www.googleapis.com/auth/calendar.events ${DRIVE_SCOPE}`,
    accessToken: 'token', expiresAt: Date.now() + 3600_000,
    ...extra,
  },
});
const filesNamed = () => Object.values(drive.files).map(f => f.name).sort();
const contentOf = (name) => JSON.parse(Object.values(drive.files).find(f => f.name === name).content);

beforeEach(() => {
  drive.folders = {}; drive.files = {}; drive.nextId = 1;
  useStore.setState({ ...initial, config: connected(), clients: many(12), consultations: [{ id: 'c1' }] }, true);
});

describe('Google Drive copy', () => {
  it('keeps one file per day in its own folder, updated with every upload', async () => {
    expect(await uploadDriveBackup()).toEqual({ ok: true });
    useStore.setState({ clients: many(13) });
    expect(await uploadDriveBackup()).toEqual({ ok: true });

    const today = driveFileName(todayISO());
    expect(Object.values(drive.folders)).toEqual(['NutriPolo - Copias de seguridad']);
    expect(filesNamed()).toEqual([today]);
    expect(contentOf(today).data.clients).toHaveLength(13);
    expect(useStore.getState().driveBackup).toMatchObject({ lastFile: today, lastError: null, lastCounts: { clients: 13 } });
  });

  it('never overwrites the day\'s copy with a sudden drop: that goes to a separate file', async () => {
    await uploadDriveBackup();
    useStore.setState({ clients: many(2) });
    await uploadDriveBackup();
    useStore.setState({ clients: many(3) });
    await uploadDriveBackup();

    const today = driveFileName(todayISO());
    const names = filesNamed();
    expect(names).toHaveLength(2);
    expect(contentOf(today).data.clients).toHaveLength(12);
    const separate = names.find(n => n !== today);
    expect(separate).toMatch(new RegExp(`^nutripolo-copia-${todayISO()}-\\d{4}\\.json$`));
    expect(contentOf(separate).data.clients).toHaveLength(3);
  });

  it('deletes its copies older than 30 days and leaves other files alone', async () => {
    await uploadDriveBackup();
    const folder = Object.keys(drive.folders)[0];
    drive.files.old = { id: 'old', name: 'nutripolo-copia-2020-01-01.json', parent: folder, content: '{}' };
    drive.files.mine = { id: 'mine', name: 'notas de Raquel.txt', parent: folder, content: 'x' };
    await uploadDriveBackup();
    expect(drive.files.old).toBeUndefined();
    expect(drive.files.mine).toBeDefined();
  });

  it('makes a new folder if the one it knew was deleted in Drive', async () => {
    await uploadDriveBackup();
    drive.folders = {}; drive.files = {};
    expect(await uploadDriveBackup()).toEqual({ ok: true });
    expect(filesNamed()).toEqual([driveFileName(todayISO())]);
  });

  it('lists the copies and reads one back as a backup', async () => {
    await uploadDriveBackup();
    const [copy] = await listDriveCopies();
    const backup = await loadDriveCopy(copy.id);
    expect(backup.counts).toMatchObject({ clients: 12, consultations: 1 });
  });

  it('waits for the Drive permission, and does nothing with no data or switched off', async () => {
    useStore.setState({ config: connected({ grantedScopes: 'https://www.googleapis.com/auth/calendar.events' }) });
    expect(driveBackupStatus().reason).toBe('no_scope');
    expect(await uploadDriveBackup()).toMatchObject({ ok: false, skipped: true, reason: 'no_scope' });

    useStore.setState({ config: { ...connected(), driveBackup: { enabled: false } } });
    expect(await uploadDriveBackup()).toMatchObject({ skipped: true, reason: 'disabled' });

    useStore.setState({ config: connected(), clients: [], consultations: [] });
    expect(await uploadDriveBackup()).toEqual({ ok: true, skipped: true });
    expect(filesNamed()).toEqual([]);
  });
});
