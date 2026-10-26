import { useEffect, useRef } from 'react';
import useStore from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';

const TICK_MS = 5 * 60 * 1000;

/**
 * Background work that must run while the app is open, whatever view is on
 * screen. Mounted once by AppContent (i.e. after hydration and unlock).
 *
 *  - Google Calendar auto-sync (when connected + autoSync), every 5 min.
 */
export function useBackgroundJobs({ toast }) {
  const connected = useStore(s => s.config.googleCalendar?.connected);
  const autoSync = useStore(s => s.config.googleCalendar?.autoSync);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!connected || !autoSync) return;
    let cancelled = false;
    const run = async () => {
      try {
        const stats = await googleCalendar.syncAll(useStore.getState());
        if (!cancelled && stats.conflicts > 0) {
          toastRef.current.info(`${stats.conflicts} conflicto(s) de sincronización resuelto(s) — se conservó la versión más reciente`);
        }
      } catch (e) {
        if (cancelled) return;
        if (useStore.getState().config.googleCalendar?.needsReauth) {
          toastRef.current.error('La sesión de Google Calendar ha caducado. Vuelve a conectar en Configuración.');
        } else if (import.meta.env.DEV) {
          console.warn('[Background sync]', e);
        }
      }
    };
    run();
    const interval = setInterval(run, TICK_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connected, autoSync]);
}
