import React, { useState, useMemo, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Textarea, Button, SegmentedControl, useToast } from './UI';
import useStore, { todayISO, generateId, computeInvoiceTotals, formatDate, errMsg } from '../stores/store';
import { useT } from '../i18n';
import { generateInvoicePDF } from '../services/pdfInvoiceGenerator';
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

export const InvoiceModal = ({ invoice, defaultClientId, onClose }) => {
  const clients = useStore(s => s.clients);
  const services = useStore(s => s.services);
  const getUnbilledConsultations = useStore(s => s.getUnbilledConsultations);
  const config = useStore(s => s.config);
  const addInvoice = useStore(s => s.addInvoice);
  const updateInvoice = useStore(s => s.updateInvoice);
  const generateInvoiceNumber = useStore(s => s.generateInvoiceNumber);
  const t = useT();
  const toast = useToast();
  const isEdit = !!invoice;

  const defaultIva = config?.tipoIva ?? 0;

  const [form, setForm] = useState(() => {
    if (invoice) {
      return {
        numero: invoice.numero || '',
        clienteId: invoice.clienteId || '',
        fecha: invoice.fecha || todayISO(),
        estado: invoice.estado || 'pendiente',
        metodoPago: invoice.metodoPago || '',
        locationId: invoice.locationId || '',
        notas: invoice.notas || '',
        ivaPct: invoice.ivaPct ?? defaultIva,
        irpfPct: invoice.irpfPct ?? 0,
        items: invoice.items?.length
          ? invoice.items.map(item => ({ ...item, precioUnitario: item.precioUnitario?.toString() ?? '' }))
          : [emptyItem()],
      };
    }
    return {
      numero: generateInvoiceNumber(),
      clienteId: defaultClientId || '',
      fecha: todayISO(),
      estado: 'pendiente',
      metodoPago: '',
      locationId: '',
      notas: '',
      ivaPct: defaultIva,
      irpfPct: 0,
      items: [],
    };
  });

  const [errors, setErrors] = useState({});
  const [showConsultations, setShowConsultations] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const unbilledConsultations = useMemo(() => {
    if (!form.clienteId) return [];
    return getUnbilledConsultations(form.clienteId);
  }, [form.clienteId, getUnbilledConsultations]);

  // ── Item operations ──────────────────────────────────────────
  const updateItem = (id, field, value) => {
    setForm(f => ({
      ...f,
      items: f.items.map(item => item.id === id ? { ...item, [field]: value } : item),
    }));
  };

  const addManualItem = () => {
    setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  };

  const addServiceItem = (servicioId) => {
    const svc = services.find(s => s.id === servicioId);
    if (!svc) return;
    setForm(f => ({
      ...f,
      items: [...f.items, {
        id: generateId(),
        descripcion: svc.nombre,
        cantidad: 1,
        precioUnitario: svc.precio.toString(),
        servicioId: svc.id,
        consultationId: null,
      }],
    }));
  };

  const addConsultationItem = (consultation) => {
    const svc = services.find(s =>
      s.activo && s.nombre.toLowerCase() === consultation.tipo?.toLowerCase()
    );
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

  const removeItem = (id) => {
    setForm(f => ({ ...f, items: f.items.filter(item => item.id !== id) }));
  };

  // ── Computed totals ──────────────────────────────────────────
  const parsedItems = useMemo(() =>
    form.items.map(item => ({
      ...item,
      cantidad: parseFloat(item.cantidad) || 0,
      precioUnitario: parseFloat(item.precioUnitario) || 0,
    })),
  [form.items]);

  const totals = useMemo(() =>
    computeInvoiceTotals(parsedItems, form.ivaPct, form.irpfPct),
  [parsedItems, form.ivaPct, form.irpfPct]);

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

  // ── Save ─────────────────────────────────────────────────────
  // The invoice is created before the PDF dialog awaits; a ref guard (not
  // just state) stops a double click from creating it twice.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (savingRef.current) return;
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    savingRef.current = true;
    setSaving(true);

    const cleanItems = parsedItems.map(({ id, descripcion, cantidad, precioUnitario, servicioId, consultationId }) => ({
      id, descripcion, cantidad, precioUnitario, servicioId, consultationId,
    }));

    const data = {
      numero: form.numero.trim(),
      clienteId: form.clienteId,
      fecha: form.fecha,
      estado: form.estado,
      metodoPago: form.metodoPago,
      locationId: form.locationId || null,
      notas: form.notas,
      ivaPct: parseFloat(form.ivaPct) || 0,
      irpfPct: parseFloat(form.irpfPct) || 0,
      items: cleanItems,
    };

    let savedInvoice;
    if (isEdit) {
      updateInvoice(invoice.id, data);
      // updateInvoice recomputes totals and compat fields; fetch updated state
      savedInvoice = useStore.getState().invoices.find(i => i.id === invoice.id);
    } else {
      savedInvoice = addInvoice(data);
    }

    try {
      const client = useStore.getState().clients.find(c => c.id === savedInvoice.clienteId);
      const cfg = useStore.getState().config;
      const pdfBytes = await generateInvoicePDF(savedInvoice, client, cfg);

      const filePath = await save({
        defaultPath: `${savedInvoice.numero}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (filePath) {
        await writeBinaryFile(filePath, pdfBytes);
        try { await invoke('open_file', { path: filePath }); } catch (_) { /* optional */ }
        toast.success(isEdit ? t.invoice_updated_pdf : t.invoice_created_pdf);
      } else {
        toast.success(isEdit ? t.invoice_updated : t.invoice_created);
      }
    } catch (pdfErr) {
      if (import.meta.env.DEV) console.error('PDF generation failed:', pdfErr);
      toast.success(isEdit ? t.invoice_updated : t.invoice_created);
      toast.error(t.pdf_error.replace('{error}', errMsg(pdfErr) || t.error_unknown));
    }

    onClose();
  };

  const activeServices = services.filter(s => s.activo);

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t.invoice_edit : t.new_invoice}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{t.save}</Button>
        </div>
      }
    >
      <div className="space-y-4">

        {/* Invoice number + Client + Date + Payment + Location */}
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_number}</label>
            <input
              type="text"
              value={form.numero}
              onChange={e => setField('numero', e.target.value)}
              placeholder="NP-2026-001"
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_client} *</label>
            <select
              value={form.clienteId}
              onChange={e => { setField('clienteId', e.target.value); setShowConsultations(false); }}
              className={`w-full px-3 py-2 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors.clienteId ? 'border-danger' : 'border-sage-300'}`}
            >
              <option value="">{t.select_client_placeholder}</option>
              {[...clients].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_date}</label>
            <input
              type="date"
              value={form.fecha}
              onChange={e => setField('fecha', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_payment_method}</label>
            <select
              value={form.metodoPago}
              onChange={e => setField('metodoPago', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            >
              <option value="">{t.not_specified}</option>
              <option value="efectivo">{t.payment_cash}</option>
              <option value="transferencia">{t.payment_transfer}</option>
              <option value="bizum">Bizum</option>
              <option value="tarjeta">{t.payment_card}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_location}</label>
            <select
              value={form.locationId}
              onChange={e => setField('locationId', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            >
              <option value="">{t.not_specified}</option>
              {(config?.locations || []).map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Estado chips */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.invoice_status}</label>
          <SegmentedControl
            ariaLabel={t.invoice_status}
            value={form.estado}
            onChange={v => setField('estado', v)}
            options={[
              { value: 'pendiente', label: t.invoice_status_pending },
              { value: 'pagada',    label: t.invoice_status_paid },
              { value: 'anulada',   label: t.invoice_status_cancelled },
            ]}
          />
        </div>

        {/* Items table */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-2">{t.invoice_items} *</label>
          {errors.items && <p className="text-xs text-danger mb-2">{errors.items}</p>}
          <div className="border border-sage-200 rounded-soft overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_56px_96px_80px_32px] gap-0 bg-sage-50 border-b border-sage-200 px-2 py-1.5">
              <span className="text-xs font-medium text-sage-500">{t.invoice_description}</span>
              <span className="text-xs font-medium text-sage-500 text-center">{t.invoice_quantity_short}</span>
              <span className="text-xs font-medium text-sage-500 text-right">{t.invoice_unit_price_short}</span>
              <span className="text-xs font-medium text-sage-500 text-right">{t.invoice_line_total}</span>
              <span />
            </div>

            {/* Item rows */}
            {form.items.map((item, idx) => {
              const lineTotal = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_56px_96px_80px_32px] gap-0 items-center border-b border-sage-100 last:border-b-0 px-2 py-1.5"
                >
                  <div>
                    <input
                      type="text"
                      value={item.descripcion}
                      onChange={e => updateItem(item.id, 'descripcion', e.target.value)}
                      placeholder={t.invoice_item_placeholder}
                      className={`w-full px-2 py-1 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors[`item_desc_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                    {errors[`item_desc_${idx}`] && <p className="text-[11px] text-danger mt-0.5">{errors[`item_desc_${idx}`]}</p>}
                  </div>
                  <div className="px-1">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.cantidad}
                      onChange={e => updateItem(item.id, 'cantidad', e.target.value)}
                      className={`w-full px-1.5 py-1 text-sm text-center border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors[`item_qty_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                  </div>
                  <div className="px-1">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.precioUnitario}
                      onChange={e => updateItem(item.id, 'precioUnitario', e.target.value)}
                      placeholder="0.00"
                      className={`w-full px-1.5 py-1 text-sm text-right border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors[`item_price_${idx}`] ? 'border-danger' : 'border-sage-200'}`}
                    />
                  </div>
                  <div className="text-right pr-1">
                    <span className="text-sm tabular-nums text-sage-700">{fmt(lineTotal)}</span>
                  </div>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label={t.invoice_remove_item}
                      title={t.invoice_remove_item}
                      className="p-1 text-sage-300 hover:text-danger transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add buttons */}
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={addManualItem}
              className="flex items-center gap-1 px-2.5 py-1 text-xs border border-sage-300 rounded-button text-sage-600 hover:bg-sage-50 transition-colors"
            >
              <Plus size={11} /> Añadir línea
            </button>

            {activeServices.length > 0 && (
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) { addServiceItem(e.target.value); e.target.value = ''; } }}
                className="px-2.5 py-1 text-xs border border-sage-300 rounded-button bg-white text-sage-600 hover:bg-sage-50 focus:outline-none focus:border-wellness-400 cursor-pointer"
              >
                <option value="" disabled>+ {t.invoice_add_service}...</option>
                {activeServices.map(svc => (
                  <option key={svc.id} value={svc.id}>{svc.nombre} — {svc.precio.toFixed(2)} €</option>
                ))}
              </select>
            )}

            {form.clienteId && unbilledConsultations.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConsultations(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs border border-wellness-300 rounded-button text-wellness-600 hover:bg-wellness-50 transition-colors"
              >
                <Plus size={11} /> Añadir consultas ({unbilledConsultations.length})
              </button>
            )}
          </div>

          {/* Unbilled consultations checklist */}
          {showConsultations && unbilledConsultations.length > 0 && (
            <div className="mt-2 border border-wellness-200 rounded-soft bg-wellness-50 p-3 space-y-1.5 max-h-40 overflow-y-auto">
              <p className="text-xs font-medium text-wellness-700 mb-2">{t.invoice_unbilled_title}</p>
              {unbilledConsultations.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => {
                const alreadyAdded = form.items.some(item => item.consultationId === c.id);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-sage-700">
                      {c.tipo || t.consultation_default} — {formatDate(c.fecha)}{c.hora ? ` ${c.hora}` : ''}
                    </span>
                    {alreadyAdded ? (
                      <span className="text-[11px] text-success font-medium">{t.invoice_item_added}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addConsultationItem(c)}
                        className="text-[11px] px-2 py-0.5 bg-wellness-400 text-white rounded-badge hover:bg-wellness-500 transition-colors"
                      >
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
          {/* Tax inputs */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-sage-600 whitespace-nowrap">{t.invoice_iva} %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={form.ivaPct}
                onChange={e => setField('ivaPct', parseFloat(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm text-center border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-sage-600 whitespace-nowrap">{t.invoice_irpf} %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
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
                    className={`px-2 py-0.5 text-[11px] rounded-badge transition-colors ${
                      form.irpfPct === pct ? 'bg-sage-700 text-white' : 'bg-sage-200 text-sage-600 hover:bg-sage-300'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="border-t border-sage-200 pt-2 space-y-1">
            <div className="flex justify-between text-xs text-sage-600">
              <span>{t.invoice_base_amount}</span>
              <span className="tabular-nums">{fmt(totals.baseImponible)} €</span>
            </div>
            {form.ivaPct > 0 && (
              <div className="flex justify-between text-xs text-sage-600">
                <span>IVA ({form.ivaPct}%)</span>
                <span className="tabular-nums">+{fmt(totals.ivaImporte)} €</span>
              </div>
            )}
            {form.ivaPct === 0 && (
              <div className="flex justify-between text-xs text-sage-400 italic">
                <span>{t.invoice_vat_exempt}</span>
                <span className="tabular-nums">0,00 €</span>
              </div>
            )}
            {form.irpfPct > 0 && (
              <div className="flex justify-between text-xs text-sage-600">
                <span>IRPF (-{form.irpfPct}%)</span>
                <span className="tabular-nums text-danger">-{fmt(totals.irpfImporte)} €</span>
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
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.notes}</label>
          <Textarea
            value={form.notas}
            onChange={e => setField('notas', e.target.value)}
            rows={2}
            placeholder={t.invoice_notes_placeholder}
          />
        </div>
      </div>
    </Modal>
  );
};

export default InvoiceModal;
