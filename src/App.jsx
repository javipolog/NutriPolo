import React, { useEffect, useState } from 'react';
import { Euro, Home, FileText, Users, Wallet, Calculator, Settings, Palette, Command, AlertTriangle, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Spinner, ToastProvider, ErrorBoundary, useToast } from './components/UI';
import { Dashboard } from './components/Dashboard';
import { Invoices } from './components/Invoices';
import { ClientsView } from './components/ClientsView';
import { ExpensesView } from './components/ExpensesView';
import { TaxesView } from './components/TaxesView';
import { DesignEditor } from './components/DesignEditor';
import { SettingsView } from './components/SettingsView';
import { NotionStatusBadge } from './components/NotionSync';
import { CommandPalette } from './components/CommandPalette';
import { useStore, runAutoBackup, validateDataIntegrity } from './stores/store';
import { useDesignStore, loadGoogleFonts } from './stores/designStore';

// ============================================
// BANNER D'ADVERTÈNCIA D'INTEGRITAT (#22)
// ============================================
const IntegrityWarningBanner = () => {
  const { integrityWarnings, setIntegrityWarnings } = useStore();

  if (!integrityWarnings || integrityWarnings.length === 0) return null;

  return (
    <div className="bg-amber-900/40 border-b border-amber-700/50 px-6 py-3 flex items-start gap-3">
      <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-amber-200 text-sm font-medium">Advertencia de integridad de datos</p>
        <ul className="mt-1 space-y-0.5">
          {integrityWarnings.map((w, i) => (
            <li key={i} className="text-amber-300/80 text-xs">{w.message}</li>
          ))}
        </ul>
      </div>
      <button
        onClick={() => setIntegrityWarnings([])}
        className="p-1 text-amber-400 hover:text-amber-200 transition-colors shrink-0"
        title="Cerrar"
      >
        <X size={14} />
      </button>
    </div>
  );
};

// ============================================
// MAIN APP
// ============================================
function AppContent() {
  const {
    currentView, setCurrentView, config, isLoading, setIntegrityWarnings,
    sidebarCollapsed, setSidebarCollapsed,
    appTheme, undo, redo, _history, _future,
  } = useStore();
  const { design } = useDesignStore();
  const toast = useToast();

  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Aplicar el tema al root (#19)
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (t) => {
      root.setAttribute('data-theme', t);
    };

    if (appTheme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      applyTheme(mq.matches ? 'light' : 'dark');
      const handler = (e) => applyTheme(e.matches ? 'light' : 'dark');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(appTheme);
    }
  }, [appTheme]);

  // Carregar fonts Google al iniciar
  useEffect(() => {
    if (design?.fonts) loadGoogleFonts(design.fonts);
  }, [design?.fonts]);

  // Post-hydration: autobackup i validació d'integritat (#2, #22)
  useEffect(() => {
    const run = async () => {
      const backupResult = await runAutoBackup();
      if (backupResult?.success) {
        console.log('[Backup] Backup diari creat:', backupResult.key);
      }
      const warnings = validateDataIntegrity();
      if (warnings.length > 0) {
        setIntegrityWarnings(warnings);
        console.warn('[Integritat] Problemes detectats:', warnings);
      }
    };

    if (useStore.persist.hasHydrated()) {
      run();
    } else {
      const unsub = useStore.persist.onFinishHydration(() => run());
      return unsub;
    }
  }, [setIntegrityWarnings]);

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard', shortcut: '1' },
    { id: 'invoices', icon: FileText, label: 'Facturas', shortcut: '2' },
    { id: 'clients', icon: Users, label: 'Clientes', shortcut: '3' },
    { id: 'expenses', icon: Wallet, label: 'Gastos', shortcut: '4' },
    { id: 'taxes', icon: Calculator, label: 'Impuestos', shortcut: '5' },
    { id: 'design', icon: Palette, label: 'Diseño', shortcut: '6' },
    { id: 'settings', icon: Settings, label: 'Configuración', shortcut: '7' }
  ];

  // Dreceres de teclat globals
  useEffect(() => {
    const handleKeyboard = (e) => {
      // Ctrl+K → Command Palette (#15)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // Ctrl+Z → Undo (#16)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        e.preventDefault();
        if (_history.length > 0) {
          undo();
          toast.info('Acción deshecha (Ctrl+Shift+Z para rehacer)', 3000);
        }
        return;
      }

      // Ctrl+Shift+Z → Redo (#16)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        e.preventDefault();
        if (_future.length > 0) {
          redo();
          toast.info('Acción rehecha', 3000);
        }
        return;
      }

      // Ctrl+Y → Redo alternatiu (#16)
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        e.preventDefault();
        if (_future.length > 0) {
          redo();
          toast.info('Acción rehecha', 3000);
        }
        return;
      }

      // Ctrl+[1-7] → Navegar seccions
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1': e.preventDefault(); setCurrentView('dashboard'); break;
          case '2': e.preventDefault(); setCurrentView('invoices'); break;
          case '3': e.preventDefault(); setCurrentView('clients'); break;
          case '4': e.preventDefault(); setCurrentView('expenses'); break;
          case '5': e.preventDefault(); setCurrentView('taxes'); break;
          case '6': e.preventDefault(); setCurrentView('design'); break;
          case '7': e.preventDefault(); setCurrentView('settings'); break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [setCurrentView, undo, redo, _history, _future, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-slate-400 mt-4">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Banner d'advertència integritat */}
      <IntegrityWarningBanner />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar col·lapsable (#20) */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-slate-900/50 border-r border-slate-800 flex flex-col transition-all duration-200 shrink-0`}>
          {/* Header: logo + toggle */}
          <div className={`border-b border-slate-800 flex items-center ${sidebarCollapsed ? 'justify-center p-3' : 'p-4 justify-between'}`}>
            {!sidebarCollapsed && (
              <h1 className="text-lg font-bold text-white flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center shrink-0">
                  <Euro size={16} className="text-white" />
                </div>
                Contabilidad
              </h1>
            )}
            {sidebarCollapsed && (
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
                <Euro size={16} className="text-white" />
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ${sidebarCollapsed ? 'mt-2 ml-0' : ''}`}
              title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
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
                    className={`w-full flex items-center gap-3 rounded-xl transition-all group ${
                      sidebarCollapsed ? 'justify-center p-3' : 'px-3 py-2.5'
                    } ${currentView === item.id
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                    title={sidebarCollapsed ? `${item.label} (Ctrl+${item.shortcut})` : `Ctrl+${item.shortcut}`}
                  >
                    <item.icon size={18} className="shrink-0" />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-left text-sm">{item.label}</span>
                        <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${
                          currentView === item.id
                            ? 'bg-blue-500/30 text-blue-200'
                            : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700 group-hover:text-slate-400'
                        }`}>
                          {item.shortcut}
                        </kbd>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Footer */}
          {!sidebarCollapsed ? (
            <div className="p-3 border-t border-slate-800">
              <div className="bg-slate-800/50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-white truncate">{config.nombre}</p>
                  <NotionStatusBadge />
                </div>
                <p className="text-xs text-slate-500">{config.nif}</p>
              </div>
              <button
                onClick={() => setShowCommandPalette(true)}
                className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors text-xs"
              >
                <Search size={12} />
                <span className="flex-1 text-left">Buscar...</span>
                <kbd className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700">Ctrl+K</kbd>
              </button>
            </div>
          ) : (
            <div className="p-2 border-t border-slate-800">
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full flex items-center justify-center p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Buscar (Ctrl+K)"
              >
                <Search size={18} />
              </button>
            </div>
          )}
        </aside>

        {/* Main amb ErrorBoundary per vista (#23) */}
        <main className="flex-1 p-8 overflow-auto">
          <ErrorBoundary key={currentView}>
            {currentView === 'dashboard' && <Dashboard />}
            {currentView === 'invoices' && <Invoices />}
            {currentView === 'clients' && <ClientsView />}
            {currentView === 'expenses' && <ExpensesView />}
            {currentView === 'taxes' && <TaxesView />}
            {currentView === 'design' && <DesignEditor />}
            {currentView === 'settings' && <SettingsView />}
          </ErrorBoundary>
        </main>
      </div>

      {/* Command Palette (#15) */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
