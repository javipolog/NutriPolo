import React, { useState, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    AreaChart, Area, PieChart, Pie, Cell, LineChart, Line, ComposedChart,
    ReferenceLine
} from 'recharts';
import {
    Euro, Wallet, Clock, AlertCircle, Calendar,
    ArrowUpRight, ArrowDownRight, TrendingUp, Activity,
    Briefcase, CheckCircle, AlertTriangle, FileText, Settings, Filter, Eye, Bell,
    GitCompareArrows, Layers, BarChart3
} from 'lucide-react';
import { Card, StatCard, StatusBadge, Button, Modal, Select } from './UI';
import { useStore, formatCurrency, formatDate, getQuarter, getTaxDeadlines, distributeInvoiceByMonth } from '../stores/store';

/* ============================================
   TOOLTIPS
   ============================================ */

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 p-4 rounded-xl shadow-2xl">
                <p className="text-slate-400 text-xs font-semibold mb-2 uppercase tracking-wider">{label}</p>
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center justify-between gap-4 text-sm font-medium mb-1 last:mb-0">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color, boxShadow: `0 0 10px ${entry.color}40` }} />
                            <span className="text-slate-200">{entry.name}</span>
                        </div>
                        <span className="text-white font-mono font-bold">{formatCurrency(entry.value)}</span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const ComparisonTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        const grouped = {};
        payload.forEach(entry => {
            const parts = entry.name.split(' ');
            const year = parts[parts.length - 1];
            const type = parts.slice(0, -1).join(' ');
            if (!grouped[year]) grouped[year] = {};
            grouped[year][type] = { value: entry.value, color: entry.color };
        });
        return (
            <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 p-4 rounded-xl shadow-2xl min-w-[220px]">
                <p className="text-slate-400 text-xs font-semibold mb-3 uppercase tracking-wider">{label}</p>
                {Object.entries(grouped).map(([year, types]) => (
                    <div key={year} className="mb-2 last:mb-0">
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">{year}</p>
                        {Object.entries(types).map(([type, data]) => (
                            <div key={type} className="flex items-center justify-between gap-4 text-sm font-medium mb-0.5">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
                                    <span className="text-slate-300 text-xs">{type}</span>
                                </div>
                                <span className="text-white font-mono font-bold text-xs">{formatCurrency(data.value)}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const YoYTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 p-4 rounded-xl shadow-2xl">
                <p className="text-slate-400 text-xs font-semibold mb-2 uppercase tracking-wider">{label}</p>
                {payload.map((entry, index) => {
                    const val = entry.value;
                    const pos = val >= 0;
                    return (
                        <div key={index} className="flex items-center justify-between gap-4 text-sm font-medium mb-1 last:mb-0">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="text-slate-200">{entry.name}</span>
                            </div>
                            <span className={`font-mono font-bold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pos ? '+' : ''}{val.toFixed(1)}%
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
};

/* ============================================
   CONSTANTS
   ============================================ */

const YEAR_COLORS = [
    { ingresos: '#3b82f6', gastos: '#ef4444', benefici: '#10b981' },
    { ingresos: '#818cf8', gastos: '#fb923c', benefici: '#34d399' },
    { ingresos: '#a78bfa', gastos: '#fbbf24', benefici: '#6ee7b7' },
];
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* ============================================
   SMALL COMPONENTS
   ============================================ */

const ChartModeTab = ({ active, icon: Icon, label, onClick }) => (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'}`}>
        <Icon size={13} />{label}
    </button>
);

const Toggle = ({ checked, onChange }) => (
    <div onClick={(e) => { e.preventDefault(); onChange(); }} className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}>
        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform duration-300 ${checked ? 'translate-x-5' : 'translate-x-0'}`}></div>
    </div>
);

const LayoutIcon = ({ icon: Icon }) => (
    <div className="p-1.5 bg-slate-700/50 rounded text-slate-400"><Icon size={14} /></div>
);

const AlertItem = ({ condition, icon: Icon, color, title, desc, fallback }) => {
    const cs = {
        amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
        blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
        emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
        red: 'bg-red-500/10 border-red-500/20 text-red-400',
        indigo: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
    };
    const render = (I, c, t, d) => (
        <div className={`flex gap-3 items-start p-3 rounded-xl border ${cs[c].split(' ').slice(0, 2).join(' ')}`}>
            <I className={`${cs[c].split(' ').pop()} shrink-0 mt-0.5`} size={18} />
            <div>
                <p className={`${cs[c].split(' ').pop()} text-sm font-semibold`}>{t}</p>
                <p className="text-slate-400 text-xs mt-1">{d}</p>
            </div>
        </div>
    );
    if (condition) return render(Icon, color, title, desc);
    if (fallback) return render(fallback.icon, fallback.color, fallback.title, fallback.desc);
    return null;
};

/* ============================================
   HELPERS
   ============================================ */

/**
 * Calcula la porció del subtotal d'una factura que pertany a un rang de mesos concret.
 * Usa distributeInvoiceByMonth per obtindre la distribució proporcional.
 */
const getDistributedAmount = (invoice, targetYear, quarterFilter) => {
    const dist = distributeInvoiceByMonth(invoice, 'subtotal');
    let total = 0;
    Object.entries(dist).forEach(([key, amount]) => {
        const [y, m] = key.split('-').map(Number);
        if (y !== targetYear) return;
        if (quarterFilter !== 'all') {
            const q = Math.ceil((m + 1) / 3);
            if (q !== parseInt(quarterFilter)) return;
        }
        total += amount;
    });
    return total;
};

/**
 * Calcula ingressos i gastos per mes usant distribució proporcional.
 * Les factures amb fechaFin distribueixen el subtotal proporcionalment
 * entre els mesos que cobreix el projecte (per dies naturals).
 * Les despeses s'assignen al mes de la seua data (sense distribució).
 */
const getMonthlyData = (yearInvoices, yearExpenses, monthRange) => {
    // Pre-calcular distribucions de totes les factures
    const monthTotals = {};
    monthRange.forEach(m => { monthTotals[m] = 0; });

    yearInvoices.forEach(inv => {
        const dist = distributeInvoiceByMonth(inv, 'subtotal');
        // dist keys són "year-month", ex: "2025-6" per juliol
        Object.entries(dist).forEach(([key, amount]) => {
            const monthIdx = parseInt(key.split('-')[1], 10);
            if (monthIdx in monthTotals) {
                monthTotals[monthIdx] += amount;
            }
        });
    });

    return monthRange.map(idx => ({
        ingresos: monthTotals[idx] || 0,
        gastos: yearExpenses.filter(e => new Date(e.fecha).getMonth() === idx)
            .reduce((s, e) => s + (e.baseImponible || 0), 0)
    }));
};

const calcGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
};

const formatGrowth = (v) => {
    if (v === 0 || isNaN(v) || !isFinite(v)) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
};

/* ============================================
   DASHBOARD COMPONENT
   ============================================ */

export const Dashboard = () => {
    const {
        invoices, expenses, clients,
        dashboardFilters: filter, setDashboardFilters: setFilter,
        dashboardConfig, setDashboardConfig
    } = useStore();

    const currentYear = new Date().getFullYear();
    const [showConfig, setShowConfig] = useState(false);
    const [chartMode, setChartMode] = useState('evolution');
    const [compareYears, setCompareYears] = useState([]);
    const [compareMetric, setCompareMetric] = useState('both');

    const toggleSection = (key) => setDashboardConfig(prev => ({ ...prev, [key]: !prev[key] }));

    const toggleCompareYear = (year) => {
        setCompareYears(prev =>
            prev.includes(year)
                ? prev.filter(y => y !== year)
                : prev.length < 2 ? [...prev, year] : [prev[1], year]
        );
    };

    // Anys disponibles
    const years = useMemo(() => {
        const u = new Set([
            ...invoices.map(i => new Date(i.fecha).getFullYear()),
            ...expenses.map(e => new Date(e.fecha).getFullYear()),
            currentYear
        ]);
        return Array.from(u).sort((a, b) => b - a);
    }, [invoices, expenses, currentYear]);

    // Filtre de dates bàsic (per data exacta - usat per despeses)
    const checkDateForYear = (dateStr, year) => {
        const date = new Date(dateStr);
        if (date.getFullYear() !== year) return false;
        if (filter.quarter === 'all') return true;
        return getQuarter(date) === parseInt(filter.quarter);
    };

    /**
     * Comprova si una factura "toca" un any/trimestre concret,
     * considerant que el projecte pot abastar múltiples mesos.
     * Inclou factures on [fecha, fechaFin] interseca el període filtrat.
     */
    const invoiceTouchesYear = (inv, year) => {
        const start = new Date(inv.fecha);
        const end = inv.fechaFin ? new Date(inv.fechaFin) : start;
        const actualEnd = end >= start ? end : start;

        if (filter.quarter === 'all') {
            // L'any complet: [1 gen, 31 des]
            const periodStart = new Date(year, 0, 1);
            const periodEnd = new Date(year, 11, 31);
            return start <= periodEnd && actualEnd >= periodStart;
        } else {
            const q = parseInt(filter.quarter);
            const periodStart = new Date(year, (q - 1) * 3, 1);
            const periodEnd = new Date(year, q * 3, 0); // últim dia del trimestre
            return start <= periodEnd && actualEnd >= periodStart;
        }
    };

    // Dades filtrades any principal
    const filteredData = useMemo(() => ({
        invoices: invoices.filter(i => invoiceTouchesYear(i, filter.year) && i.estado !== 'anulada'),
        expenses: expenses.filter(e => checkDateForYear(e.fecha, filter.year))
    }), [invoices, expenses, filter]);

    // Dades filtrades anys comparació
    const compareData = useMemo(() => {
        const r = {};
        compareYears.forEach(year => {
            r[year] = {
                invoices: invoices.filter(i => invoiceTouchesYear(i, year) && i.estado !== 'anulada'),
                expenses: expenses.filter(e => checkDateForYear(e.fecha, year))
            };
        });
        return r;
    }, [invoices, expenses, compareYears, filter]);

    const allCompareYears = [filter.year, ...compareYears];

    // Estadístiques
    const stats = useMemo(() => {
        const totalIngresos = filteredData.invoices.reduce((s, i) => s + getDistributedAmount(i, filter.year, filter.quarter), 0);
        const totalGastos = filteredData.expenses.reduce((s, e) => s + (e.baseImponible || 0), 0);
        const beneficio = totalIngresos - totalGastos;

        const pend = invoices.filter(i => i.estado === 'emitida' && new Date(i.fecha).getFullYear() === filter.year);
        const pendientes = pend.length;
        const importePendiente = pend.reduce((s, i) => s + (i.total || 0), 0);

        const prevYear = filter.year - 1;
        const prevInv = invoices.filter(i => invoiceTouchesYear(i, prevYear) && i.estado !== 'anulada');
        const prevExp = expenses.filter(e => checkDateForYear(e.fecha, prevYear));
        const prevIngresos = prevInv.reduce((s, i) => s + getDistributedAmount(i, prevYear, filter.quarter), 0);
        const prevGastos = prevExp.reduce((s, e) => s + (e.baseImponible || 0), 0);
        const prevBeneficio = prevIngresos - prevGastos;

        return {
            totalIngresos, totalGastos, beneficio, pendientes, importePendiente, prevYear,
            growth: {
                ingresos: calcGrowth(totalIngresos, prevIngresos),
                gastos: calcGrowth(totalGastos, prevGastos),
                beneficio: calcGrowth(beneficio, prevBeneficio)
            }
        };
    }, [filteredData, invoices, expenses, filter]);

    // Month range helpers
    const monthRange = useMemo(() => {
        const start = filter.quarter === 'all' ? 0 : (parseInt(filter.quarter) - 1) * 3;
        const end = filter.quarter === 'all' ? 12 : start + 3;
        return Array.from({ length: end - start }, (_, i) => start + i);
    }, [filter.quarter]);

    const monthLabels = useMemo(() => monthRange.map(i => MONTHS[i]), [monthRange]);

    // Chart data principal (sense comparació)
    const chartData = useMemo(() => {
        const main = getMonthlyData(filteredData.invoices, filteredData.expenses, monthRange);
        return monthLabels.map((name, idx) => ({
            name, ingresos: main[idx].ingresos, gastos: main[idx].gastos,
            beneficio: main[idx].ingresos - main[idx].gastos
        }));
    }, [filteredData, monthRange, monthLabels]);

    // Chart data comparació multi-any
    const comparisonChartData = useMemo(() => {
        if (compareYears.length === 0) return chartData;
        const main = getMonthlyData(filteredData.invoices, filteredData.expenses, monthRange);
        const cmp = {};
        compareYears.forEach(y => { if (compareData[y]) cmp[y] = getMonthlyData(compareData[y].invoices, compareData[y].expenses, monthRange); });

        return monthLabels.map((name, idx) => {
            const row = { name,
                [`ingresos_${filter.year}`]: main[idx].ingresos,
                [`gastos_${filter.year}`]: main[idx].gastos,
                [`beneficio_${filter.year}`]: main[idx].ingresos - main[idx].gastos,
            };
            compareYears.forEach(y => {
                if (cmp[y]) {
                    row[`ingresos_${y}`] = cmp[y][idx].ingresos;
                    row[`gastos_${y}`] = cmp[y][idx].gastos;
                    row[`beneficio_${y}`] = cmp[y][idx].ingresos - cmp[y][idx].gastos;
                }
            });
            return row;
        });
    }, [chartData, compareYears, compareData, filteredData, filter, monthRange, monthLabels]);

    // YoY % data
    const yoyChartData = useMemo(() => {
        if (compareYears.length === 0) return [];
        const refYear = compareYears[0];
        const main = getMonthlyData(filteredData.invoices, filteredData.expenses, monthRange);
        const ref = compareData[refYear] ? getMonthlyData(compareData[refYear].invoices, compareData[refYear].expenses, monthRange) : monthRange.map(() => ({ ingresos: 0, gastos: 0 }));

        return monthLabels.map((name, idx) => {
            const pct = (c, p) => p === 0 ? (c > 0 ? 100 : 0) : parseFloat((((c - p) / Math.abs(p)) * 100).toFixed(1));
            return { name,
                'Δ Ingresos': pct(main[idx].ingresos, ref[idx].ingresos),
                'Δ Gastos': pct(main[idx].gastos, ref[idx].gastos),
                'Δ Benefici': pct(main[idx].ingresos - main[idx].gastos, ref[idx].ingresos - ref[idx].gastos)
            };
        });
    }, [filteredData, compareData, compareYears, monthRange, monthLabels]);

    // Acumulat
    const accumulatedChartData = useMemo(() => {
        const main = getMonthlyData(filteredData.invoices, filteredData.expenses, monthRange);
        const cmp = {};
        compareYears.forEach(y => { if (compareData[y]) cmp[y] = getMonthlyData(compareData[y].invoices, compareData[y].expenses, monthRange); });

        const acc = {}; allCompareYears.forEach(y => { acc[y] = { i: 0, g: 0 }; });

        return monthLabels.map((name, idx) => {
            acc[filter.year].i += main[idx].ingresos;
            acc[filter.year].g += main[idx].gastos;
            const row = { name, [`Ingressos ${filter.year}`]: acc[filter.year].i, [`Gastos ${filter.year}`]: acc[filter.year].g };
            compareYears.forEach(y => {
                if (cmp[y]) {
                    acc[y].i += cmp[y][idx].ingresos;
                    acc[y].g += cmp[y][idx].gastos;
                    row[`Ingressos ${y}`] = acc[y].i;
                    row[`Gastos ${y}`] = acc[y].g;
                }
            });
            return row;
        });
    }, [filteredData, compareData, compareYears, filter, allCompareYears, monthRange, monthLabels]);

    // Resum comparatiu (taula)
    const yearSummaries = useMemo(() => {
        return allCompareYears.map((year, idx) => {
            const d = idx === 0 ? filteredData : compareData[year];
            if (!d) return null;
            const targetYear = year;
            const ing = d.invoices.reduce((s, i) => s + getDistributedAmount(i, targetYear, filter.quarter), 0);
            const gas = d.expenses.reduce((s, e) => s + (e.baseImponible || 0), 0);
            const ben = ing - gas;
            const nf = d.invoices.length;
            return { year, ing, gas, ben, margin: ing > 0 ? (ben / ing) * 100 : 0, nf, ng: d.expenses.length, avg: nf > 0 ? ing / nf : 0, isMain: idx === 0 };
        }).filter(Boolean);
    }, [filteredData, compareData, allCompareYears]);

    // Pie charts
    const expensesByCategory = useMemo(() => {
        const c = {};
        filteredData.expenses.forEach(e => { c[e.categoria] = (c[e.categoria] || 0) + e.total; });
        return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7);
    }, [filteredData.expenses]);

    const clientsByRevenue = useMemo(() => {
        const c = {};
        filteredData.invoices.forEach(i => {
            const n = clients.find(cl => cl.id === i.clienteId)?.nombre || 'Desconocido';
            c[n] = (c[n] || 0) + getDistributedAmount(i, filter.year, filter.quarter);
        });
        return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    }, [filteredData.invoices, clients, filter]);

    const taxDeadline = useMemo(() => getTaxDeadlines(filter.year), [filter.year]);

    /* ============================================
       RENDER
       ============================================ */

    return (
        <div className="space-y-6 animate-fadeIn pb-8">
            {/* HEADER */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Panel de Control</h1>
                    <p className="text-slate-400 mt-1 flex items-center gap-2">
                        <Activity size={16} className="text-blue-400" />Visión general de tu actividad económica
                    </p>
                </div>
                <div className="flex items-center flex-wrap gap-3">
                    {/* Filtre Any/Trimestre */}
                    <Card className="flex items-center gap-2 px-3 py-1.5 !bg-slate-900/80 !border-slate-800">
                        <Filter size={14} className="text-slate-400" />
                        <select value={filter.year} onChange={(e) => setFilter({ ...filter, year: parseInt(e.target.value) })} className="bg-transparent text-sm text-white font-medium focus:outline-none cursor-pointer">
                            {years.map(y => <option key={y} value={y} className="bg-slate-800">{y}</option>)}
                        </select>
                        <div className="w-px h-4 bg-slate-700 mx-1"></div>
                        <select value={filter.quarter} onChange={(e) => setFilter({ ...filter, quarter: e.target.value })} className="bg-transparent text-sm text-white font-medium focus:outline-none cursor-pointer">
                            <option value="all" className="bg-slate-800">Todo el año</option>
                            <option value="1" className="bg-slate-800">1º Trimestre</option>
                            <option value="2" className="bg-slate-800">2º Trimestre</option>
                            <option value="3" className="bg-slate-800">3º Trimestre</option>
                            <option value="4" className="bg-slate-800">4º Trimestre</option>
                        </select>
                    </Card>

                    {/* Selector comparació anys */}
                    {years.length > 1 && (
                        <Card className="flex items-center gap-2 px-3 py-1.5 !bg-slate-900/80 !border-slate-800">
                            <GitCompareArrows size={14} className="text-indigo-400" />
                            <span className="text-xs text-slate-400 font-medium">Comparar:</span>
                            <div className="flex gap-1">
                                {years.filter(y => y !== filter.year).map(y => (
                                    <button key={y} onClick={() => toggleCompareYear(y)}
                                        className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${compareYears.includes(y) ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800 border border-transparent'}`}>
                                        {y}
                                    </button>
                                ))}
                            </div>
                        </Card>
                    )}

                    <Button variant="ghost" size="sm" icon={Settings} onClick={() => setShowConfig(true)}>Personalizar</Button>
                </div>
            </div>

            {/* CONFIG MODAL */}
            <Modal open={showConfig} onClose={() => setShowConfig(false)} title="Personalizar Dashboard" size="sm">
                <div className="space-y-4">
                    <p className="text-sm text-slate-400">Selecciona los elementos que quieres ver en tu panel de control.</p>
                    <div className="space-y-3">
                        {[
                            { key: 'showStats', icon: Briefcase, label: 'Resumen Financiero' },
                            { key: 'showMainChart', icon: TrendingUp, label: 'Gráficos de Evolución' },
                            { key: 'showAlerts', icon: AlertCircle, label: 'Alertas y Estado' },
                            { key: 'showDistribution', icon: Wallet, label: 'Distribución de Gastos' },
                            { key: 'showClients', icon: Euro, label: 'Ingresos por Cliente' },
                            { key: 'showRecent', icon: FileText, label: 'Últimas Facturas' },
                        ].map(({ key, icon, label }) => (
                            <label key={key} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 cursor-pointer border border-slate-700/50">
                                <span className="flex items-center gap-2 text-white"><LayoutIcon icon={icon} /> {label}</span>
                                <Toggle checked={dashboardConfig[key]} onChange={() => toggleSection(key)} />
                            </label>
                        ))}
                    </div>
                    <div className="flex justify-end pt-4"><Button onClick={() => setShowConfig(false)}>Listo</Button></div>
                </div>
            </Modal>

            {/* STAT CARDS amb tendència real vs any anterior */}
            {dashboardConfig.showStats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                    <StatCard icon={Euro} label="Ingresos" value={formatCurrency(stats.totalIngresos)}
                        subValue={`Base Imponible · vs ${stats.prevYear}`} color="blue"
                        trend={formatGrowth(stats.growth.ingresos)} trendUp={stats.growth.ingresos >= 0} />
                    <StatCard icon={Wallet} label="Gastos" value={formatCurrency(stats.totalGastos)}
                        subValue={`Deducibles · vs ${stats.prevYear}`} color="red"
                        trend={formatGrowth(stats.growth.gastos)} trendUp={stats.growth.gastos <= 0} />
                    <StatCard icon={Briefcase} label="Beneficio" value={formatCurrency(stats.beneficio)}
                        subValue={`Rendimiento · vs ${stats.prevYear}`} color="emerald"
                        trend={formatGrowth(stats.growth.beneficio)} trendUp={stats.growth.beneficio >= 0} />
                    <StatCard icon={Clock} label="Pendiente" value={formatCurrency(stats.importePendiente)}
                        subValue={`${stats.pendientes} factura${stats.pendientes !== 1 ? 's' : ''} sin cobrar`}
                        color="amber" trend={stats.pendientes.toString()} trendUp={false} />
                </div>
            )}

            {/* GRÀFIC PRINCIPAL + PANEL LATERAL */}
            {/* El grid s'adapta: si el chart principal és visible ocupa 2/3 columnes,
                si no, el panel lateral s'expandeix. Si cap dels dos és visible no renderitza res. */}
            {(dashboardConfig.showMainChart || dashboardConfig.showAlerts || dashboardConfig.showClients || dashboardConfig.showDistribution) && (
            <div className={`grid grid-cols-1 gap-6 lg:gap-8 ${
                dashboardConfig.showMainChart
                    ? 'lg:grid-cols-3'
                    : 'lg:grid-cols-2'
            }`}>
                {dashboardConfig.showMainChart && (
                    <Card className="lg:col-span-2 p-6 flex flex-col relative overflow-hidden" variant="glass"
                        style={{ minHeight: compareYears.length > 0 ? '500px' : '420px' }}>
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                        {/* Capçalera + mode tabs */}
                        <div className="flex items-start justify-between mb-4 relative z-10 gap-4 flex-wrap">
                            <div>
                                <h3 className="text-lg font-bold text-white">Evolución Financiera</h3>
                                <p className="text-slate-400 text-sm">
                                    {filter.year}{compareYears.length > 0 ? ` vs ${compareYears.join(', ')}` : ''}
                                    {filter.quarter !== 'all' ? ` · T${filter.quarter}` : ''}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <ChartModeTab active={chartMode === 'evolution'} icon={TrendingUp} label="Evolución" onClick={() => setChartMode('evolution')} />
                                {compareYears.length > 0 && (
                                    <>
                                        <ChartModeTab active={chartMode === 'compare'} icon={BarChart3} label="Comparar" onClick={() => setChartMode('compare')} />
                                        <ChartModeTab active={chartMode === 'yoy'} icon={ArrowUpRight} label="% YoY" onClick={() => setChartMode('yoy')} />
                                        <ChartModeTab active={chartMode === 'accumulated'} icon={Layers} label="Acumulado" onClick={() => setChartMode('accumulated')} />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Filtre de mètrica */}
                        {compareYears.length > 0 && (chartMode === 'compare' || chartMode === 'evolution') && (
                            <div className="flex gap-1.5 mb-4 relative z-10">
                                {[{ key: 'both', label: 'Todo' }, { key: 'ingresos', label: 'Ingresos' }, { key: 'gastos', label: 'Gastos' }, { key: 'beneficio', label: 'Beneficio' }].map(m => (
                                    <button key={m.key} onClick={() => setCompareMetric(m.key)}
                                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${compareMetric === m.key ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* CHARTS */}
                        <div className="flex-1 w-full min-h-0 relative z-10">
                            <ResponsiveContainer width="100%" height="100%">
                                {/* EVOLUCIÓ sense comparació */}
                                {chartMode === 'evolution' && compareYears.length === 0 ? (
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="ingresos" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorIngresos)" name="Ingresos" activeDot={{ r: 6, strokeWidth: 0, fill: '#60a5fa' }} animationDuration={1500} />
                                        <Area type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorGastos)" name="Gastos" activeDot={{ r: 6, strokeWidth: 0, fill: '#f87171' }} animationDuration={1500} />
                                    </AreaChart>

                                /* EVOLUCIÓ amb comparació (lines) */
                                ) : chartMode === 'evolution' && compareYears.length > 0 ? (
                                    <LineChart data={comparisonChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} />
                                        {allCompareYears.map((year, yIdx) => {
                                            const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                            const main = yIdx === 0;
                                            return (
                                                <React.Fragment key={year}>
                                                    {(compareMetric === 'both' || compareMetric === 'ingresos') && <Line type="monotone" dataKey={`ingresos_${year}`} stroke={c.ingresos} strokeWidth={main ? 3 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.ingresos }} name={`Ingressos ${year}`} animationDuration={1500} />}
                                                    {(compareMetric === 'both' || compareMetric === 'gastos') && <Line type="monotone" dataKey={`gastos_${year}`} stroke={c.gastos} strokeWidth={main ? 3 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.gastos }} name={`Gastos ${year}`} animationDuration={1500} />}
                                                    {compareMetric === 'beneficio' && <Line type="monotone" dataKey={`beneficio_${year}`} stroke={c.benefici} strokeWidth={main ? 3 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.benefici }} name={`Benefici ${year}`} animationDuration={1500} />}
                                                </React.Fragment>
                                            );
                                        })}
                                    </LineChart>

                                /* COMPARAR (barres agrupades) */
                                ) : chartMode === 'compare' ? (
                                    <BarChart data={comparisonChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} />
                                        {allCompareYears.map((year, yIdx) => {
                                            const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                            const main = yIdx === 0;
                                            return (
                                                <React.Fragment key={year}>
                                                    {(compareMetric === 'both' || compareMetric === 'ingresos') && <Bar dataKey={`ingresos_${year}`} fill={c.ingresos} fillOpacity={main ? 0.9 : 0.5} name={`Ingressos ${year}`} radius={[3, 3, 0, 0]} animationDuration={1200} />}
                                                    {(compareMetric === 'both' || compareMetric === 'gastos') && <Bar dataKey={`gastos_${year}`} fill={c.gastos} fillOpacity={main ? 0.9 : 0.5} name={`Gastos ${year}`} radius={[3, 3, 0, 0]} animationDuration={1200} />}
                                                    {compareMetric === 'beneficio' && <Bar dataKey={`beneficio_${year}`} fill={c.benefici} fillOpacity={main ? 0.9 : 0.5} name={`Benefici ${year}`} radius={[3, 3, 0, 0]} animationDuration={1200} />}
                                                </React.Fragment>
                                            );
                                        })}
                                    </BarChart>

                                /* YoY % */
                                ) : chartMode === 'yoy' ? (
                                    <ComposedChart data={yoyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                                        <Tooltip content={<YoYTooltip />} />
                                        <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
                                        <Bar dataKey={'Δ Ingresos'} fill="#3b82f6" fillOpacity={0.7} radius={[3, 3, 0, 0]} name={'Δ Ingresos'} animationDuration={1200} />
                                        <Bar dataKey={'Δ Gastos'} fill="#ef4444" fillOpacity={0.7} radius={[3, 3, 0, 0]} name={'Δ Gastos'} animationDuration={1200} />
                                        <Line type="monotone" dataKey={'Δ Benefici'} stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981', r: 4 }} name={'Δ Benefici'} animationDuration={1500} />
                                    </ComposedChart>

                                /* ACUMULAT */
                                ) : chartMode === 'accumulated' ? (
                                    <AreaChart data={accumulatedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            {allCompareYears.map((year, yIdx) => (
                                                <linearGradient key={year} id={`accIng${year}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={(YEAR_COLORS[yIdx] || YEAR_COLORS[0]).ingresos} stopOpacity={yIdx === 0 ? 0.3 : 0.1} />
                                                    <stop offset="95%" stopColor={(YEAR_COLORS[yIdx] || YEAR_COLORS[0]).ingresos} stopOpacity={0} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} />
                                        {allCompareYears.map((year, yIdx) => {
                                            const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                            const main = yIdx === 0;
                                            return (
                                                <React.Fragment key={year}>
                                                    <Area type="monotone" dataKey={`Ingressos ${year}`} stroke={c.ingresos} strokeWidth={main ? 3 : 2} strokeDasharray={main ? undefined : '6 3'} fillOpacity={1} fill={`url(#accIng${year})`} name={`Ingressos ${year}`} activeDot={{ r: 5, strokeWidth: 0, fill: c.ingresos }} animationDuration={1500} />
                                                    <Area type="monotone" dataKey={`Gastos ${year}`} stroke={c.gastos} strokeWidth={main ? 2 : 1.5} strokeDasharray={main ? '4 2' : '6 3'} fillOpacity={0} name={`Gastos ${year}`} activeDot={{ r: 4, strokeWidth: 0, fill: c.gastos }} animationDuration={1500} />
                                                </React.Fragment>
                                            );
                                        })}
                                    </AreaChart>

                                ) : (
                                    <AreaChart data={chartData}><Area dataKey="ingresos" /></AreaChart>
                                )}
                            </ResponsiveContainer>
                        </div>

                        {/* Llegenda dinàmica */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-800/50 relative z-10">
                            {compareYears.length === 0 ? (
                                <>
                                    <span className="flex items-center gap-1.5 text-xs text-slate-400"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Ingresos</span>
                                    <span className="flex items-center gap-1.5 text-xs text-slate-400"><div className="w-2 h-2 rounded-full bg-red-500"></div> Gastos</span>
                                </>
                            ) : allCompareYears.map((year, yIdx) => {
                                const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                return (
                                    <div key={year} className="flex items-center gap-2">
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${yIdx === 0 ? 'text-white' : 'text-slate-500'}`}>{year}</span>
                                        <span className="flex items-center gap-1 text-xs text-slate-400"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.ingresos }}></div>Ing</span>
                                        <span className="flex items-center gap-1 text-xs text-slate-400"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.gastos }}></div>Gas</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                )}

                {/* PANEL LATERAL:
                    - Quan showMainChart=true → ocupa 1 columna (col 3 del grid 3 cols)
                    - Quan showMainChart=false → mostra els widgets en grid de 2 cols expandit
                    - Només es renderitza si hi ha algun widget lateral visible */}
                {(dashboardConfig.showAlerts || dashboardConfig.showClients || dashboardConfig.showDistribution) && (
                    <div className={`flex flex-col gap-6 ${
                        !dashboardConfig.showMainChart
                            ? 'lg:col-span-2 lg:grid lg:grid-cols-2 lg:items-start'
                            : 'lg:col-span-1'
                    }`}>
                        {dashboardConfig.showAlerts && (
                            <Card className="p-6" variant="gradient">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><AlertCircle size={20} className="text-amber-400" />Estado y Alertas</h3>
                                <div className="space-y-3">
                                    {taxDeadline.next.urgent ? (
                                        <AlertItem condition={true} icon={Bell} color="red" title={`¡URGENTE! ${taxDeadline.next.model}`} desc={`Solo ${taxDeadline.next.daysUntil} días para presentar. Fecha límite: ${taxDeadline.next.label}.`} />
                                    ) : taxDeadline.next.warning ? (
                                        <AlertItem condition={true} icon={Clock} color="amber" title={`Próximo: ${taxDeadline.next.model}`} desc={`${taxDeadline.next.daysUntil} días para presentar (${taxDeadline.next.label}).`} />
                                    ) : (
                                        <AlertItem condition={taxDeadline.next.daysUntil <= 45} icon={Calendar} color="blue"
                                            title={`Próximo trimestre: ${taxDeadline.next.model}`} desc={`${taxDeadline.next.daysUntil} días hasta ${taxDeadline.next.label}.`}
                                            fallback={{ icon: CheckCircle, color: "emerald", title: "Sin cierres inminentes", desc: `Próxima fecha: ${taxDeadline.next.label} (${taxDeadline.next.daysUntil} días).` }} />
                                    )}
                                    {stats.pendientes > 0 && (
                                        <AlertItem condition={true} icon={Wallet} color={stats.pendientes > 3 ? "amber" : "blue"}
                                            title={`${stats.pendientes} factura${stats.pendientes > 1 ? 's' : ''} pendiente${stats.pendientes > 1 ? 's' : ''}`}
                                            desc={`${formatCurrency(stats.importePendiente)} por cobrar.`} />
                                    )}
                                    {!taxDeadline.next.warning && !taxDeadline.next.urgent && stats.pendientes === 0 && (
                                        <AlertItem condition={true} icon={CheckCircle} color="emerald" title="Todo en orden" desc="No hay alertas pendientes. ¡Buen trabajo!" />
                                    )}
                                </div>
                            </Card>
                        )}

                        {dashboardConfig.showClients && (
                            <Card className="p-6 flex-1 flex flex-col min-h-[300px]" variant="default">
                                <h3 className="text-lg font-bold text-white mb-2">Ingresos por Cliente</h3>
                                <div className="flex-1 w-full relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={clientsByRevenue} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                                                {clientsByRevenue.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip content={<CustomTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total</p>
                                        <p className="text-sm font-bold text-white">{formatCurrency(stats.totalIngresos)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-4">
                                    {clientsByRevenue.slice(0, 4).map((e, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                            <span className="text-slate-300 truncate">{e.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {dashboardConfig.showDistribution && (
                            <Card className="p-6 flex-1 flex flex-col min-h-[300px]" variant="default">
                                <h3 className="text-lg font-bold text-white mb-2">Gastos por Categoría</h3>
                                <div className="flex-1 w-full relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={expensesByCategory} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                                                {expensesByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip content={<CustomTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total</p>
                                        <p className="text-sm font-bold text-white">{formatCurrency(stats.totalGastos)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-4">
                                    {expensesByCategory.slice(0, 4).map((e, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                            <span className="text-slate-300 truncate">{e.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </div>
                )}
            </div>
            )}

            {/* TAULA COMPARATIVA MULTI-ANY */}
            {compareYears.length > 0 && (
                <Card className="overflow-hidden border border-slate-800" variant="default">
                    <div className="p-6 border-b border-slate-800/50 bg-slate-900/50">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <GitCompareArrows size={18} className="text-indigo-400" />
                            Comparativa {filter.quarter !== 'all' ? `T${filter.quarter}` : 'Anual'}: {allCompareYears.join(' vs ')}
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-900/50">
                                <tr>
                                    <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Any</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ingressos</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gastos</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Benefici</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Marge</th>
                                    <th className="text-center py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Factures</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Mitja/Fact.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {yearSummaries.map((s, idx) => {
                                    const base = idx > 0 ? yearSummaries[0] : null;
                                    const dIng = base ? calcGrowth(s.ing, base.ing) : null;
                                    const dBen = base ? calcGrowth(s.ben, base.ben) : null;
                                    return (
                                        <tr key={s.year} className={`transition-colors ${s.isMain ? 'bg-blue-500/5' : 'hover:bg-slate-800/30'}`}>
                                            <td className="py-4 px-6">
                                                <span className={`font-bold font-mono ${s.isMain ? 'text-blue-400' : 'text-slate-300'}`}>{s.year}</span>
                                                {s.isMain && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-semibold">ACTUAL</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <span className="text-white font-bold">{formatCurrency(s.ing)}</span>
                                                {dIng !== null && <span className={`ml-2 text-xs font-medium ${dIng < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatGrowth(dIng)}</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right text-slate-300 font-medium">{formatCurrency(s.gas)}</td>
                                            <td className="py-4 px-6 text-right">
                                                <span className={`font-bold ${s.ben >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(s.ben)}</span>
                                                {dBen !== null && <span className={`ml-2 text-xs font-medium ${dBen < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatGrowth(dBen)}</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <span className={`font-mono text-sm font-bold ${s.margin >= 30 ? 'text-emerald-400' : s.margin >= 15 ? 'text-amber-400' : 'text-red-400'}`}>{s.margin.toFixed(1)}%</span>
                                            </td>
                                            <td className="py-4 px-6 text-center text-slate-400 font-mono">{s.nf}</td>
                                            <td className="py-4 px-6 text-right text-slate-300 font-medium">{formatCurrency(s.avg)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* ÚLTIMES FACTURES */}
            {dashboardConfig.showRecent && (
                <Card className="overflow-hidden border border-slate-800" variant="default">
                    <div className="p-6 border-b border-slate-800/50 flex items-center justify-between bg-slate-900/50">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><FileText size={18} className="text-blue-400" /> Últimas Facturas</h3>
                        <Button variant="ghost" size="sm" className="text-xs">Ver todas</Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-900/50">
                                <tr>
                                    <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Número</th>
                                    <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cliente</th>
                                    <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fecha</th>
                                    <th className="text-right py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Importe</th>
                                    <th className="text-center py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {invoices.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5).map(inv => {
                                    const client = clients.find(c => c.id === inv.clienteId);
                                    return (
                                        <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors group">
                                            <td className="py-4 px-6 text-white font-mono text-sm group-hover:text-blue-400 transition-colors">{inv.numero}</td>
                                            <td className="py-4 px-6 text-slate-300 font-medium">{client?.nombre || '-'}</td>
                                            <td className="py-4 px-6 text-slate-400 text-sm">{formatDate(inv.fecha)}</td>
                                            <td className="py-4 px-6 text-right text-white font-bold tracking-tight">{formatCurrency(inv.total)}</td>
                                            <td className="py-4 px-6 text-center"><StatusBadge status={inv.estado} /></td>
                                        </tr>
                                    );
                                })}
                                {invoices.length === 0 && (
                                    <tr><td colSpan={5} className="py-12 text-center text-slate-500">No hay facturas recientes</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};
