import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Home, Calendar, Users, ClipboardList, Receipt, Package, Settings, ArrowRight, Leaf, X } from 'lucide-react';
import useStore, { formatCurrency, formatDateShort } from '../stores/store';
import { useT } from '../i18n';

const highlight = (text, query) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-wellness-100 text-wellness-600 rounded">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

export const CommandPalette = ({ open, onClose }) => {
  const clients = useStore(s => s.clients);
  const consultations = useStore(s => s.consultations);
  const nutritionPlans = useStore(s => s.nutritionPlans);
  const invoices = useStore(s => s.invoices);
  const setCurrentView = useStore(s => s.setCurrentView);
  const setSelectedClientId = useStore(s => s.setSelectedClientId);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const t = useT();

  const SECTIONS = useMemo(() => [
    { id: 'dashboard', label: t.nav_dashboard, icon: Home,          description: 'Panel de control y resumen' },
    { id: 'agenda',    label: t.nav_agenda,    icon: Calendar,      description: 'Citas y calendario' },
    { id: 'clients',   label: t.nav_clients,   icon: Users,         description: 'Gestión de clientes' },
    { id: 'plans',     label: t.nav_plans,     icon: ClipboardList, description: 'Planes nutricionales' },
    { id: 'invoices',  label: t.nav_invoices,  icon: Receipt,       description: 'Facturación y pagos' },
    { id: 'services',  label: t.nav_services,  icon: Package,       description: 'Catálogo de servicios' },
    { id: 'settings',  label: t.nav_settings,  icon: Settings,      description: 'Configuración de la app' },
  ], [t]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = [];

    const matchedSections = SECTIONS.filter(s =>
      !q || s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
    if (matchedSections.length > 0) {
      items.push({ type: 'group', label: 'Secciones' });
      matchedSections.forEach(s => items.push({ type: 'section', ...s }));
    }

    if (q.length >= 2) {
      const matchedClients = clients
        .filter(c =>
          (c.nombre || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.telefono || '').toLowerCase().includes(q)
        )
        .slice(0, 5);
      if (matchedClients.length > 0) {
        items.push({ type: 'group', label: 'Clientes' });
        matchedClients.forEach(c => items.push({
          type: 'client', id: c.id, label: c.nombre,
          description: [c.email, c.telefono].filter(Boolean).join(' · '),
          data: c,
        }));
      }

      const matchedConsultations = consultations
        .filter(c => {
          const client = clients.find(x => x.id === c.clienteId);
          return (client?.nombre || '').toLowerCase().includes(q) || (c.fecha || '').includes(q);
        })
        .slice(0, 3);
      if (matchedConsultations.length > 0) {
        items.push({ type: 'group', label: 'Consultas' });
        matchedConsultations.forEach(c => {
          const client = clients.find(x => x.id === c.clienteId);
          items.push({
            type: 'consultation', id: c.id,
            label: client?.nombre || 'Sin cliente',
            description: `${formatDateShort(c.fecha)} · ${c.tipo || ''} · ${c.estado}`,
            data: c,
          });
        });
      }

      const matchedPlans = nutritionPlans
        .filter(p => {
          const client = clients.find(x => x.id === p.clienteId);
          return (p.nombre || '').toLowerCase().includes(q) || (client?.nombre || '').toLowerCase().includes(q);
        })
        .slice(0, 3);
      if (matchedPlans.length > 0) {
        items.push({ type: 'group', label: 'Planes nutricionales' });
        matchedPlans.forEach(p => {
          const client = clients.find(x => x.id === p.clienteId);
          items.push({
            type: 'plan', id: p.id, label: p.nombre,
            description: `${client?.nombre || ''} · ${p.estado}`,
            data: p,
          });
        });
      }

      const matchedInvoices = invoices
        .filter(i => {
          const client = clients.find(x => x.id === i.clienteId);
          return (i.numero || '').toLowerCase().includes(q) || (client?.nombre || '').toLowerCase().includes(q);
        })
        .slice(0, 3);
      if (matchedInvoices.length > 0) {
        items.push({ type: 'group', label: 'Facturas' });
        matchedInvoices.forEach(i => {
          const client = clients.find(x => x.id === i.clienteId);
          items.push({
            type: 'invoice', id: i.id, label: i.numero,
            description: `${client?.nombre || ''} · ${formatDateShort(i.fecha)}`,
            meta: formatCurrency(i.total || i.importe),
            data: i,
          });
        });
      }
    }

    return items;
  }, [query, clients, consultations, nutritionPlans, invoices, SECTIONS]);

  const selectableItems = results.filter(r => r.type !== 'group');

  const handleSelect = (item) => {
    if (item.type === 'section') {
      setCurrentView(item.id);
    } else if (item.type === 'client') {
      setSelectedClientId(item.id);
      setCurrentView('clients');
    } else if (item.type === 'consultation') {
      setCurrentView('agenda');
    } else if (item.type === 'plan') {
      setCurrentView('plans');
    } else if (item.type === 'invoice') {
      setCurrentView('invoices');
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, selectableItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (selectableItems[activeIdx]) handleSelect(selectableItems[activeIdx]); }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  let selectableCount = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-sage-300 rounded-soft shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-sage-300">
          <Search size={18} className="text-sage-600 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Buscar clientes, consultas, planes..."
            className="flex-1 bg-transparent text-sage-900 placeholder-sage-500 outline-none text-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-sage-500 hover:text-sage-700">
              <X size={16} />
            </button>
          )}
          <kbd className="text-[10px] px-1.5 py-0.5 bg-sage-100 text-sage-500 rounded border border-sage-300">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-center text-sage-500 text-sm py-8">Sin resultados</p>
          ) : (
            results.map((item, i) => {
              if (item.type === 'group') {
                return (
                  <div key={`group-${i}`} className="px-4 py-1.5 mt-1">
                    <p className="text-[10px] font-semibold text-sage-500 uppercase tracking-wider">{item.label}</p>
                  </div>
                );
              }
              const myIdx = selectableCount++;
              const isActive = myIdx === activeIdx;
              const Icon = item.icon || (item.type === 'client' ? Users : item.type === 'invoice' ? Receipt : item.type === 'plan' ? ClipboardList : Leaf);
              return (
                <button
                  key={`${item.type}-${item.id || i}`}
                  data-active={isActive}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIdx(myIdx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isActive ? 'bg-wellness-50 text-wellness-500' : 'text-sage-700 hover:bg-sage-100'
                  }`}
                >
                  <div className={`p-1.5 rounded-button ${isActive ? 'bg-wellness-400/30' : 'bg-sage-100'}`}>
                    <Icon size={14} className={isActive ? 'text-wellness-400' : 'text-sage-600'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{highlight(item.label, query)}</p>
                    {item.description && <p className="text-xs text-sage-500 truncate">{item.description}</p>}
                  </div>
                  {item.meta && <span className="text-xs font-mono text-sage-600 shrink-0">{item.meta}</span>}
                  {isActive && <ArrowRight size={14} className="text-wellness-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-sage-300 flex items-center gap-4 text-[10px] text-sage-400">
          <span><kbd className="bg-sage-100 px-1 rounded">↑↓</kbd> Navegar</span>
          <span><kbd className="bg-sage-100 px-1 rounded">↵</kbd> Seleccionar</span>
          <span><kbd className="bg-sage-100 px-1 rounded">ESC</kbd> Cerrar</span>
        </div>
      </div>
    </div>
  );
};
