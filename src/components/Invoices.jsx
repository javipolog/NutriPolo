import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
    Search, Plus, Filter, Download, FileText, Copy,
    Trash2, Edit2, Eye, Check, Calendar,
    ArrowUpDown, Printer, ExternalLink, Send,
    RefreshCw, AlertTriangle, CreditCard, X, FileSpreadsheet,
    FileCheck, RotateCcw, SlidersHorizontal
} from 'lucide-react';
import { Button, Input, Select, Card, Modal, StatusBadge, EmptyState, useToast } from './UI';
import {
    useStore, formatCurrency, formatDate, formatDateShort, generateId,
    generateInvoiceNumber, generateClientCode,
    exportDocumentsCSV, downloadCSV, getRecurringDue,
    calcularPagado, calcularPendiente
} from '../stores/store';

// Definició de totes les columnes disponibles (#18)
const ALL_COLUMNS = [
  { key: 'cod',      label: 'COD',      alwaysVisible: false },
  { key: 'work',     label: 'Concepto', alwaysVisible: false },
  { key: 'cliente',  label: 'Cliente',  alwaysVisible: false },
  { key: 'importe',  label: 'Importe',  alwaysVisible: false },
  { key: 'iva',      label: 'IVA',      alwaysVisible: false },
  { key: 'irpf',     label: 'IRPF',     alwaysVisible: false },
  { key: 'total',    label: 'Total',    alwaysVisible: false },
  { key: 'pagado',   label: 'Pagado',   alwaysVisible: false },
  { key: 'pendiente',label: 'Pendiente',alwaysVisible: false },
  { key: 'status',   label: 'Estado',   alwaysVisible: false },
  { key: 'fecha',    label: 'Fecha',    alwaysVisible: false },
  { key: 'acciones', label: 'Acciones', alwaysVisible: true  },
];

// Dropdown per triar columnes visibles (#18)
// Usa ReactDOM.createPortal per escapar qualsevol stacking context (backdrop-filter, etc.)
const ColumnPicker = ({ visibleColumns, onChange }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const dropdown = open ? ReactDOM.createPortal(
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
      className="w-44 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1"
    >
      <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Columnas visibles</p>
      {ALL_COLUMNS.filter(c => !c.alwaysVisible).map(col => (
        <label key={col.key} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={visibleColumns[col.key] !== false}
            onChange={e => onChange({ ...visibleColumns, [col.key]: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-slate-300">{col.label}</span>
        </label>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
          open ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
        }`}
        title="Mostrar/ocultar columnas"
      >
        <SlidersHorizontal size={14} />
        <span className="hidden sm:inline">Cols</span>
      </button>
      {dropdown}
    </>
  );
};
import { useNotionStore } from '../stores/notionStore';
import { InvoiceModal } from './InvoiceModal';
import { InvoicePreviewModern } from './InvoicePreview';
import { SendInvoiceModal } from './SendInvoiceModal';
import { save } from '@tauri-apps/api/dialog';
import { open as openUrl } from '@tauri-apps/api/shell';
import { generateInvoicePDF, savePDF } from '../services/pdfGenerator';

// ============================================
// MODAL DE PAGAMENT PARCIAL (#11)
// ============================================
const PartialPaymentModal = ({ open, onClose, invoice, onAdd, onDelete }) => {
    const [form, setForm] = useState({ fecha: new Date().toISOString().split('T')[0], importe: '', metodo: 'transferencia' });
    const toast = useToast();

    const pagado = calcularPagado(invoice || {});
    const pendiente = calcularPendiente(invoice || {});

    const handleAdd = () => {
        const importe = parseFloat(form.importe);
        if (!importe || importe <= 0) { toast.warning('Introduce un importe válido'); return; }
        if (importe > pendiente + 0.01) { toast.warning('El importe supera lo pendiente'); return; }
        onAdd({ fecha: form.fecha, importe, metodo: form.metodo });
        setForm(f => ({ ...f, importe: '' }));
    };

    if (!invoice) return null;
    return (
        <Modal open={open} onClose={onClose} title="Gestionar Pagos" size="md">
            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 p-4 bg-slate-800/40 rounded-xl text-center">
                    <div><p className="text-xs text-slate-400">Total factura</p><p className="text-white font-bold">{formatCurrency(invoice.total)}</p></div>
                    <div><p className="text-xs text-slate-400">Pagado</p><p className="text-emerald-400 font-bold">{formatCurrency(pagado)}</p></div>
                    <div><p className="text-xs text-slate-400">Pendiente</p><p className="text-red-400 font-bold">{formatCurrency(pendiente)}</p></div>
                </div>

                {/* Historial de pagaments */}
                {(invoice.pagos || []).length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-400 uppercase">Pagos registrados</p>
                        {(invoice.pagos || []).map(p => (
                            <div key={p.id} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <CreditCard size={14} className="text-emerald-400" />
                                    <span className="text-sm text-white font-mono">{formatCurrency(p.importe)}</span>
                                    <span className="text-xs text-slate-400">{formatDateShort(p.fecha)}</span>
                                    <span className="text-xs text-slate-500 capitalize">{p.metodo}</span>
                                </div>
                                <button onClick={() => onDelete(p.id)} className="text-red-400 hover:text-red-300 p-1">
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Afegir pagament */}
                {pendiente > 0.01 && (
                    <div className="space-y-3 border-t border-slate-700 pt-4">
                        <p className="text-xs font-semibold text-slate-400 uppercase">Añadir pago</p>
                        <div className="grid grid-cols-3 gap-3">
                            <Input label="Fecha" type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                            <Input label="Importe (€)" type="number" step="0.01" value={form.importe}
                                onChange={e => setForm(f => ({ ...f, importe: e.target.value }))}
                                placeholder={pendiente.toFixed(2)} />
                            <Select label="Método" value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))}
                                options={[
                                    { value: 'transferencia', label: 'Transferencia' },
                                    { value: 'bizum', label: 'Bizum' },
                                    { value: 'efectivo', label: 'Efectivo' },
                                    { value: 'tarjeta', label: 'Tarjeta' },
                                    { value: 'otro', label: 'Otro' },
                                ]} />
                        </div>
                        <div className="flex gap-2">
                            <Button onClick={handleAdd} className="flex-1">Registrar Pago</Button>
                            <Button variant="ghost" onClick={() => setForm(f => ({ ...f, importe: pendiente.toFixed(2) }))}>
                                Pago Total
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};

// ============================================
// COMPONENT PRINCIPAL
// ============================================
export const Invoices = () => {
    const {
        invoices, clients, addInvoice, updateInvoice, deleteInvoice, config,
        invoiceSearch: search, setInvoiceSearch: setSearch,
        invoiceFilters: filters, setInvoiceFilters: setFilters,
        addPago, deletePago, createRectificativa, generateFromTemplate, convertPresupuestoToFactura,
        invoiceCounters,
        invoiceVisibleColumns, setInvoiceVisibleColumns,
    } = useStore();

    // Normalitzar: camps no definits es consideren visibles
    const cols = {
      cod: true, work: true, cliente: true, importe: false, iva: false, irpf: false,
      total: true, pagado: true, pendiente: true, status: true, fecha: true,
      ...invoiceVisibleColumns,
    };
    const { autoSync, isConfigured, syncSingleInvoice, deleteFromNotion } = useNotionStore();
    const toast = useToast();

    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });
    const [generating, setGenerating] = useState(false);
    const [docType, setDocType] = useState('facturas'); // 'facturas' | 'presupuestos'
    const [isExportingCSV, setIsExportingCSV] = useState(false);

    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [previewInvoice, setPreviewInvoice] = useState(null);
    const [sendInvoice, setSendInvoice] = useState(null);
    const [pagoInvoice, setPagoInvoice] = useState(null);

    // Facturas recurrents pendents (#8)
    const recurringDue = useMemo(() => getRecurringDue(invoices), [invoices]);

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

    // Filtrar per tipus de document (facturas vs presupuestos)
    const filteredInvoices = useMemo(() => {
        const uniqueMap = new Map();
        invoices.forEach(inv => uniqueMap.set(inv.id, inv));
        const uniqueSource = Array.from(uniqueMap.values());

        return uniqueSource
            .filter(i => {
                const tipo = i.tipoDocumento || 'factura';
                if (docType === 'facturas') return tipo === 'factura' || tipo === 'rectificativa';
                if (docType === 'presupuestos') return tipo === 'presupuesto';
                return true;
            })
            .filter(i => {
                const searchLower = search.toLowerCase();
                const client = clients.find(c => c.id === i.clienteId);
                const matchesSearch =
                    (i.numero || '').toLowerCase().includes(searchLower) ||
                    (i.concepto || '').toLowerCase().includes(searchLower) ||
                    (client?.nombre || '').toLowerCase().includes(searchLower);
                const matchesStatus = filters.status === 'all' || i.estado === filters.status;
                const matchesClient = filters.client === 'all' || i.clienteId === filters.client;
                const date = new Date(i.fecha);
                const matchesYear = filters.year === 'all' || date.getFullYear().toString() === filters.year;
                const matchesMonth = filters.month === 'all' || date.getMonth().toString() === filters.month;
                return matchesSearch && matchesStatus && matchesClient && matchesYear && matchesMonth;
            })
            .sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                if (sortConfig.key === 'clienteId') {
                    const cA = clients.find(c => c.id === a.clienteId);
                    const cB = clients.find(c => c.id === b.clienteId);
                    aValue = cA ? cA.nombre : '';
                    bValue = cB ? cB.nombre : '';
                }
                if (aValue === bValue) return 0;
                if (aValue == null) return 1;
                if (bValue == null) return -1;
                let cmp = 0;
                if (typeof aValue === 'string' && typeof bValue === 'string')
                    cmp = aValue.localeCompare(bValue, 'es', { numeric: true, sensitivity: 'base' });
                else if (typeof aValue === 'number' && typeof bValue === 'number')
                    cmp = aValue - bValue;
                else cmp = aValue < bValue ? -1 : 1;
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            });
    }, [invoices, clients, search, filters, sortConfig, docType]);

    const sortedClients = useMemo(() => {
        const lastDates = new Map();
        invoices.forEach(inv => {
            const current = lastDates.get(inv.clienteId) || 0;
            const invDate = new Date(inv.fecha).getTime();
            if (invDate > current) lastDates.set(inv.clienteId, invDate);
        });
        return [...clients].sort((a, b) => {
            const dA = lastDates.get(a.id) || 0;
            const dB = lastDates.get(b.id) || 0;
            if (dA !== dB) return dB - dA;
            return a.nombre.localeCompare(b.nombre);
        });
    }, [clients, invoices]);

    // Actions
    const handleSort = (key) => setSortConfig(c => ({
        key, direction: c.key === key && c.direction === 'desc' ? 'asc' : 'desc'
    }));

    const handleOpenNew = () => {
        setEditingInvoice(null);
        setShowModal(true);
    };

    const handleOpenEdit = (inv) => {
        setEditingInvoice(inv);
        setShowModal(true);
    };

    const handleOpenPreview = (inv) => { setPreviewInvoice(inv); setShowPreview(true); };

    const handleSaveInvoice = async (data) => {
        let savedInvoice;
        if (editingInvoice) {
            updateInvoice(editingInvoice.id, data);
            savedInvoice = { ...editingInvoice, ...data };
        } else {
            savedInvoice = { ...data, id: generateId() };
            addInvoice(savedInvoice);
        }
        setShowModal(false);
        if (autoSync && isConfigured && (savedInvoice.tipoDocumento || 'factura') === 'factura') {
            const client = clients.find(c => c.id === savedInvoice.clienteId);
            await syncSingleInvoice(savedInvoice, client);
        }
    };

    const handleDuplicate = (inv) => {
        const today = new Date().toISOString().split('T')[0];
        const newInv = {
            ...inv,
            id: generateId(),
            estado: 'borrador',
            fecha: today,
            pagos: [],
            esPlantilla: false,
            proximaFecha: null,
            rectificadaId: null,
            numero: generateInvoiceNumber(clients, invoices, inv.clienteId, today, invoiceCounters),
        };
        addInvoice(newInv);
        toast.success('Documento duplicado como borrador');
    };

    const handleDelete = async (id) => {
        if (confirm('¿Estás seguro de eliminar este documento?')) {
            deleteInvoice(id);
            if (autoSync && isConfigured) await deleteFromNotion(id);
        }
    };

    const handleMarkPaid = async (inv) => {
        const data = { estado: 'pagada', fechaPago: new Date().toISOString().split('T')[0] };
        updateInvoice(inv.id, data);
        if (autoSync && isConfigured) {
            const client = clients.find(c => c.id === inv.clienteId);
            await syncSingleInvoice({ ...inv, ...data }, client);
        }
    };

    // Rectificativa (#7)
    const handleCreateRectificativa = (invoiceId) => {
        const rect = createRectificativa(invoiceId);
        if (rect) {
            toast.success(`Rectificativa ${rect.numero} creada como borrador`);
            setEditingInvoice(rect);
            setShowModal(true);
        }
    };

    // Convertir pressupost a factura (#9)
    const handleConvertToFactura = (presupuestoId) => {
        const newNum = convertPresupuestoToFactura(presupuestoId);
        if (newNum) {
            toast.success(`Convertido a factura ${newNum}`);
            setDocType('facturas');
        }
    };

    // Generar des de plantilla recurrent (#8)
    const handleGenerateFromTemplate = (templateId) => {
        const newInv = generateFromTemplate(templateId);
        if (newInv) {
            toast.success(`Factura ${newInv.numero} generada como borrador`);
            setEditingInvoice(newInv);
            setShowModal(true);
        }
    };

    // Pagaments parcials (#11)
    const handleAddPago = (invoiceId, pago) => {
        addPago(invoiceId, pago);
        // Refrescar la factura al modal de pagaments
        const updated = useStore.getState().invoices.find(i => i.id === invoiceId);
        if (updated) setPagoInvoice(updated);
        toast.success('Pago registrado');
    };

    const handleDeletePago = (invoiceId, pagoId) => {
        deletePago(invoiceId, pagoId);
        const updated = useStore.getState().invoices.find(i => i.id === invoiceId);
        if (updated) setPagoInvoice(updated);
    };

    // Export CSV (#12)
    const handleExportCSV = async () => {
        setIsExportingCSV(true);
        try {
            const year = filters.year !== 'all' ? filters.year : null;
            const csv = exportDocumentsCSV(invoices, clients, {
                year,
                tipoDocumento: docType === 'presupuestos' ? 'presupuesto' : 'factura',
            });
            const yearLabel = year || 'todos';
            const filename = `facturas-${yearLabel}.csv`;
            const result = await downloadCSV(csv, filename);
            if (result.success) toast.success('CSV exportado correctamente');
            else if (!result.cancelled) toast.error('Error al exportar CSV');
        } catch (e) {
            toast.error('Error: ' + e.message);
        }
        setIsExportingCSV(false);
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
                const pdfBytes = await generateInvoicePDF(inv, client, config);
                await savePDF(pdfBytes, filePath);
                toast.success('PDF generado correctamente');
            }
        } catch (e) {
            toast.error('Error al generar el PDF: ' + (e?.message || e));
        }
        setGenerating(false);
    };

    const SortIcon = ({ column }) => {
        if (sortConfig.key !== column) return <ArrowUpDown size={12} className="text-slate-600 opacity-0 group-hover:opacity-50" />;
        return <ArrowUpDown size={12} className={`text-blue-400 ${sortConfig.direction === 'asc' ? 'rotate-180' : ''}`} />;
    };

    const isFacturas = docType === 'facturas';

    return (
        <div className="space-y-4 h-full flex flex-col">
            {/* Alerta de plantilles recurrents pendents (#8) */}
            {isFacturas && recurringDue.length > 0 && (
                <div className="bg-blue-900/30 border border-blue-700/50 rounded-xl px-4 py-3 flex items-center gap-3">
                    <RefreshCw size={16} className="text-blue-400 shrink-0" />
                    <span className="text-blue-200 text-sm flex-1">
                        {recurringDue.length} plantilla{recurringDue.length > 1 ? 's' : ''} recurrente{recurringDue.length > 1 ? 's' : ''} pendiente{recurringDue.length > 1 ? 's' : ''} de generar:
                        {' '}<span className="font-medium">{recurringDue.map(i => i.concepto || i.numero).join(', ')}</span>
                    </span>
                    <div className="flex gap-1">
                        {recurringDue.slice(0, 3).map(inv => (
                            <Button key={inv.id} size="sm" onClick={() => handleGenerateFromTemplate(inv.id)}
                                className="text-xs bg-blue-700 hover:bg-blue-600">
                                Generar
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            {/* Header & Controls */}
            <div className="flex flex-col gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Facturación</h1>
                        <p className="text-slate-400 text-sm mt-0.5">{filteredInvoices.length} documentos encontrados</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Tab switcher: Facturas / Presupuestos */}
                        <div className="flex gap-1 p-1 bg-slate-800 rounded-xl">
                            <button onClick={() => setDocType('facturas')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${isFacturas ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                                <FileText size={14} />Facturas
                            </button>
                            <button onClick={() => setDocType('presupuestos')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!isFacturas ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                                <FileCheck size={14} />Presupuestos
                            </button>
                        </div>
                        <ColumnPicker visibleColumns={cols} onChange={setInvoiceVisibleColumns} />
                        <Button icon={FileSpreadsheet} variant="secondary" onClick={handleExportCSV} disabled={isExportingCSV}
                            title="Exportar CSV para el gestor">
                            {isExportingCSV ? '...' : 'CSV'}
                        </Button>
                        <Button icon={Plus} onClick={handleOpenNew}>Nueva</Button>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-3">
                    <Input icon={Search} placeholder="Buscar por nº, cliente o concepto..."
                        value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />

                    <div className="flex gap-2 text-sm overflow-x-auto pb-1 lg:pb-0">
                        <select value={filters.status}
                            onChange={e => setFilters({ ...filters, status: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner">
                            <option value="all">Todos los estados</option>
                            <option value="borrador">Borrador</option>
                            <option value="emitida">Pendiente</option>
                            <option value="parcial">Parcial</option>
                            <option value="pagada">Pagada</option>
                            <option value="anulada">Anulada</option>
                        </select>
                        <select value={filters.client}
                            onChange={e => setFilters({ ...filters, client: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 max-w-[180px] appearance-none font-medium hover:border-slate-600 transition-all shadow-inner">
                            <option value="all">Todos los clientes</option>
                            {sortedClients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        <select value={filters.year}
                            onChange={e => setFilters({ ...filters, year: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner">
                            <option value="all">Años</option>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <select value={filters.month}
                            onChange={e => setFilters({ ...filters, month: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2 outline-none focus:border-blue-500 appearance-none font-medium hover:border-slate-600 transition-all shadow-inner">
                            <option value="all">Mes</option>
                            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
                            <tr>
                                {cols.cod && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('numero')}>
                                    <div className="flex items-center gap-1">COD <SortIcon column="numero" /></div>
                                </th>}
                                {cols.work && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('concepto')}>
                                    <div className="flex items-center gap-1">CONCEPTO <SortIcon column="concepto" /></div>
                                </th>}
                                {cols.cliente && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('clienteId')}>
                                    <div className="flex items-center gap-1">CLIENTE <SortIcon column="clienteId" /></div>
                                </th>}
                                {cols.importe && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IMPORTE</th>}
                                {cols.iva && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IVA</th>}
                                {cols.irpf && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">IRPF</th>}
                                {cols.total && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right cursor-pointer group hover:text-slate-300" onClick={() => handleSort('total')}>
                                    <div className="flex items-center justify-end gap-1">TOTAL <SortIcon column="total" /></div>
                                </th>}
                                {cols.pagado && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">PAGADO</th>}
                                {cols.pendiente && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-right">PENDIENTE</th>}
                                {cols.status && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase text-center">STATUS</th>}
                                {cols.fecha && <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase cursor-pointer group hover:text-slate-300" onClick={() => handleSort('fecha')}>
                                    <div className="flex items-center gap-1">FECHA <SortIcon column="fecha" /></div>
                                </th>}
                                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase sticky right-0 bg-slate-900 shadow-xl">
                                    ACCIONES
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {filteredInvoices.map(inv => {
                                const client = clients.find(c => c.id === inv.clienteId);
                                const isPaid = inv.estado === 'pagada';
                                const pagado = calcularPagado(inv);
                                const pendiente = calcularPendiente(inv);
                                const isRectificativa = inv.tipoDocumento === 'rectificativa';
                                const isPresupuesto = inv.tipoDocumento === 'presupuesto';
                                const isLocked = !isPresupuesto && !isRectificativa &&
                                    (inv.estado === 'emitida' || inv.estado === 'pagada' || inv.estado === 'parcial');
                                const isTemplate = inv.esPlantilla;

                                return (
                                    <tr key={inv.id} className={`hover:bg-slate-800/30 transition-colors group ${isRectificativa ? 'opacity-80' : ''}`}>
                                        {/* COD */}
                                        {cols.cod && <td className="py-2 px-4 text-sm font-mono text-slate-300 border-r border-slate-800/50">
                                            <div className="flex items-center gap-1.5">
                                                {isRectificativa && <RotateCcw size={11} className="text-orange-400 shrink-0" title="Rectificativa" />}
                                                {isTemplate && <RefreshCw size={11} className="text-blue-400 shrink-0" title="Plantilla recurrente" />}
                                                {inv.numero}
                                            </div>
                                        </td>}

                                        {/* WORK */}
                                        {cols.work && <td className="py-2 px-4 text-sm text-white max-w-[200px] truncate" title={inv.concepto}>
                                            {inv.concepto}
                                            {isRectificativa && inv.rectificadaId && (
                                                <span className="ml-1 text-xs text-orange-400/70">rectif.</span>
                                            )}
                                        </td>}

                                        {/* CLIENTE */}
                                        {cols.cliente && <td className="py-2 px-4 text-sm">
                                            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-xs border border-slate-700">
                                                {client?.nombre || 'Sin Cliente'}
                                            </span>
                                        </td>}

                                        {/* IMPORTE */}
                                        {cols.importe && <td className={`py-2 px-4 text-sm text-right font-mono ${isRectificativa ? 'text-orange-400' : 'text-slate-400'}`}>
                                            {formatCurrency(inv.subtotal)}
                                        </td>}

                                        {/* IVA */}
                                        {cols.iva && <td className="py-2 px-4 text-sm text-right text-slate-400 font-mono">
                                            {formatCurrency(inv.iva)}
                                        </td>}

                                        {/* IRPF */}
                                        {cols.irpf && <td className="py-2 px-4 text-sm text-right text-slate-400 font-mono">
                                            {formatCurrency(inv.irpf)}
                                        </td>}

                                        {/* TOTAL */}
                                        {cols.total && <td className={`py-2 px-4 text-sm text-right font-mono font-bold bg-slate-800/20 ${isRectificativa ? 'text-orange-400' : 'text-white'}`}>
                                            {formatCurrency(inv.total)}
                                        </td>}

                                        {/* PAGADO */}
                                        {cols.pagado && <td className="py-2 px-4 text-sm text-right font-mono">
                                            <span className={pagado > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                                                {formatCurrency(pagado)}
                                            </span>
                                        </td>}

                                        {/* PENDIENTE */}
                                        {cols.pendiente && <td className="py-2 px-4 text-sm text-right font-mono">
                                            <span className={pendiente > 0 && inv.estado !== 'anulada' && inv.estado !== 'borrador' ? 'text-red-400' : 'text-slate-600'}>
                                                {formatCurrency(inv.estado !== 'anulada' ? pendiente : 0)}
                                            </span>
                                        </td>}

                                        {/* STATUS */}
                                        {cols.status && <td className="py-2 px-4 text-center">
                                            <StatusBadge status={isPresupuesto ? 'presupuesto' : isRectificativa ? 'rectificativa' : inv.estado} />
                                        </td>}

                                        {/* FECHA */}
                                        {cols.fecha && <td className="py-2 px-4 text-sm font-mono">
                                            <div className="text-slate-300">{formatDateShort(inv.fecha)}</div>
                                            {inv.fechaFacturacion && (
                                                <div className="text-xs text-slate-500">{formatDateShort(inv.fechaFacturacion)}</div>
                                            )}
                                            {isTemplate && inv.proximaFecha && (
                                                <div className="text-xs text-blue-400">→ {formatDateShort(inv.proximaFecha)}</div>
                                            )}
                                        </td>}

                                        {/* ACCIONES */}
                                        <td className="py-2 px-4 sticky right-0 bg-slate-900 group-hover:bg-slate-800 transition-colors shadow-xl border-l border-slate-800">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button variant="ghost" size="sm" icon={Eye} onClick={() => handleOpenPreview(inv)} title="Ver" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Download} onClick={() => generatePDF(inv)} disabled={generating} title="PDF" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Send} onClick={() => setSendInvoice(inv)} title="Enviar email"
                                                    className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10" />

                                                {/* Pagament parcial — per a emitides i parcials */}
                                                {(inv.estado === 'emitida' || inv.estado === 'parcial') && (
                                                    <Button variant="ghost" size="sm" icon={CreditCard}
                                                        onClick={() => setPagoInvoice(inv)}
                                                        title="Gestionar pagos"
                                                        className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10" />
                                                )}

                                                {inv.dropboxLink && (
                                                    <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openUrl(inv.dropboxLink)} title="Dropbox"
                                                        className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300" />
                                                )}

                                                {/* Marcar pagada — per a emitides sense pagos parcials */}
                                                {inv.estado === 'emitida' && (inv.pagos || []).length === 0 && (
                                                    <Button variant="ghost" size="sm" icon={Check} onClick={() => handleMarkPaid(inv)} title="Marcar Pagada"
                                                        className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300" />
                                                )}

                                                {/* Convertir pressupost a factura */}
                                                {isPresupuesto && (
                                                    <Button variant="ghost" size="sm" icon={FileText}
                                                        onClick={() => handleConvertToFactura(inv.id)}
                                                        title="Convertir a Factura"
                                                        className="h-8 w-8 p-0 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10" />
                                                )}

                                                {/* Generar des de plantilla */}
                                                {isTemplate && (
                                                    <Button variant="ghost" size="sm" icon={RefreshCw}
                                                        onClick={() => handleGenerateFromTemplate(inv.id)}
                                                        title="Generar factura ahora"
                                                        className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10" />
                                                )}

                                                <div className="w-px h-4 bg-slate-700 mx-1" />

                                                <Button variant="ghost" size="sm" icon={Copy} onClick={() => handleDuplicate(inv)} title="Duplicar" className="h-8 w-8 p-0" />
                                                <Button variant="ghost" size="sm" icon={Edit2} onClick={() => handleOpenEdit(inv)}
                                                    title={isLocked ? 'Ver (bloqueada)' : 'Editar'}
                                                    className={`h-8 w-8 p-0 ${isLocked ? 'text-slate-500' : ''}`} />

                                                {/* Crear rectificativa per a factures emitides/pagades */}
                                                {isLocked && (
                                                    <Button variant="ghost" size="sm" icon={RotateCcw}
                                                        onClick={() => handleCreateRectificativa(inv.id)}
                                                        title="Crear Rectificativa"
                                                        className="h-8 w-8 p-0 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10" />
                                                )}

                                                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDelete(inv.id)} title="Eliminar"
                                                    className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/20" />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            {filteredInvoices.length === 0 && (
                                <tr>
                                    <td colSpan={Object.values(cols).filter(Boolean).length + 1} className="py-12">
                                        <EmptyState icon={Filter} title="No se encontraron documentos"
                                            description="Prueba a ajustar los filtros o crea un nuevo documento." />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="bg-slate-900 border-t border-slate-800 p-3 flex gap-6 text-sm font-mono overflow-x-auto">
                    <div className="text-slate-400">Total: <span className="text-white">{filteredInvoices.length}</span></div>
                    <div className="text-slate-400">Importe: <span className="text-white">{formatCurrency(filteredInvoices.reduce((s, i) => s + (i.total || 0), 0))}</span></div>
                    <div className="text-slate-400">Pendiente: <span className="text-red-400">{formatCurrency(filteredInvoices.filter(i => i.estado === 'emitida' || i.estado === 'parcial').reduce((s, i) => s + calcularPendiente(i), 0))}</span></div>
                </div>
            </div>

            {/* Modals */}
            <InvoiceModal
                open={showModal}
                onClose={() => setShowModal(false)}
                onSave={handleSaveInvoice}
                invoice={editingInvoice}
                onCreateRectificativa={handleCreateRectificativa}
            />

            <PartialPaymentModal
                open={!!pagoInvoice}
                onClose={() => setPagoInvoice(null)}
                invoice={pagoInvoice}
                onAdd={(pago) => handleAddPago(pagoInvoice.id, pago)}
                onDelete={(pagoId) => handleDeletePago(pagoInvoice.id, pagoId)}
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
                            <Button icon={Send} onClick={() => { setShowPreview(false); setSendInvoice(previewInvoice); }}
                                className="bg-blue-600 hover:bg-blue-500">
                                Enviar por Email
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
