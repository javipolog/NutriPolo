import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, Receipt, Search, FileDown, Mail, FileSpreadsheet } from 'lucide-react';
import { Button, EmptyState, StatusBadge, useToast, useConfirm } from './UI';
import useStore, { formatCurrency, formatDate, canDeleteInvoice, errMsg } from '../stores/store';
import { useT, plural } from '../i18n';
import { InvoiceModal, downloadInvoicePdf } from './InvoiceModal';
import { SendEmailModal } from './SendEmailModal';
import { generateInvoicePDF } from '../services/pdfInvoiceGenerator';
import {
  isIssued, isCorrective, invoiceClientName, issuedInPeriod, periodTotals, incomeBookCsv, quarterOf, countsInTotals,
} from '../services/invoicing';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

const QUARTERS = [1, 2, 3, 4];

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
  const [emailing, setEmailing] = useState(null);   // { invoice, client, pdfBytes }
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState(() => String(new Date().getFullYear()));
  const [filterQuarter, setFilterQuarter] = useState(0);
  const [filterEstado, setFilterEstado] = useState('all');

  const years = useMemo(() => {
    const ys = new Set(invoices.map(i => i.fecha?.slice(0, 4)).filter(Boolean));
    ys.add(String(new Date().getFullYear()));
    return [...ys].sort().reverse();
  }, [invoices]);

  const statusOf = (inv) => (!isIssued(inv) ? 'borrador' : inv.estado === 'pendiente' ? 'emitida' : inv.estado);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return invoices.filter(inv => {
      if (filterYear !== 'all' && inv.fecha?.slice(0, 4) !== filterYear) return false;
      if (filterYear !== 'all' && filterQuarter && quarterOf(inv.fecha) !== filterQuarter) return false;
      if (filterEstado !== 'all' && statusOf(inv) !== filterEstado) return false;
      if (q) {
        const name = invoiceClientName(inv, clients).toLowerCase();
        if (!inv.numero?.toLowerCase().includes(q) && !name.includes(q) && !inv.concepto?.toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Drafts first, then by number (newest first)
      if (isIssued(a) !== isIssued(b)) return isIssued(a) ? 1 : -1;
      return (b.numero || '').localeCompare(a.numero || '', undefined, { numeric: true });
    });
  }, [invoices, clients, search, filterYear, filterQuarter, filterEstado]);

  // Figures of the period: issued invoices only (drafts are not income yet)
  const totals = useMemo(() => periodTotals(filtered.filter(isIssued)), [filtered]);
  const drafts = filtered.filter(i => !isIssued(i)).length;

  const handleDelete = async (inv) => {
    if (!canDeleteInvoice(invoices, inv)) {
      toast.info(t.invoice_delete_issued);
      return;
    }
    const ok = await confirm({ message: t.invoice_confirm_delete_draft, danger: true, confirmText: t.delete });
    if (!ok) return;
    if (deleteInvoice(inv.id)) toast.success(t.invoice_deleted);
  };

  const handleDownloadPDF = async (inv) => {
    try {
      if (await downloadInvoicePdf(inv)) toast.success(t.pdf_saved);
    } catch (err) {
      toast.error(t.pdf_error.replace('{error}', errMsg(err) || t.error_unknown));
    }
  };

  const handleEmail = async (inv) => {
    const record = clients.find(c => c.id === inv.clienteId);
    // The client record may be gone: write to the address frozen on the invoice
    const client = record || { id: inv.clienteId, nombre: inv.destinatario?.nombre, email: inv.destinatario?.email };
    if (!client.email) { toast.error(t.email_client_no_email); return; }
    try {
      const pdfBytes = await generateInvoicePDF(inv, record, useStore.getState().config);
      setEmailing({ invoice: inv, client, pdfBytes });
    } catch (err) {
      toast.error(t.pdf_error.replace('{error}', errMsg(err) || t.error_unknown));
    }
  };

  const handleExportBook = async () => {
    if (filterYear === 'all') return;
    const period = `${filterYear}${filterQuarter ? `-T${filterQuarter}` : ''}`;
    const rows = issuedInPeriod(invoices, filterYear, filterQuarter);
    try {
      const path = await save({ defaultPath: `libro-ingresos-${period}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (!path) return;
      await writeTextFile(path, incomeBookCsv(rows));
      toast.success(plural(t, 'invoice_book_exported', rows.length));
    } catch (err) {
      toast.error(t.invoice_book_error.replace('{error}', errMsg(err)));
    }
  };

  const iconBtn = 'p-1.5 rounded-button text-sage-400 transition-colors';

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-title text-sage-900">{t.invoices_title}</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={FileSpreadsheet}
            onClick={handleExportBook}
            disabled={filterYear === 'all'}
            title={filterYear === 'all' ? t.invoice_book_pick_year : t.invoice_book_hint}
          >
            {t.invoice_book_export}
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => { setEditInvoice(null); setShowModal(true); }}>
            {t.new_invoice}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.search_placeholder}
            aria-label={t.search_placeholder}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
          />
        </div>
        <select
          value={filterYear}
          onChange={e => { setFilterYear(e.target.value); if (e.target.value === 'all') setFilterQuarter(0); }}
          aria-label={t.invoices_year}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">{t.invoices_all_years}</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={filterQuarter}
          onChange={e => setFilterQuarter(Number(e.target.value))}
          disabled={filterYear === 'all'}
          aria-label={t.invoices_quarter}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 disabled:opacity-50"
        >
          <option value={0}>{t.invoices_whole_year}</option>
          {QUARTERS.map(q => <option key={q} value={q}>{t.invoices_quarter_n.replace('{n}', q)}</option>)}
        </select>
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          aria-label={t.invoice_status}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">{t.invoices_all_statuses}</option>
          <option value="borrador">{t.invoice_status_draft}</option>
          <option value="emitida">{t.invoice_status_pending}</option>
          <option value="pagada">{t.invoice_status_paid}</option>
          <option value="anulada">{t.invoice_status_cancelled}</option>
        </select>
      </div>

      {/* Period figures (issued invoices; a corrective one subtracts) */}
      {filtered.some(isIssued) && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: t.invoices_base, value: totals.base, hint: t.invoices_base_hint },
            { label: t.invoices_irpf_withheld, value: totals.irpf, hint: t.invoices_irpf_hint },
            { label: t.invoices_paid, value: totals.cobrado, tone: 'text-success' },
            { label: t.invoices_pending, value: totals.total - totals.cobrado, tone: 'text-warning' },
          ].map(card => (
            <div key={card.label} title={card.hint} className="bg-white border border-sage-200 rounded-soft p-3 text-center shadow-card">
              <p className="text-xs text-sage-500">{card.label}</p>
              <p className={`text-lg font-bold tabular-nums ${card.tone || 'text-sage-800'}`}>{formatCurrency(card.value)}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-sage-500">
        {plural(t, 'invoices_count', filtered.length)}
        {drafts > 0 && ` · ${plural(t, 'invoices_drafts', drafts)}`}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t.no_invoices}
          action={{ label: t.new_invoice, onClick: () => { setEditInvoice(null); setShowModal(true); } }}
        />
      ) : (
        <div className="bg-white border border-sage-200 rounded-soft shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sage-200 bg-sage-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_number}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_client}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_date}</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_concept}</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_amount}</th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-sage-500">{t.invoice_status}</th>
                <th className="px-4 py-2.5"><span className="sr-only">{t.actions}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sage-100">
              {filtered.map(inv => {
                const issued = isIssued(inv);
                const loc = inv.locationId ? locations.find(l => l.id === inv.locationId) : null;
                const label = inv.numero || t.invoice_status_draft;
                return (
                  <tr key={inv.id} className={`hover:bg-sage-50 transition-colors ${countsInTotals(inv) ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3 font-mono text-xs text-sage-600">
                      {inv.numero || '—'}
                      {isCorrective(inv) && <span className="block font-sans text-[11px] text-sage-500">{t.invoice_corrects.replace('{number}', inv.rectificaNumero)}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-sage-900">{invoiceClientName(inv, clients) || '—'}</span>
                      {loc && <span className="block text-[11px] text-sage-500">{loc.name}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-sage-500">{formatDate(inv.fecha)}</td>
                    <td className="px-4 py-3 text-xs text-sage-600 max-w-xs truncate">
                      {inv.items?.[0]?.descripcion || inv.concepto || '—'}
                      {inv.items?.length > 1 && (
                        <span className="ml-1.5 text-[11px] bg-sage-100 text-sage-500 px-1.5 py-0.5 rounded-badge">+{inv.items.length - 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-sage-800">{formatCurrency(inv.total ?? inv.importe)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={statusOf(inv)} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {issued && (
                          <>
                            <button onClick={() => handleDownloadPDF(inv)} title={t.download_pdf} aria-label={`${t.download_pdf}: ${label}`} className={`${iconBtn} hover:text-wellness-600 hover:bg-wellness-50`}>
                              <FileDown size={13} />
                            </button>
                            <button onClick={() => handleEmail(inv)} title={t.invoice_send_email} aria-label={`${t.invoice_send_email}: ${label}`} className={`${iconBtn} hover:text-wellness-600 hover:bg-wellness-50`}>
                              <Mail size={13} />
                            </button>
                          </>
                        )}
                        <button onClick={() => { setEditInvoice(inv); setShowModal(true); }} title={issued ? t.invoice_open : t.edit} aria-label={`${issued ? t.invoice_open : t.edit}: ${label}`} className={`${iconBtn} hover:text-sage-700 hover:bg-sage-100`}>
                          <Edit2 size={13} />
                        </button>
                        {!issued && (
                          <button onClick={() => handleDelete(inv)} title={t.delete} aria-label={`${t.delete}: ${label}`} className={`${iconBtn} hover:text-danger hover:bg-danger-light`}>
                            <Trash2 size={13} />
                          </button>
                        )}
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
      {emailing && (
        <SendEmailModal
          mode="invoice"
          client={emailing.client}
          invoice={emailing.invoice}
          pdfBytes={emailing.pdfBytes}
          onClose={() => setEmailing(null)}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default Invoices;
