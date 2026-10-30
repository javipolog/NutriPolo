import React, { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { Home, Calendar, Users, ClipboardList, Receipt, Package, UserCheck, FileText, Settings, Search, ChevronLeft, ChevronRight, AlertTriangle, X, Download, RefreshCw } from 'lucide-react';
import { Spinner, ToastProvider, ErrorBoundary, Modal, Button, useToast } from './components/UI';
import { CommandPalette } from './components/CommandPalette';
import { UnlockScreen } from './components/UnlockScreen';
import { LoadErrorScreen } from './components/LoadErrorScreen';
import useStore, { flushAllPending, getLoadFailure, syncGoogleSecrets } from './stores/store';
import { useT } from './i18n';
import { useBackgroundJobs } from './hooks/useBackgroundJobs';
import { useNow } from './hooks/useNow';
import { countPendingReminders } from './components/RemindersPanel';

// ============================================
// WHAT'S NEW MODAL
// ============================================
const APP_VERSION = '1.17.0';

const WhatsNewModal = () => {
  const [open, setOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    const seen = localStorage.getItem('nutripolo-seen-version');
    if (seen !== APP_VERSION) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem('nutripolo-seen-version', APP_VERSION);
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={handleClose} title={t.whats_new_title.replace('{version}', APP_VERSION)} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-wellness-50 border border-wellness-200 rounded-soft">
          <UserCheck size={20} className="text-wellness-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-sage-800">{t.whats_new_gcal_patients_title}</p>
            <p className="text-xs text-sage-600 mt-1">{t.whats_new_gcal_patients_desc}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 bg-wellness-50 border border-wellness-200 rounded-soft">
          <FileText size={20} className="text-wellness-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-sage-800">{t.whats_new_plan_pdf_title}</p>
            <p className="text-xs text-sage-600 mt-1">{t.whats_new_plan_pdf_desc}</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleClose}>{t.got_it}</Button>
        </div>
      </div>
    </Modal>
  );
};

// ============================================
// AUTO-UPDATE CHECKER
// ============================================
const UpdateChecker = () => {
  const [update, setUpdate] = useState(null);   // { version, body }
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const toast = useToast();
  const t = useT();

  const check = useCallback(async () => {
    try {
      const { checkUpdate } = await import('@tauri-apps/api/updater');
      const { shouldUpdate, manifest } = await checkUpdate();
      if (shouldUpdate && manifest) {
        setUpdate({ version: manifest.version, body: manifest.body });
      }
    } catch {
      // Silently ignore — expected to fail in dev mode or offline
    }
  }, []);

  useEffect(() => {
    // Check on mount (small delay to not block startup)
    const timeout = setTimeout(check, 5000);
    // Re-check every 30 minutes
    const interval = setInterval(check, 30 * 60 * 1000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, [check]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const { installUpdate } = await import('@tauri-apps/api/updater');
      const { relaunch } = await import('@tauri-apps/api/process');
      // The installer closes the app: save pending changes first.
      await flushAllPending();
      await installUpdate();
      await relaunch();
    } catch (e) {
      toast.error(t.update_error.replace('{error}', e?.message || String(e)));
      setInstalling(false);
    }
  };

  if (!update || dismissed) return null;

  return (
    // Top-right so it never overlaps the toast stack in the bottom-right corner
    <div role="status" className="fixed top-4 right-4 z-50 max-w-sm animate-slideIn">
      <div className="bg-white border border-wellness-300 rounded-soft shadow-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Download size={20} className="text-wellness-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-sage-800">
              {t.update_available}
            </p>
            <p className="text-xs text-sage-600 mt-1">
              {t.update_ready.replace('{version}', update.version)}
            </p>
            {update.body && (
              <p className="text-xs text-sage-500 mt-1">{update.body}</p>
            )}
          </div>
          <button onClick={() => setDismissed(true)} aria-label={t.close} className="text-sage-400 hover:text-sage-600 p-0.5">
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            {t.update_later}
          </Button>
          <Button size="sm" onClick={handleInstall} disabled={installing}>
            {installing ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                {t.update_installing}
              </>
            ) : (
              t.update_now
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// Shown while a view's code is still loading
const LazyView = () => (
  <div className="flex items-center justify-center h-64">
    <Spinner />
  </div>
);

// ============================================
// INTEGRITY WARNING BANNER
// ============================================
const IntegrityWarningBanner = () => {
  const integrityWarnings = useStore(s => s.integrityWarnings);
  const [dismissed, setDismissed] = useState(false);
  const t = useT();
  if (!integrityWarnings?.length || dismissed) return null;
  return (
    <div role="alert" className="bg-warning-light border-b border-warning/20 px-6 py-3 flex items-start gap-3">
      <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-warning-dark text-sm font-medium">{t.integrity_warnings_title}</p>
        <ul className="mt-1 space-y-0.5">
          {integrityWarnings.map((w, i) => (
            <li key={i} className="text-warning text-xs">{w.message}</li>
          ))}
        </ul>
      </div>
      <button onClick={() => setDismissed(true)} aria-label={t.close} className="p-1 text-warning hover:text-warning-dark transition-colors shrink-0">
        <X size={14} />
      </button>
    </div>
  );
};

// ============================================
// SAVE ERROR BANNER
// ============================================
const SaveErrorBanner = () => {
  const saveError = useStore(s => s.saveError);
  const t = useT();
  if (!saveError) return null;
  return (
    <div role="alert" className="bg-danger-light border-b border-danger/20 px-6 py-3 flex items-start gap-3">
      <AlertTriangle size={16} className="text-danger mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-danger text-sm font-medium">{t.save_error_title}</p>
        <p className="text-danger text-xs mt-0.5">
          {t.save_error_desc} ({saveError})
        </p>
      </div>
    </div>
  );
};

// ============================================
// DYNAMIC VIEW LOADER
// ============================================
const VIEW_IMPORTERS = {
  dashboard: () => import('./components/Dashboard').then(m => m.Dashboard || m.default),
  agenda:    () => import('./components/CalendarView').then(m => m.CalendarView || m.default),
  clients:   () => import('./components/ClientsView').then(m => m.ClientsView || m.default),
  plans:     () => import('./components/NutritionPlanEditor').then(m => m.NutritionPlanEditor || m.default),
  invoices:  () => import('./components/Invoices').then(m => m.Invoices || m.default),
  services:  () => import('./components/ServicesView').then(m => m.ServicesView || m.default),
  settings:  () => import('./components/SettingsView').then(m => m.SettingsView || m.default),
  inbox:     () => import('./components/PatientSuggestionsInbox').then(m => m.PatientSuggestionsInbox || m.default),
};

// Module-level cache: ViewLoader remounts on every view change (ErrorBoundary key),
// so a loaded view must render synchronously the next time, without a "Loading" flash.
const viewCache = {};
const loadView = (view) => viewCache[view]
  ? Promise.resolve(viewCache[view])
  : VIEW_IMPORTERS[view]().then(Component => (viewCache[view] = Component));

// Warm the cache in the background so the first visit to each view is instant too.
const prefetchViews = () => {
  Object.keys(VIEW_IMPORTERS).forEach(view => loadView(view).catch(() => {}));
};

const ViewLoadError = () => {
  const t = useT();
  return (
    <div role="alert" className="flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 bg-warning-light rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={30} className="text-warning" />
        </div>
        <h2 className="font-serif text-xl font-semibold text-sage-900 mb-2">{t.view_load_error_title}</h2>
        <p className="text-sage-600 text-sm mb-6">{t.view_load_error_desc}</p>
        <Button icon={RefreshCw} onClick={() => window.location.reload()}>{t.reload_app}</Button>
      </div>
    </div>
  );
};

function ViewLoader({ view }) {
  const [, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (viewCache[view] || !VIEW_IMPORTERS[view]) return;
    let cancelled = false;
    setFailed(false);
    loadView(view)
      .then(() => { if (!cancelled) setLoaded(n => n + 1); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [view]);

  const Component = viewCache[view];
  if (Component) return <Component />;
  if (failed) return <ViewLoadError />;
  return <LazyView />;
}

/**
 * Reminders badge count. Selecting a number (recomputed only when its inputs
 * change) keeps the shell from re-rendering on unrelated store updates.
 */
function usePendingReminders(now) {
  const cache = useRef(null);
  return useStore(s => {
    const c = cache.current;
    if (!c || c.config !== s.config || c.consultations !== s.consultations || c.clients !== s.clients || c.now !== now) {
      cache.current = {
        config: s.config, consultations: s.consultations, clients: s.clients, now,
        value: countPendingReminders(s, now),
      };
    }
    return cache.current.value;
  });
}

// ============================================
// MAIN APP
// ============================================
function AppContent() {
  const currentView = useStore(s => s.currentView);
  const setCurrentView = useStore(s => s.setCurrentView);
  // Narrow selectors: the shell (and the view inside it) only re-renders when
  // something it shows changes, not on every sync update or keystroke.
  const closeToTray = useStore(s => s.config.closeToTray !== false);
  const autoLockMinutes = useStore(s => Number(s.config.autoLockMinutes) || 0);
  const nombre = useStore(s => s.config.nombre);
  const numColegiada = useStore(s => s.config.numColegiada);
  const sidebarCollapsed = useStore(s => s.sidebarCollapsed);
  const setSidebarCollapsed = useStore(s => s.setSidebarCollapsed);
  const appTheme = useStore(s => s.appTheme);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const _history = useStore(s => s._history);
  const _future = useStore(s => s._future);
  const runAutoBackup = useStore(s => s.runAutoBackup);
  const validateDataIntegrity = useStore(s => s.validateDataIntegrity);
  const pendingTotal = useStore(s =>
    (s.patientSuggestions || []).filter(sg =>
      sg.status === 'pending' || sg.status === 'pending-confirm'
    ).length
  );
  const now = useNow(60000);
  const pendingReminders = usePendingReminders(now);

  const toast = useToast();
  const t = useT();
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useBackgroundJobs({ toast });

  // Tray: close-to-tray preference and menu labels in the app language.
  useEffect(() => {
    invoke('configure_tray', {
      closeToTray, showLabel: t.tray_show, quitLabel: t.tray_quit,
    }).catch(() => {});
  }, [closeToTray, t]);

  useEffect(() => {
    const timer = setTimeout(prefetchViews, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (th) => root.setAttribute('data-theme', th);
    if (appTheme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(appTheme || 'light');
    }
  }, [appTheme]);


  // Post-hydration: backup + integrity check
  useEffect(() => {
    const run = async () => {
      await runAutoBackup();
      validateDataIntegrity();
    };
    if (useStore.persist?.hasHydrated?.()) {
      run();
    } else {
      const unsub = useStore.persist?.onFinishHydration?.(() => run());
      return () => unsub?.();
    }
  }, [runAutoBackup, validateDataIntegrity]);

  // Auto-lock on inactivity. Only active when at-rest encryption is enabled.
  // Timeout is configurable in Settings via `config.autoLockMinutes`:
  //   0 or undefined → disabled
  //   N > 0          → lock after N minutes of no input events
  useEffect(() => {
    const minutes = autoLockMinutes;
    if (minutes <= 0) return;

    let cancelled = false;
    let timer = null;

    const checkAndArm = async () => {
      try {
        const enabled = await invoke('encryption_is_enabled');
        if (!enabled || cancelled) return;
      } catch {
        return;
      }
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            // Write pending changes while the key is still available.
            await flushAllPending();
            await invoke('encryption_lock');
          } catch {}
          window.location.reload();
        }, minutes * 60 * 1000);
      };
      const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
      events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
      resetTimer();
      // Cleanup on unmount or config change
      return () => {
        clearTimeout(timer);
        events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      };
    };

    let cleanup;
    checkAndArm().then((c) => { cleanup = c; });
    return () => {
      cancelled = true;
      cleanup?.();
      clearTimeout(timer);
    };
  }, [autoLockMinutes]);

  const navItems = [
    { id: 'dashboard', icon: Home,          label: t.nav_dashboard, shortcut: '1', badge: pendingReminders },
    { id: 'agenda',    icon: Calendar,      label: t.nav_agenda,    shortcut: '2' },
    { id: 'clients',   icon: Users,         label: t.nav_clients,   shortcut: '3', badge: pendingTotal },
    { id: 'plans',     icon: ClipboardList, label: t.nav_plans,     shortcut: '4' },
    { id: 'invoices',  icon: Receipt,       label: t.nav_invoices,  shortcut: '5' },
    { id: 'services',  icon: Package,       label: t.nav_services,  shortcut: '6' },
    { id: 'settings',  icon: Settings,      label: t.nav_settings,  shortcut: '7' },
  ];

  const toastRef = useRef(toast);
  const tRef = useRef(t);
  const histRef = useRef(_history);
  const futRef = useRef(_future);
  toastRef.current = toast;
  tRef.current = t;
  histRef.current = _history;
  futRef.current = _future;

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (histRef.current.length > 0) { undo(); toastRef.current.info(tRef.current.undo_done, 3000); }
        return;
      }
      // With Shift held the key arrives as 'Z'.
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (futRef.current.length > 0) { redo(); toastRef.current.info(tRef.current.redo_done, 3000); }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const views = ['dashboard', 'agenda', 'clients', 'plans', 'invoices', 'services', 'settings'];
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < views.length) { e.preventDefault(); setCurrentView(views[idx]); }
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [setCurrentView, undo, redo]);

  return (
    // Fixed-height shell: only <main> scrolls, so the sidebar stays in place.
    <div className="h-screen overflow-hidden bg-sage-50 flex flex-col">
      <SaveErrorBanner />
      <IntegrityWarningBanner />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-sage-100 border-r border-sage-300 flex flex-col overflow-y-auto transition-all duration-200 shrink-0 shadow-sidebar`}>

          {/* Logo + toggle */}
          <div className={`border-b border-sage-300 flex items-center ${sidebarCollapsed ? 'justify-center p-3 flex-col gap-2' : 'p-4 justify-between'}`}>
            {!sidebarCollapsed && (
              <h1 className="font-serif text-lg font-semibold text-sage-900 flex items-center gap-2.5">
                <img src="/icon-nutripolo.svg" alt="NutriPolo" className="w-8 h-8 rounded-soft shrink-0" />
                NutriPolo
              </h1>
            )}
            {sidebarCollapsed && (
              <img src="/icon-nutripolo.svg" alt="NutriPolo" className="w-8 h-8 rounded-soft" />
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-button text-sage-500 hover:text-sage-800 hover:bg-sage-200 transition-colors"
              title={sidebarCollapsed ? t.sidebar_expand : t.sidebar_collapse}
              aria-label={sidebarCollapsed ? t.sidebar_expand : t.sidebar_collapse}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-2" aria-label={t.main_navigation}>
            <ul className="space-y-0.5">
              {navItems.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => setCurrentView(item.id)}
                    aria-current={currentView === item.id ? 'page' : undefined}
                    aria-label={sidebarCollapsed ? item.label : undefined}
                    className={`relative w-full flex items-center gap-3 rounded-button transition-colors duration-150 group ${
                      sidebarCollapsed ? 'justify-center p-3' : 'px-3 py-2.5'
                    } ${currentView === item.id
                      ? 'bg-wellness-400 text-white'
                      : 'text-sage-600 hover:bg-sage-200 hover:text-sage-900'
                    }`}
                    title={sidebarCollapsed
                      ? `${item.label}${item.shortcut ? ` (Ctrl+${item.shortcut})` : ''}`
                      : item.shortcut ? `Ctrl+${item.shortcut}` : item.label
                    }
                  >
                    <item.icon size={17} className="shrink-0" />
                    {/* Badge dot on collapsed sidebar */}
                    {sidebarCollapsed && item.badge > 0 && (
                      <span className="absolute top-1 right-1 min-w-[14px] h-3.5 flex items-center justify-center px-1 rounded-full bg-terra-500 text-white text-[11px] font-bold leading-none">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
                        {/* Badge pill takes priority over keyboard shortcut */}
                        {item.badge > 0 ? (
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                            currentView === item.id
                              ? 'bg-white/30 text-white'
                              : 'bg-terra-500 text-white'
                          }`}>
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        ) : item.shortcut ? (
                          <kbd className={`text-[11px] px-1.5 py-0.5 rounded border ${
                            currentView === item.id
                              ? 'bg-wellness-500/40 text-wellness-100 border-wellness-300/30'
                              : 'bg-sage-200 text-sage-500 border-sage-300 group-hover:bg-sage-300'
                          }`}>
                            {item.shortcut}
                          </kbd>
                        ) : null}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Footer */}
          {!sidebarCollapsed ? (
            <div className="p-3 border-t border-sage-300">
              <div className="bg-sage-50 border border-sage-300 rounded-soft p-3 mb-2">
                <p className="text-sm font-medium text-sage-900 truncate">{nombre}</p>
                <p className="text-xs text-sage-500 mt-0.5">{t.sidebar_colegiada} {numColegiada}</p>
              </div>
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-button text-sage-500 hover:text-sage-800 hover:bg-sage-200 transition-colors text-xs"
              >
                <Search size={12} />
                <span className="flex-1 text-left">{t.search_placeholder}</span>
                <kbd className="text-[11px] px-1.5 py-0.5 bg-sage-200 rounded border border-sage-300 text-sage-500">Ctrl+K</kbd>
              </button>
            </div>
          ) : (
            <div className="p-2 border-t border-sage-300">
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center justify-center p-2.5 rounded-button text-sage-500 hover:text-sage-800 hover:bg-sage-200 transition-colors"
                title={`${t.search} (Ctrl+K)`}
                aria-label={t.search}
              >
                <Search size={17} />
              </button>
            </div>
          )}
        </aside>

        {/* Main content */}
        {/* relative: absolutely positioned children (sr-only text, chart tooltips) stay inside the scroll area */}
        <main className="relative flex-1 p-4 md:p-6 lg:p-8 overflow-auto bg-sage-50">
          {/* Readable line length on wide monitors; h-full keeps the Agenda's fitted height */}
          <div className="mx-auto w-full max-w-[1440px] h-full">
            <ErrorBoundary key={currentView}>
              <ViewLoader view={currentView} />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
      />
      <WhatsNewModal />
      <UpdateChecker />
    </div>
  );
}

/**
 * EncryptionGate — determines on launch whether at-rest encryption is
 * enabled, renders the UnlockScreen when locked, and only hydrates the
 * Zustand store (decrypting everything via the Rust backend) once the
 * vault is unlocked.
 *
 * State machine:
 *   checking       → asking the backend whether encryption.json exists
 *   unlocking      → encryption enabled, waiting for user to unlock
 *   hydrating      → unlocked (or no encryption), triggering persist.rehydrate()
 *   loadError      → the data file exists but could not be read (writes blocked)
 *   ready          → store is hydrated, render the main app
 */
function EncryptionGate() {
  const [phase, setPhase] = useState('checking');
  const t = useT();

  // Phase 1 — check encryption state on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const enabled = await invoke('encryption_is_enabled');
        if (cancelled) return;
        if (!enabled) {
          setPhase('hydrating');
          return;
        }
        const unlocked = await invoke('encryption_is_unlocked');
        if (cancelled) return;
        setPhase(unlocked ? 'hydrating' : 'unlocking');
      } catch {
        // If the IPC call fails (shouldn't happen in Tauri), default
        // to no-encryption so the app can still boot.
        if (!cancelled) setPhase('hydrating');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Phase 2 — rehydrate the store once we know the vault is accessible
  useEffect(() => {
    if (phase !== 'hydrating') return;
    let cancelled = false;
    (async () => {
      try {
        await useStore.persist.rehydrate();
      } catch {
        // Errors surface through getLoadFailure() below.
      }
      if (cancelled) return;
      if (getLoadFailure()) { setPhase('loadError'); return; }
      await syncGoogleSecrets();
      if (!cancelled) setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, [phase]);

  const handleUnlocked = useCallback(() => setPhase('hydrating'), []);

  if (phase === 'checking' || phase === 'hydrating') {
    return (
      <div className="min-h-screen bg-sage-50 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-sage-600 mt-4 text-sm">
            {phase === 'checking' ? t.gate_checking : t.gate_decrypting}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'unlocking') {
    return <UnlockScreen onUnlocked={handleUnlocked} />;
  }

  if (phase === 'loadError') {
    return <LoadErrorScreen failure={getLoadFailure()} onResolved={async () => { await syncGoogleSecrets(); setPhase('ready'); }} />;
  }

  return <AppContent />;
}

export default function App() {
  // "Quit" in the tray menu: write pending changes before the process exits.
  useEffect(() => {
    let unlisten;
    listen('tray-quit', async () => {
      try { await flushAllPending(); } finally { invoke('quit_app').catch(() => {}); }
    }).then(u => { unlisten = u; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  return (
    <ToastProvider>
      <EncryptionGate />
    </ToastProvider>
  );
}
