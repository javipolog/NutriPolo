import React, { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Home, Calendar, Users, ClipboardList, Receipt, Package, Settings, Search, ChevronLeft, ChevronRight, AlertTriangle, X, Clock, Sparkles, Download, RefreshCw } from 'lucide-react';
import { Spinner, ToastProvider, ErrorBoundary, Modal, useToast } from './components/UI';
import { CommandPalette } from './components/CommandPalette';
import { UnlockScreen } from './components/UnlockScreen';
import useStore from './stores/store';
import { useT } from './i18n';

// ============================================
// WHAT'S NEW MODAL
// ============================================
const APP_VERSION = '1.5.0';

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
    <Modal open={open} onClose={handleClose} title="Novedades en NutriPolo" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-wellness-50 border border-wellness-200 rounded-soft">
          <Sparkles size={20} className="text-wellness-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-sage-800">Google Calendar bidireccional</p>
            <p className="text-xs text-sage-600 mt-1">
              El calendario <strong>"NutriPolo App"</strong> ahora se sincroniza en ambas direcciones.
              Las consultas que crees o edites en la app se enviarán automáticamente a Google Calendar.
            </p>
            <p className="text-xs text-sage-500 mt-1.5">
              Los demás calendarios siguen en solo lectura. Puedes cambiar el modo de cada calendario
              en Ajustes &gt; Google Calendar.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-wellness-400 text-white text-sm font-medium rounded-button hover:bg-wellness-500 transition-colors"
          >
            Entendido
          </button>
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
      await installUpdate();
      await relaunch();
    } catch (e) {
      toast.error('Error al actualizar: ' + (e?.message || String(e)));
      setInstalling(false);
    }
  };

  if (!update || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom">
      <div className="bg-white border border-wellness-300 rounded-soft shadow-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Download size={20} className="text-wellness-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-sage-800">
              Nueva versión disponible
            </p>
            <p className="text-xs text-sage-600 mt-1">
              NutriPolo <strong>v{update.version}</strong> está lista para instalar.
            </p>
            {update.body && (
              <p className="text-xs text-sage-500 mt-1">{update.body}</p>
            )}
          </div>
          <button onClick={() => setDismissed(true)} className="text-sage-400 hover:text-sage-600 p-0.5">
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 text-xs text-sage-600 hover:text-sage-800 transition-colors"
          >
            Más tarde
          </button>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-wellness-400 text-white text-xs font-medium rounded-button hover:bg-wellness-500 transition-colors disabled:opacity-60"
          >
            {installing ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                Instalando...
              </>
            ) : (
              'Actualizar ahora'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Lazy-loaded views (created in later phases — placeholders until implemented)
const LazyView = ({ name }) => (
  <div className="flex items-center justify-center h-64 text-sage-500 text-sm">
    Vista "{name}" en construcción...
  </div>
);

// ============================================
// INTEGRITY WARNING BANNER
// ============================================
const IntegrityWarningBanner = () => {
  const integrityWarnings = useStore(s => s.integrityWarnings);
  const [dismissed, setDismissed] = useState(false);
  if (!integrityWarnings?.length || dismissed) return null;
  return (
    <div className="bg-warning-light border-b border-warning/20 px-6 py-3 flex items-start gap-3">
      <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-warning-dark text-sm font-medium">Advertencias de integridad de datos</p>
        <ul className="mt-1 space-y-0.5">
          {integrityWarnings.map((w, i) => (
            <li key={i} className="text-warning text-xs">{w.message}</li>
          ))}
        </ul>
      </div>
      <button onClick={() => setDismissed(true)} className="p-1 text-warning hover:text-warning-dark transition-colors shrink-0">
        <X size={14} />
      </button>
    </div>
  );
};

// ============================================
// DYNAMIC VIEW LOADER
// ============================================
function ViewLoader({ view }) {
  const [components, setComponents] = useState({});

  useEffect(() => {
    // Import views as they are created
    const loadView = async (v) => {
      try {
        switch (v) {
          case 'dashboard': {
            const m = await import('./components/Dashboard');
            setComponents(c => ({ ...c, dashboard: m.Dashboard || m.default }));
            break;
          }
          case 'agenda': {
            const m = await import('./components/CalendarView');
            setComponents(c => ({ ...c, agenda: m.CalendarView || m.default }));
            break;
          }
          case 'clients': {
            const m = await import('./components/ClientsView');
            setComponents(c => ({ ...c, clients: m.ClientsView || m.default }));
            break;
          }
          case 'plans': {
            const m = await import('./components/NutritionPlanEditor');
            setComponents(c => ({ ...c, plans: m.NutritionPlanEditor || m.default }));
            break;
          }
          case 'invoices': {
            const m = await import('./components/Invoices');
            setComponents(c => ({ ...c, invoices: m.Invoices || m.default }));
            break;
          }
          case 'services': {
            const m = await import('./components/ServicesView');
            setComponents(c => ({ ...c, services: m.ServicesView || m.default }));
            break;
          }
          case 'settings': {
            const m = await import('./components/SettingsView');
            setComponents(c => ({ ...c, settings: m.SettingsView || m.default }));
            break;
          }
          case 'inbox': {
            const m = await import('./components/PatientSuggestionsInbox');
            setComponents(c => ({ ...c, inbox: m.PatientSuggestionsInbox || m.default }));
            break;
          }

        }
      } catch {
        // Component not yet created — show placeholder
      }
    };
    loadView(view);
  }, [view]);

  const Component = components[view];
  if (!Component) return <LazyView name={view} />;
  return <Component />;
}

// ============================================
// MAIN APP
// ============================================
function AppContent() {
  const currentView = useStore(s => s.currentView);
  const setCurrentView = useStore(s => s.setCurrentView);
  const config = useStore(s => s.config);
  const isLoading = useStore(s => s.isLoading);
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

  const toast = useToast();
  const t = useT();
  const [showCommandPalette, setShowCommandPalette] = useState(false);

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

  // Apply UI fonts
  useEffect(() => {
    const loadGoogleFont = (fontName, id) => {
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        const q = fontName.replace(/\s+/g, '+');
        link.href = `https://fonts.googleapis.com/css2?family=${q}:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap`;
        document.head.appendChild(link);
      }
    };
    const font = config.appFont || 'Inter';
    document.documentElement.style.setProperty('--font-ui', `'${font}', system-ui, sans-serif`);
    if (font !== 'Inter') loadGoogleFont(font, `gf-ui-${font.replace(/\s+/g, '-').toLowerCase()}`);
    const heading = config.appFontHeading || 'Playfair Display';
    document.documentElement.style.setProperty('--font-heading', `'${heading}', Georgia, ui-serif, serif`);
    const mono = config.appFontMono || 'JetBrains Mono';
    document.documentElement.style.setProperty('--font-mono', `'${mono}', monospace`);
  }, [config.appFont, config.appFontHeading, config.appFontMono]);

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
    const minutes = Number(config.autoLockMinutes) || 0;
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
  }, [config.autoLockMinutes]);

  const navItems = [
    { id: 'dashboard', icon: Home,          label: t.nav_dashboard, shortcut: '1' },
    { id: 'agenda',    icon: Calendar,      label: t.nav_agenda,    shortcut: '2' },
    { id: 'clients',   icon: Users,         label: t.nav_clients,   shortcut: '3', badge: pendingTotal },
    { id: 'plans',     icon: ClipboardList, label: t.nav_plans,     shortcut: '4' },
    { id: 'invoices',  icon: Receipt,       label: t.nav_invoices,  shortcut: '5' },
    { id: 'services',  icon: Package,       label: t.nav_services,  shortcut: '6' },
    { id: 'settings',  icon: Settings,      label: t.nav_settings,  shortcut: '7' },
  ];

  const toastRef = useRef(toast);
  const histRef = useRef(_history);
  const futRef = useRef(_future);
  const tRef = useRef(t);
  toastRef.current = toast;
  histRef.current = _history;
  futRef.current = _future;
  tRef.current = t;

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (histRef.current.length > 0) { undo(); toastRef.current.info('Acción deshecha', 3000); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (futRef.current.length > 0) { redo(); toastRef.current.info('Acción rehecha', 3000); }
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-sage-50 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-sage-600 mt-4 text-sm">{t.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sage-50 flex flex-col">
      <IntegrityWarningBanner />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-sage-100 border-r border-sage-300 flex flex-col transition-all duration-200 shrink-0 shadow-sidebar`}>

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
              title={sidebarCollapsed ? 'Expandir' : 'Colapsar'}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-2">
            <ul className="space-y-0.5">
              {navItems.map(item => (
                <li key={item.id}>
                  <button
                    onClick={() => setCurrentView(item.id)}
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
                      <span className="absolute top-1 right-1 min-w-[14px] h-3.5 flex items-center justify-center px-1 rounded-full bg-orange-400 text-white text-[9px] font-bold leading-none">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
                        {/* Badge pill takes priority over keyboard shortcut */}
                        {item.badge > 0 ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                            currentView === item.id
                              ? 'bg-white/30 text-white'
                              : 'bg-orange-400 text-white'
                          }`}>
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        ) : item.shortcut ? (
                          <kbd className={`text-[10px] px-1.5 py-0.5 rounded border ${
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
                <p className="text-sm font-medium text-sage-900 truncate">{config.nombre}</p>
                <p className="text-xs text-sage-500 mt-0.5">Col. {config.numColegiada}</p>
              </div>
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-button text-sage-500 hover:text-sage-800 hover:bg-sage-200 transition-colors text-xs"
              >
                <Search size={12} />
                <span className="flex-1 text-left">Buscar...</span>
                <kbd className="text-[10px] px-1.5 py-0.5 bg-sage-200 rounded border border-sage-300 text-sage-500">Ctrl+K</kbd>
              </button>
            </div>
          ) : (
            <div className="p-2 border-t border-sage-300">
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center justify-center p-2.5 rounded-button text-sage-500 hover:text-sage-800 hover:bg-sage-200 transition-colors"
                title="Buscar (Ctrl+K)"
              >
                <Search size={17} />
              </button>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto bg-sage-50">
          <ErrorBoundary key={currentView}>
            <ViewLoader view={currentView} />
          </ErrorBoundary>
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
 *   ready          → store is hydrated, render the main app
 */
function EncryptionGate() {
  const [phase, setPhase] = useState('checking');

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
        // Rehydration errors are logged inside the store; fall through
        // so the UI isn't permanently stuck on a loading spinner.
      }
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
            {phase === 'checking' ? 'Comprobando seguridad...' : 'Descifrando datos...'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'unlocking') {
    return <UnlockScreen onUnlocked={handleUnlocked} />;
  }

  return <AppContent />;
}

export default function App() {
  return (
    <ToastProvider>
      <EncryptionGate />
    </ToastProvider>
  );
}
