import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Home, FileText, Users, Wallet, Calculator, Settings, Palette, ArrowRight, Euro, X } from 'lucide-react';
import { useStore, formatCurrency, formatDateShort } from '../stores/store';

// ============================================
// COMMAND PALETTE (#15)
// Accés ràpid a tot: Ctrl+K
// ============================================

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, description: 'Vista general' },
  { id: 'invoices', label: 'Facturas', icon: FileText, description: 'Gestión de facturas y presupuestos' },
  { id: 'clients', label: 'Clientes', icon: Users, description: 'Directorio de clientes' },
  { id: 'expenses', label: 'Gastos', icon: Wallet, description: 'Registro de gastos' },
  { id: 'taxes', label: 'Impuestos', icon: Calculator, description: 'Modelos 303 y 130' },
  { id: 'design', label: 'Diseño', icon: Palette, description: 'Editor de plantillas PDF' },
  { id: 'settings', label: 'Configuración', icon: Settings, description: 'Ajustes de la aplicación' },
];

const highlight = (text, query) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-blue-500/40 text-blue-200 rounded">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

export const CommandPalette = ({ open, onClose }) => {
  const { invoices, clients, expenses, setCurrentView } = useStore();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reiniciar estat al obrir
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Resultats filtrats
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = [];

    // Seccions — sempre visibles si no hi ha query, o si coincideixen
    const matchedSections = SECTIONS.filter(s =>
      !q || s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
    if (matchedSections.length > 0) {
      items.push({ type: 'group', label: 'Secciones' });
      matchedSections.forEach(s => items.push({ type: 'section', ...s }));
    }

    if (q.length >= 2) {
      // Factures — cerca per número, concepte o client
      const matchedInvoices = invoices
        .filter(inv => {
          const client = clients.find(c => c.id === inv.clienteId);
          return (
            (inv.numero || '').toLowerCase().includes(q) ||
            (inv.concepto || '').toLowerCase().includes(q) ||
            (client?.nombre || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 5);

      if (matchedInvoices.length > 0) {
        items.push({ type: 'group', label: 'Facturas' });
        matchedInvoices.forEach(inv => {
          const client = clients.find(c => c.id === inv.clienteId);
          items.push({
            type: 'invoice',
            id: inv.id,
            label: inv.numero,
            description: `${inv.concepto} · ${client?.nombre || 'Sin cliente'}`,
            meta: formatCurrency(inv.total),
            data: inv,
          });
        });
      }

      // Clients — cerca per nom o CIF/NIF
      const matchedClients = clients
        .filter(c =>
          (c.nombre || '').toLowerCase().includes(q) ||
          (c.cifNif || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q)
        )
        .slice(0, 5);

      if (matchedClients.length > 0) {
        items.push({ type: 'group', label: 'Clientes' });
        matchedClients.forEach(c => {
          items.push({
            type: 'client',
            id: c.id,
            label: c.nombre,
            description: c.cifNif || c.email || '',
            data: c,
          });
        });
      }

      // Gastos — cerca per proveïdor o concepte
      const matchedExpenses = expenses
        .filter(e =>
          (e.proveedor || '').toLowerCase().includes(q) ||
          (e.concepto || '').toLowerCase().includes(q)
        )
        .slice(0, 3);

      if (matchedExpenses.length > 0) {
        items.push({ type: 'group', label: 'Gastos' });
        matchedExpenses.forEach(e => {
          items.push({
            type: 'expense',
            id: e.id,
            label: e.proveedor || 'Sin proveedor',
            description: `${e.concepto} · ${formatDateShort(e.fecha)}`,
            meta: formatCurrency(e.total),
            data: e,
          });
        });
      }
    }

    return items;
  }, [query, invoices, clients, expenses]);

  // Índexs seleccionables (exclou grups)
  const selectableItems = results.filter(r => r.type !== 'group');

  const handleSelect = (item) => {
    if (item.type === 'section') {
      setCurrentView(item.id);
    } else if (item.type === 'invoice' || item.type === 'expense') {
      setCurrentView(item.type === 'invoice' ? 'invoices' : 'expenses');
    } else if (item.type === 'client') {
      setCurrentView('clients');
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, selectableItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectableItems[activeIdx]) handleSelect(selectableItems[activeIdx]);
    }
  };

  // Mantenir l'element actiu visible
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  let selectableCount = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Buscar facturas, clientes, secciones..."
            className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          )}
          <kbd className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded border border-slate-700">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">Sin resultados</p>
          ) : (
            results.map((item, i) => {
              if (item.type === 'group') {
                return (
                  <div key={`group-${i}`} className="px-4 py-1.5 mt-1">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{item.label}</p>
                  </div>
                );
              }

              const myIdx = selectableCount++;
              const isActive = myIdx === activeIdx;
              const Icon = item.icon || (item.type === 'invoice' ? FileText : item.type === 'client' ? Users : item.type === 'expense' ? Wallet : Euro);

              return (
                <button
                  key={`${item.type}-${item.id || i}`}
                  data-active={isActive}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIdx(myIdx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isActive ? 'bg-blue-600/20 text-white' : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg ${isActive ? 'bg-blue-600/30' : 'bg-slate-800'}`}>
                    <Icon size={14} className={isActive ? 'text-blue-400' : 'text-slate-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{highlight(item.label, query)}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500 truncate">{item.description}</p>
                    )}
                  </div>
                  {item.meta && (
                    <span className="text-xs font-mono text-slate-400 shrink-0">{item.meta}</span>
                  )}
                  {isActive && <ArrowRight size={14} className="text-blue-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-4 text-[10px] text-slate-600">
          <span><kbd className="bg-slate-800 px-1 rounded">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-800 px-1 rounded">↵</kbd> seleccionar</span>
          <span><kbd className="bg-slate-800 px-1 rounded">ESC</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
};
