import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, History, RotateCcw, FilePlus, Loader2 } from 'lucide-react';
import useStore, { clearLoadFailure, flushAllPending } from '../stores/store';

/**
 * LoadErrorScreen — shown when the main data file exists but cannot be read
 * (corrupt JSON, failed decryption…). Writes are blocked while it is shown,
 * so the empty default state can never overwrite the real file. The user
 * can retry, restore an automatic backup, or start empty; the last two move
 * the unreadable file aside (`*.corrupt-<timestamp>`) instead of deleting it.
 */
export const LoadErrorScreen = ({ failure, onResolved }) => {
  const restoreFromAutoBackup = useStore(s => s.restoreFromAutoBackup);
  const getAutoBackupInfo = useStore(s => s.getAutoBackupInfo);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getAutoBackupInfo().then(info => setBackups([...(info.dates || [])].reverse()));
  }, [getAutoBackupInfo]);

  const run = async (restoreDate) => {
    setBusy(true);
    setError('');
    try {
      await invoke('quarantine_data', { key: failure.key });
      clearLoadFailure();
      if (restoreDate) await restoreFromAutoBackup(restoreDate);
      else useStore.setState({});   // persist the empty state
      await flushAllPending();
      onResolved();
    } catch (e) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-sage-50 flex items-center justify-center p-6">
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

        {error && <p className="text-xs text-danger text-center">{error}</p>}

        <div className="space-y-2">
          <button
            onClick={() => window.location.reload()}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-sage-300 text-sage-700 text-sm rounded-button hover:bg-sage-100 disabled:opacity-60"
          >
            <RotateCcw size={14} /> Reintentar
          </button>

          {backups.length > 0 && (
            <div className="border border-sage-200 rounded-soft p-3 space-y-1.5">
              <p className="text-xs font-medium text-sage-700 flex items-center gap-1.5">
                <History size={13} /> Restaurar una copia automática
              </p>
              {backups.map(date => (
                <button
                  key={date}
                  onClick={() => run(date)}
                  disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-sm text-sage-800 rounded-button hover:bg-wellness-50 disabled:opacity-60"
                >
                  Copia del {date.split('-').reverse().join('/')}
                </button>
              ))}
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
