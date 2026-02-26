import React, { useState, useMemo, useEffect } from 'react';
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
   TOOLTIPS — paleta càlida
   ============================================ */

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border border-sand-300 p-4 rounded-soft shadow-modal">
                <p className="text-sand-500 text-xs font-semibold mb-2 uppercase tracking-wider">{label}</p>
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center justify-between gap-4 text-sm font-medium mb-1 last:mb-0">
                        <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-sand-700">{entry.name}</span>
                        </div>
                        <span className="text-sand-900 font-mono font-bold">{formatCurrency(entry.value)}</span>
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
            <div className="bg-white border border-sand-300 p-4 rounded-soft shadow-modal min-w-[220px]">
                <p className="text-sand-500 text-xs font-semibold mb-3 uppercase tracking-wider">{label}</p>
                {Object.entries(grouped).map(([year, types]) => (
                    <div key={year} className="mb-2 last:mb-0">
                        <p className="text-sand-400 text-[10px] font-bold uppercase tracking-widest mb-1">{year}</p>
                        {Object.entries(types).map(([type, data]) => (
                            <div key={type} className="flex items-center justify-between gap-4 text-sm font-medium mb-0.5">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
                                    <span className="text-sand-600 text-xs">{type}</span>
                                </div>
                                <span className="text-sand-900 font-mono font-bold text-xs">{formatCurrency(data.value)}</span>
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
            <div className="bg-white border border-sand-300 p-4 rounded-soft shadow-modal">
                <p className="text-sand-500 text-xs font-semibold mb-2 uppercase tracking-wider">{label}</p>
                {payload.map((entry, index) => {
                    const val = entry.value;
                    const pos = val >= 0;
                    return (
                        <div key={index} className="flex items-center justify-between gap-4 text-sm font-medium mb-1 last:mb-0">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="text-sand-700">{entry.name}</span>
                            </div>
                            <span className={`font-mono font-bold ${pos ? 'text-success' : 'text-danger'}`}>
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
   CONSTANTS — paleta terra
   ============================================ */

const YEAR_COLORS = [
    { ingresos: '#C15F3C', gastos: '#9C9A91', benefici: '#2D7A4F' },
    { ingresos: '#D4845F', gastos: '#B0AEA5', benefici: '#3A8F5C' },
    { ingresos: '#A84E30', gastos: '#65635B', benefici: '#1A5C38' },
];
const PIE_COLORS = ['#C15F3C', '#2D7A4F', '#B8860B', '#4A7FB5', '#8B5CF6', '#06b6d4', '#ec4899'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* ============================================
   SMALL COMPONENTS
   ============================================ */

const ChartModeTab = ({ active, icon: Icon, label, onClick }) => (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-button text-xs font-medium transition-colors duration-150 ${active ? 'bg-terra-50 text-terra-400 border border-terra-200' : 'text-sand-500 hover:bg-sand-100 hover:text-sand-700 border border-transparent'}`}>
        <Icon size={13} />{label}
    </button>
);

const Toggle = ({ checked, onChange }) => (
    <div onClick={(e) => { e.preventDefault(); onChange(); }} className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 ${checked ? 'bg-terra-400' : 'bg-sand-300'}`}>
        <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform duration-300 ${checked ? 'translate-x-5' : 'translate-x-0'}`}></div>
    </div>
);

const LayoutIcon = ({ icon: Icon }) => (
    <div className="p-1.5 bg-sand-100 rounded text-sand-500"><Icon size={14} /></div>
);

const AlertItem = ({ condition, icon: Icon, color, title, desc, fallback }) => {
    const cs = {
        amber:   'bg-warning-light border-warning/20 text-warning',
        blue:    'bg-info-light border-info/20 text-info',
        emerald: 'bg-success-light border-success/20 text-success',
        red:     'bg-danger-light border-danger/20 text-danger',
        indigo:  'bg-info-light border-info/20 text-info',
    };
    const render = (I, c, t, d) => {
        const cls = cs[c] || cs.blue;
        const [bg, border, textCls] = cls.split(' ');
        return (
            <div className={`flex gap-3 items-start p-3 rounded-soft border ${bg} ${border}`}>
                <I className={`${textCls} shrink-0 mt-0.5`} size={17} />
                <div>
                    <p className={`${textCls} text-sm font-semibold`}>{t}</p>
                    <p className="text-sand-600 text-xs mt-1">{d}</p>
                </div>
            </div>
        );
    };
    if (condition) return render(Icon, color, title, desc);
    if (fallback) return render(fallback.icon, fallback.color, fallback.title, fallback.desc);
    return null;
};

/* ============================================
   HELPERS
   ============================================ */

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

const getMonthlyData = (yearInvoices, yearExpenses, monthRange) => {
    const monthTotals = {};
    monthRange.forEach(m => { monthTotals[m] = 0; });

    yearInvoices.forEach(inv => {
        const dist = distributeInvoiceByMonth(inv, 'subtotal');
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

    // Dark mode detection — actualitza quan canvia data-theme al <html>
    const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');
    useEffect(() => {
        const obs = new MutationObserver(() =>
            setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
        );
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, []);
    const ct = isDark
        ? { axis: '#6A6860', grid: '#3A3530', cursor: '#5A4A40', tooltipBg: '#2A2420', refLine: '#4A4540' }
        : { axis: '#9C9A91', grid: '#E8E5DD', cursor: '#F4F3EE', tooltipBg: '#ffffff',  refLine: '#D4D0C8' };
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

    const years = useMemo(() => {
        const u = new Set([
            ...invoices.map(i => new Date(i.fecha).getFullYear()),
            ...expenses.map(e => new Date(e.fecha).getFullYear()),
            currentYear
        ]);
        return Array.from(u).sort((a, b) => b - a);
    }, [invoices, expenses, currentYear]);

    const checkDateForYear = (dateStr, year) => {
        const date = new Date(dateStr);
        if (date.getFullYear() !== year) return false;
        if (filter.quarter === 'all') return true;
        return getQuarter(date) === parseInt(filter.quarter);
    };

    const invoiceTouchesYear = (inv, year) => {
        const start = new Date(inv.fecha);
        const end = inv.fechaFin ? new Date(inv.fechaFin) : start;
        const actualEnd = end >= start ? end : start;

        if (filter.quarter === 'all') {
            const periodStart = new Date(year, 0, 1);
            const periodEnd = new Date(year, 11, 31);
            return start <= periodEnd && actualEnd >= periodStart;
        } else {
            const q = parseInt(filter.quarter);
            const periodStart = new Date(year, (q - 1) * 3, 1);
            const periodEnd = new Date(year, q * 3, 0);
            return start <= periodEnd && actualEnd >= periodStart;
        }
    };

    const filteredData = useMemo(() => ({
        invoices: invoices.filter(i => invoiceTouchesYear(i, filter.year) && i.estado !== 'anulada'),
        expenses: expenses.filter(e => checkDateForYear(e.fecha, filter.year))
    }), [invoices, expenses, filter]);

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

    const monthRange = useMemo(() => {
        const start = filter.quarter === 'all' ? 0 : (parseInt(filter.quarter) - 1) * 3;
        const end = filter.quarter === 'all' ? 12 : start + 3;
        return Array.from({ length: end - start }, (_, i) => start + i);
    }, [filter.quarter]);

    const monthLabels = useMemo(() => monthRange.map(i => MONTHS[i]), [monthRange]);

    const chartData = useMemo(() => {
        const main = getMonthlyData(filteredData.invoices, filteredData.expenses, monthRange);
        return monthLabels.map((name, idx) => ({
            name, ingresos: main[idx].ingresos, gastos: main[idx].gastos,
            beneficio: main[idx].ingresos - main[idx].gastos
        }));
    }, [filteredData, monthRange, monthLabels]);

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
                    <h1 className="font-serif text-display text-sand-900">Panel de Control</h1>
                    <p className="text-sand-600 mt-1 flex items-center gap-2 text-sm">
                        <Activity size={15} className="text-terra-400" />Visión general de tu actividad económica
                    </p>
                </div>
                <div className="flex items-center flex-wrap gap-3">
                    {/* Filtre Any/Trimestre */}
                    <div className="bg-white border border-sand-300 rounded-soft flex items-center gap-2 px-3 py-1.5 shadow-card">
                        <Filter size={14} className="text-sand-400" />
                        <select value={filter.year} onChange={(e) => setFilter({ ...filter, year: parseInt(e.target.value) })} className="bg-transparent text-sm text-sand-800 font-medium focus:outline-none cursor-pointer">
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <div className="w-px h-4 bg-sand-300 mx-1"></div>
                        <select value={filter.quarter} onChange={(e) => setFilter({ ...filter, quarter: e.target.value })} className="bg-transparent text-sm text-sand-800 font-medium focus:outline-none cursor-pointer">
                            <option value="all">Todo el año</option>
                            <option value="1">1º Trimestre</option>
                            <option value="2">2º Trimestre</option>
                            <option value="3">3º Trimestre</option>
                            <option value="4">4º Trimestre</option>
                        </select>
                    </div>

                    {/* Selector comparació anys */}
                    {years.length > 1 && (
                        <div className="bg-white border border-sand-300 rounded-soft flex items-center gap-2 px-3 py-1.5 shadow-card">
                            <GitCompareArrows size={14} className="text-info" />
                            <span className="text-xs text-sand-500 font-medium">Comparar:</span>
                            <div className="flex gap-1">
                                {years.filter(y => y !== filter.year).map(y => (
                                    <button key={y} onClick={() => toggleCompareYear(y)}
                                        className={`px-2 py-0.5 rounded-badge text-xs font-bold transition-colors ${compareYears.includes(y) ? 'bg-info-light text-info border border-info/20' : 'text-sand-500 hover:text-sand-700 hover:bg-sand-100 border border-transparent'}`}>
                                        {y}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <Button variant="secondary" size="sm" icon={Settings} onClick={() => setShowConfig(true)}>Personalizar</Button>
                </div>
            </div>

            {/* CONFIG MODAL */}
            <Modal open={showConfig} onClose={() => setShowConfig(false)} title="Personalizar Dashboard" size="sm">
                <div className="space-y-4">
                    <p className="text-sm text-sand-600">Selecciona los elementos que quieres ver en tu panel de control.</p>
                    <div className="space-y-2">
                        {[
                            { key: 'showStats',       icon: Briefcase,    label: 'Resumen Financiero' },
                            { key: 'showMainChart',   icon: TrendingUp,   label: 'Gráficos de Evolución' },
                            { key: 'showAlerts',      icon: AlertCircle,  label: 'Alertas y Estado' },
                            { key: 'showDistribution',icon: Wallet,       label: 'Distribución de Gastos' },
                            { key: 'showClients',     icon: Euro,         label: 'Ingresos por Cliente' },
                            { key: 'showRecent',      icon: FileText,     label: 'Últimas Facturas' },
                        ].map(({ key, icon, label }) => (
                            <label key={key} className="flex items-center justify-between p-3 rounded-soft bg-sand-50 hover:bg-sand-100 cursor-pointer border border-sand-300 transition-colors">
                                <span className="flex items-center gap-2 text-sand-800"><LayoutIcon icon={icon} /> {label}</span>
                                <Toggle checked={dashboardConfig[key]} onChange={() => toggleSection(key)} />
                            </label>
                        ))}
                    </div>
                    <div className="flex justify-end pt-4"><Button onClick={() => setShowConfig(false)}>Listo</Button></div>
                </div>
            </Modal>

            {/* STAT CARDS */}
            {dashboardConfig.showStats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                    <StatCard icon={Euro} label="Ingresos" value={formatCurrency(stats.totalIngresos)}
                        subValue={`Base Imponible · vs ${stats.prevYear}`} color="success"
                        trend={formatGrowth(stats.growth.ingresos)} trendUp={stats.growth.ingresos >= 0} />
                    <StatCard icon={Wallet} label="Gastos" value={formatCurrency(stats.totalGastos)}
                        subValue={`Deducibles · vs ${stats.prevYear}`} color="danger"
                        trend={formatGrowth(stats.growth.gastos)} trendUp={stats.growth.gastos <= 0} />
                    <StatCard icon={Briefcase} label="Beneficio" value={formatCurrency(stats.beneficio)}
                        subValue={`Rendimiento · vs ${stats.prevYear}`} color="terra"
                        trend={formatGrowth(stats.growth.beneficio)} trendUp={stats.growth.beneficio >= 0} />
                    <StatCard icon={Clock} label="Pendiente" value={formatCurrency(stats.importePendiente)}
                        subValue={`${stats.pendientes} factura${stats.pendientes !== 1 ? 's' : ''} sin cobrar`}
                        color="warning" trend={stats.pendientes.toString()} trendUp={false} />
                </div>
            )}

            {/* GRÀFIC PRINCIPAL + PANEL LATERAL */}
            {(dashboardConfig.showMainChart || dashboardConfig.showAlerts || dashboardConfig.showClients || dashboardConfig.showDistribution) && (
            <div className={`grid grid-cols-1 gap-6 lg:gap-8 ${
                dashboardConfig.showMainChart ? 'lg:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2'
            }`}>
                {dashboardConfig.showMainChart && (
                    <Card className="lg:col-span-2 p-6 flex flex-col"
                        style={{ minHeight: compareYears.length > 0 ? '500px' : '420px' }}>

                        {/* Capçalera + mode tabs */}
                        <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
                            <div>
                                <h3 className="font-serif text-subheading text-sand-900">Evolución Financiera</h3>
                                <p className="text-sand-500 text-sm">
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
                            <div className="flex gap-1.5 mb-4">
                                {[{ key: 'both', label: 'Todo' }, { key: 'ingresos', label: 'Ingresos' }, { key: 'gastos', label: 'Gastos' }, { key: 'beneficio', label: 'Beneficio' }].map(m => (
                                    <button key={m.key} onClick={() => setCompareMetric(m.key)}
                                        className={`px-2.5 py-1 rounded-badge text-[11px] font-semibold transition-colors ${compareMetric === m.key ? 'bg-sand-200 text-sand-800' : 'text-sand-400 hover:text-sand-600'}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* CHARTS */}
                        <div className="flex-1 w-full min-h-[280px]">
                            <ResponsiveContainer width="100%" height="100%">
                                {chartMode === 'evolution' && compareYears.length === 0 ? (
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#C15F3C" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#C15F3C" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={ct.axis} stopOpacity={0.25} />
                                                <stop offset="95%" stopColor={ct.axis} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                                        <XAxis dataKey="name" stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#C15F3C', strokeDasharray: '4 4', strokeWidth: 1 }} />
                                        <Area type="monotone" dataKey="ingresos" stroke="#C15F3C" strokeWidth={2.5} fillOpacity={1} fill="url(#colorIngresos)" name="Ingresos" activeDot={{ r: 5, strokeWidth: 0, fill: '#C15F3C' }} animationDuration={1500} />
                                        <Area type="monotone" dataKey="gastos" stroke={ct.axis} strokeWidth={2.5} fillOpacity={1} fill="url(#colorGastos)" name="Gastos" activeDot={{ r: 5, strokeWidth: 0, fill: ct.axis }} animationDuration={1500} />
                                    </AreaChart>

                                ) : chartMode === 'evolution' && compareYears.length > 0 ? (
                                    <LineChart data={comparisonChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                                        <XAxis dataKey="name" stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} cursor={{ stroke: '#C15F3C', strokeDasharray: '4 4', strokeWidth: 1 }} />
                                        {allCompareYears.map((year, yIdx) => {
                                            const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                            const main = yIdx === 0;
                                            return (
                                                <React.Fragment key={year}>
                                                    {(compareMetric === 'both' || compareMetric === 'ingresos') && <Line type="monotone" dataKey={`ingresos_${year}`} stroke={c.ingresos} strokeWidth={main ? 2.5 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.ingresos }} name={`Ingressos ${year}`} animationDuration={1500} />}
                                                    {(compareMetric === 'both' || compareMetric === 'gastos') && <Line type="monotone" dataKey={`gastos_${year}`} stroke={c.gastos} strokeWidth={main ? 2.5 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.gastos }} name={`Gastos ${year}`} animationDuration={1500} />}
                                                    {compareMetric === 'beneficio' && <Line type="monotone" dataKey={`beneficio_${year}`} stroke={c.benefici} strokeWidth={main ? 2.5 : 2} strokeDasharray={main ? undefined : '6 3'} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: c.benefici }} name={`Benefici ${year}`} animationDuration={1500} />}
                                                </React.Fragment>
                                            );
                                        })}
                                    </LineChart>

                                ) : chartMode === 'compare' ? (
                                    <BarChart data={comparisonChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                                        <XAxis dataKey="name" stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} cursor={{ fill: ct.cursor }} />
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

                                ) : chartMode === 'yoy' ? (
                                    <ComposedChart data={yoyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                                        <XAxis dataKey="name" stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                                        <Tooltip content={<YoYTooltip />} />
                                        <ReferenceLine y={0} stroke={ct.refLine} strokeWidth={1.5} />
                                        <Bar dataKey={'Δ Ingresos'} fill="#C15F3C" fillOpacity={0.7} radius={[3, 3, 0, 0]} name={'Δ Ingresos'} animationDuration={1200} />
                                        <Bar dataKey={'Δ Gastos'} fill={ct.axis} fillOpacity={0.7} radius={[3, 3, 0, 0]} name={'Δ Gastos'} animationDuration={1200} />
                                        <Line type="monotone" dataKey={'Δ Benefici'} stroke="#2D7A4F" strokeWidth={2.5} dot={{ fill: '#2D7A4F', r: 4 }} name={'Δ Benefici'} animationDuration={1500} />
                                    </ComposedChart>

                                ) : chartMode === 'accumulated' ? (
                                    <AreaChart data={accumulatedChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            {allCompareYears.map((year, yIdx) => (
                                                <linearGradient key={year} id={`accIng${year}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={(YEAR_COLORS[yIdx] || YEAR_COLORS[0]).ingresos} stopOpacity={yIdx === 0 ? 0.2 : 0.08} />
                                                    <stop offset="95%" stopColor={(YEAR_COLORS[yIdx] || YEAR_COLORS[0]).ingresos} stopOpacity={0} />
                                                </linearGradient>
                                            ))}
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                                        <XAxis dataKey="name" stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                        <YAxis stroke={ct.axis} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                        <Tooltip content={<ComparisonTooltip />} cursor={{ stroke: '#C15F3C', strokeDasharray: '4 4', strokeWidth: 1 }} />
                                        {allCompareYears.map((year, yIdx) => {
                                            const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                            const main = yIdx === 0;
                                            return (
                                                <React.Fragment key={year}>
                                                    <Area type="monotone" dataKey={`Ingressos ${year}`} stroke={c.ingresos} strokeWidth={main ? 2.5 : 2} strokeDasharray={main ? undefined : '6 3'} fillOpacity={1} fill={`url(#accIng${year})`} name={`Ingressos ${year}`} activeDot={{ r: 5, strokeWidth: 0, fill: c.ingresos }} animationDuration={1500} />
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
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-sand-200">
                            {compareYears.length === 0 ? (
                                <>
                                    <span className="flex items-center gap-1.5 text-xs text-sand-500"><div className="w-2 h-2 rounded-full bg-terra-400"></div> Ingresos</span>
                                    <span className="flex items-center gap-1.5 text-xs text-sand-500"><div className="w-2 h-2 rounded-full bg-sand-500"></div> Gastos</span>
                                </>
                            ) : allCompareYears.map((year, yIdx) => {
                                const c = YEAR_COLORS[yIdx] || YEAR_COLORS[0];
                                return (
                                    <div key={year} className="flex items-center gap-2">
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${yIdx === 0 ? 'text-sand-800' : 'text-sand-400'}`}>{year}</span>
                                        <span className="flex items-center gap-1 text-xs text-sand-500"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.ingresos }}></div>Ing</span>
                                        <span className="flex items-center gap-1 text-xs text-sand-500"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.gastos }}></div>Gas</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                )}

                {(dashboardConfig.showAlerts || dashboardConfig.showClients || dashboardConfig.showDistribution) && (
                    <div className={`flex flex-col gap-6 ${
                        !dashboardConfig.showMainChart
                            ? 'lg:col-span-2 lg:grid lg:grid-cols-2 lg:items-start'
                            : 'lg:col-span-1'
                    }`}>
                        {dashboardConfig.showAlerts && (
                            <Card className="p-6">
                                <h3 className="font-serif text-subheading text-sand-900 mb-4 flex items-center gap-2">
                                    <AlertCircle size={18} className="text-warning" />Estado y Alertas
                                </h3>
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
                            <Card className="p-6 flex flex-col min-h-[300px]">
                                <h3 className="font-serif text-subheading text-sand-900 mb-2">Ingresos por Cliente</h3>
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
                                        <p className="text-xs text-sand-500 uppercase font-bold tracking-wider">Total</p>
                                        <p className="text-sm font-bold text-sand-900">{formatCurrency(stats.totalIngresos)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-4">
                                    {clientsByRevenue.slice(0, 4).map((e, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                            <span className="text-sand-600 truncate">{e.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {dashboardConfig.showDistribution && (
                            <Card className="p-6 flex flex-col min-h-[300px]">
                                <h3 className="font-serif text-subheading text-sand-900 mb-2">Gastos por Categoría</h3>
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
                                        <p className="text-xs text-sand-500 uppercase font-bold tracking-wider">Total</p>
                                        <p className="text-sm font-bold text-sand-900">{formatCurrency(stats.totalGastos)}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-4">
                                    {expensesByCategory.slice(0, 4).map((e, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs">
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                            <span className="text-sand-600 truncate">{e.name}</span>
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
                <Card className="overflow-hidden">
                    <div className="px-6 py-4 border-b border-sand-300 bg-sand-50">
                        <h3 className="font-serif text-subheading text-sand-900 flex items-center gap-2">
                            <GitCompareArrows size={17} className="text-info" />
                            Comparativa {filter.quarter !== 'all' ? `T${filter.quarter}` : 'Anual'}: {allCompareYears.join(' vs ')}
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-sand-50 border-b border-sand-300">
                                <tr>
                                    <th className="text-left py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Año</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Ingresos</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Gastos</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Beneficio</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Margen</th>
                                    <th className="text-center py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Facturas</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Media/Fact.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sand-200">
                                {yearSummaries.map((s, idx) => {
                                    const base = idx > 0 ? yearSummaries[0] : null;
                                    const dIng = base ? calcGrowth(s.ing, base.ing) : null;
                                    const dBen = base ? calcGrowth(s.ben, base.ben) : null;
                                    return (
                                        <tr key={s.year} className={`transition-colors ${s.isMain ? 'bg-terra-50' : 'hover:bg-sand-50'}`}>
                                            <td className="py-4 px-6">
                                                <span className={`font-bold font-mono ${s.isMain ? 'text-terra-500' : 'text-sand-700'}`}>{s.year}</span>
                                                {s.isMain && <span className="ml-2 text-[10px] bg-terra-50 text-terra-400 px-1.5 py-0.5 rounded-badge font-semibold border border-terra-200">ACTUAL</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <span className="text-sand-900 font-bold">{formatCurrency(s.ing)}</span>
                                                {dIng !== null && <span className={`ml-2 text-xs font-medium ${dIng < 0 ? 'text-danger' : 'text-success'}`}>{formatGrowth(dIng)}</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right text-sand-600 font-medium">{formatCurrency(s.gas)}</td>
                                            <td className="py-4 px-6 text-right">
                                                <span className={`font-bold ${s.ben >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(s.ben)}</span>
                                                {dBen !== null && <span className={`ml-2 text-xs font-medium ${dBen < 0 ? 'text-danger' : 'text-success'}`}>{formatGrowth(dBen)}</span>}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <span className={`font-mono text-sm font-bold ${s.margin >= 30 ? 'text-success' : s.margin >= 15 ? 'text-warning' : 'text-danger'}`}>{s.margin.toFixed(1)}%</span>
                                            </td>
                                            <td className="py-4 px-6 text-center text-sand-500 font-mono">{s.nf}</td>
                                            <td className="py-4 px-6 text-right text-sand-600 font-medium">{formatCurrency(s.avg)}</td>
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
                <Card className="overflow-hidden">
                    <div className="px-6 py-4 border-b border-sand-300 bg-sand-50 flex items-center justify-between">
                        <h3 className="font-serif text-subheading text-sand-900 flex items-center gap-2">
                            <FileText size={17} className="text-terra-400" /> Últimas Facturas
                        </h3>
                        <Button variant="ghost" size="sm" className="text-xs">Ver todas</Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-sand-50 border-b border-sand-300">
                                <tr>
                                    <th className="text-left py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Número</th>
                                    <th className="text-left py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Cliente</th>
                                    <th className="text-left py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Fecha</th>
                                    <th className="text-right py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Importe</th>
                                    <th className="text-center py-3 px-6 text-xs font-semibold text-sand-500 uppercase tracking-wide">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sand-200">
                                {invoices.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5).map(inv => {
                                    const client = clients.find(c => c.id === inv.clienteId);
                                    return (
                                        <tr key={inv.id} className="hover:bg-sand-50 transition-colors">
                                            <td className="py-3 px-6 text-sand-700 font-mono text-sm">{inv.numero}</td>
                                            <td className="py-3 px-6 text-sand-700 font-medium">{client?.nombre || '-'}</td>
                                            <td className="py-3 px-6 text-sand-500 text-sm">{formatDate(inv.fecha)}</td>
                                            <td className="py-3 px-6 text-right text-sand-900 font-bold tracking-tight">{formatCurrency(inv.total)}</td>
                                            <td className="py-3 px-6 text-center"><StatusBadge status={inv.estado} /></td>
                                        </tr>
                                    );
                                })}
                                {invoices.length === 0 && (
                                    <tr><td colSpan={5} className="py-12 text-center text-sand-400">No hay facturas recientes</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};
