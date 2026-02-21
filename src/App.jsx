import React, { useEffect } from 'react';
import { Euro, Home, FileText, Users, Wallet, Calculator, Settings, Palette, Command } from 'lucide-react';
import { Spinner, ToastProvider } from './components/UI';
import { Dashboard } from './components/Dashboard';
import { Invoices } from './components/Invoices';
import { ClientsView } from './components/ClientsView';
import { ExpensesView } from './components/ExpensesView';
import { TaxesView } from './components/TaxesView';
import { DesignEditor } from './components/DesignEditor';
import { SettingsView } from './components/SettingsView';
import { NotionStatusBadge } from './components/NotionSync';
import { useStore } from './stores/store';
import { useDesignStore, loadGoogleFonts } from './stores/designStore';

// ============================================
// MAIN APP
// ============================================
function AppContent() {
  const { currentView, setCurrentView, config, isLoading } = useStore();
  const { design } = useDesignStore();

  // Carregar fonts Google al iniciar
  useEffect(() => {
    if (design?.fonts) loadGoogleFonts(design.fonts);
  }, [design?.fonts]);

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard', shortcut: '1' },
    { id: 'invoices', icon: FileText, label: 'Facturas', shortcut: '2' },
    { id: 'clients', icon: Users, label: 'Clientes', shortcut: '3' },
    { id: 'expenses', icon: Wallet, label: 'Gastos', shortcut: '4' },
    { id: 'taxes', icon: Calculator, label: 'Impuestos', shortcut: '5' },
    { id: 'design', icon: Palette, label: 'Diseño', shortcut: '6' },
    { id: 'settings', icon: Settings, label: 'Configuración', shortcut: '7' }
  ];

  // Dreceres de teclat per navegar entre seccions
  useEffect(() => {
    const handleKeyboard = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

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
  }, [setCurrentView]);

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
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/50 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center">
              <Euro size={20} className="text-white" />
            </div>
            Contabilidad
          </h1>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => setCurrentView(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${currentView === item.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  title={`${item.label} (Ctrl+${item.shortcut})`}
                >
                  <item.icon size={20} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${
                    currentView === item.id
                      ? 'bg-blue-500/30 text-blue-200'
                      : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700 group-hover:text-slate-400'
                  }`}>
                    {item.shortcut}
                  </kbd>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-white truncate">{config.nombre}</p>
              <NotionStatusBadge />
            </div>
            <p className="text-xs text-slate-500">{config.nif}</p>
          </div>

          {/* Indicador dreceres de teclat */}
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600">
            <Command size={10} />
            <span>+ número para navegar</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'invoices' && <Invoices />}
        {currentView === 'clients' && <ClientsView />}
        {currentView === 'expenses' && <ExpensesView />}
        {currentView === 'taxes' && <TaxesView />}
        {currentView === 'design' && <DesignEditor />}
        {currentView === 'settings' && <SettingsView />}
      </main>
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
