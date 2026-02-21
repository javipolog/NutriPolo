import React, { useState, useEffect, useMemo } from 'react';
import { Lock, RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Modal, Input, Button, Card, Select, useToast } from './UI';
import { useStore, formatCurrency, calcularFactura, generateInvoiceNumber, generatePresupuestoNumber } from '../stores/store';

export const InvoiceModal = ({ open, onClose, onSave, invoice, onCreateRectificativa }) => {
    const { clients, invoices, config, invoiceCounters } = useStore();
    const [errors, setErrors] = useState({});
    const [showRecurring, setShowRecurring] = useState(false);
    const toast = useToast();

    // Sort clients by most recent invoice
    const sortedClients = useMemo(() => {
        const lastDates = new Map();
        invoices.forEach(inv => {
            const current = lastDates.get(inv.clienteId) || 0;
            const invDate = new Date(inv.fecha).getTime();
            if (invDate > current) lastDates.set(inv.clienteId, invDate);
        });
        return [...clients].sort((a, b) => {
            const dateA = lastDates.get(a.id) || 0;
            const dateB = lastDates.get(b.id) || 0;
            if (dateA !== dateB) return dateB - dateA;
            return a.nombre.localeCompare(b.nombre);
        });
    }, [clients, invoices]);

    const [form, setForm] = useState({
        clienteId: '', fecha: new Date().toISOString().split('T')[0], fechaFin: '', fechaFacturacion: '',
        tipo: 'classic', idioma: 'es', concepto: '', baseImponible: 0, jornadas: 0, tarifaDia: 0,
        ivaPorcentaje: 21, irpfPorcentaje: 15, estado: 'borrador', numero: '', dropboxLink: '',
        tipoDocumento: 'factura', pagos: [],
        esPlantilla: false, periodicidad: null, proximaFecha: null,
    });

    useEffect(() => {
        if (invoice) {
            setForm(invoice);
            setShowRecurring(invoice.esPlantilla || false);
        } else {
            setForm(prev => ({
                ...prev,
                clienteId: clients[0]?.id || '',
                fecha: new Date().toISOString().split('T')[0],
                fechaFin: '', fechaFacturacion: '',
                tipo: 'classic',
                idioma: config.idiomaDefecto || 'es',
                concepto: '',
                baseImponible: 0, jornadas: 0, tarifaDia: 0,
                ivaPorcentaje: config.tipoIva || 21,
                irpfPorcentaje: config.tipoIrpf || 15,
                estado: 'borrador', numero: '', dropboxLink: '',
                tipoDocumento: 'factura', pagos: [],
                esPlantilla: false, periodicidad: null, proximaFecha: null,
            }));
            setShowRecurring(false);
        }
        setErrors({});
    }, [invoice, clients, config, open]);

    // Auto-generar número per a documents nous
    useEffect(() => {
        if (!invoice && open && form.clienteId && form.fecha) {
            const isPresupuesto = form.tipoDocumento === 'presupuesto';
            const num = isPresupuesto
                ? generatePresupuestoNumber(clients, invoices, form.clienteId, form.fecha, invoiceCounters)
                : generateInvoiceNumber(clients, invoices, form.clienteId, form.fecha, invoiceCounters);
            setForm(prev => ({ ...prev, numero: num }));
        }
    }, [form.clienteId, form.fecha, form.tipoDocumento, invoice, open, clients, invoices, invoiceCounters]);

    const calc = calcularFactura(form.tipo, form, form.ivaPorcentaje, form.irpfPorcentaje);

    // Detectar si la factura està bloquejada (emitida o pagada)
    const isLocked = invoice?.tipoDocumento === 'factura' &&
        (invoice?.estado === 'emitida' || invoice?.estado === 'pagada');

    const validateForm = () => {
        const newErrors = {};
        if (!form.clienteId) newErrors.clienteId = 'El cliente es obligatorio';
        if (!form.numero?.trim()) {
            newErrors.numero = 'El número es obligatorio';
        } else {
            const duplicate = invoices.find(i => i.numero === form.numero.trim() && i.id !== invoice?.id);
            if (duplicate) newErrors.numero = `El número ${form.numero} ya existe`;
        }
        if (!form.fecha) newErrors.fecha = 'La fecha es obligatoria';
        if (!form.concepto?.trim()) newErrors.concepto = 'El concepto es obligatorio';
        if (calc.subtotal <= 0) newErrors.importe = 'El importe debe ser mayor que 0';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isLocked) return; // No s'ha de poder guardar si és bloquejada
        if (!validateForm()) {
            toast.warning('Corrige los errores antes de guardar');
            return;
        }
        const saveData = {
            ...form,
            numero: form.numero.trim(),
            ...calc,
            // Si no és plantilla, netejar camps recurrents
            esPlantilla: form.esPlantilla || false,
            periodicidad: form.esPlantilla ? (form.periodicidad || 'mensual') : null,
            proximaFecha: form.esPlantilla ? form.proximaFecha : null,
        };
        onSave(saveData);
    };

    const title = invoice?.tipoDocumento === 'rectificativa' ? 'Factura Rectificativa'
        : invoice?.tipoDocumento === 'presupuesto' ? 'Editar Presupuesto'
        : invoice ? 'Editar Factura' : 'Nuevo Documento';

    return (
        <Modal open={open} onClose={onClose} title={title} size="lg">
            {/* Banner de bloqueig per factures emitides/pagades */}
            {isLocked && (
                <div className="mb-4 p-4 bg-amber-900/30 border border-amber-700/50 rounded-xl flex items-start gap-3">
                    <Lock size={18} className="text-amber-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-amber-200 font-medium text-sm">Factura {invoice.estado === 'pagada' ? 'pagada' : 'emitida'} — no editable</p>
                        <p className="text-amber-300/70 text-xs mt-1">
                            Para corregir esta factura, crea una rectificativa. Solo puedes cambiar el estado.
                        </p>
                    </div>
                    {onCreateRectificativa && (
                        <Button size="sm" onClick={() => { onClose(); onCreateRectificativa(invoice.id); }}
                            className="bg-amber-700 hover:bg-amber-600 text-white text-xs shrink-0">
                            Crear Rectificativa
                        </Button>
                    )}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Tipus de document — només per a nous documents */}
                {!invoice && (
                    <div className="flex gap-2 p-1 bg-slate-800/50 rounded-xl w-fit">
                        {[{ v: 'factura', l: 'Factura' }, { v: 'presupuesto', l: 'Presupuesto' }].map(({ v, l }) => (
                            <button key={v} type="button"
                                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${form.tipoDocumento === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                onClick={() => setForm(f => ({ ...f, tipoDocumento: v }))}>
                                {l}
                            </button>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <Select label="Cliente" value={form.clienteId}
                        onChange={e => { setForm({ ...form, clienteId: e.target.value }); setErrors(p => ({ ...p, clienteId: undefined })); }}
                        options={[{ value: '', label: 'Seleccionar...' }, ...sortedClients.map(c => ({ value: c.id, label: c.nombre }))]}
                        error={errors.clienteId} disabled={isLocked} />
                    <Input label={`Código ${form.tipoDocumento === 'presupuesto' ? 'Presupuesto' : 'Factura'} (COD)`}
                        value={form.numero}
                        onChange={e => { setForm({ ...form, numero: e.target.value }); setErrors(p => ({ ...p, numero: undefined })); }}
                        placeholder="Auto-generado" error={errors.numero} disabled={isLocked} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Input label="Fecha Inicio" type="date" value={form.fecha}
                        onChange={e => { setForm({ ...form, fecha: e.target.value }); setErrors(p => ({ ...p, fecha: undefined })); }}
                        error={errors.fecha} disabled={isLocked} />
                    <Input label="Fecha Fin" type="date" value={form.fechaFin || ''}
                        onChange={e => setForm({ ...form, fechaFin: e.target.value })} disabled={isLocked} />
                    <Input label="Fecha Envío (FAC.DATA)" type="date" value={form.fechaFacturacion || ''}
                        onChange={e => setForm({ ...form, fechaFacturacion: e.target.value })} disabled={isLocked} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <Select label="Tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}
                        options={[{ value: 'classic', label: 'Importe fijo' }, { value: 'days', label: 'Por jornadas' }]}
                        disabled={isLocked} />
                    <Select label="Idioma" value={form.idioma} onChange={e => setForm({ ...form, idioma: e.target.value })}
                        options={[{ value: 'es', label: 'Castellano' }, { value: 'ca', label: 'Català' }]}
                        disabled={isLocked} />
                    <Select label="Estado" value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}
                        options={[
                            { value: 'borrador', label: 'Borrador' },
                            { value: 'emitida', label: 'Emitida' },
                            { value: 'pagada', label: 'Pagada' },
                            { value: 'anulada', label: 'Anulada' },
                        ]} />
                </div>
                <Input label="Concepto (WORK)" value={form.concepto}
                    onChange={e => { setForm({ ...form, concepto: e.target.value }); setErrors(p => ({ ...p, concepto: undefined })); }}
                    placeholder="Descripción del servicio..." error={errors.concepto} disabled={isLocked} />

                <Input label="Link Dropbox (Opcional)" value={form.dropboxLink || ''}
                    onChange={e => setForm({ ...form, dropboxLink: e.target.value })}
                    placeholder="https://www.dropbox.com/s/..." disabled={isLocked} />

                {form.tipo === 'classic' ? (
                    <Input label="Base Imponible (€)" type="number" step="0.01" value={form.baseImponible}
                        onChange={e => setForm({ ...form, baseImponible: parseFloat(e.target.value) || 0 })}
                        disabled={isLocked} />
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Jornadas" type="number" step="0.5" value={form.jornadas}
                            onChange={e => setForm({ ...form, jornadas: parseFloat(e.target.value) || 0 })}
                            disabled={isLocked} />
                        <Input label="Tarifa/día (€)" type="number" step="0.01" value={form.tarifaDia}
                            onChange={e => setForm({ ...form, tarifaDia: parseFloat(e.target.value) || 0 })}
                            disabled={isLocked} />
                    </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <Input label="IVA (%)" type="number" value={form.ivaPorcentaje}
                        onChange={e => setForm({ ...form, ivaPorcentaje: parseFloat(e.target.value) || 0 })}
                        disabled={isLocked} />
                    <Input label="IRPF (%)" type="number" value={form.irpfPorcentaje}
                        onChange={e => setForm({ ...form, irpfPorcentaje: parseFloat(e.target.value) || 0 })}
                        disabled={isLocked} />
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

                {/* Secció plantilla recurrent (#8) — només per a factures */}
                {form.tipoDocumento === 'factura' && !isLocked && (
                    <div className="border border-slate-700 rounded-xl overflow-hidden">
                        <button type="button"
                            className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors text-sm"
                            onClick={() => setShowRecurring(v => !v)}>
                            <div className="flex items-center gap-2 text-slate-300">
                                <RefreshCw size={14} />
                                <span>Plantilla recurrente</span>
                                {form.esPlantilla && <span className="ml-1 px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded-full text-xs">{form.periodicidad}</span>}
                            </div>
                            {showRecurring ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                        </button>
                        {showRecurring && (
                            <div className="p-4 space-y-4 bg-slate-900/30">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input type="checkbox" checked={form.esPlantilla}
                                        onChange={e => setForm(f => ({ ...f, esPlantilla: e.target.checked }))}
                                        className="w-4 h-4 accent-blue-500" />
                                    <span className="text-sm text-slate-300">Usar como plantilla para generar facturas recurrentes</span>
                                </label>
                                {form.esPlantilla && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <Select label="Periodicidad" value={form.periodicidad || 'mensual'}
                                            onChange={e => setForm(f => ({ ...f, periodicidad: e.target.value }))}
                                            options={[
                                                { value: 'mensual', label: 'Mensual' },
                                                { value: 'trimestral', label: 'Trimestral' },
                                                { value: 'semestral', label: 'Semestral' },
                                                { value: 'anual', label: 'Anual' },
                                            ]} />
                                        <Input label="Próxima generación" type="date"
                                            value={form.proximaFecha || ''}
                                            onChange={e => setForm(f => ({ ...f, proximaFecha: e.target.value }))} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                    {!isLocked && <Button type="submit">Guardar</Button>}
                </div>
            </form>
        </Modal>
    );
};
