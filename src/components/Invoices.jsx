import React, { useState, useMemo } from 'react';
import {
    Search, Plus, Filter, Download, Upload, Copy,
    Trash2, Edit2, Eye, Check, TrendingUp, Calendar,
    MoreHorizontal, ArrowUpDown, ChevronDown, Printer, ExternalLink, Send
} from 'lucide-react';
import { Button, Input, Select, Card, Modal, StatusBadge, EmptyState } from './UI';
import { useStore, formatCurrency, formatDate, formatDateShort, generateId, generateInvoiceNumber, generateClientCode } from '../stores/store';
import { useNotionStore } from '../stores/notionStore';
import { InvoiceModal } from './InvoiceModal';
import { InvoicePreviewModern } from './InvoicePreview';
import { SendInvoiceModal } from './SendInvoiceModal';
import { save } from '@tauri-apps/api/dialog';
import { open as openUrl } from '@tauri-apps/api/shell';
import { generateInvoicePDF, savePDF } from '../services/pdfGenerator';
import { useToast } from './UI';

export const Invoices = () => {
    const {
        invoices, clients, addInvoice, updateInvoice, deleteInvoice, config,
        invoiceSearch: search, setInvoiceSearch: setSearch,
        invoiceFilters: filters, setInvoiceFilters: setFilters
    } = useStore();
    const { autoSync, isConfigured, syncSingleInvoice, deleteFromNotion } = useNotionStore();
    const toast = useToast();

    // Local State for UI only
    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });
    const [generating, setGenerating] = useState(false);

    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [previewInvoice, setPreviewInvoice] = useState(null);
    const [sendInvoice, setSendInvoice] = useState(null); // invoice to send

    // Available Filter Options
    const years = useMemo(() => {
        const years = new Set(invoices.map(i => new Date(i.fecha).getFullYear()));
        return Array.from(years).sort((a, b) => b - a);
    }, [invoices]);

    const months = [
        { value: '0', label: 'Enero' }, { value: '1', label: 'Febrero' },
        { value: '2', label: 'Marzo' }, { value: '3', label: 'Abril' },
        { value: '4', label: 'Mayo' }, { value: '5', label: 'Junio' },
        { value: '6', label: 'Julio' }, { value: '7', label: 'Agosto' },
        { value: '8', label: 'Septiembre' }, { value: '9', label: 'Octubre' },
        { value: '10', label: 'Noviembre' }, { value: '11', label: 'Diciembre' }
    ];

    // Logic to process invoices based on search/filter/sort
    const filteredInvoices = useMemo(() => {
        // First, deduplicate invoices by ID to prevent ghost entries
        const uniqueInvoicesMap = new Map();
        invoices.forEach(inv => uniqueInvoicesMap.set(inv.id, inv));
        const uniqueSource = Array.from(uniqueInvoicesMap.values());

        return uniqueSource
            .filter(i => {
                // Text Search
                const searchLower = search.toLowerCase();
                const client = clients.find(c => c.id === i.clienteId);
                const matchesSearch =
                    (i.numero || '').toLowerCase().includes(searchLower) ||
                    (i.concepto || '').toLowerCase().includes(searchLower) ||
                    (client?.nombre || '').toLowerCase().includes(searchLower);

                // Status Filter
                const matchesStatus = filters.status === 'all' || i.estado === filters.status;

                // Client Filter
                const matchesClient = filters.client === 'all' || i.clienteId === filters.client;

                // Date Filter
                const date = new Date(i.fecha);
                const matchesYear = filters.year === 'all' || date.getFullYear().toString() === filters.year;
                const matchesMonth = filters.month === 'all' || date.getMonth().toString() === filters.month;

                return matchesSearch && matchesStatus && matchesClient && matchesYear && matchesMonth;
            })
            .sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Si ordenamos por cliente, usamos el nombre en lugar del ID
                if (sortConfig.key === 'clienteId') {
                    const clientA = clients.find(c => c.id === a.clienteId);
                    const clientB = clients.find(c => c.id === b.clienteId);
                    aValue = clientA ? clientA.nombre : '';
                    bValue = clientB ? clientB.nombre : '';
                }

                // Manejo de valores nulos
                if (aValue === bValue) return 0;
                if (aValue === null || aValue === undefined) return 1;
                if (bValue === null || bValue === undefined) return -1;

                let comparison = 0;
                // Comparación de cadenas (incluye fechas ISO y textos con orden natural)
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    comparison = aValue.localeCompare(bValue, 'es', { numeric: true, sensitivity: 'base' });
                }
                // Comparación numérica directa
                else if (typeof aValue === 'number' && typeof bValue === 'number') {
                    comparison = aValue - bValue;
                }
                // Fallback para otros tipos
                else {
                    if (aValue < bValue) comparison = -1;
                    if (aValue > bValue) comparison = 1;
                }

                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
    }, [invoices, clients, search, filters, sortConfig]);

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

    // Actions
    const handleSort = (key) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const handleOpenNew = () => { setEditingInvoice(null); setShowModal(true); };
    const handleOpenEdit = (inv) => { setEditingInvoice(inv); setShowModal(true); };
    const handleOpenPreview = (inv) => { setPreviewInvoice(inv); setShowPreview(true); };

    const handleSaveInvoice = async (data) => {
        let savedInvoice;
        if (editingInvoice) {
            updateInvoice(editingInvoice.id, data);
            savedInvoice = { ...editingInvoice, ...data };
        } else {
            // Use the number from the form if available, otherwise generate it
            const numero = data.numero || generateInvoiceNumber(clients, invoices, data.clienteId, data.fecha);
            savedInvoice = { ...data, id: generateId(), numero };
            addInvoice(savedInvoice);
        }
        setShowModal(false);

        // Sync with Notion
        if (autoSync && isConfigured) {
            const client = clients.find(c => c.id === savedInvoice.clienteId);
            await syncSingleInvoice(savedInvoice, client);
        }
    };

    const handleDuplicate = (inv) => {
        const newInv = {
            ...inv,
            id: generateId(),
            estado: 'borrador',
            fecha: new Date().toISOString().split('T')[0],
            numero: 'BORRADOR' // Will be regenerated on save usually or needs better handling
        };
        // Let's generate a proper number for duplication
        newInv.numero = generateInvoiceNumber(clients, invoices, newInv.clienteId, newInv.fecha);
        addInvoice(newInv);
    };

    const handleDelete = async (id) => {
        if (confirm('¿Estás seguro de eliminar esta factura?')) {
            deleteInvoice(id);
            if (autoSync && isConfigured) {
                await deleteFromNotion(id);
            }
        }
    };

    const handleMarkPaid = async (inv) => {
        const updatedData = {
            estado: 'pagada',
            fechaPago: new Date().toISOString().split('T')[0]
        };
        updateInvoice(inv.id, updatedData);
        if (autoSync && isConfigured) {
            const client = clients.find(c => c.id === inv.clienteId);
            await syncSingleInvoice({ ...inv, ...updatedData }, client);
        }
    };

    const generatePDF = async (inv) => {
        setGenerating(true);
        try {
            const client = clients.find(c => c.id === inv.clienteId);
            const filePath = await save({
                defaultPath: `${inv.numero}.pdf`,
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });

            if (filePath) {
                // Generar PDF des del frontend amb el disseny real de l'editor visual
                const pdfBytes = await generateInvoicePDF(inv, client, config);
                await savePDF(pdfBytes, filePath);
                toast.success('PDF generado correctamente con tu diseño personalizado');
            }
        } catch (e) {
            console.error('Error generating PDF:', e);
            toast.error('Error al generar el PDF: ' + (e?.message || e));
        }
        setGenerating(false);
    };

    // Render Helper for Sort Icon
    const SortIcon = ({ column }) => {
        if (sortConfig.key !== column) return <ArrowUpDown size={12} className="text-slate-600 opacity-0 group-hover:opacity-50" />;
        return <ArrowUpDown size={12} className={`text-blue-400 ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} />;
    };

    return (
        <div className="space-y-4 h-full flex flex-col">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Facturas</h1>
                        <p className="text-slate-400 text-sm mt-0.5">{filteredInvoices.length} documentos encontrados</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button icon={Plus} onClick={handleOpenNew}>Nueva</Button>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-3">
                    <Input
                        icon={Search}
                        placeholder="Buscar por nº, cliente o concepto..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="flex-1"
                    />

                    <div className="flex gap-2 text-sm overflow-x-auto pb-1 lg:pb-0">
                        <select
                            value={filters.status}
                            onChange={e => setFilters({ ...filters, status: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner"
                        >
                            <option value="all" className="bg-slate-900 text-white">Todos los estados</option>
                            <option value="borrador" className="bg-slate-900 text-white">Borrador</option>
                            <option value="emitida" className="bg-slate-900 text-white">Pendiente</option>
                            <option value="pagada" className="bg-slate-900 text-white">Pagada</option>
                            <option value="anulada" className="bg-slate-900 text-white">Anulada</option>
                        </select>

                        <select
                            value={filters.client}
                            onChange={e => setFilters({ ...filters, client: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 max-w-[180px] appearance-none font-medium hover:border-slate-600 transition-all shadow-inner"
                        >
                            <option value="all" className="bg-slate-900 text-white">Todos los clientes</option>
                            {sortedClients.map(c => <option key={c.id} value={c.id} className="bg-slate-900 text-white">{c.nombre}</option>)}
                        </select>

                        <select
                            value={filters.year}
                            onChange={e => setFilters({ ...filters, year: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner"
                        >
                            <option value="all" className="bg-slate-900 text-white">Años</option>
                            {years.map(y => <option key={y} value={y} className="bg-slate-900 text-white">{y}</option>)}
                        </select>

                        <select
                            value={filters.month}
                            onChange={e => setFilters({ ...filters, month: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner"
                        >
                            <option value="all" className="bg-slate-900 text-white">Mes</option>
                            {months.map(m => <option key={m.value} value={m.value} className="bg-slate-900 text-white">{m.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Notion-like Table */}
            <div className="flex-1 bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
                            <tr>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('numero')}>
                                    <div className="flex items-center gap-1">COD <SortIcon column="numero" /></div>
                                </th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('concepto')}>
                                    <div className="flex items-center gap-1">WORK <SortIcon column="concepto" /></div>
                                </th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('clienteId')}>
                                    <div className="flex items-center gap-1">CLIENTE <SortIcon column="clienteId" /></div>
                                </th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IMPORTE</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IVA</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IRPF</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right cursor-pointer group hover:text-slate-300" onClick={() => handleSort('total')}>
                                    <div className="flex items-center justify-end gap-1">IMP FAC <SortIcon column="total" /></div>
                                </th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">PAGADO</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">P.PAGAR</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-center">STATUS</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('fecha')}>
                                    <div className="flex items-center gap-1">FECHA <SortIcon column="fecha" /></div>
                                </th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase sticky right-0 bg-slate-900 shadow-xl">
                                    ACCIONES
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {filteredInvoices.map(inv => {
                                const client = clients.find(c => c.id === inv.clienteId);
                                const isPaid = inv.estado === 'pagada';

                                return (
                                    <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors group">
                                        {/* COD */}
                                        <td className="py-2 px-4 text-sm font-mono text-slate-300 border-r border-slate-800/50">
                                            {inv.numero}
                                        </td>

                                        {/* WORK */}
                                        <td className="py-2 px-4 text-sm text-white max-w-[200px] truncate" title={inv.concepto}>
                                            {inv.concepto}
                                        </td>

                                        {/* CLIENTE */}
                                        <td className="py-2 px-4 text-sm">
                                            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-xs border border-slate-700">
                                                {client?.nombre || 'Sin Cliente'}
                                            </span>
                                        </td>

                                        {/* IMPORTE */}
                                        <td className="py-2 px-4 text-sm text-right text-slate-400 font-mono">
                                            {formatCurrency(inv.subtotal)}
                                        </td>

                                        {/* IVA */}
                                        <td className="py-2 px-4 text-sm text-right text-slate-400 font-mono">
                                            {formatCurrency(inv.iva)}
                                        </td>

                                        {/* IRPF */}
                                        <td className="py-2 px-4 text-sm text-right text-slate-400 font-mono">
                                            {formatCurrency(inv.irpf)}
                                        </td>

                                        {/* TOTAL (IMP FAC) */}
                                        <td className="py-2 px-4 text-sm text-right text-white font-mono font-bold bg-slate-800/20">
                                            {formatCurrency(inv.total)}
                                        </td>

                                        {/* PAGADO */}
                                        <td className="py-2 px-4 text-sm text-right font-mono">
                                            <span className={isPaid ? 'text-emerald-400' : 'text-slate-600'}>
                                                {formatCurrency(isPaid ? inv.total : 0)}
                                            </span>
                                        </td>

                                        {/* POR PAGAR */}
                                        <td className="py-2 px-4 text-sm text-right font-mono">
                                            <span className={!isPaid && inv.estado !== 'anulada' && inv.estado !== 'borrador' ? 'text-red-400' : 'text-slate-600'}>
                                                {formatCurrency(!isPaid && inv.estado !== 'anulada' ? inv.total : 0)}
                                            </span>
                                        </td>

                                        {/* STATUS */}
                                        <td className="py-2 px-4 text-center">
                                            <StatusBadge status={inv.estado} />
                                        </td>

                                        {/* FECHA */}
                                        <td className="py-2 px-4 text-sm font-mono">
                                            <div className="text-slate-300">{formatDateShort(inv.fecha)}</div>
                                            {inv.fechaFacturacion && (
                                                <div className="text-xs text-slate-500" title="Fecha Envío (FAC.DATA)">{formatDateShort(inv.fechaFacturacion)}</div>
                                            )}
                                        </td>

                                        {/* ACCIONES */}
                                        <td className="py-2 px-4 sticky right-0 bg-slate-900 group-hover:bg-slate-800 transition-colors shadow-xl border-l border-slate-800">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button variant="ghost" size="sm" icon={Eye} onClick={() => handleOpenPreview(inv)} title="Ver" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Download} onClick={() => generatePDF(inv)} disabled={generating} title="PDF" className="h-8 w-8 p-0" />
                                                <Button
                                                    variant="ghost" size="sm" icon={Send}
                                                    onClick={() => setSendInvoice(inv)}
                                                    title="Enviar per email"
                                                    className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                                />

                                                {inv.dropboxLink && (
                                                    <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openUrl(inv.dropboxLink)} title="Dropbox" className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300" />
                                                )}

                                                {!isPaid && inv.estado === 'emitida' && (
                                                    <Button variant="ghost" size="sm" icon={Check} onClick={() => handleMarkPaid(inv)} title="Marcar Pagada" className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300" />
                                                )}

                                                <div className="w-px h-4 bg-slate-700 mx-1"></div>

                                                <Button variant="ghost" size="sm" icon={Copy} onClick={() => handleDuplicate(inv)} title="Duplicar" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleOpenEdit(inv)} title="Editar" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDelete(inv.id)} title="Eliminar" className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/20" />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            {filteredInvoices.length === 0 && (
                                <tr>
                                    <td colSpan={12} className="py-12">
                                        <EmptyState
                                            icon={Filter}
                                            title="No se encontraron facturas"
                                            description="Prueba a ajustar los filtros o crea una nueva factura."
                                        />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer Summary */}
                <div className="bg-slate-900 border-t border-slate-800 p-3 flex gap-6 text-sm font-mono overflow-x-auto">
                    <div className="text-slate-400">Total Registros: <span className="text-white">{filteredInvoices.length}</span></div>
                    <div className="text-slate-400">Total Importe: <span className="text-white">{formatCurrency(filteredInvoices.reduce((s, i) => s + (i.total || 0), 0))}</span></div>
                    <div className="text-slate-400">Total Pendiente: <span className="text-red-400">{formatCurrency(filteredInvoices.filter(i => i.estado === 'emitida').reduce((s, i) => s + (i.total || 0), 0))}</span></div>
                </div>
            </div>

            <InvoiceModal
                open={showModal}
                onClose={() => setShowModal(false)}
                onSave={handleSaveInvoice}
                invoice={editingInvoice}
            />

            <SendInvoiceModal
                open={!!sendInvoice}
                onClose={() => setSendInvoice(null)}
                invoice={sendInvoice}
                client={sendInvoice ? clients.find(c => c.id === sendInvoice.clienteId) : null}
            />

            <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Vista Previa" size="full">
                {previewInvoice && (
                    <div className="flex flex-col items-center">
                        <div className="mb-4 flex gap-2">
                            <Button icon={Download} onClick={() => generatePDF(previewInvoice)} disabled={generating}>
                                {generating ? 'Generando...' : 'Descargar PDF'}
                            </Button>
                            <Button
                                icon={Send}
                                onClick={() => { setShowPreview(false); setSendInvoice(previewInvoice); }}
                                className="bg-blue-600 hover:bg-blue-500"
                            >
                                Enviar per Email
                            </Button>
                            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
                        </div>
                        <div className="overflow-auto max-h-[70vh] border border-slate-700 rounded-lg">
                            <InvoicePreviewModern
                                invoice={previewInvoice}
                                client={clients.find(c => c.id === previewInvoice.clienteId)}
                                config={config}
                            />
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};
