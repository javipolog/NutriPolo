import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, History, RotateCcw, FilePlus, Loader2 } from 'lucide-react';
import useStore, { clearLoadFailure, flushAllPending } from '../stores/store';
import { useConfirm } from './UI';

const BACKUP_ERRORS = {
  not_a_backup: 'La copia está dañada o no es una copia de NutriPolo.',
  backup_newer: 'La copia es de una versión más nueva de NutriPolo.',
};

const formatDay = (iso) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * LoadErrorScreen — shown when the main data file exists but cannot be read
 * (corrupt JSON, failed decryption…). Writes are blocked while it is shown,
 * so the empty default state can never overwrite the real file. The user
 * can retry, restore an automatic backup, or start empty.
 *
 * A backup is read and checked before anything moves: if it fails, the
 * unreadable file stays in place and writes stay blocked, so "Reintentar"
 * is always safe. Only then is the file moved aside (`*.corrupt-<timestamp>`,
 * never deleted).
 */
export const LoadErrorScreen = ({ failure, onResolved }) => {
  const loadAutoBackup = useStore(s => s.loadAutoBackup);
  const applyBackup = useStore(s => s.applyBackup);
  const getAutoBackupInfo = useStore(s => s.getAutoBackupInfo);
  const { confirm, ConfirmDialog } = useConfirm();
  const [backups, setBackups] = useState([]);
  const [safety, setSafety] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getAutoBackupInfo().then(info => {
      setBackups([...(info.dates || [])].reverse());
      setSafety(info.safety);
    });
  }, [getAutoBackupInfo]);

  const run = async (restoreKey) => {
    if (!restoreKey && !(await confirm({
      title: 'Empezar sin datos',
      message: 'La aplicación se abrirá vacía. El archivo que no se puede leer se guarda aparte (no se borra), por si se puede recuperar más adelante.',
      danger: true,
      confirmText: 'Empezar vacía',
    }))) return;
    setBusy(true);
    setError('');
    try {
      const backup = restoreKey ? await loadAutoBackup(restoreKey) : null;
      await invoke('quarantine_data', { key: failure.key });
      clearLoadFailure();
      if (backup) await applyBackup(backup, { safety: false });
      else useStore.setState({});   // persist the empty state
      if (!(await flushAllPending())) throw new Error('No se han podido guardar los datos. Comprueba que hay espacio en el disco.');
      onResolved();
    } catch (e) {
      setError(BACKUP_ERRORS[e?.code] || String(e?.message || e));
      setBusy(false);
    }
  };

  const backupButton = (key, label) => (
    <button
      key={key}
      onClick={() => run(key)}
      disabled={busy}
      className="w-full text-left px-3 py-1.5 text-sm text-sage-800 rounded-button hover:bg-wellness-50 disabled:opacity-60"
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-sage-50 flex items-center justify-center p-6">
      {ConfirmDialog}
      <div className="w-full max-w-md bg-white rounded-soft shadow-lg border border-sage-200 p-8 space-y-5">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-danger-light flex items-center justify-center mb-3">
            <AlertTriangle size={24} className="text-danger" />
          </div>
          <h1 className="font-serif text-xl font-semibold text-sage-900">No se pudieron leer tus datos</h1>
          <p className="text-xs text-sage-600 mt-2">
            El archivo de datos existe pero está dañado o no se puede descifrar. No se ha modificado nada:
            elige cómo continuar. El archivo original se conservará aparte.
          </p>
          <p className="text-[11px] text-sage-500 mt-2 font-mono break-all">{failure.error}</p>
        </div>

        {error && <p role="alert" className="text-xs text-danger text-center">{error}</p>}

        <div className="space-y-2">
          <button
            onClick={() => window.location.reload()}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-sage-300 text-sage-700 text-sm rounded-button hover:bg-sage-100 disabled:opacity-60"
          >
            <RotateCcw size={14} /> Reintentar
          </button>

          {(backups.length > 0 || safety) && (
            <div className="border border-sage-200 rounded-soft p-3 space-y-1.5">
              <p className="text-xs font-medium text-sage-700 flex items-center gap-1.5">
                <History size={13} /> Restaurar una copia automática
              </p>
              {backups.map(date => backupButton(date, `Copia del ${formatDay(date)}`))}
              {safety && backupButton('safety', `Copia anterior a la última restauración (${formatDay(safety.date)})`)}
            </div>
          )}

          <button
            onClick={() => run(null)}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs text-sage-500 hover:text-sage-800 disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <FilePlus size={13} />}
            Empezar con datos vacíos
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadErrorScreen;
