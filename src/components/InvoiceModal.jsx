import React, { useState, useMemo, useRef } from 'react';
import { Plus, Trash2, FileDown, FileMinus, Lock } from 'lucide-react';
import { Modal, Textarea, Button, SegmentedControl, useToast } from './UI';
import useStore, { todayISO, generateId, computeInvoiceTotals, formatDate, errMsg } from '../stores/store';
import { useT } from '../i18n';
import { generateInvoicePDF } from '../services/pdfInvoiceGenerator';
import { isIssued, isCorrective, seriesOf } from '../services/invoicing';
import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';

const emptyItem = () => ({
  id: generateId(),
  descripcion: '',
  cantidad: 1,
  precioUnitario: '',
  servicioId: null,
  consultationId: null,
});

const inputCls = 'w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 disabled:bg-sage-50 disabled:text-sage-600';

/** Ask where to save an invoice PDF, write it and open it. Returns whether it was saved. */
export async function downloadInvoicePdf(invoice) {
  const { clients, config } = useStore.getState();
  const pdfBytes = await generateInvoicePDF(invoice, clients.find(c => c.id === invoice.clienteId), config);
  const filePath = await save({ defaultPath: `${invoice.numero}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!filePath) return false;
  await writeBinaryFile(filePath, pdfBytes);
  try { await invoke('open_file', { path: filePath }); } catch (_) { /* optional */ }
  return true;
}

/**
 * New invoice, draft, issued invoice or corrective invoice.
 *  - Draft (or new): everything editable; "Save draft" or "Issue", which
 *    gives the number, freezes the data and saves the PDF.
 *  - Issued: only payment (status, date, method); "Correct" starts a
 *    corrective invoice, opened in place.
 */
export const InvoiceModal = (props) => {
  const [current, setCurrent] = useState(props.invoice || null);
  return <InvoiceForm key={current?.id || 'new'} {...props} invoice={current} onSwitch={setCurrent} />;
};

const InvoiceForm = ({ invoice, defaultClientId, onClose, onSwitch }) => {
  const clients = useStore(s => s.clients);
  const services = useStore(s => s.services);
  const getUnbilledConsultations = useStore(s => s.getUnbilledConsultations);
  const config = useStore(s => s.config);
  const saveInvoiceDraft = useStore(s => s.saveInvoiceDraft);
  const issueInvoice = useStore(s => s.issueInvoice);
  const updateInvoice = useStore(s => s.updateInvoice);
  const createCorrectiveDraft = useStore(s => s.createCorrectiveDraft);
  const generateInvoiceNumber = useStore(s => s.generateInvoiceNumber);
  const t = useT();
  const toast = useToast();

  const issued = isIssued(invoice);
  const corrective = isCorrective(invoice);
  const locked = issued;
  const defaultIva = config?.tipoIva ?? 0;

  const [form, setForm] = useState(() => ({
    clienteId: invoice?.clienteId || defaultClientId || '',
    fecha: invoice?.fecha || todayISO(),
    estado: invoice?.estado || 'pendiente',
    fechaCobro: invoice?.fechaCobro || '',
    metodoPago: invoice?.metodoPago || '',
    locationId: invoice?.locationId || '',
    notas: invoice?.notas || '',
    motivoRectificacion: invoice?.motivoRectificacion || '',
    ivaPct: invoice?.ivaPct ?? defaultIva,
    irpfPct: invoice?.irpfPct ?? 0,
    items: invoice?.items?.length
      ? invoice.items.map(item => ({ ...item, precioUnitario: item.precioUnitario?.toString() ?? '' }))
      : [],
  }));

  const [errors, setErrors] = useState({});
  const [problems, setProblems] = useState([]);
  const [showConsultations, setShowConsultations] = useState(false);
  // Id of the draft once saved here (a new invoice becomes a draft on the first save)
  const draftIdRef = useRef(invoice?.id || null);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const unbilledConsultations = useMemo(() => {
    if (!form.clienteId || corrective) return [];
    return getUnbilledConsultations(form.clienteId);
  }, [form.clienteId, getUnbilledConsultations, corrective]);

  // ── Item operations ──────────────────────────────────────────
  const updateItem = (id, field, value) => {
    setForm(f => ({ ...f, items: f.items.map(item => item.id === id ? { ...item, [field]: value } : item) }));
  };
  const addManualItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const addServiceItem = (servicioId) => {
    const svc = services.find(s => s.id === servicioId);
    if (!svc) return;
    setForm(f => ({
      ...f,
      items: [...f.items, { id: generateId(), descripcion: svc.nombre, cantidad: 1, precioUnitario: svc.precio.toString(), servicioId: svc.id, consultationId: null }],
    }));
  };
  const addConsultationItem = (consultation) => {
    const svc = services.find(s => s.activo && s.nombre.toLowerCase() === consultation.tipo?.toLowerCase());
    setForm(f => ({
      ...f,
      items: [...f.items, {
        id: generateId(),
        descripcion: `${consultation.tipo || t.consultation_default} — ${formatDate(consultation.fecha)}`,
        cantidad: 1,
        precioUnitario: svc ? svc.precio.toString() : '',
        servicioId: svc ? svc.id : null,
        consultationId: consultation.id,
      }],
    }));
  };
  const removeItem = (id) => setForm(f => ({ ...f, items: f.items.filter(item => item.id !== id) }));

  // Another client: lines for the previous client's consultations go
  const changeClient = (clienteId) => {
    const linked = form.items.filter(i => i.consultationId).length;
    setForm(f => ({ ...f, clienteId, items: f.items.filter(i => !i.consultationId) }));
    setShowConsultations(false);
    if (linked) toast.info(t.invoice_client_changed_lines.replace('{n}', linked));
  };

  // ── Computed totals ──────────────────────────────────────────
  const parsedItems = useMemo(() => form.items.map(item => ({
    ...item,
    cantidad: parseFloat(item.cantidad) || 0,
    precioUnitario: parseFloat(item.precioUnitario) || 0,
  })), [form.items]);
  const totals = useMemo(() => computeInvoiceTotals(parsedItems, form.ivaPct, form.irpfPct), [parsedItems, form.ivaPct, form.irpfPct]);
  const fmt = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  // ── Validation ───────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = t.select_client_error;
    if (form.items.length === 0) e.items = t.invoice_need_item;
    form.items.forEach((item, idx) => {
      if (!item.descripcion.trim()) e[`item_desc_${idx}`] = t.error_required;
      const qty = parseFloat(item.cantidad);
      if (!qty || qty <= 0) e[`item_qty_${idx}`] = '> 0';
      if (item.precioUnitario === '' || isNaN(parseFloat(item.precioUnitario))) e[`item_price_${idx}`] = t.error_required;
    });
    return e;
  };

  const draftData = () => ({
    clienteId: form.clienteId,
    fecha: form.fecha,
    estado: form.estado,
    fechaCobro: form.estado === 'pagada' ? (form.fechaCobro || todayISO()) : '',
    metodoPago: form.metodoPago,
    locationId: form.locationId || null,
    notas: form.notas,
    motivoRectificacion: form.motivoRectificacion,
    ivaPct: parseFloat(form.ivaPct) || 0,
    irpfPct: parseFloat(form.irpfPct) || 0,
    items: parsedItems.map(({ id, descripcion, cantidad, precioUnitario, servicioId, consultationId }) => ({
      id, descripcion, cantidad, precioUnitario, servicioId, consultationId,
    })),
  });

  // ── Actions ──────────────────────────────────────────────────
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const saveDraft = () => run(async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const draft = saveInvoiceDraft(draftData(), draftIdRef.current);
    draftIdRef.current = draft.id;
    toast.success(t.invoice_draft_saved);
    onClose();
  });

  const issue = () => run(async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const draft = saveInvoiceDraft(draftData(), draftIdRef.current);
    draftIdRef.current = draft.id;
    const result = issueInvoice(draft.id);
    if (!result.ok) { setProblems(result.problems); return; }
    setProblems([]);
    try {
      const saved = await downloadInvoicePdf(result.invoice);
      toast.success((saved ? t.invoice_issued_pdf : t.invoice_issued).replace('{number}', result.invoice.numero));
    } catch (pdfErr) {
      toast.success(t.invoice_issued.replace('{number}', result.invoice.numero));
      toast.error(t.pdf_error.replace('{error}', errMsg(pdfErr) || t.error_unknown));
    }
    onClose();
  });

  const savePayment = () => run(async () => {
    updateInvoice(invoice.id, {
      estado: form.estado,
      metodoPago: form.metodoPago,
      fechaCobro: form.estado === 'pagada' ? (form.fechaCobro || todayISO()) : '',
    });
    toast.success(t.invoice_updated);
    onClose();
  });

  const download = () => run(async () => {
    try {
      if (await downloadInvoicePdf(invoice)) toast.success(t.pdf_saved);
    } catch (err) {
      toast.error(t.pdf_error.replace('{error}', errMsg(err) || t.error_unknown));
    }
  });

  const startCorrective = () => {
    const draft = createCorrectiveDraft(invoice.id);
    if (draft) onSwitch(draft);
  };

  const problemText = (p) => {
    const text = t[`invoice_problem_${p.code}`] || p.code;
    return p.last ? text.replace('{number}', p.last.numero).replace('{date}', formatDate(p.last.fecha)) : text;
  };

  const activeServices = services.filter(s => s.activo);
  const canCorrect = issued && !corrective && invoice.estado !== 'anulada';
  const title = issued
    ? `${corrective ? t.invoice_corrective : t.invoice_label} ${invoice.numero}`
    : corrective ? t.invoice_new_corrective : invoice ? t.invoice_edit_draft : t.new_invoice;

  return (
    <Modal
      open
      guardChanges
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex items-center gap-2">
          {canCorrect && (
            <Button variant="ghost" icon={FileMinus} onClick={startCorrective} disabled={busy}>{t.invoice_correct}</Button>
          )}
          {issued && (
            <Button variant="ghost" icon={FileDown} onClick={download} disabled={busy}>{t.download_pdf}</Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          {issued ? (
            <Button variant="primary" onClick={savePayment} disabled={busy}>{t.save}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={saveDraft} disabled={busy}>{t.invoice_save_draft}</Button>
              <Button variant="primary" onClick={issue} disabled={busy}>{t.invoice_issue}</Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {issued && (
          <p className="flex items-start gap-2 text-xs text-sage-600 bg-sage-50 border border-sage-200 rounded-soft px-3 py-2">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>{t.invoice_issued_locked.replace('{date}', formatDate(invoice.emitidaAt.slice(0, 10)))}</span>
          </p>
        )}
        {corrective && (
          <div className="bg-warning-light border border-warning/30 rounded-soft px-3 py-2 space-y-2">
            <p className="text-xs text-sage-700">
              {t.invoice_corrective_of.replace('{number}', invoice.rectificaNumero).replace('{date}', formatDate(invoice.rectificaFecha))}
            </p>
            {!issued && <p className="text-xs text-sage-500">{t.invoice_corrective_hint}</p>}
            <div>
              <label htmlFor="inv-motivo" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_corrective_reason} *</label>
              <Textarea
                id="inv-motivo"
                value={form.motivoRectificacion}
                onChange={e => setField('motivoRectificacion', e.target.value)}
                rows={2}
                disabled={locked}
              />
            </div>
          </div>
        )}
        {problems.length > 0 && (
          <div role="alert" className="bg-danger-light border border-danger/30 rounded-soft px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-danger">{t.invoice_cannot_issue}</p>
            <ul className="list-disc pl-5 text-xs text-sage-700 space-y-0.5">
              {problems.map(p => <li key={p.code}>{problemText(p)}</li>)}
            </ul>
          </div>
        )}

        {/* Number + Client + Date + Payment + Location */}
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_number}</label>
            {issued ? (
              <p className="px-3 py-2 text-sm font-mono text-sage-800">{invoice.numero}</p>
            ) : (
              <p className="px-1 py-2 text-xs text-sage-500" title={t.invoice_number_on_issue}>
                {t.invoice_number_next.replace('{number}', generateInvoiceNumber(form.fecha, seriesOf(invoice)))}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="inv-client" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_client} *</label>
            <select
              id="inv-client"
              value={form.clienteId}
              onChange={e => changeClient(e.target.value)}
              disabled={locked || corrective}
              className={`${inputCls} ${errors.clienteId ? 'border-danger' : ''}`}
            >
              <option value="">{t.select_client_placeholder}</option>
              {[...clients].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
              {issued && !clients.some(c => c.id === form.clienteId) && (
                <option value={form.clienteId}>{invoice.destinatario?.nombre || '—'}</option>
              )}
            </select>
            {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
          </div>
          <div>
            <label htmlFor="inv-date" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_date}</label>
            <input id="inv-date" type="date" value={form.fecha} onChange={e => setField('fecha', e.target.value)} disabled={locked} className={inputCls} />
          </div>
          <div>
            <label htmlFor="inv-method" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_payment_method}</label>
            <select id="inv-method" value={form.metodoPago} onChange={e => setField('metodoPago', e.target.value)} className={inputCls}>
              <option value="">{t.not_specified}</option>
              <option value="efectivo">{t.payment_cash}</option>
              <option value="transferencia">{t.payment_transfer}</option>
              <option value="bizum">Bizum</option>
              <option value="tarjeta">{t.payment_card}</option>
            </select>
          </div>
          <div>
            <label htmlFor="inv-location" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_location}</label>
            <select id="inv-location" value={form.locationId} onChange={e => setField('locationId', e.target.value)} disabled={locked} className={inputCls}>
              <option value="">{t.not_specified}</option>
              {(config?.locations || []).map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>
        </div>

        {/* Payment status */}
        {invoice?.estado === 'anulada' ? (
          <p className="text-xs text-sage-600">{t.invoice_cancelled_by_corrective}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_status}</label>
              <SegmentedControl
                ariaLabel={t.invoice_status}
                value={form.estado}
                onChange={v => setForm(f => ({ ...f, estado: v, fechaCobro: v === 'pagada' ? (f.fechaCobro || todayISO()) : f.fechaCobro }))}
                options={[
                  { value: 'pendiente', label: t.invoice_status_pending },
                  { value: 'pagada',    label: t.invoice_status_paid },
                ]}
              />
            </div>
            {form.estado === 'pagada' && (
              <div>
                <label htmlFor="inv-paid-on" className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_paid_on}</label>
                <input id="inv-paid-on" type="date" value={form.fechaCobro} onChange={e => setField('fechaCobro', e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
        )}

        {/* Items table */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">{t.invoice_items} *</label>
          {errors.items && <p className="text-xs text-danger mb-2">{errors.items}</p>}
          <div className="border border-sage-200 rounded-soft overflow-hidden">
            <div className="grid grid-cols-[1fr_56px_96px_80px_32px] gap-0 bg-sage-50 border-b border-sage-200 px-2 py-1.5">
              <span className="text-xs font-medium text-sage-500">{t.invoice_description}</span>
              <span className="text-xs font-medium text-sage-500 text-center">{t.invoice_quantity_short}</span>
              <span className="text-xs font-medium text-sage-500 text-right">{t.invoice_unit_price_short}</span>
              <span className="text-xs font-medium text-sage-500 text-right">{t.invoice_line_total}</span>
              <span />
            </div>
            {form.items.map((item, idx) => {
              const lineTotal = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0);
              return (
                <div key={item.id} className="grid grid-cols-[1fr_56px_96px_80px_32px] gap-0 items-center border-b border-sage-100 last:border-b-0 px-2 py-1.5">
                  <div>
                    <input
                      type="text"
                      value={item.descripcion}
                      onChange={e => updateItem(item.id, 'descripcion', e.target.value)}
                      placeholder={t.invoice_item_placeholder}
                      aria-label={t.invoice_description}
                      disabled={locked}
                      className={`w-full px-2 py-1 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 disabled:bg-transparent disabled:border-transparent ${errors[`item_desc_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                    {errors[`item_desc_${idx}`] && <p className="text-[11px] text-danger mt-0.5">{errors[`item_desc_${idx}`]}</p>}
                  </div>
                  <div className="px-1">
                    <input
                      type="number" min="0.01" step="0.01"
                      value={item.cantidad}
                      onChange={e => updateItem(item.id, 'cantidad', e.target.value)}
                      aria-label={t.invoice_quantity_short}
                      disabled={locked}
                      className={`w-full px-1.5 py-1 text-sm text-center border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 disabled:bg-transparent disabled:border-transparent ${errors[`item_qty_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                  </div>
                  <div className="px-1">
                    <input
                      type="number" step="0.01" min={corrective ? undefined : '0'}
                      value={item.precioUnitario}
                      onChange={e => updateItem(item.id, 'precioUnitario', e.target.value)}
                      placeholder="0.00"
                      aria-label={t.invoice_unit_price_short}
                      disabled={locked}
                      className={`w-full px-1.5 py-1 text-sm text-right border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 disabled:bg-transparent disabled:border-transparent ${errors[`item_price_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                  </div>
                  <div className="text-right pr-1">
                    <span className="text-sm tabular-nums text-sage-700">{fmt(lineTotal)}</span>
                  </div>
                  <div className="flex justify-center">
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={t.invoice_remove_item}
                        title={t.invoice_remove_item}
                        className="p-1 text-sage-400 hover:text-danger transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!locked && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" onClick={addManualItem} className="flex items-center gap-1 px-2.5 py-1 text-xs border border-sage-300 rounded-button text-sage-600 hover:bg-sage-50 transition-colors">
                <Plus size={11} /> {t.invoice_add_line}
              </button>
              {activeServices.length > 0 && !corrective && (
                <select
                  defaultValue=""
                  aria-label={t.invoice_add_service}
                  onChange={e => { if (e.target.value) { addServiceItem(e.target.value); e.target.value = ''; } }}
                  className="px-2.5 py-1 text-xs border border-sage-300 rounded-button bg-white text-sage-600 hover:bg-sage-50 focus:outline-none focus:border-wellness-400 cursor-pointer"
                >
                  <option value="" disabled>+ {t.invoice_add_service}...</option>
                  {activeServices.map(svc => <option key={svc.id} value={svc.id}>{svc.nombre} — {svc.precio.toFixed(2)} €</option>)}
                </select>
              )}
              {form.clienteId && unbilledConsultations.length > 0 && (
                <button type="button" onClick={() => setShowConsultations(v => !v)} className="flex items-center gap-1 px-2.5 py-1 text-xs border border-wellness-300 rounded-button text-wellness-600 hover:bg-wellness-50 transition-colors">
                  <Plus size={11} /> {t.invoice_add_consultations.replace('{n}', unbilledConsultations.length)}
                </button>
              )}
            </div>
          )}

          {!locked && showConsultations && unbilledConsultations.length > 0 && (
            <div className="mt-2 border border-wellness-200 rounded-soft bg-wellness-50 p-3 space-y-1.5 max-h-40 overflow-y-auto">
              <p className="text-xs font-medium text-wellness-700 mb-2">{t.invoice_unbilled_title}</p>
              {[...unbilledConsultations].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => {
                const alreadyAdded = form.items.some(item => item.consultationId === c.id);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-sage-700">{c.tipo || t.consultation_default} — {formatDate(c.fecha)}{c.hora ? ` ${c.hora}` : ''}</span>
                    {alreadyAdded ? (
                      <span className="text-[11px] text-success font-medium">{t.invoice_item_added}</span>
                    ) : (
                      <button type="button" onClick={() => addConsultationItem(c)} className="text-[11px] px-2 py-0.5 bg-wellness-400 text-white rounded-badge hover:bg-wellness-500 transition-colors">
                        {t.add}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tax + Totals */}
        <div className="bg-sage-50 rounded-soft p-3 space-y-2">
          {!locked && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="inv-iva" className="text-xs font-medium text-sage-600 whitespace-nowrap">{t.invoice_iva} %</label>
                <input
                  id="inv-iva" type="number" min="0" max="100" step="1"
                  value={form.ivaPct}
                  onChange={e => setField('ivaPct', parseFloat(e.target.value) || 0)}
                  className="w-16 px-2 py-1 text-sm text-center border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="inv-irpf" className="text-xs font-medium text-sage-600 whitespace-nowrap">{t.invoice_irpf} %</label>
                <input
                  id="inv-irpf" type="number" min="0" max="100" step="1"
                  value={form.irpfPct}
                  onChange={e => setField('irpfPct', parseFloat(e.target.value) || 0)}
                  className="w-16 px-2 py-1 text-sm text-center border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
                />
                <div className="flex gap-1">
                  {[0, 7, 15].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setField('irpfPct', pct)}
                      aria-pressed={form.irpfPct === pct}
                      className={`px-2 py-0.5 text-[11px] rounded-badge transition-colors ${form.irpfPct === pct ? 'bg-sage-700 text-white' : 'bg-sage-200 text-sage-600 hover:bg-sage-300'}`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!locked && form.irpfPct > 0 && <p className="text-[11px] text-sage-500">{t.invoice_irpf_hint}</p>}

          <div className={`${locked ? '' : 'border-t border-sage-200 pt-2'} space-y-1`}>
            <div className="flex justify-between text-xs text-sage-600">
              <span>{t.invoice_base_amount}</span>
              <span className="tabular-nums">{fmt(totals.baseImponible)} €</span>
            </div>
            {form.ivaPct > 0 ? (
              <div className="flex justify-between text-xs text-sage-600">
                <span>IVA ({form.ivaPct}%)</span>
                <span className="tabular-nums">{fmt(totals.ivaImporte)} €</span>
              </div>
            ) : (
              <div className="flex justify-between text-xs text-sage-500 italic">
                <span>{t.invoice_vat_exempt}</span>
                <span className="tabular-nums">0,00 €</span>
              </div>
            )}
            {form.irpfPct > 0 && (
              <div className="flex justify-between text-xs text-sage-600">
                <span>IRPF (-{form.irpfPct}%)</span>
                <span className="tabular-nums text-danger">{fmt(-totals.irpfImporte)} €</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-sage-900 border-t border-sage-300 pt-1.5 mt-1">
              <span>{t.invoice_total.toUpperCase()}</span>
              <span className="tabular-nums text-terra-500">{fmt(totals.total)} €</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="inv-notes" className="block text-xs font-medium text-sage-600 mb-1">{t.notes}</label>
          <Textarea id="inv-notes" value={form.notas} onChange={e => setField('notas', e.target.value)} rows={2} placeholder={t.invoice_notes_placeholder} disabled={locked} />
        </div>
      </div>
    </Modal>
  );
};

export default InvoiceModal;
