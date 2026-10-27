import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
    Calendar, Users, ClipboardList, Receipt, MapPin,
    AlertTriangle, CheckCircle, CheckCircle2, Clock, ArrowRight,
    UserPlus, Activity, Bell
} from 'lucide-react';
import { Card, StatCard, Button, Badge, EmptyState, StatusBadge } from './UI';
import useStore, { formatCurrency, formatDate, formatDateShort, filterVisibleConsultations } from '../stores/store';
import { RemindersPanel } from './RemindersPanel';
import { ConsultationModal } from './ConsultationModal';
import { ClientModal } from './ClientModal';
import { InvoiceModal } from './InvoiceModal';
import { PlanEditorModal } from './NutritionPlanEditor';
import { useT, useLocale, plural } from '../i18n';

/* ============================================
   CONSTANTS
   ============================================ */

const CONSULTATION_STATUS_DOT = {
    programada:  'bg-wellness-400',
    completada:  'bg-sage-300',
    cancelada:   'bg-danger',
    no_show:     'bg-sage-400',
};

/* ============================================
   HELPERS
   ============================================ */

function getGreeting(nombre, t) {
    const h = new Date().getHours();
    const saludo = h >= 5 && h < 13 ? t.greeting_morning : h < 20 ? t.greeting_afternoon : t.greeting_evening;
    const firstName = nombre ? nombre.split(' ')[0] : '';
    return firstName ? `${saludo}, ${firstName}` : saludo;
}

function getTodayLabel(locale) {
    const raw = new Date().toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getLast6Months(locale) {
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const name = d.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
        result.push({ year: d.getFullYear(), month: d.getMonth(), label: name.charAt(0).toUpperCase() + name.slice(1) });
    }
    return result;
}

function getRelativeDate(dateStr, t) {
    if (!dateStr) return '';
    const now = new Date();
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((today - d) / 86400000);
    if (diffDays === 0) return t.today;
    if (diffDays === 1) return t.yesterday;
    if (diffDays === -1) return t.tomorrow;
    if (diffDays < 0 && diffDays > -7) return t.in_n_days.replace('{n}', -diffDays);
    if (diffDays > 0 && diffDays < 7) return t.n_days_ago.replace('{n}', diffDays);
    return formatDateShort(dateStr);
}

/* ============================================
   CUSTOM TOOLTIP (warm palette)
   ============================================ */

const ChartTooltip = ({ active, payload, label, formatter }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-sage-300 px-3 py-2.5 rounded-soft shadow-modal">
            <p className="text-sage-500 text-xs font-semibold mb-1.5 uppercase tracking-wider">{label}</p>
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-medium">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="text-sage-700">{entry.name}:</span>
                    <span className="text-sage-900 tabular-nums font-bold ml-auto pl-3">
                        {formatter ? formatter(entry.value, entry.name) : entry.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

/* ============================================
   SECTION: HEADER
   ============================================ */

const DashboardHeader = ({ nombre, onCreate }) => {
    const t = useT();
    const locale = useLocale();
    return (
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
                <h1 className="font-serif text-display text-sage-900">{getGreeting(nombre, t)}</h1>
                <p className="text-sage-500 mt-1 flex items-center gap-2 text-sm">
                    <Activity size={14} className="text-wellness-400 shrink-0" />
                    {getTodayLabel(locale)}
                </p>
            </div>
            {/* Quick actions open the creation form directly */}
            <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Calendar} onClick={() => onCreate('consultation')}>{t.new_consultation}</Button>
                <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => onCreate('client')}>{t.new_client}</Button>
                <Button size="sm" variant="secondary" icon={ClipboardList} onClick={() => onCreate('plan')}>{t.new_plan}</Button>
                <Button size="sm" variant="secondary" icon={Receipt} onClick={() => onCreate('invoice')}>{t.new_invoice}</Button>
            </div>
        </div>
    );
};

/* ============================================
   SECTION: QUICK STATS
   ============================================ */

const QuickStatsRow = ({ todayConsultations, activeClients, activePlans, expiringCount, pendingTotal, pendingCount, newClientsThisMonth, newClientsPrev }) => {
    const t = useT();
    const nextConsultation = todayConsultations.find(c => c.estado === 'programada');
    const clientTrend = newClientsPrev > 0
        ? t.dashboard_new_this_month.replace('{n}', `${newClientsThisMonth >= newClientsPrev ? '+' : ''}${newClientsThisMonth - newClientsPrev}`)
        : newClientsThisMonth > 0 ? t.dashboard_new_this_month.replace('{n}', `+${newClientsThisMonth}`) : null;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                icon={Calendar}
                label={t.dashboard_consultations_today}
                value={todayConsultations.length.toString()}
                subValue={nextConsultation ? t.dashboard_next_at.replace('{time}', nextConsultation.hora || '—') : todayConsultations.length ? t.dashboard_all_completed : t.dashboard_no_consultations_today}
                color="wellness"
            />
            <StatCard
                icon={Users}
                label={t.active_clients}
                value={activeClients.toString()}
                subValue={clientTrend || t.dashboard_no_new_clients}
                trend={newClientsThisMonth > 0 ? `+${newClientsThisMonth}` : null}
                trendUp={true}
                color="success"
            />
            <StatCard
                icon={ClipboardList}
                label={t.active_plans}
                value={activePlans.toString()}
                subValue={expiringCount > 0 ? t.dashboard_expiring_week.replace('{n}', expiringCount) : t.dashboard_none_expiring}
                color="info"
            />
            <StatCard
                icon={Receipt}
                label={t.dashboard_pending_payment}
                value={formatCurrency(pendingTotal)}
                subValue={plural(t, 'dashboard_pending_invoices', pendingCount)}
                color="warning"
            />
        </div>
    );
};

/* ============================================
   SECTION: TODAY AGENDA
   ============================================ */

const TodayAgenda = ({ consultations, clients, locations, onNavigate }) => {
    const t = useT();
    const clientsById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
    const locationsById = useMemo(
        () => new Map((locations || []).map(l => [l.id, l])),
        [locations]
    );

    return (
        <Card className="p-6 h-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
                    <Calendar size={17} className="text-wellness-400" />
                    {t.dashboard_today_agenda}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('agenda')}>
                    {t.dashboard_view_agenda} <ArrowRight size={13} />
                </Button>
            </div>

            {consultations.length === 0 ? (
                <EmptyState
                    icon={Calendar}
                    title={t.dashboard_no_consultations_today}
                    description={t.no_appointments_today}
                    action={{ label: t.dashboard_go_to_agenda, onClick: () => onNavigate('agenda') }}
                />
            ) : (
                <div className="space-y-0 divide-y divide-sage-100">
                    {consultations.map(c => {
                        const client = clientsById.get(c.clienteId);
                        const location = locationsById.get(c.locationId);
                        const dotColor = CONSULTATION_STATUS_DOT[c.estado] || 'bg-sage-300';
                        return (
                            <div key={c.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                                <span className="tabular-nums text-sm text-sage-900 font-semibold w-14 shrink-0">
                                    {c.hora || '—'}
                                </span>
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-sage-900 truncate">
                                        {client?.nombre || t.unknown_client}
                                    </p>
                                    <p className="text-xs text-sage-500 truncate">
                                        {c.tipo || t.consultation_default}
                                        {location && (
                                            <span className="ml-2 inline-flex items-center gap-0.5 text-sage-400">
                                                <MapPin size={10} />
                                                {location.nombre || location.name}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <Badge
                                    tone={{ completada: 'neutral', cancelada: 'danger', no_show: 'neutral' }[c.estado] || 'primary'}
                                    icon={c.estado === 'completada' ? CheckCircle : undefined}
                                    className="shrink-0"
                                >
                                    {c.estado === 'programada' ? t.status_pending :
                                     c.estado === 'completada' ? t.status_completed :
                                     c.estado === 'cancelada'  ? t.status_cancelled : t.status_no_show}
                                </Badge>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
};

/* ============================================
   SECTION: ALERTS PANEL
   ============================================ */

const AlertsPanel = ({ followUps, expiringPlans, unbilledCount, upcomingCount, pendingConfirm, pendingReview, onNavigate }) => {
    const t = useT();
    const alerts = [
        pendingConfirm > 0 && {
            icon: CheckCircle2,
            color: 'info',
            title: plural(t, 'dashboard_alert_confirm', pendingConfirm),
            desc: t.dashboard_alert_pending_confirm_desc,
            action: () => onNavigate('inbox'),
        },
        pendingReview > 0 && {
            icon: UserPlus,
            color: 'orange',
            title: plural(t, 'dashboard_alert_review', pendingReview),
            desc: t.dashboard_alert_review_desc,
            action: () => onNavigate('inbox'),
        },
        followUps.length > 0 && {
            icon: AlertTriangle,
            color: 'warning',
            title: plural(t, 'dashboard_alert_followup', followUps.length),
            desc: t.pending_followups_desc,
            action: () => onNavigate('clients'),
        },
        expiringPlans.length > 0 && {
            icon: ClipboardList,
            color: 'danger',
            title: plural(t, 'dashboard_alert_expiring', expiringPlans.length),
            desc: t.expiring_plans_desc,
            action: () => onNavigate('plans'),
        },
        unbilledCount > 0 && {
            icon: Receipt,
            color: 'amber',
            title: plural(t, 'dashboard_alert_unbilled', unbilledCount),
            desc: t.dashboard_alert_unbilled_desc,
            action: () => onNavigate('invoices'),
        },
        upcomingCount > 0 && {
            icon: Calendar,
            color: 'info',
            title: plural(t, 'dashboard_alert_upcoming', upcomingCount),
            desc: t.upcoming_week,
            action: () => onNavigate('agenda'),
        },
    ].filter(Boolean);

    const colorMap = {
        orange:  { bg: 'bg-terra-50',     border: 'border-terra-200', text: 'text-terra-500' },
        warning: { bg: 'bg-warning-light', border: 'border-warning/20', text: 'text-warning' },
        danger:  { bg: 'bg-danger-light',  border: 'border-danger/20',  text: 'text-danger'  },
        amber:   { bg: 'bg-warning-light', border: 'border-warning/20', text: 'text-warning' },
        info:    { bg: 'bg-info-light',    border: 'border-info/20',    text: 'text-info'    },
    };

    return (
        <Card className="p-6 h-full">
            <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2 mb-4">
                <Bell size={17} className="text-warning" />
                {t.dashboard_attention}
            </h2>

            {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 bg-success-light rounded-full flex items-center justify-center mb-3">
                        <CheckCircle size={24} className="text-success" />
                    </div>
                    <p className="text-sm font-medium text-sage-700">{t.dashboard_all_clear}</p>
                    <p className="text-xs text-sage-500 mt-1">{t.dashboard_all_clear_desc}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {alerts.map((alert, i) => {
                        const c = colorMap[alert.color] || colorMap.info;
                        return (
                            <button
                                key={i}
                                onClick={alert.action}
                                className={`w-full flex gap-3 items-start p-3 rounded-soft border ${c.bg} ${c.border} hover:opacity-80 transition-opacity text-left`}
                            >
                                <alert.icon className={`${c.text} shrink-0 mt-0.5`} size={16} />
                                <div className="min-w-0 flex-1">
                                    <p className={`${c.text} text-sm font-semibold`}>{alert.title}</p>
                                    <p className="text-sage-600 text-xs mt-0.5">{alert.desc}</p>
                                </div>
                                <ArrowRight size={14} className={`${c.text} shrink-0 mt-0.5`} />
                            </button>
                        );
                    })}
                </div>
            )}
        </Card>
    );
};

/* ============================================
   SECTION: ACTIVITY CHARTS
   ============================================ */

const ActivityCharts = ({ consultationsChart, clientsChart, revenueChart, isDark }) => {
    const t = useT();
    const axisColor = isDark ? '#6A6860' : '#9C9A91';
    const gridColor = isDark ? '#3A3530' : '#E8E5DD';

    const axisProps = {
        stroke: axisColor,
        fontSize: 12,
        tickLine: false,
        axisLine: false,
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Consultas por mes */}
            <Card className="p-6">
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">{t.consultations_title}</h3>
                <p className="text-sage-500 text-xs mb-4">{t.dashboard_last_6_months}</p>
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={consultationsChart} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip formatter={(v) => v} />} cursor={{ fill: isDark ? '#2A2520' : '#F4F3EE' }} />
                        <Bar dataKey="value" name={t.consultations_title} fill="#C15F3C" radius={[4, 4, 0, 0]} animationDuration={600} />
                    </BarChart>
                </ResponsiveContainer>
            </Card>

            {/* Nuevos clientes */}
            <Card className="p-6">
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">{t.dashboard_new_clients}</h3>
                <p className="text-sage-500 text-xs mb-4">{t.dashboard_last_6_months}</p>
                <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={clientsChart} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorClients" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3A6591" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#3A6591" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip formatter={(v) => v} />} cursor={{ stroke: '#3A6591', strokeDasharray: '4 4', strokeWidth: 1 }} />
                        <Area type="monotone" dataKey="value" name={t.nav_clients} stroke="#3A6591" strokeWidth={2.5} fill="url(#colorClients)" activeDot={{ r: 4, strokeWidth: 0, fill: '#3A6591' }} animationDuration={600} />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            {/* Ingresos */}
            <Card className="p-6">
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">{t.dashboard_revenue_collected}</h3>
                <p className="text-sage-500 text-xs mb-4">{t.dashboard_last_6_months}</p>
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={revenueChart} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip content={<ChartTooltip formatter={(v) => formatCurrency(v)} />} cursor={{ fill: isDark ? '#2A2520' : '#F4F3EE' }} />
                        <Bar dataKey="value" name={t.dashboard_revenue} fill="#3E6B52" radius={[4, 4, 0, 0]} animationDuration={600} />
                    </BarChart>
                </ResponsiveContainer>
            </Card>
        </div>
    );
};

/* ============================================
   SECTION: RECENT INVOICES
   ============================================ */

const RecentInvoices = ({ invoices, clients, onNavigate }) => {
    const t = useT();
    const clientsById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
    const recent = [...invoices]
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
        .slice(0, 5);

    return (
        <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-sage-200 bg-sage-50 flex items-center justify-between">
                <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
                    <Receipt size={17} className="text-wellness-400" />
                    {t.dashboard_recent_invoices}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('invoices')}>
                    {t.view_all} <ArrowRight size={13} />
                </Button>
            </div>

            {recent.length === 0 ? (
                <div className="px-6">
                    <EmptyState
                        icon={Receipt}
                        title={t.dashboard_no_invoices}
                        description={t.dashboard_no_invoices_desc}
                        action={{ label: t.dashboard_go_to_invoices, onClick: () => onNavigate('invoices') }}
                    />
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-sage-50 border-b border-sage-200">
                            <tr>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">{t.invoice_number}</th>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">{t.invoice_client}</th>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">{t.invoice_date}</th>
                                <th className="text-right py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">{t.invoice_amount}</th>
                                <th className="text-center py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">{t.invoice_status}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sage-100">
                            {recent.map(inv => {
                                const client = clientsById.get(inv.clienteId);
                                return (
                                    <tr key={inv.id} className="hover:bg-sage-50 transition-colors">
                                        <td className="py-3 px-6 font-mono text-sm text-sage-700 whitespace-nowrap">{inv.numero}</td>
                                        <td className="py-3 px-6 text-sm font-medium text-sage-800">{client?.nombre || '—'}</td>
                                        <td className="py-3 px-6 text-sm text-sage-500">{formatDate(inv.fecha)}</td>
                                        <td className="py-3 px-6 text-right tabular-nums font-bold text-sage-900">{formatCurrency(inv.total)}</td>
                                        <td className="py-3 px-6 text-center">
                                            <StatusBadge status={inv.estado === 'pendiente' ? 'emitida' : inv.estado} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </Card>
    );
};

/* ============================================
   SECTION: RECENT ACTIVITY FEED
   ============================================ */

const RecentActivityFeed = ({ clients, consultations, nutritionPlans, invoices }) => {
    const t = useT();
    const items = useMemo(() => {
        const all = [];

        clients.slice().sort((a, b) => (b.fechaAlta || '').localeCompare(a.fechaAlta || '')).slice(0, 5).forEach(c => {
            if (c.fechaAlta) all.push({ date: c.fechaAlta, icon: UserPlus, color: 'success', text: t.activity_new_client.replace('{name}', c.nombre) });
        });

        const completedConsultations = consultations
            .filter(c => c.estado === 'completada')
            .slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 5);
        completedConsultations.forEach(c => {
            if (c.fecha) all.push({ date: c.fecha, icon: Calendar, color: 'wellness', text: t.activity_consultation_completed.replace('{type}', c.tipo || t.consultation_default) });
        });

        nutritionPlans.slice().sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || '')).slice(0, 4).forEach(p => {
            if (p.fechaInicio) all.push({ date: p.fechaInicio, icon: ClipboardList, color: 'info', text: t.activity_plan_created.replace('{name}', p.nombre) });
        });

        invoices.filter(i => i.estado === 'pagada').slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 4).forEach(inv => {
            if (inv.fecha) all.push({ date: inv.fecha, icon: Receipt, color: 'warning', text: t.activity_invoice_paid.replace('{number}', inv.numero).replace('{amount}', formatCurrency(inv.total)) });
        });

        return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    }, [clients, consultations, nutritionPlans, invoices, t]);

    const iconColorMap = {
        success:  { bg: 'bg-success-light',  text: 'text-success'  },
        wellness: { bg: 'bg-wellness-50',     text: 'text-wellness-400' },
        info:     { bg: 'bg-info-light',      text: 'text-info'     },
        warning:  { bg: 'bg-warning-light',   text: 'text-warning'  },
    };

    return (
        <Card className="p-6">
            <h2 className="font-serif text-subheading text-sage-900 mb-4 flex items-center gap-2">
                <Clock size={17} className="text-sage-500" />
                {t.dashboard_recent_activity}
            </h2>

            {items.length === 0 ? (
                <EmptyState
                    icon={Activity}
                    title={t.dashboard_no_activity}
                    description={t.dashboard_no_activity_desc}
                />
            ) : (
                <div className="space-y-3">
                    {items.map((item, i) => {
                        const c = iconColorMap[item.color] || iconColorMap.info;
                        return (
                            <div key={i} className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full ${c.bg} flex items-center justify-center shrink-0`}>
                                    <item.icon size={14} className={c.text} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-sage-800 truncate">{item.text}</p>
                                </div>
                                <span className="text-xs text-sage-400 shrink-0">{getRelativeDate(item.date, t)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
};

/* ============================================
   MAIN DASHBOARD COMPONENT
   ============================================ */

export const Dashboard = () => {
    const clients        = useStore(s => s.clients);
    const allConsultations = useStore(s => s.consultations);
    const nutritionPlans = useStore(s => s.nutritionPlans);
    const invoices       = useStore(s => s.invoices);
    const config         = useStore(s => s.config);
    const patientSuggestions = useStore(s => s.patientSuggestions);
    const consultations  = useMemo(
      () => filterVisibleConsultations(allConsultations, config.googleCalendar),
      [allConsultations, config.googleCalendar]
    );
    const pendingConfirm = useMemo(
      () => (patientSuggestions || []).filter(sg => sg.status === 'pending-confirm').length,
      [patientSuggestions]
    );
    const pendingReview = useMemo(
      () => (patientSuggestions || []).filter(sg => sg.status === 'pending').length,
      [patientSuggestions]
    );
    const setCurrentView = useStore(s => s.setCurrentView);
    const locale = useLocale();
    const [creating, setCreating] = useState(null); // 'consultation' | 'client' | 'plan' | 'invoice'
    const closeCreate = () => setCreating(null);
    const getTodayConsultations   = useStore(s => s.getTodayConsultations);
    const getUpcomingConsultations = useStore(s => s.getUpcomingConsultations);
    const getPendingFollowUps     = useStore(s => s.getPendingFollowUps);
    const getExpiringPlans        = useStore(s => s.getExpiringPlans);

    // Dark mode detection
    const [isDark, setIsDark] = useState(() =>
        document.documentElement.getAttribute('data-theme') === 'dark'
    );
    useEffect(() => {
        const obs = new MutationObserver(() =>
            setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
        );
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, []);

    // Today's consultations
    const todayConsultations = useMemo(() => getTodayConsultations(), [consultations]);

    // Upcoming this week
    const upcoming = useMemo(() => getUpcomingConsultations(7), [consultations]);

    // Follow-ups needed
    const followUps = useMemo(() => getPendingFollowUps(30), [clients, consultations]);

    // Expiring plans
    const expiringPlans = useMemo(() => getExpiringPlans(7), [nutritionPlans]);

    // Active clients
    const activeClients = useMemo(() =>
        clients.filter(c => c.estado === 'activo').length
    , [clients]);

    // Active plans
    const activePlans = useMemo(() =>
        nutritionPlans.filter(p => p.estado === 'activo').length
    , [nutritionPlans]);

    // Pending invoices
    const { pendingTotal, pendingCount } = useMemo(() => {
        const pending = invoices.filter(i => i.estado === 'pendiente');
        return {
            pendingTotal: pending.reduce((s, i) => s + (i.total || i.importe || 0), 0),
            pendingCount: pending.length,
        };
    }, [invoices]);

    // New clients this month vs previous
    const { newClientsThisMonth, newClientsPrev } = useMemo(() => {
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        return {
            newClientsThisMonth: clients.filter(c => c.fechaAlta?.startsWith(thisMonth)).length,
            newClientsPrev:      clients.filter(c => c.fechaAlta?.startsWith(prevMonth)).length,
        };
    }, [clients]);

    // Unbilled consultations (exclude pending-confirm — not yet assigned to a client)
    const unbilledCount = useMemo(() => {
        const billedIds = new Set(
            invoices.flatMap(inv => (inv.items || []).map(item => item.consultationId).filter(Boolean))
        );
        return consultations.filter(c =>
          c.estado === 'completada' &&
          !billedIds.has(c.id) &&
          c.matchStatus !== 'auto-pending-review'
        ).length;
    }, [consultations, invoices]);

    // Last 6 months data for charts
    const last6 = useMemo(() => getLast6Months(locale), [locale]);

    const consultationsChart = useMemo(() =>
        last6.map(({ year, month, label }) => ({
            label,
            value: consultations.filter(c =>
                c.estado !== 'cancelada' &&
                new Date(c.fecha + 'T00:00:00').getFullYear() === year &&
                new Date(c.fecha + 'T00:00:00').getMonth() === month
            ).length,
        }))
    , [consultations, last6]);

    const clientsChart = useMemo(() =>
        last6.map(({ year, month, label }) => ({
            label,
            value: clients.filter(c => {
                if (!c.fechaAlta) return false;
                const d = new Date(c.fechaAlta + 'T00:00:00');
                return d.getFullYear() === year && d.getMonth() === month;
            }).length,
        }))
    , [clients, last6]);

    const revenueChart = useMemo(() =>
        last6.map(({ year, month, label }) => {
            const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
            const total = invoices
                .filter(i => i.estado === 'pagada' && i.fecha?.startsWith(prefix))
                .reduce((s, i) => s + (i.total || i.importe || 0), 0);
            return { label, value: total };
        })
    , [invoices, last6]);

    const locations = config?.locations || [];

    return (
        <div className="space-y-6 animate-fadeIn pb-8">
            <DashboardHeader nombre={config?.nombre} onCreate={setCreating} />

            <QuickStatsRow
                todayConsultations={todayConsultations}
                activeClients={activeClients}
                activePlans={activePlans}
                expiringCount={expiringPlans.length}
                pendingTotal={pendingTotal}
                pendingCount={pendingCount}
                newClientsThisMonth={newClientsThisMonth}
                newClientsPrev={newClientsPrev}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <TodayAgenda
                        consultations={todayConsultations}
                        clients={clients}
                        locations={locations}
                        onNavigate={setCurrentView}
                    />
                </div>
                <div>
                    <AlertsPanel
                        followUps={followUps}
                        expiringPlans={expiringPlans}
                        unbilledCount={unbilledCount}
                        upcomingCount={upcoming.length}
                        pendingConfirm={pendingConfirm}
                        pendingReview={pendingReview}
                        onNavigate={setCurrentView}
                    />
                </div>
            </div>

            <RemindersPanel onNavigate={setCurrentView} />

            <ActivityCharts
                consultationsChart={consultationsChart}
                clientsChart={clientsChart}
                revenueChart={revenueChart}
                isDark={isDark}
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2">
                    <RecentInvoices
                        invoices={invoices}
                        clients={clients}
                        onNavigate={setCurrentView}
                    />
                </div>
                <RecentActivityFeed
                    clients={clients}
                    consultations={consultations}
                    nutritionPlans={nutritionPlans}
                    invoices={invoices}
                />
            </div>

            {creating === 'consultation' && <ConsultationModal onClose={closeCreate} />}
            {creating === 'client' && <ClientModal onClose={closeCreate} />}
            {creating === 'plan' && <PlanEditorModal onClose={closeCreate} />}
            {creating === 'invoice' && <InvoiceModal onClose={closeCreate} />}
        </div>
    );
};
