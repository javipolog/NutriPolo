import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useStore, generateId, formatCurrency, formatDate, defaultCategories, getQuarter, validateNIFOrCIF } from '../stores/store';
import { Button, Input, Select, Card, Modal, StatCard, useToast, useConfirm } from './UI';
import {
    Wallet, Calculator, Plus, Search, Edit2, Trash2,
    FolderSearch, FileText, Check, Loader2, Filter,
    Calendar, Layers, ArrowUpDown, ChevronRight, PieChart,
    Download, Eye, EyeOff, Radio, Zap, FolderOpen, RefreshCw, Tag
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { scanFolderForReceipts } from '../services/pdfScanner';
import {
    startWatching, stopWatching, onWatcherEvent,
    processInitialPdfs, getWatcherStatus, markAsProcessed, getStats
} from '../services/folderWatcher';
import { useProviderMemory } from '../services/providerMemory';
import { invoke } from '@tauri-apps/api/tauri';
import { RulesManager } from './RulesManager';

export const ExpensesView = () => {
    const {
        expenses, addExpense, updateExpense, deleteExpense, config, setConfig,
        expenseSearch: search, setExpenseSearch: setSearch,
        expenseFilters: filters, setExpenseFilters: setFilters
    } = useStore();
    const { customRules } = useProviderMemory();
    const activeRulesCount = customRules.filter(r => r.enabled !== false).length;
    const [showModal, setShowModal] = useState(false);
    const [editingExpense, setEditingExpense] = useState(null);
    const [selectedExpenses, setSelectedExpenses] = useState([]);
    const toast = useToast();
    const { confirm, ConfirmDialog } = useConfirm();
    const [sortConfig, setSortConfig] = useState({ key: 'fecha', direction: 'desc' });

    // ============================================
    // WATCHFOLDER STATE
    // ============================================
    const [watcherActive, setWatcherActive] = useState(false);
    const [watcherProcessing, setWatcherProcessing] = useState(false);
    const [watcherStats, setWatcherStats] = useState({ processed: 0, queued: 0, newFound: 0 });
    const [pendingImports, setPendingImports] = useState([]);
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [recentActivity, setRecentActivity] = useState([]);
    const [initialScanDone, setInitialScanDone] = useState(false);
    const [showActivityLog, setShowActivityLog] = useState(false);
    const [showRulesManager, setShowRulesManager] = useState(false);

    const configRef = useRef(config);
    const expensesRef = useRef(expenses);
    configRef.current = config;
    expensesRef.current = expenses;

    // ============================================
    // WATCHER LIFECYCLE
    // ============================================

    const addActivity = useCallback((type, message) => {
        setRecentActivity(prev => [
            { type, message, time: new Date() },
            ...prev.slice(0, 19)
        ]);
    }, []);

    useEffect(() => {
        const unlisten = onWatcherEvent((event) => {
            switch (event.type) {
                case 'watcher_started':
                    setWatcherActive(true);
                    addActivity('info', 'Vigilància iniciada');
                    break;
                case 'watcher_stopped':
                    setWatcherActive(false);
                    setWatcherProcessing(false);
                    addActivity('info', 'Vigilància aturada');
                    break;
                case 'initial_scan':
                    addActivity('info', `Escaneig inicial: ${event.total} PDFs nous (${event.skipped} ja importats)`);
                    break;
                case 'pdf_found':
                    setWatcherStats(prev => ({ ...prev, newFound: prev.newFound + 1, queued: event.queueSize }));
                    addActivity('new', `Nou PDF: ${event.filename}`);
                    break;
                case 'processing':
                    setWatcherProcessing(true);
                    setWatcherStats(prev => ({ ...prev, queued: event.queueSize }));
                    break;
                case 'pdf_processed': {
                    setWatcherProcessing(event.queueSize > 0);
                    setWatcherStats(prev => ({ ...prev, processed: prev.processed + 1, queued: event.queueSize }));
                    setPendingImports(prev => {
                        const updated = [...prev, event.data];
                        if (updated.length === 1 && initialScanDone) setShowPendingModal(true);
                        return updated;
                    });
                    const provider = event.data?.proveedor || event.filename;
                    const total = event.data?.total ? ` — ${formatCurrency(event.data.total)}` : '';
                    addActivity('success', `Processat: ${provider}${total}`);
                    break;
                }
                case 'pdf_error':
                    addActivity('error', `Error processant: ${event.filename}`);
                    break;
                case 'pdf_removed':
                    addActivity('warning', `PDF eliminat: ${event.filename}`);
                    break;
                case 'queue_empty':
                    setWatcherProcessing(false);
                    if (!initialScanDone) {
                        setInitialScanDone(true);
                        setPendingImports(prev => {
                            if (prev.length > 0) setShowPendingModal(true);
                            return prev;
                        });
                    }
                    break;
                case 'watcher_error':
                    addActivity('error', `Error: ${event.message}`);
                    toast.error(`Error del watcher: ${event.message}`);
                    break;
            }
        });
        return unlisten;
    }, [initialScanDone, addActivity]);

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getWatcherStatus();
                if (status.active) { setWatcherActive(true); setInitialScanDone(true); }
            } catch { /* ignorar */ }
        };
        checkStatus();
    }, []);

    // ============================================
    // WATCHER ACTIONS
    // ============================================

    const handleToggleWatcher = async () => {
        if (watcherActive) {
            await stopWatching();
            setWatcherActive(false);
            setWatcherProcessing(false);
            toast.info('Vigilància de carpeta aturada');
            return;
        }

        let folder = config.expensesFolder;
        if (!folder) {
            const selected = await openDialog({ directory: true, multiple: false, title: 'Selecciona la carpeta de factures/gastos' });
            if (selected) { folder = selected; setConfig({ ...config, expensesFolder: selected }); }
            else return;
        }

        setWatcherStats({ processed: 0, queued: 0, newFound: 0 });
        setPendingImports([]);
        setRecentActivity([]);
        setInitialScanDone(false);

        try {
            const watchConfig = { ...config, existingExpenses: expenses };
            const { existingPdfs } = await startWatching(folder, watchConfig);
            toast.success(`Vigilància activa — ${existingPdfs.length} PDFs trobats`);
            if (existingPdfs.length > 0) await processInitialPdfs(existingPdfs, watchConfig);
            else setInitialScanDone(true);
        } catch (e) {
            console.error('Error iniciant watcher:', e);
            toast.error('Error iniciant vigilància: ' + (e.message || e));
            setWatcherActive(false);
        }
    };

    const handleChangeFolder = async () => {
        const selected = await openDialog({ directory: true, multiple: false });
        if (selected) {
            const wasActive = watcherActive;
            if (wasActive) await stopWatching();
            setConfig({ ...config, expensesFolder: selected });
            if (wasActive) setTimeout(() => handleToggleWatcher(), 300);
        }
    };

    const handleImportPending = (selectedItems) => {
        let count = 0;
        selectedItems.forEach(item => {
            const exists = expensesRef.current.some(e =>
                e.fecha === item.fecha && Math.abs(e.total - item.total) < 0.1 && e.proveedor === item.proveedor
            );
            if (!exists) {
                const ivaPorcentaje = item.ivaPorcentaje || 21;
                // Calcular ivaImporte sempre des del percentatge per garantir consistència
                const ivaImporte = parseFloat((item.baseImponible * (ivaPorcentaje / 100)).toFixed(2));
                const total = parseFloat((item.baseImponible + ivaImporte).toFixed(2));
                const expenseData = {
                    id: generateId(), fecha: item.fecha, proveedor: item.proveedor,
                    cifProveedor: item.cifProveedor || '',
                    concepto: item.concepto || item.filename || 'Gasto Importado',
                    categoria: item.categoria || defaultCategories[0],
                    baseImponible: item.baseImponible, ivaPorcentaje,
                    ivaImporte,
                    total, deducibleIrpf: true, deducibleIva: true, archivo: item.file
                };
                addExpense(expenseData);
                count++;
                if (item.file) markAsProcessed(item.file);
                // 🧠 Aprendre de cada importació
                try {
                    useProviderMemory.getState().learnFromImport(expenseData);
                } catch (e) { /* silenciar */ }
            }
        });
        setShowPendingModal(false);
        setPendingImports([]);
        if (count > 0) toast.success(`${count} gastos importats correctament.`);
        else toast.warning('No s\'han importat gastos (duplicats o cap seleccionat).');
    };

    // ============================================
    // ORIGINAL DERIVED DATA
    // ============================================

    const years = useMemo(() => {
        const uniqueYears = new Set(expenses.map(e => new Date(e.fecha).getFullYear().toString()));
        if (uniqueYears.size === 0) uniqueYears.add(new Date().getFullYear().toString());
        return Array.from(uniqueYears).sort((a, b) => b - a);
    }, [expenses]);

    const filteredExpenses = useMemo(() => {
        return expenses
            .filter(e => {
                const date = new Date(e.fecha);
                const yearMatch = filters.year === 'all' || date.getFullYear().toString() === filters.year;
                let periodMatch = true;
                if (filters.period.startsWith('Q')) {
                    periodMatch = `Q${getQuarter(date)}` === filters.period;
                } else if (filters.period !== 'all') {
                    periodMatch = (date.getMonth() + 1).toString().padStart(2, '0') === filters.period;
                }
                const categoryMatch = filters.category === 'all' || e.categoria === filters.category;
                const searchMatch = e.proveedor?.toLowerCase().includes(search.toLowerCase()) || e.concepto?.toLowerCase().includes(search.toLowerCase());
                return yearMatch && periodMatch && categoryMatch && searchMatch;
            })
            .sort((a, b) => {
                const aValue = a[sortConfig.key], bValue = b[sortConfig.key];
                const modifier = sortConfig.direction === 'asc' ? 1 : -1;
                if (typeof aValue === 'string') return aValue.localeCompare(bValue) * modifier;
                return (aValue - bValue) * modifier;
            });
    }, [expenses, filters, search, sortConfig]);

    const totals = useMemo(() => filteredExpenses.reduce((acc, e) => ({
        total: acc.total + (e.total || 0), iva: acc.iva + (e.ivaImporte || 0), base: acc.base + (e.baseImponible || 0)
    }), { total: 0, iva: 0, base: 0 }), [filteredExpenses]);

    const groupedData = useMemo(() => {
        if (filters.groupBy === 'none') return null;
        const groups = {};
        filteredExpenses.forEach(e => {
            let key;
            if (filters.groupBy === 'month') { const d = new Date(e.fecha); key = d.toLocaleString('es-ES', { month: 'long', year: 'numeric' }); }
            else if (filters.groupBy === 'category') key = e.categoria;
            else if (filters.groupBy === 'provider') key = e.proveedor;
            if (!groups[key]) groups[key] = { items: [], total: 0, iva: 0 };
            groups[key].items.push(e); groups[key].total += e.total; groups[key].iva += e.ivaImporte;
        });
        return Object.entries(groups).sort((a, b) => {
            if (filters.groupBy === 'month') return new Date(b[1].items[0].fecha) - new Date(a[1].items[0].fecha);
            return b[1].total - a[1].total;
        });
    }, [filteredExpenses, filters.groupBy]);

    const openNew = () => { setEditingExpense(null); setShowModal(true); };
    const openEdit = (exp) => { setEditingExpense(exp); setShowModal(true); };

    const saveExpense = (data) => {
        // Recalcular sempre ivaImporte i total des del percentatge per garantir persistència correcta
        const ivaImporte = parseFloat((data.baseImponible * (data.ivaPorcentaje / 100)).toFixed(2));
        const total = parseFloat((data.baseImponible + ivaImporte).toFixed(2));
        const finalData = { ...data, ivaImporte, total };
        if (editingExpense) {
            updateExpense(editingExpense.id, finalData);
            // 🧠 Aprendre de correccions manuals
            const hasChanged = editingExpense.categoria !== data.categoria ||
                editingExpense.proveedor !== data.proveedor ||
                editingExpense.cifProveedor !== data.cifProveedor ||
                editingExpense.ivaPorcentaje !== data.ivaPorcentaje;
            if (hasChanged) {
                try {
                    useProviderMemory.getState().learnFromCorrection(editingExpense, finalData);
                    console.log('[ExpensesView] 🧠 Correcció apresa per memòria');
                } catch (e) { console.warn('[ExpensesView] Memory learning error:', e); }
            }
            toast.success('Gasto actualizado');
        }
        else { addExpense({ ...finalData, id: generateId() }); toast.success('Gasto añadido'); }
        setShowModal(false);
    };

    const handleDelete = async (id) => {
        const confirmed = await confirm({ title: 'Eliminar gasto', message: '¿Estás seguro? Esta acción no se puede deshacer.', danger: true });
        if (confirmed) { deleteExpense(id); setSelectedExpenses(prev => prev.filter(sid => sid !== id)); toast.success('Gasto eliminado'); }
    };

    const handleDeleteSelected = async () => {
        const confirmed = await confirm({ title: 'Eliminar múltiples gastos', message: `¿Eliminar ${selectedExpenses.length} gastos seleccionados?`, danger: true });
        if (confirmed) { useStore.getState().deleteExpenses(selectedExpenses); setSelectedExpenses([]); toast.success(`${selectedExpenses.length} gastos eliminados`); }
    };

    const toggleSelect = (id) => setSelectedExpenses(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    const toggleSelectAll = (ids) => {
        const allInCurrent = ids.every(id => selectedExpenses.includes(id));
        if (allInCurrent) setSelectedExpenses(prev => prev.filter(id => !ids.includes(id)));
        else setSelectedExpenses(prev => [...new Set([...prev, ...ids])]);
    };

    const openPdf = async (path) => {
        if (!path) return;
        try { await invoke('open_file', { path }); } catch (e) { toast.error('No se pudo abrir el archivo'); }
    };

    const toggleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="space-y-6 pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-white tracking-tight">Gastos</h1>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-slate-400 text-sm font-medium bg-slate-800/50 px-2.5 py-1 rounded-full border border-slate-700/50 flex items-center gap-2">
                            {filteredExpenses.length} gastos filtrados
                            {filteredExpenses.length > 0 && (
                                <button onClick={() => toggleSelectAll(filteredExpenses.map(e => e.id))}
                                    className="text-blue-400 hover:text-blue-300 ml-1 text-xs border-l border-slate-700 pl-2 font-bold">
                                    {filteredExpenses.every(e => selectedExpenses.includes(e.id)) ? 'DESMARCAR TODOS' : 'SELECCIONAR TODOS'}
                                </button>
                            )}
                        </span>
                    </div>
                </div>
                <div className="flex gap-3">
                    {selectedExpenses.length > 0 && (
                        <Button variant="danger" icon={Trash2} onClick={handleDeleteSelected}
                            className="bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/20">
                            Eliminar ({selectedExpenses.length})
                        </Button>
                    )}
                    {pendingImports.length > 0 && !showPendingModal && (
                        <Button onClick={() => setShowPendingModal(true)}
                            className="bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-900/20 relative" icon={FileText}>
                            Pendents ({pendingImports.length})
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
                        </Button>
                    )}
                    <Button icon={Plus} onClick={openNew} className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20">
                        Nuevo Gasto
                    </Button>
                </div>
            </div>

            {/* ============================================ */}
            {/* WATCHFOLDER CONTROL PANEL                    */}
            {/* ============================================ */}
            <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
                <div className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        {/* Toggle + Folder */}
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                            <button onClick={handleToggleWatcher}
                                className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 flex-shrink-0 ${
                                    watcherActive
                                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 shadow-lg shadow-emerald-900/20'
                                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white'
                                }`}>
                                {watcherProcessing ? <Loader2 size={18} className="animate-spin" />
                                    : watcherActive ? <Radio size={18} className="animate-pulse" />
                                    : <Eye size={18} />}
                                {watcherActive ? 'VIGILANT' : 'ACTIVAR WATCHFOLDER'}
                                {watcherActive && (
                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                                    </span>
                                )}
                            </button>

                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                <FolderOpen size={16} className="text-slate-500 flex-shrink-0" />
                                {config.expensesFolder
                                    ? <span className="text-xs text-slate-500 truncate" title={config.expensesFolder}>{config.expensesFolder}</span>
                                    : <span className="text-xs text-slate-600 italic">Cap carpeta seleccionada</span>}
                                <button onClick={handleChangeFolder} className="text-blue-400 hover:text-blue-300 text-xs font-medium flex-shrink-0 transition-colors">Canviar</button>
                            </div>
                        </div>

                        {/* Stats badges */}
                        {watcherActive && (
                            <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="flex items-center gap-1.5 text-xs">
                                    <Zap size={13} className="text-emerald-400" />
                                    <span className="text-slate-400">Processats:</span>
                                    <span className="text-emerald-400 font-bold">{watcherStats.processed}</span>
                                </div>
                                {watcherStats.queued > 0 && (
                                    <div className="flex items-center gap-1.5 text-xs">
                                        <Loader2 size={13} className="text-blue-400 animate-spin" />
                                        <span className="text-slate-400">En cua:</span>
                                        <span className="text-blue-400 font-bold">{watcherStats.queued}</span>
                                    </div>
                                )}
                                <button onClick={() => setShowActivityLog(!showActivityLog)}
                                    className="text-slate-500 hover:text-slate-300 transition-colors p-1">
                                    {showActivityLog ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        )}

                        {/* Botó Regles — sempre visible */}
                        <button
                            onClick={() => setShowRulesManager(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex-shrink-0
                                bg-slate-800/80 border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-500/8"
                            title="Gestionar regles de categorització"
                        >
                            <Tag size={13} />
                            Regles
                            {activeRulesCount > 0 && (
                                <span className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-0.5">
                                    {activeRulesCount}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Activity Log (collapsible) */}
                    {showActivityLog && recentActivity.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-800 max-h-40 overflow-y-auto custom-scrollbar space-y-1">
                            {recentActivity.map((activity, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        activity.type === 'success' ? 'bg-emerald-400' :
                                        activity.type === 'error' ? 'bg-red-400' :
                                        activity.type === 'warning' ? 'bg-amber-400' :
                                        activity.type === 'new' ? 'bg-blue-400' :
                                        'bg-slate-500'
                                    }`} />
                                    <span className="text-slate-500 flex-shrink-0 font-mono">
                                        {activity.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                    <span className="text-slate-400 truncate">{activity.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard icon={Wallet} label={filters.period === 'all' ? `Gasto Total ${filters.year}` : `Gasto Período (${filters.period})`}
                    value={formatCurrency(totals.total)} color="red" subValue={`Base: ${formatCurrency(totals.base)}`} />
                <StatCard icon={Calculator} label="IVA Soportado" value={formatCurrency(totals.iva)} color="amber" subValue="IVA deducible acumulado" />
                <StatCard icon={PieChart} label="Media de Gasto"
                    value={formatCurrency(filteredExpenses.length > 0 ? totals.total / filteredExpenses.length : 0)} color="blue"
                    subValue={`Sobre ${filteredExpenses.length} documentos`} />
            </div>

            {/* Filters Bar */}
            <Card className="p-1 border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-20 shadow-xl">
                <div className="flex flex-col lg:flex-row gap-2 p-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                        <input className="w-full bg-slate-800 border border-slate-700 text-white pl-10 pr-4 py-2 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                            placeholder="Buscar por proveedor o concepto..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl border border-slate-700 overflow-hidden shadow-inner">
                            <select value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })}
                                className="bg-transparent text-white text-sm px-3 py-1 outline-none cursor-pointer hover:bg-slate-700 transition-colors appearance-none font-medium">
                                <option value="all" className="bg-slate-900 text-white">Años</option>
                                {years.map(y => <option key={y} value={y} className="bg-slate-900 text-white">{y}</option>)}
                            </select>
                            <div className="w-px h-4 bg-slate-700 mx-1"></div>
                            <select value={filters.period} onChange={e => setFilters({ ...filters, period: e.target.value })}
                                className="bg-transparent text-white text-sm px-3 py-1 outline-none cursor-pointer hover:bg-slate-700 transition-colors appearance-none font-medium">
                                <option value="all" className="bg-slate-900 text-white">Todo el año</option>
                                <optgroup label="Trimestres" className="bg-slate-900 text-slate-400 font-bold italic">
                                    <option value="Q4" className="bg-slate-900 text-white">Trimestre 4</option>
                                    <option value="Q3" className="bg-slate-900 text-white">Trimestre 3</option>
                                    <option value="Q2" className="bg-slate-900 text-white">Trimestre 2</option>
                                    <option value="Q1" className="bg-slate-900 text-white">Trimestre 1</option>
                                </optgroup>
                                <optgroup label="Meses" className="bg-slate-900 text-slate-400 font-bold italic">
                                    {['12','11','10','09','08','07','06','05','04','03','02','01'].map(m => (
                                        <option key={m} value={m} className="bg-slate-900 text-white">
                                            {new Date(2000, parseInt(m)-1).toLocaleString('es-ES', { month: 'long' }).replace(/^\w/, c => c.toUpperCase())}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>
                        <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}
                            className="bg-slate-800 border border-slate-700 text-white text-sm px-4 py-2 rounded-xl outline-none focus:border-blue-500 transition-all hover:border-slate-600 appearance-none font-medium shadow-inner">
                            <option value="all" className="bg-slate-900 text-white">Categorías</option>
                            {defaultCategories.map(c => <option key={c} value={c} className="bg-slate-900 text-white">{c}</option>)}
                        </select>
                        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-3 py-1 rounded-xl shadow-inner hover:border-slate-600 transition-colors">
                            <Layers size={14} className="text-slate-400" />
                            <select value={filters.groupBy} onChange={e => setFilters({ ...filters, groupBy: e.target.value })}
                                className="bg-transparent text-white text-sm outline-none cursor-pointer appearance-none font-medium py-1">
                                <option value="none" className="bg-slate-900 text-white">Sin agrupar</option>
                                <option value="month" className="bg-slate-900 text-white">Mes</option>
                                <option value="category" className="bg-slate-900 text-white">Categoría</option>
                                <option value="provider" className="bg-slate-900 text-white">Proveedor</option>
                            </select>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Main Content */}
            {filters.groupBy !== 'none' && groupedData ? (
                <div className="space-y-6">
                    {groupedData.map(([group, data]) => (
                        <div key={group} className="space-y-3">
                            <div className="flex items-center gap-3 px-2">
                                <ChevronRight className="text-blue-500" size={20} />
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">{group}</h3>
                                <div className="h-px flex-1 bg-slate-800"></div>
                                <div className="flex gap-4 text-sm font-mono">
                                    <span className="text-slate-500">Items: <span className="text-slate-300">{data.items.length}</span></span>
                                    <span className="text-slate-500">Total: <span className="text-emerald-400 font-bold">{formatCurrency(data.total)}</span></span>
                                </div>
                            </div>
                            <Card className="overflow-hidden border-slate-800/50">
                                <ExpensesTable expenses={data.items} onEdit={openEdit} onDelete={handleDelete} onOpenPdf={openPdf}
                                    toggleSort={toggleSort} sortConfig={sortConfig} selectedItems={selectedExpenses}
                                    onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} compact />
                            </Card>
                        </div>
                    ))}
                </div>
            ) : (
                <Card className="overflow-hidden border-slate-800 shadow-2xl">
                    <ExpensesTable expenses={filteredExpenses} onEdit={openEdit} onDelete={handleDelete} onOpenPdf={openPdf}
                        toggleSort={toggleSort} sortConfig={sortConfig} selectedItems={selectedExpenses}
                        onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
                </Card>
            )}

            {/* Modals */}
            <ExpenseModal open={showModal} onClose={() => setShowModal(false)} onSave={saveExpense} expense={editingExpense} />
            <ScanResultModal open={showPendingModal} onClose={() => setShowPendingModal(false)} results={pendingImports} onImport={handleImportPending} />
            <RulesManager open={showRulesManager} onClose={() => setShowRulesManager(false)} />
            {ConfirmDialog}
        </div>
    );
};

// ============================================
// SUB-COMPONENTS
// ============================================

const ExpensesTable = ({ expenses, onEdit, onDelete, onOpenPdf, toggleSort, sortConfig, selectedItems = [], onToggleSelect, onToggleSelectAll, compact = false }) => {
    if (expenses.length === 0) {
        return <div className="py-20 text-center text-slate-500 flex flex-col items-center gap-3">
            <Filter size={40} className="opacity-20" />
            <p className="text-lg">No se encontraron gastos con estos filtros</p>
        </div>;
    }

    const allSelected = expenses.length > 0 && expenses.every(e => selectedItems.includes(e.id));
    const someSelected = expenses.some(e => selectedItems.includes(e.id));

    return (
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-slate-800 bg-slate-800/20">
                        <th className="py-4 px-6 text-left w-10">
                            <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                                checked={allSelected} ref={el => el && (el.indeterminate = someSelected && !allSelected)}
                                onChange={() => onToggleSelectAll(expenses.map(e => e.id))} />
                        </th>
                        <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors group" onClick={() => toggleSort('fecha')}>
                            <div className="flex items-center gap-2">FECHA <ArrowUpDown size={12} className={`opacity-0 group-hover:opacity-100 ${sortConfig.key === 'fecha' ? 'opacity-100 text-blue-500' : ''}`} /></div>
                        </th>
                        <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors group" onClick={() => toggleSort('proveedor')}>
                            <div className="flex items-center gap-2">PROVEEDOR <ArrowUpDown size={12} className={`opacity-0 group-hover:opacity-100 ${sortConfig.key === 'proveedor' ? 'opacity-100 text-blue-500' : ''}`} /></div>
                        </th>
                        <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">CONCEPTO</th>
                        {!compact && <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">CATEGORÍA</th>}
                        <th className="text-right py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">IVA</th>
                        <th className="text-right py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors group" onClick={() => toggleSort('total')}>
                            <div className="flex items-center justify-end gap-2">TOTAL <ArrowUpDown size={12} className={`opacity-0 group-hover:opacity-100 ${sortConfig.key === 'total' ? 'opacity-100 text-blue-500' : ''}`} /></div>
                        </th>
                        <th className="text-right py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">ACCIONES</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                    {expenses.map(exp => (
                        <tr key={exp.id} className={`hover:bg-slate-800/40 transition-all group ${selectedItems.includes(exp.id) ? 'bg-blue-600/5 hover:bg-blue-600/10' : ''}`}
                            onClick={() => onToggleSelect(exp.id)}>
                            <td className="py-3 px-6" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                                    checked={selectedItems.includes(exp.id)} onChange={() => onToggleSelect(exp.id)} />
                            </td>
                            <td className="py-3 px-6 text-slate-400 font-mono text-sm">{formatDate(exp.fecha)}</td>
                            <td className="py-3 px-6">
                                <div className="text-white font-semibold">{exp.proveedor}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{exp.cifProveedor}</div>
                            </td>
                            <td className="py-3 px-6">
                                <div className="flex items-center gap-2">
                                    {exp.archivo && (
                                        <button onClick={e => { e.stopPropagation(); onOpenPdf(exp.archivo); }}
                                            className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors" title="Ver comprobante">
                                            <FileText size={14} />
                                        </button>
                                    )}
                                    <span className={`text-slate-300 text-sm truncate max-w-[200px] ${exp.archivo ? "cursor-pointer hover:text-white" : ""}`}
                                        onClick={e => { if (exp.archivo) { e.stopPropagation(); onOpenPdf(exp.archivo); } }}>
                                        {exp.concepto}
                                    </span>
                                </div>
                            </td>
                            {!compact && (
                                <td className="py-3 px-6">
                                    <span className="bg-slate-800/80 text-slate-400 text-[10px] px-2 py-1 rounded-md border border-slate-700/50 uppercase font-medium">{exp.categoria}</span>
                                </td>
                            )}
                            <td className="py-3 px-6 text-right">
                                <div className="text-slate-500 text-xs font-mono">{formatCurrency(exp.ivaImporte)}</div>
                                <div className="text-[10px] text-slate-600 font-mono">({exp.ivaPorcentaje}%)</div>
                            </td>
                            <td className="py-3 px-6 text-right">
                                <div className="text-white font-bold font-mono">{formatCurrency(exp.total)}</div>
                                <div className="text-[10px] text-slate-500 font-mono">Base: {formatCurrency(exp.baseImponible)}</div>
                            </td>
                            <td className="py-3 px-6 text-right" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1 opacity-10 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="sm" icon={Edit2} onClick={() => onEdit(exp)} className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700" />
                                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onDelete(exp.id)} className="h-8 w-8 p-0 text-slate-500 hover:text-red-400 hover:bg-red-900/20" />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ExpenseModal = ({ open, onClose, onSave, expense }) => {
    const [form, setForm] = useState({
        fecha: new Date().toISOString().split('T')[0], proveedor: '', cifProveedor: '', concepto: '',
        categoria: defaultCategories[0], baseImponible: 0, ivaPorcentaje: 21, deducibleIrpf: true, deducibleIva: true
    });

    useEffect(() => {
        if (expense) setForm(expense);
        else setForm({ fecha: new Date().toISOString().split('T')[0], proveedor: '', cifProveedor: '', concepto: '', categoria: defaultCategories[0], baseImponible: 0, ivaPorcentaje: 21, deducibleIrpf: true, deducibleIva: true });
    }, [expense, open]);

    const handleSubmit = (e) => { e.preventDefault(); onSave(form); };
    const ivaImporte = form.baseImponible * (form.ivaPorcentaje / 100);
    const total = form.baseImponible + ivaImporte;

    return (
        <Modal open={open} onClose={onClose} title={expense ? 'Editar Gasto' : 'Nuevo Gasto'} className="max-w-lg">
            <form onSubmit={handleSubmit} className="space-y-5 py-2">
                <div className="grid grid-cols-2 gap-4">
                    <Input label="Fecha" type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} required />
                    <Select label="Categoría" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} options={defaultCategories.map(c => ({ value: c, label: c }))} />
                </div>
                <div className="grid grid-cols-3 gap-4 border-t border-slate-800 pt-4">
                    <div className="col-span-2">
                        <Input label="Proveedor" value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} required placeholder="Nombre fiscal..." />
                    </div>
                    <div>
                        <Input label="CIF/NIF" value={form.cifProveedor} onChange={e => setForm({ ...form, cifProveedor: e.target.value })} placeholder="B123..." />
                    </div>
                </div>
                <Input label="Concepto / Factura" value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} required placeholder="Ej: Factura luz Enero..." />
                <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4">
                    <Input label="Base Imponible (€)" type="number" step="0.01" value={form.baseImponible} onChange={e => setForm({ ...form, baseImponible: parseFloat(e.target.value) || 0 })} required />
                    <Input label="IVA (%)" type="number" value={form.ivaPorcentaje} onChange={e => setForm({ ...form, ivaPorcentaje: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="flex gap-6 bg-slate-800/30 p-3 rounded-xl border border-slate-800">
                    <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer select-none">
                        <input type="checkbox" checked={form.deducibleIva} onChange={e => setForm({ ...form, deducibleIva: e.target.checked })} className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500" />
                        Deducible IVA
                    </label>
                    <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer select-none">
                        <input type="checkbox" checked={form.deducibleIrpf} onChange={e => setForm({ ...form, deducibleIrpf: e.target.checked })} className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500" />
                        Deducible IRPF
                    </label>
                </div>
                <div className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20">
                    <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Base</span><span>{formatCurrency(form.baseImponible)}</span></div>
                    <div className="flex justify-between text-xs text-slate-400"><span>IVA ({form.ivaPorcentaje}%)</span><span>{formatCurrency(ivaImporte)}</span></div>
                    <div className="mt-3 pt-3 border-t border-blue-500/20 flex justify-between items-end">
                        <span className="text-white text-sm font-medium">TOTAL GASTO</span>
                        <span className="text-white text-xl font-black">{formatCurrency(total)}</span>
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">Cancelar</Button>
                    <Button type="submit" className="px-8 bg-blue-600 hover:bg-blue-500">Guardar Transacción</Button>
                </div>
            </form>
        </Modal>
    );
};

const ScanResultModal = ({ open, onClose, results, onImport }) => {
    const [selected, setSelected] = useState([]);

    useEffect(() => {
        if (open) setSelected(results);
    }, [open, results]);

    const toggle = (item) => {
        if (selected.includes(item)) setSelected(selected.filter(i => i !== item));
        else setSelected([...selected, item]);
    };

    // Ordenar per data descendent
    const sortedResults = useMemo(() =>
        [...results].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
        [results]
    );

    return (
        <Modal open={open} onClose={onClose} title={`PDFs Detectats (${results.length})`} className="max-w-4xl">
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                <div className="flex items-center gap-2 text-amber-400 bg-amber-400/10 p-3 rounded-lg border border-amber-400/20 mb-2">
                    <Calculator size={18} />
                    <p className="text-xs font-medium">Dades extretes automàticament. Revisa els imports abans de confirmar.</p>
                </div>
                {sortedResults.map((r, i) => (
                    <div key={i}
                        className={`p-4 rounded-xl border transition-all cursor-pointer ${selected.includes(r) ? 'bg-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-900/10' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500 hover:bg-slate-800'}`}
                        onClick={() => toggle(r)}>
                        <div className="flex items-start gap-4">
                            <div className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${selected.includes(r) ? 'bg-blue-600 border-blue-600' : 'border-slate-600 bg-slate-900'}`}>
                                {selected.includes(r) && <Check size={14} className="text-white stroke-[3px]" />}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-white text-base">{r.proveedor || 'Proveedor desconocido'}</h4>
                                            {r.inferredQuarter && (
                                                <span className="bg-blue-600/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-full font-bold border border-blue-500/20">T{r.inferredQuarter}</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 line-clamp-1">
                                            <Calendar size={12} /> {formatDate(r.fecha)}
                                            <span className="mx-1">•</span>
                                            <FileText size={12} /> {r.filename}
                                        </p>
                                    </div>
                                    <div className="text-right bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-700/50">
                                        <div className="text-lg font-black text-white leading-none">{formatCurrency(r.total)}</div>
                                        {r.ivaPorcentaje !== undefined && (
                                            <div className="text-[10px] text-slate-500 font-bold mt-1 tracking-wider uppercase">IVA {r.ivaPorcentaje}%</div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center gap-4 pt-3 border-t border-slate-700/30" onClick={e => e.stopPropagation()}>
                                    <div className="flex-1">
                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1.5">
                                            Categoría
                                            {r.categorySource && r.categorySource !== 'default' && r.categorySource !== 'keywords' && (
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                                    r.categorySource.startsWith('memory') ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                    r.categorySource === 'custom_rule' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                                                    r.categorySource === 'existing_expenses' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                                    'bg-slate-700 text-slate-400'
                                                }`}>
                                                    {r.categorySource.startsWith('memory') ? '🧠 MEMÒRIA' :
                                                     r.categorySource === 'custom_rule' ? '📏 REGLA' :
                                                     r.categorySource === 'existing_expenses' ? '📋 RECURRENT' : '🔍'}
                                                </span>
                                            )}
                                        </label>
                                        <Select value={r.categoria} onChange={e => { r.categoria = e.target.value; setSelected([...selected]); }}
                                            options={defaultCategories.map(c => ({ value: c, label: c }))} className="h-8 text-xs bg-slate-900/50 border-slate-700" />
                                    </div>
                                    <div className="w-28">
                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">CIF/NIF</label>
                                        <input type="text" value={r.cifProveedor || ''} onChange={e => { r.cifProveedor = e.target.value; setSelected([...selected]); }}
                                            className="w-full h-8 text-xs bg-slate-900/50 border border-slate-700 rounded-md px-2 text-white outline-none focus:border-blue-500 font-mono" placeholder="B12345678" />
                                    </div>
                                    <div className="w-1/4">
                                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Concepto</label>
                                        <input type="text" value={r.concepto || ''} onChange={e => { r.concepto = e.target.value; setSelected([...selected]); }}
                                            className="w-full h-8 text-xs bg-slate-900/50 border border-slate-700 rounded-md px-2 text-white outline-none focus:border-blue-500" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                {results.length === 0 && (
                    <div className="py-10 text-center text-slate-500">No s'han trobat resultats.</div>
                )}
            </div>
            <div className="flex justify-between items-center pt-6 mt-4 border-t border-slate-800">
                <span className="text-slate-400 text-sm font-medium">{selected.length} elements seleccionats</span>
                <div className="flex gap-3">
                    <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">Cancelar</Button>
                    <Button onClick={() => onImport(selected)} className="bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 px-6">
                        Confirmar Importació
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
