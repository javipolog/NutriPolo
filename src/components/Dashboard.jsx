import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
    Calendar, Users, ClipboardList, Receipt, MapPin,
    AlertTriangle, CheckCircle, CheckCircle2, Clock, ArrowRight,
    UserPlus, Activity, Bell, TrendingUp, MessageCircle
} from 'lucide-react';
import { Card, StatCard, Button, EmptyState, StatusBadge, useToast } from './UI';
import useStore, { formatCurrency, formatDate, formatDateShort, todayISO, filterVisibleConsultations } from '../stores/store';
import { useT } from '../i18n';
import { openWhatsAppReminder } from '../services/whatsappService';

/* ============================================
   CONSTANTS
   ============================================ */

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const CONSULTATION_STATUS_DOT = {
    programada:  'bg-wellness-400',
    completada:  'bg-success',
    cancelada:   'bg-danger',
    no_asistio:  'bg-sage-400',
};

/* ============================================
   HELPERS
   ============================================ */

function getGreeting(nombre) {
    const h = new Date().getHours();
    const saludo = h >= 5 && h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const firstName = nombre ? nombre.split(' ')[0] : '';
    return firstName ? `${saludo}, ${firstName}` : saludo;
}

function getTodayLabel() {
    const raw = new Date().toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getLast6Months() {
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        result.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()] });
    }
    return result;
}

function getRelativeDate(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const d = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;
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
                    <span className="text-sage-900 font-mono font-bold ml-auto pl-3">
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

const DashboardHeader = ({ nombre }) => (
    <div>
        <h1 className="font-serif text-display text-sage-900">{getGreeting(nombre)}</h1>
        <p className="text-sage-500 mt-1 flex items-center gap-2 text-sm">
            <Activity size={14} className="text-wellness-400 shrink-0" />
            {getTodayLabel()}
        </p>
    </div>
);

/* ============================================
   SECTION: QUICK STATS
   ============================================ */

const QuickStatsRow = ({ todayConsultations, activeClients, activePlans, expiringCount, pendingTotal, pendingCount, newClientsThisMonth, newClientsPrev }) => {
    const nextConsultation = todayConsultations.find(c => c.estado === 'programada');
    const clientTrend = newClientsPrev > 0
        ? `${newClientsThisMonth >= newClientsPrev ? '+' : ''}${newClientsThisMonth - newClientsPrev} este mes`
        : newClientsThisMonth > 0 ? `+${newClientsThisMonth} este mes` : null;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                icon={Calendar}
                label="Consultas hoy"
                value={todayConsultations.length.toString()}
                subValue={nextConsultation ? `Próxima: ${nextConsultation.hora || '—'}` : todayConsultations.length ? 'Todas completadas' : 'Sin consultas hoy'}
                color="wellness"
            />
            <StatCard
                icon={Users}
                label="Clientes activos"
                value={activeClients.toString()}
                subValue={clientTrend || 'Sin altas este mes'}
                trend={newClientsThisMonth > 0 ? `+${newClientsThisMonth}` : null}
                trendUp={true}
                color="success"
            />
            <StatCard
                icon={ClipboardList}
                label="Planes activos"
                value={activePlans.toString()}
                subValue={expiringCount > 0 ? `${expiringCount} por vencer esta semana` : 'Ninguno por vencer'}
                color="info"
            />
            <StatCard
                icon={Receipt}
                label="Pendiente de cobro"
                value={formatCurrency(pendingTotal)}
                subValue={`${pendingCount} factura${pendingCount !== 1 ? 's' : ''} pendiente${pendingCount !== 1 ? 's' : ''}`}
                color="warning"
            />
        </div>
    );
};

/* ============================================
   SECTION: TODAY AGENDA
   ============================================ */

const TodayAgenda = ({ consultations, clients, locations, onNavigate }) => {
    const config = useStore(s => s.config);
    const updateConsultation = useStore(s => s.updateConsultation);
    const t = useT();
    const toast = useToast();

    const locationName = (id) => config.locations?.find(l => l.id === id)?.name || id || '';

    const handleWhatsAppReminder = (consultation, client) => {
        const result = openWhatsAppReminder({ client, consultation, config, locationName });
        if (result.error === 'no_phone') { toast.error(t.whatsapp_no_phone); return; }
        if (result.success) {
            updateConsultation(consultation.id, { lastWhatsappReminder: new Date().toISOString() });
            toast.success(t.whatsapp_reminder_sent);
        }
    };

    return (
        <Card className="p-6 h-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
                    <Calendar size={17} className="text-wellness-400" />
                    Agenda de hoy
                </h2>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('agenda')}>
                    Ver agenda <ArrowRight size={13} />
                </Button>
            </div>

            {consultations.length === 0 ? (
                <EmptyState
                    icon={Calendar}
                    title="Sin consultas hoy"
                    description="No tienes consultas programadas para hoy"
                    action={{ label: 'Ir a agenda', onClick: () => onNavigate('agenda') }}
                />
            ) : (
                <div className="space-y-0 divide-y divide-sage-100">
                    {consultations.map(c => {
                        const client = clients.find(cl => cl.id === c.clienteId);
                        const location = locations?.find(l => l.id === c.localizacion);
                        const dotColor = CONSULTATION_STATUS_DOT[c.estado] || 'bg-sage-300';
                        return (
                            <div key={c.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                                <span className="font-mono text-sm text-sage-900 font-semibold w-14 shrink-0">
                                    {c.hora || '—'}
                                </span>
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-sage-900 truncate">
                                        {client?.nombre || 'Cliente desconocido'}
                                    </p>
                                    <p className="text-xs text-sage-500 truncate">
                                        {c.tipo || 'Consulta'}
                                        {location && (
                                            <span className="ml-2 inline-flex items-center gap-0.5 text-sage-400">
                                                <MapPin size={10} />
                                                {location.nombre || location.name}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                {c.estado === 'programada' && client && (
                                    <button
                                        onClick={() => handleWhatsAppReminder(c, client)}
                                        title={t.whatsapp_reminder}
                                        className="p-1.5 rounded-button text-sage-400 hover:text-success hover:bg-success-light transition-colors shrink-0"
                                    >
                                        <MessageCircle size={14} className={c.lastWhatsappReminder ? 'text-success' : ''} />
                                    </button>
                                )}
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-badge shrink-0 ${
                                    c.estado === 'completada' ? 'bg-success-light text-success' :
                                    c.estado === 'cancelada'  ? 'bg-danger-light text-danger' :
                                    c.estado === 'no_asistio' ? 'bg-sage-100 text-sage-500' :
                                    'bg-wellness-50 text-wellness-500'
                                }`}>
                                    {c.estado === 'programada' ? 'Pendiente' :
                                     c.estado === 'completada' ? 'Completada' :
                                     c.estado === 'cancelada'  ? 'Cancelada' : 'No asistió'}
                                </span>
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
    const alerts = [
        pendingConfirm > 0 && {
            icon: CheckCircle2,
            color: 'info',
            title: `${pendingConfirm} coincidencia${pendingConfirm !== 1 ? 's' : ''} por confirmar`,
            desc: 'Pacientes detectados automáticamente — aprueba con un clic',
            action: () => onNavigate('inbox'),
        },
        pendingReview > 0 && {
            icon: UserPlus,
            color: 'orange',
            title: `${pendingReview} paciente${pendingReview !== 1 ? 's' : ''} por identificar`,
            desc: 'Detectados en la clínica externa — vincúlalos o crea sus fichas',
            action: () => onNavigate('inbox'),
        },
        followUps.length > 0 && {
            icon: AlertTriangle,
            color: 'warning',
            title: `${followUps.length} cliente${followUps.length !== 1 ? 's' : ''} sin seguimiento`,
            desc: 'Sin consulta en los últimos 30 días',
            action: () => onNavigate('clients'),
        },
        expiringPlans.length > 0 && {
            icon: ClipboardList,
            color: 'danger',
            title: `${expiringPlans.length} plan${expiringPlans.length !== 1 ? 'es' : ''} por vencer`,
            desc: 'Vencen en los próximos 7 días',
            action: () => onNavigate('plans'),
        },
        unbilledCount > 0 && {
            icon: Receipt,
            color: 'amber',
            title: `${unbilledCount} consulta${unbilledCount !== 1 ? 's' : ''} sin facturar`,
            desc: 'Consultas completadas pendientes de factura',
            action: () => onNavigate('invoices'),
        },
        upcomingCount > 0 && {
            icon: Calendar,
            color: 'info',
            title: `${upcomingCount} consulta${upcomingCount !== 1 ? 's' : ''} esta semana`,
            desc: 'Próximas 7 días',
            action: () => onNavigate('agenda'),
        },
    ].filter(Boolean);

    const colorMap = {
        orange:  { bg: 'bg-orange-50',     border: 'border-orange-200', text: 'text-orange-600' },
        warning: { bg: 'bg-warning-light', border: 'border-warning/20', text: 'text-warning' },
        danger:  { bg: 'bg-danger-light',  border: 'border-danger/20',  text: 'text-danger'  },
        amber:   { bg: 'bg-warning-light', border: 'border-warning/20', text: 'text-warning' },
        info:    { bg: 'bg-info-light',    border: 'border-info/20',    text: 'text-info'    },
    };

    return (
        <Card className="p-6 h-full">
            <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2 mb-4">
                <Bell size={17} className="text-warning" />
                Atención requerida
            </h2>

            {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 bg-success-light rounded-full flex items-center justify-center mb-3">
                        <CheckCircle size={24} className="text-success" />
                    </div>
                    <p className="text-sm font-medium text-sage-700">Todo al día</p>
                    <p className="text-xs text-sage-500 mt-1">No hay alertas pendientes. ¡Buen trabajo!</p>
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
   SECTION: QUICK ACTIONS
   ============================================ */

const QuickActions = ({ onNavigate }) => (
    <Card className="p-5">
        <h2 className="font-serif text-subheading text-sage-900 mb-4 flex items-center gap-2">
            <TrendingUp size={17} className="text-wellness-400" />
            Acciones rápidas
        </h2>
        <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" icon={Calendar} onClick={() => onNavigate('agenda')}>
                Nueva consulta
            </Button>
            <Button variant="secondary" size="sm" icon={UserPlus} onClick={() => onNavigate('clients')}>
                Nuevo cliente
            </Button>
            <Button variant="secondary" size="sm" icon={ClipboardList} onClick={() => onNavigate('plans')}>
                Nuevo plan
            </Button>
            <Button variant="secondary" size="sm" icon={Receipt} onClick={() => onNavigate('invoices')}>
                Nueva factura
            </Button>
        </div>
    </Card>
);

/* ============================================
   SECTION: ACTIVITY CHARTS
   ============================================ */

const ActivityCharts = ({ consultationsChart, clientsChart, revenueChart, isDark }) => {
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
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">Consultas</h3>
                <p className="text-sage-500 text-xs mb-4">Últimos 6 meses</p>
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={consultationsChart} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip formatter={(v) => v} />} cursor={{ fill: isDark ? '#2A2520' : '#F4F3EE' }} />
                        <Bar dataKey="value" name="Consultas" fill="#C15F3C" radius={[4, 4, 0, 0]} animationDuration={1200} />
                    </BarChart>
                </ResponsiveContainer>
            </Card>

            {/* Nuevos clientes */}
            <Card className="p-6">
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">Nuevos clientes</h3>
                <p className="text-sage-500 text-xs mb-4">Últimos 6 meses</p>
                <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={clientsChart} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorClients" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4A7FB5" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#4A7FB5" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip formatter={(v) => v} />} cursor={{ stroke: '#4A7FB5', strokeDasharray: '4 4', strokeWidth: 1 }} />
                        <Area type="monotone" dataKey="value" name="Clientes" stroke="#4A7FB5" strokeWidth={2.5} fill="url(#colorClients)" activeDot={{ r: 4, strokeWidth: 0, fill: '#4A7FB5' }} animationDuration={1400} />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            {/* Ingresos */}
            <Card className="p-6">
                <h3 className="font-serif text-sm font-semibold text-sage-900 mb-0.5">Ingresos cobrados</h3>
                <p className="text-sage-500 text-xs mb-4">Últimos 6 meses</p>
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={revenueChart} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} dy={8} />
                        <YAxis {...axisProps} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                        <Tooltip content={<ChartTooltip formatter={(v) => formatCurrency(v)} />} cursor={{ fill: isDark ? '#2A2520' : '#F4F3EE' }} />
                        <Bar dataKey="value" name="Ingresos" fill="#2D7A4F" radius={[4, 4, 0, 0]} animationDuration={1200} />
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
    const recent = [...invoices]
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
        .slice(0, 5);

    return (
        <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-sage-200 bg-sage-50 flex items-center justify-between">
                <h2 className="font-serif text-subheading text-sage-900 flex items-center gap-2">
                    <Receipt size={17} className="text-wellness-400" />
                    Últimas facturas
                </h2>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('invoices')}>
                    Ver todas <ArrowRight size={13} />
                </Button>
            </div>

            {recent.length === 0 ? (
                <div className="px-6">
                    <EmptyState
                        icon={Receipt}
                        title="Sin facturas"
                        description="Crea tu primera factura desde la sección de Facturación"
                        action={{ label: 'Ir a Facturación', onClick: () => onNavigate('invoices') }}
                    />
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-sage-50 border-b border-sage-200">
                            <tr>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">Número</th>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">Cliente</th>
                                <th className="text-left py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">Fecha</th>
                                <th className="text-right py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">Importe</th>
                                <th className="text-center py-3 px-6 text-xs font-semibold text-sage-500 uppercase tracking-wide">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-sage-100">
                            {recent.map(inv => {
                                const client = clients.find(c => c.id === inv.clienteId);
                                return (
                                    <tr key={inv.id} className="hover:bg-sage-50 transition-colors">
                                        <td className="py-3 px-6 font-mono text-sm text-sage-700">{inv.numero}</td>
                                        <td className="py-3 px-6 text-sm font-medium text-sage-800">{client?.nombre || '—'}</td>
                                        <td className="py-3 px-6 text-sm text-sage-500">{formatDate(inv.fecha)}</td>
                                        <td className="py-3 px-6 text-right font-mono font-bold text-sage-900">{formatCurrency(inv.total)}</td>
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
    const items = useMemo(() => {
        const all = [];

        clients.slice().sort((a, b) => (b.fechaAlta || '').localeCompare(a.fechaAlta || '')).slice(0, 5).forEach(c => {
            if (c.fechaAlta) all.push({ date: c.fechaAlta, icon: UserPlus, color: 'success', text: `Nuevo cliente: ${c.nombre}` });
        });

        const completedConsultations = consultations
            .filter(c => c.estado === 'completada')
            .slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 5);
        completedConsultations.forEach(c => {
            if (c.fecha) all.push({ date: c.fecha, icon: Calendar, color: 'wellness', text: `Consulta completada · ${c.tipo || 'Consulta'}` });
        });

        nutritionPlans.slice().sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || '')).slice(0, 4).forEach(p => {
            if (p.fechaInicio) all.push({ date: p.fechaInicio, icon: ClipboardList, color: 'info', text: `Plan creado: ${p.nombre}` });
        });

        invoices.filter(i => i.estado === 'pagada').slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 4).forEach(inv => {
            if (inv.fecha) all.push({ date: inv.fecha, icon: Receipt, color: 'warning', text: `Factura cobrada: ${inv.numero} · ${formatCurrency(inv.total)}` });
        });

        return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    }, [clients, consultations, nutritionPlans, invoices]);

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
                Actividad reciente
            </h2>

            {items.length === 0 ? (
                <EmptyState
                    icon={Activity}
                    title="Sin actividad reciente"
                    description="Comienza registrando tu primer cliente o consulta"
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
                                <span className="text-xs text-sage-400 shrink-0">{getRelativeDate(item.date)}</span>
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
    const last6 = useMemo(() => getLast6Months(), []);

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
            <DashboardHeader nombre={config?.nombre} />

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

            <QuickActions onNavigate={setCurrentView} />

            <ActivityCharts
                consultationsChart={consultationsChart}
                clientsChart={clientsChart}
                revenueChart={revenueChart}
                isDark={isDark}
            />

            <RecentInvoices
                invoices={invoices}
                clients={clients}
                onNavigate={setCurrentView}
            />

            <RecentActivityFeed
                clients={clients}
                consultations={consultations}
                nutritionPlans={nutritionPlans}
                invoices={invoices}
            />
        </div>
    );
};
