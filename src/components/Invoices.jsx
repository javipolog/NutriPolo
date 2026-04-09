import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, Receipt, Search, FileDown } from 'lucide-react';
import { Button, EmptyState, useToast, useConfirm } from './UI';
import useStore, { formatCurrency, formatDate } from '../stores/store';
import { useT } from '../i18n';
import { InvoiceModal } from './InvoiceModal';
import { generateInvoicePDF } from '../services/pdfInvoiceGenerator';
import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';

const STATUS_COLORS = {
  pendiente: 'bg-warning-light text-warning',
  pagada:    'bg-success-light text-success',
  anulada:   'bg-danger-light text-danger',
};

export const Invoices = () => {
  const invoices = useStore(s => s.invoices);
  const clients = useStore(s => s.clients);
  const locations = useStore(s => s.config?.locations) || [];
  const deleteInvoice = useStore(s => s.deleteInvoice);
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState('all');
  const [filterEstado, setFilterEstado] = useState('all');

  const years = useMemo(() => {
    const ys = [...new Set(invoices.map(i => i.fecha?.slice(0, 4)).filter(Boolean))].sort().reverse();
    return ys;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return invoices.filter(inv => {
      if (filterYear !== 'all' && inv.fecha?.slice(0, 4) !== filterYear) return false;
      if (filterEstado !== 'all' && inv.estado !== filterEstado) return false;
      if (q) {
        const client = clients.find(c => c.id === inv.clienteId);
        const clientName = client?.nombre?.toLowerCase() || '';
        if (!inv.numero?.toLowerCase().includes(q) && !clientName.includes(q) && !inv.concepto?.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (b.numero || '').localeCompare(a.numero || ''));
  }, [invoices, clients, search, filterYear, filterEstado]);

  const total = filtered.reduce((s, i) => s + (i.total || i.importe || 0), 0);
  const totalPagado = filtered.filter(i => i.estado === 'pagada').reduce((s, i) => s + (i.total || i.importe || 0), 0);

  const handleDelete = async (inv) => {
    const ok = await confirm(`¿Eliminar factura ${inv.numero}?`);
    if (!ok) return;
    deleteInvoice(inv.id);
    toast.success('Factura eliminada');
  };

  const handleDownloadPDF = async (inv) => {
    try {
      const client = clients.find(c => c.id === inv.clienteId);
      const config = useStore.getState().config;
      const pdfBytes = await generateInvoicePDF(inv, client, config);

      const filePath = await save({
        defaultPath: `${inv.numero}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (filePath) {
        await writeBinaryFile(filePath, pdfBytes);
        try { await invoke('open_file', { path: filePath }); } catch (_) { /* optional */ }
        toast.success('PDF guardado');
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('PDF download failed:', err);
      toast.error?.('No se pudo generar el PDF');
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-900">{t.invoices_title}</h1>
        <Button variant="primary" icon={Plus} onClick={() => { setEditInvoice(null); setShowModal(true); }}>
          {t.new_invoice}
        </Button>
      </div>

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-sage-200 rounded-soft p-3 text-center shadow-card">
            <p className="text-xs text-sage-400">{t.invoices_total}</p>
            <p className="text-lg font-bold text-sage-800">{formatCurrency(total)}</p>
          </div>
          <div className="bg-white border border-sage-200 rounded-soft p-3 text-center shadow-card">
            <p className="text-xs text-sage-400">{t.invoices_paid}</p>
            <p className="text-lg font-bold text-success">{formatCurrency(totalPagado)}</p>
          </div>
          <div className="bg-white border border-sage-200 rounded-soft p-3 text-center shadow-card">
            <p className="text-xs text-sage-400">{t.invoices_pending}</p>
            <p className="text-lg font-bold text-warning">{formatCurrency(total - totalPagado)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.search_placeholder}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
          />
        </div>
        <select
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todos los años</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="pagada">Pagada</option>
          <option value="anulada">Anulada</option>
        </select>
      </div>

      <p className="text-xs text-sage-500">{filtered.length} factura{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t.no_invoices}
          action={{ label: t.new_invoice, onClick: () => setShowModal(true) }}
        />
      ) : (
        <div className="bg-white border border-sage-200 rounded-soft shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sage-200 bg-sage-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">Número</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">Cliente</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">Fecha</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">Concepto</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-sage-500">Importe</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-sage-500">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sage-100">
              {filtered.map(inv => {
                const client = clients.find(c => c.id === inv.clienteId);
                const loc = inv.locationId ? locations.find(l => l.id === inv.locationId) : null;
                return (
                  <tr key={inv.id} className="hover:bg-sage-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-sage-600">{inv.numero}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-sage-900">{client?.nombre || '—'}</span>
                      {loc && <span className="block text-[10px] text-sage-400">{loc.name}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-sage-500">{formatDate(inv.fecha)}</td>
                    <td className="px-4 py-3 text-xs text-sage-600 max-w-xs truncate">
                      {inv.items?.[0]?.descripcion || inv.concepto || '—'}
                      {inv.items?.length > 1 && (
                        <span className="ml-1.5 text-[10px] bg-sage-100 text-sage-500 px-1.5 py-0.5 rounded-badge">+{inv.items.length - 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-sage-800">{formatCurrency(inv.total || inv.importe)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-badge font-medium ${STATUS_COLORS[inv.estado] || 'bg-sage-100 text-sage-500'}`}>
                        {inv.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownloadPDF(inv)}
                          title="Descargar PDF"
                          className="p-1.5 rounded-button text-sage-400 hover:text-wellness-600 hover:bg-wellness-50 transition-colors"
                        >
                          <FileDown size={13} />
                        </button>
                        <button
                          onClick={() => { setEditInvoice(inv); setShowModal(true); }}
                          className="p-1.5 rounded-button text-sage-400 hover:text-sage-700 hover:bg-sage-100 transition-colors"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(inv)}
                          className="p-1.5 rounded-button text-sage-400 hover:text-danger hover:bg-danger-light transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <InvoiceModal
          invoice={editInvoice}
          onClose={() => { setShowModal(false); setEditInvoice(null); }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default Invoices;
