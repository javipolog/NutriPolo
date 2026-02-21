import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Button, Card, Select, useToast } from './UI';
import { useStore, formatCurrency, calcularFactura, defaultCategories, generateInvoiceNumber } from '../stores/store';

export const InvoiceModal = ({ open, onClose, onSave, invoice }) => {
    const { clients, invoices, config, invoiceCounters } = useStore();
    const [errors, setErrors] = useState({});
    const toast = useToast();

    // Sort clients by most recent invoice
    const sortedClients = useMemo(() => {
        const lastDates = new Map();
        invoices.forEach(inv => {
            const current = lastDates.get(inv.clienteId) || 0;
            const invDate = new Date(inv.fecha).getTime();
            if (invDate > current) {
                lastDates.set(inv.clienteId, invDate);
            }
        });

        return [...clients].sort((a, b) => {
            const dateA = lastDates.get(a.id) || 0;
            const dateB = lastDates.get(b.id) || 0;
            if (dateA !== dateB) return dateB - dateA;
            return a.nombre.localeCompare(b.nombre);
        });
    }, [clients, invoices]);

    const [form, setForm] = useState({
        clienteId: '', fecha: new Date().toISOString().split('T')[0], fechaFin: '', fechaFacturacion: '', tipo: 'classic', idioma: 'es',
        concepto: '', baseImponible: 0, jornadas: 0, tarifaDia: 0, ivaPorcentaje: 21, irpfPorcentaje: 15, estado: 'borrador',
        numero: '', dropboxLink: ''
    });

    useEffect(() => {
        if (invoice) {
            setForm(invoice);
        } else {
            setForm(prev => ({
                ...prev,
                clienteId: clients[0]?.id || '',
                fecha: new Date().toISOString().split('T')[0],
                fechaFin: '',
                fechaFacturacion: '',
                tipo: 'classic',
                idioma: config.idiomaDefecto || 'es',
                concepto: '',
                baseImponible: 0,
                jornadas: 0,
                tarifaDia: 0,
                ivaPorcentaje: config.tipoIva || 21,
                irpfPorcentaje: config.tipoIrpf || 15,
                estado: 'borrador',
                numero: '',
                dropboxLink: ''
            }));
        }
    }, [invoice, clients, config, open]);

    // Auto-generar número de factura per a noves factures (usa el comptador persistent)
    useEffect(() => {
        if (!invoice && open && form.clienteId && form.fecha) {
            const num = generateInvoiceNumber(clients, invoices, form.clienteId, form.fecha, invoiceCounters);
            setForm(prev => ({ ...prev, numero: num }));
        }
    }, [form.clienteId, form.fecha, invoice, open, clients, invoices, invoiceCounters]);

    const calc = calcularFactura(form.tipo, form, form.ivaPorcentaje, form.irpfPorcentaje);

    const validateForm = () => {
        const newErrors = {};

        if (!form.clienteId) {
            newErrors.clienteId = 'El cliente es obligatorio';
        }
        if (!form.numero?.trim()) {
            newErrors.numero = 'El número de factura es obligatorio';
        } else {
            // Verificar unicitat: el número no pot existir en una altra factura
            const duplicate = invoices.find(i => i.numero === form.numero.trim() && i.id !== invoice?.id);
            if (duplicate) {
                newErrors.numero = `El número ${form.numero} ya existe (factura ${duplicate.id})`;
            }
        }
        if (!form.fecha) {
            newErrors.fecha = 'La fecha es obligatoria';
        }
        if (!form.concepto?.trim()) {
            newErrors.concepto = 'El concepto es obligatorio';
        }
        if (calc.subtotal <= 0) {
            newErrors.importe = 'El importe debe ser mayor que 0';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!validateForm()) {
            toast.warning('Corrige los errores antes de guardar');
            return;
        }
        onSave({ ...form, numero: form.numero.trim(), ...calc });
    };

    return (
        <Modal open={open} onClose={onClose} title={invoice ? 'Editar Factura' : 'Nueva Factura'} size="lg">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <Select label="Cliente" value={form.clienteId} onChange={e => { setForm({ ...form, clienteId: e.target.value }); setErrors(prev => ({ ...prev, clienteId: undefined })); }}
                        options={[{ value: '', label: 'Seleccionar...' }, ...sortedClients.map(c => ({ value: c.id, label: c.nombre }))]}
                        error={errors.clienteId} />
                    <Input label="Código Factura (COD)" value={form.numero} onChange={e => { setForm({ ...form, numero: e.target.value }); setErrors(prev => ({ ...prev, numero: undefined })); }} placeholder="Auto-generado"
                        error={errors.numero} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Input label="Fecha Inicio" type="date" value={form.fecha} onChange={e => { setForm({ ...form, fecha: e.target.value }); setErrors(prev => ({ ...prev, fecha: undefined })); }}
                        error={errors.fecha} />
                    <Input label="Fecha Fin" type="date" value={form.fechaFin || ''} onChange={e => setForm({ ...form, fechaFin: e.target.value })} />
                    <Input label="Fecha Envío (FAC.DATA)" type="date" value={form.fechaFacturacion || ''} onChange={e => setForm({ ...form, fechaFacturacion: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Select label="Tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}
                        options={[{ value: 'classic', label: 'Importe fijo' }, { value: 'days', label: 'Por jornadas' }]} />
                    <Select label="Idioma" value={form.idioma} onChange={e => setForm({ ...form, idioma: e.target.value })}
                        options={[{ value: 'es', label: 'Castellano' }, { value: 'ca', label: 'Català' }]} />
                    <Select label="Estado" value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}
                        options={[{ value: 'borrador', label: 'Borrador' }, { value: 'emitida', label: 'Emitida' }, { value: 'pagada', label: 'Pagada' }, { value: 'anulada', label: 'Anulada' }]} />
                </div>
                <Input label="Concepto (WORK)" value={form.concepto} onChange={e => { setForm({ ...form, concepto: e.target.value }); setErrors(prev => ({ ...prev, concepto: undefined })); }} placeholder="Descripción del servicio..."
                    error={errors.concepto} />

                <Input label="Link Dropbox (Opcional)" value={form.dropboxLink || ''} onChange={e => setForm({ ...form, dropboxLink: e.target.value })} placeholder="https://www.dropbox.com/s/..." />

                {form.tipo === 'classic' ? (
                    <Input label="Base Imponible (€)" type="number" step="0.01" value={form.baseImponible} onChange={e => setForm({ ...form, baseImponible: parseFloat(e.target.value) || 0 })} />
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Jornadas" type="number" step="0.5" value={form.jornadas} onChange={e => setForm({ ...form, jornadas: parseFloat(e.target.value) || 0 })} />
                        <Input label="Tarifa/día (€)" type="number" step="0.01" value={form.tarifaDia} onChange={e => setForm({ ...form, tarifaDia: parseFloat(e.target.value) || 0 })} />
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <Input label="IVA (%)" type="number" value={form.ivaPorcentaje} onChange={e => setForm({ ...form, ivaPorcentaje: parseFloat(e.target.value) || 0 })} />
                    <Input label="IRPF (%)" type="number" value={form.irpfPorcentaje} onChange={e => setForm({ ...form, irpfPorcentaje: parseFloat(e.target.value) || 0 })} />
                </div>
                <Card className={`p-4 bg-slate-800/30 ${errors.importe ? 'border border-red-700' : ''}`}>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-slate-400">Base Imponible</span><span className="text-white">{formatCurrency(calc.subtotal)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">IVA ({form.ivaPorcentaje}%)</span><span className="text-emerald-400">+{formatCurrency(calc.iva)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">IRPF ({form.irpfPorcentaje}%)</span><span className="text-red-400">-{formatCurrency(calc.irpf)}</span></div>
                        <div className="flex justify-between pt-2 border-t border-slate-700"><span className="text-white font-medium">Total</span><span className="text-white font-bold text-lg">{formatCurrency(calc.total)}</span></div>
                    </div>
                    {errors.importe && <p className="text-red-400 text-xs mt-2">{errors.importe}</p>}
                </Card>
                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button type="submit">Guardar</Button>
                </div>
            </form>
        </Modal>
    );
};
