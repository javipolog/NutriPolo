import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Lock, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

/**
 * UnlockScreen — shown on app launch when at-rest encryption is enabled
 * but the vault is still locked. Derives the master key (Argon2id) via
 * the Rust `encryption_unlock` command. On success, calls `onUnlocked`
 * so App.jsx can rehydrate the Zustand store with decrypted data.
 *
 * Wrong passwords are counted locally for UI feedback only — there is
 * no lockout because the app is single-user and strictly local.
 */
export const UnlockScreen = ({ onUnlocked }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [unlocking, setUnlocking] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!password || unlocking) return;
    setUnlocking(true);
    setError('');
    try {
      await invoke('encryption_unlock', { password });
      onUnlocked();
    } catch (err) {
      const code = String(err || '');
      setAttempts((n) => n + 1);
      if (code.includes('wrong_password')) {
        setError('Contraseña incorrecta');
      } else if (code.includes('no_encryption_config')) {
        setError('No se encuentra la configuración de cifrado');
      } else if (code.includes('argon2')) {
        setError('Error al derivar la clave (Argon2)');
      } else {
        setError('No se pudo desbloquear: ' + code);
      }
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sage-50 via-sage-100 to-wellness-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-card shadow-lg border border-sage-200 p-8">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-wellness-100 flex items-center justify-center mb-3">
              <Lock size={24} className="text-wellness-600" />
            </div>
            <h1 className="font-serif text-xl font-semibold text-sage-900">
              NutriPolo bloqueado
            </h1>
            <p className="text-xs text-sage-500 mt-1">
              Introduce tu contraseña maestra para desbloquear tus datos
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-sage-600 mb-1.5">
                Contraseña maestra
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={unlocking}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 pr-10 text-sm border border-sage-300 rounded-button focus:border-wellness-400 focus:outline-none focus:ring-1 focus:ring-wellness-400 disabled:opacity-60 bg-white"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-sage-400 hover:text-sage-700 transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 bg-danger-light border border-danger/30 rounded-button">
                <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger flex-1">{error}</p>
              </div>
            )}

            {attempts >= 5 && (
              <div className="flex items-start gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-button">
                <AlertCircle size={14} className="text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning-dark flex-1">
                  Si has olvidado tu contraseña, los datos son irrecuperables.
                  Comprueba la contraseña con cuidado.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={!password || unlocking}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-wellness-500 text-white text-sm font-medium rounded-button hover:bg-wellness-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {unlocking ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Descifrando...
                </>
              ) : (
                <>
                  <ShieldCheck size={14} />
                  Desbloquear
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-[10px] text-sage-400 text-center leading-relaxed">
            Tus datos están cifrados con AES-256-GCM y Argon2id. La contraseña
            nunca sale de tu dispositivo.
          </p>
        </div>
      </div>
    </div>
  );
};

export default UnlockScreen;
