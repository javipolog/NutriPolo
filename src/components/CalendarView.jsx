import React, { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, MapPin, RefreshCw, Trash2, AlertCircle, AlertTriangle, EyeOff, CheckCircle2, UserPlus, X as XIcon } from 'lucide-react';
import { Button, SegmentedControl, useToast, useConfirm, clickableProps } from './UI';
import useStore, { formatDate, todayISO, filterVisibleConsultations, filterVisiblePersonalEvents } from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';
import { useT, useLocale, plural } from '../i18n';
import { ConsultationModal } from './ConsultationModal';

// ── Helpers ────────────────────────────────────────────────────────────────

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Short weekday names Monday→Sunday in the given locale (2024-01-01 was a Monday). */
function weekdayNames(locale) {
  return Array.from({ length: 7 }, (_, i) =>
    capitalize(new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')));
}

/** Full month names January→December in the given locale. */
function monthNames(locale) {
  return Array.from({ length: 12 }, (_, i) =>
    capitalize(new Date(2024, i, 1).toLocaleDateString(locale, { month: 'long' })));
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day); // adjust to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

const STATUS_BG = {
  programada: 'bg-wellness-100 border-wellness-400 text-wellness-700',
  completada:  'bg-success-light border-success text-success-dark',
  cancelada:   'bg-danger-light border-danger/50 text-danger-dark',
  no_show:     'bg-sage-100 border-sage-400 text-sage-600',
};

const LOCATION_COLORS = ['border-l-wellness-400', 'border-l-coral-400', 'border-l-blue-400', 'border-l-purple-400'];

/** Return inline style object when a consultation has a Google Calendar color, or null. */
function calStyle(c, calColorMap) {
  const color = calColorMap[c.sourceCalendarId];
  if (!color) return null;
  return {
    backgroundColor: color + '22',
    borderColor: color + '66',
    borderLeftColor: color,
    color: '#1a1a1a',
  };
}

/**
 * Return visual metadata for a consultation based on its matchStatus.
 * Returns null for fully-linked consultations (normal rendering).
 */
function consultationMatchVisual(c, t) {
  switch (c.matchStatus) {
    case 'auto-pending-review':
      return { cls: 'bg-info-light border-l-info text-info', Icon: CheckCircle2, tooltip: t.calendar_match_auto_tooltip };
    case 'suggested':
      return { cls: 'bg-terra-50 border-l-orange-400 text-terra-700', Icon: AlertCircle, tooltip: t.calendar_match_suggested_tooltip };
    case 'unknown':
      return { cls: 'bg-danger-light border-l-danger text-danger', Icon: UserPlus, tooltip: t.calendar_match_unknown_tooltip };
    case 'dismissed':
      return { cls: 'bg-sage-100 border-l-sage-400 text-sage-500 opacity-60', Icon: XIcon, tooltip: t.match_status_dismissed };
    default:
      return null;
  }
}

// ── Hour slots for weekly view ─────────────────────────────────────────────
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 20;

// ── Weekly View ────────────────────────────────────────────────────────────

const WeekView = ({ weekStart, consultations, personalEvents, clients, config, calColorMap, onNewConsultation, onEditConsultation }) => {
  const t = useT();
  const dayNames = weekdayNames(useLocale());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = todayISO();
  const locationColors = {};
  (config.locations || []).forEach((l, i) => { locationColors[l.id] = LOCATION_COLORS[i % LOCATION_COLORS.length]; });
  const blockedHours = config.blockedHours || [];

  // Convert JS getDay() (0=Sun) to our format (0=Mon)
  const isBlocked = (jsDay, hour) => {
    const dow = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
    return blockedHours.some(b => b.dayOfWeek === dow && hour >= b.startHour && hour < b.endHour);
  };

  const getBlockedLabel = (jsDay, hour) => {
    const dow = jsDay === 0 ? 6 : jsDay - 1;
    const match = blockedHours.find(b => b.dayOfWeek === dow && hour >= b.startHour && hour < b.endHour);
    return match?.label || '';
  };

  // 8–20 by default, widened so early/late appointments are never hidden.
  const hours = useMemo(() => {
    let first = DEFAULT_FIRST_HOUR, last = DEFAULT_LAST_HOUR;
    for (const c of [...consultations, ...(personalEvents || [])]) {
      const h = c.hora ? parseInt(c.hora.split(':')[0], 10) : NaN;
      if (Number.isNaN(h) || c.allDay) continue;
      first = Math.min(first, h);
      last = Math.max(last, h);
    }
    return Array.from({ length: last - first + 1 }, (_, i) => i + first);
  }, [consultations, personalEvents]);

  const byDayHour = useMemo(() => {
    const map = {};
    consultations.forEach(c => {
      const h = c.hora ? parseInt(c.hora.split(':')[0]) : null;
      const key = `${c.fecha}_${h}`;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [consultations]);

  // Parallel index for personal events — ballet, birthdays, etc.
  // All-day events skipped here (they'd span the whole column); only time-bound render.
  const personalByDayHour = useMemo(() => {
    const map = {};
    (personalEvents || []).forEach(e => {
      if (e.allDay) return;
      const h = e.hora ? parseInt(e.hora.split(':')[0]) : null;
      if (h === null || Number.isNaN(h)) return;
      const key = `${e.fecha}_${h}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return map;
  }, [personalEvents]);

  return (
    <div className="overflow-x-auto flex-1 flex flex-col min-h-0">
      <div className="min-w-[700px] flex flex-col flex-1">
        {/* Day headers */}
        <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-sage-200 bg-sage-50">
          <div />
          {days.map(d => {
            const iso = toISO(d);
            const isToday = iso === today;
            return (
              <div key={iso} className={`py-2 text-center text-xs font-medium border-l border-sage-200 ${isToday ? 'bg-wellness-50' : ''}`}>
                <p className="text-sage-400">{dayNames[d.getDay() === 0 ? 6 : d.getDay() - 1]}</p>
                <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-wellness-500' : 'text-sage-700'}`}>{d.getDate()}</p>
              </div>
            );
          })}
        </div>

        {/* Time rows */}
        <div className="relative flex-1 flex flex-col">
          {hours.map(h => (
            <div key={h} className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-sage-100 flex-1 min-h-[40px]">
              <div className="text-right pr-2 pt-1 text-[11px] text-sage-400 shrink-0">{h}:00</div>
              {days.map(d => {
                const iso = toISO(d);
                const isToday = iso === today;
                const key = `${iso}_${h}`;
                const slots = byDayHour[key] || [];
                const blocked = isBlocked(d.getDay(), h);
                const blockedLabel = blocked ? getBlockedLabel(d.getDay(), h) : '';
                return (
                  <div
                    key={iso}
                    className={`border-l border-sage-100 px-0.5 py-0.5 transition-colors ${blocked ? 'bg-sage-200/60 cursor-default' : 'cursor-pointer hover:bg-sage-50'} ${isToday && !blocked ? 'bg-wellness-50/40' : ''}`}
                    onClick={() => !blocked && onNewConsultation({ fecha: iso, hora: `${String(h).padStart(2, '0')}:00` })}
                  >
                    {blocked && slots.length === 0 && blockedLabel && (
                      <span className="text-[11px] text-sage-400 italic">{blockedLabel}</span>
                    )}
                    {slots.map(c => {
                      const client = clients.find(x => x.id === c.clienteId);
                      const locColor = locationColors[c.locationId] || 'border-l-sage-400';
                      const cStyle = calStyle(c, calColorMap);
                      const matchVisual = consultationMatchVisual(c, t);
                      const MatchIcon = matchVisual?.Icon;
                      return (
                        <div
                          key={c.id}
                          {...clickableProps(e => { e.stopPropagation(); onEditConsultation(c); })}
                          className={`text-[11px] rounded px-1 py-0.5 mb-0.5 border-l-2 cursor-pointer truncate hover:opacity-80 ${
                            matchVisual
                              ? matchVisual.cls
                              : cStyle
                                ? 'border'
                                : `${STATUS_BG[c.estado] || 'bg-sage-100 text-sage-600'} ${locColor}`
                          }`}
                          style={(!matchVisual && cStyle) || undefined}
                          title={matchVisual
                            ? matchVisual.tooltip
                            : `${client?.nombre || c.googleSummary || '?'} — ${c.tipo || ''}`
                          }
                        >
                          <span className="font-medium">{c.hora}</span>{' '}
                          {matchVisual
                            ? <>{MatchIcon && <MatchIcon size={8} className="inline mb-0.5 mr-0.5" />}{c.googleSummary?.replace(/^Consulta\s*-\s*/i, '')?.split(' ')[0] || '?'}</>
                            : (client?.nombre?.split(' ')[0] || c.googleSummary || '?')
                          }
                        </div>
                      );
                    })}
                    {(personalByDayHour[key] || []).map(e => (
                      <div
                        key={e.id}
                        onClick={ev => ev.stopPropagation()}
                        className="text-[11px] rounded px-1 py-0.5 mb-0.5 border-l-2 border-l-sage-500 bg-sage-200/50 text-sage-700 italic truncate cursor-default"
                        title={`[${t.personal_event_prefix}] ${e.title}${e.duracion ? ` — ${e.duracion}min` : ''}`}
                      >
                        <span className="font-medium">{e.hora}</span> {e.title}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Monthly View ───────────────────────────────────────────────────────────

const MonthView = ({ monthStart, consultations, personalEvents, clients, calColorMap, onNewConsultation, onEditConsultation }) => {
  const t = useT();
  const dayNames = weekdayNames(useLocale());
  const today = todayISO();
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from Monday of the week containing the 1st
  const gridStart = startOfWeek(firstDay);

  // Build 6 weeks × 7 days
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  // Merge consultations + personal events by date, tagging origin so the
  // renderer can distinguish clickable consults from read-only personal blocks.
  const byDate = useMemo(() => {
    const map = {};
    consultations.forEach(c => {
      if (!map[c.fecha]) map[c.fecha] = [];
      map[c.fecha].push({ ...c, __kind: 'consultation' });
    });
    (personalEvents || []).forEach(e => {
      if (!map[e.fecha]) map[e.fecha] = [];
      map[e.fecha].push({ ...e, __kind: 'personal' });
    });
    // Sort each day: consults first (by hora), then personal events (by hora)
    Object.keys(map).forEach(k => {
      map[k].sort((a, b) => {
        if (a.__kind !== b.__kind) return a.__kind === 'consultation' ? -1 : 1;
        return (a.hora || '').localeCompare(b.hora || '');
      });
    });
    return map;
  }, [consultations, personalEvents]);

  return (
    <div className="flex-1 flex flex-col">
      {/* Week day headers */}
      <div className="grid grid-cols-7 border-b border-sage-200 bg-sage-50">
        {dayNames.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-sage-500">{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1">
        {cells.map(d => {
          const iso = toISO(d);
          const inMonth = d.getMonth() === month;
          const isToday = iso === today;
          const dayConsults = byDate[iso] || [];

          return (
            <div
              key={iso}
              onClick={() => onNewConsultation({ fecha: iso })}
              className={`min-h-0 border-b border-r border-sage-100 p-1 cursor-pointer hover:bg-sage-50 transition-colors ${!inMonth ? 'opacity-30' : ''} ${isToday ? 'bg-wellness-50' : ''}`}
            >
              <p className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-wellness-400 text-white' : 'text-sage-600'}`}>
                {d.getDate()}
              </p>
              <div className="space-y-0.5">
                {dayConsults.slice(0, 3).map(item => {
                  if (item.__kind === 'personal') {
                    return (
                      <div
                        key={item.id}
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] px-1 rounded truncate bg-sage-200/50 text-sage-700 italic cursor-default border border-sage-300"
                        title={`[${t.personal_event_prefix}] ${item.title}`}
                      >
                        {!item.allDay && item.hora && <span className="font-medium mr-0.5">{item.hora}</span>}
                        {item.title}
                      </div>
                    );
                  }
                  const c = item;
                  const client = clients.find(x => x.id === c.clienteId);
                  const cStyle = calStyle(c, calColorMap);
                  const matchVisual = consultationMatchVisual(c, t);
                  const MatchIcon = matchVisual?.Icon;
                  return (
                    <div
                      key={c.id}
                      {...clickableProps(e => { e.stopPropagation(); onEditConsultation(c); })}
                      className={`text-[11px] px-1 rounded truncate cursor-pointer hover:opacity-80 ${
                        matchVisual
                          ? matchVisual.cls + ' border border-l-2'
                          : cStyle
                            ? 'border border-l-2'
                            : STATUS_BG[c.estado] || 'bg-sage-100 text-sage-600'
                      }`}
                      style={(!matchVisual && cStyle) || undefined}
                      title={matchVisual ? matchVisual.tooltip : undefined}
                    >
                      {c.hora && <span className="font-medium mr-0.5">{c.hora}</span>}
                      {matchVisual
                        ? <>{MatchIcon && <MatchIcon size={8} className="inline mb-0.5 mr-0.5" />}{c.googleSummary?.replace(/^Consulta\s*-\s*/i, '')?.split(' ')[0] || '?'}</>
                        : (client?.nombre?.split(' ')[0] || c.googleSummary || '?')
                      }
                    </div>
                  );
                })}
                {dayConsults.length > 3 && (
                  <p className="text-[11px] text-sage-400 pl-1">{t.calendar_more.replace('{n}', dayConsults.length - 3)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── List View (compact) ────────────────────────────────────────────────────

const ListView = ({ consultations, clients, config, calColorMap, onEdit }) => {
  const t = useT();
  const locationName = id => config.locations?.find(l => l.id === id)?.name || id || '';

  if (consultations.length === 0) {
    return <p className="text-center py-16 text-sage-400 text-sm">{t.calendar_no_consultations_period}</p>;
  }

  // Group by date
  const grouped = {};
  [...consultations].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || '')).forEach(c => {
    if (!grouped[c.fecha]) grouped[c.fecha] = [];
    grouped[c.fecha].push(c);
  });

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([fecha, items]) => (
        <div key={fecha}>
          <p className="text-xs font-semibold text-sage-500 uppercase mb-2">{formatDate(fecha)}</p>
          <div className="space-y-2">
            {items.map(c => {
              const client = clients.find(x => x.id === c.clienteId);
              const cColor = calColorMap[c.sourceCalendarId];
              return (
                <div
                  key={c.id}
                  {...clickableProps(() => onEdit(c))}
                  className="bg-white border border-sage-200 rounded-soft p-3 flex items-center gap-3 cursor-pointer hover:shadow-card-hover transition-shadow"
                  style={cColor ? { borderLeftWidth: 4, borderLeftColor: cColor } : undefined}
                >
                  {c.hora && (
                    <div className="text-center w-14 shrink-0">
                      <p className="text-sm font-bold" style={cColor ? { color: cColor } : undefined}>
                        {c.hora}
                      </p>
                      {c.duracion && <p className="text-[11px] text-sage-400">{c.duracion}m</p>}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sage-900 text-sm">{client?.nombre || c.googleSummary || t.calendar_no_client}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-sage-400">
                      <span>{c.tipo}</span>
                      {c.locationId && <span className="flex items-center gap-0.5"><MapPin size={9} />{locationName(c.locationId)}</span>}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-badge shrink-0 ${STATUS_BG[c.estado] || 'bg-sage-100 text-sage-500'}`}>
                    {t[`status_${c.estado}`] || c.estado}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Main CalendarView ──────────────────────────────────────────────────────

export const CalendarView = () => {
  const allConsultations  = useStore(s => s.consultations);
  const allPersonalEvents = useStore(s => s.personalEvents);
  const patientSuggestions = useStore(s => s.patientSuggestions);
  const clients = useStore(s => s.clients);
  const config  = useStore(s => s.config);
  const setCurrentView        = useStore(s => s.setCurrentView);
  const acceptMassDelete      = useStore(s => s.acceptMassDelete);
  const ignoreMassDeleteOnce  = useStore(s => s.ignoreMassDeleteOnce);
  const updateConfig          = useStore(s => s.updateConfig);

  // Calendars with pending mass-delete review
  const massDeleteCalendars = useMemo(
    () => (config.googleCalendar?.calendars || []).filter(c => c.massDeletePending != null),
    [config.googleCalendar?.calendars]
  );
  const consultations = useMemo(
    () => filterVisibleConsultations(allConsultations, config.googleCalendar),
    [allConsultations, config.googleCalendar]
  );
  const personalEvents = useMemo(
    () => filterVisiblePersonalEvents(allPersonalEvents, config.googleCalendar).filter(e => !e.cancelled),
    [allPersonalEvents, config.googleCalendar]
  );
  const pendingConfirmCount = useMemo(
    () => (patientSuggestions || []).filter(sg => sg.status === 'pending-confirm').length,
    [patientSuggestions]
  );
  const pendingReviewCount = useMemo(
    () => (patientSuggestions || []).filter(sg => sg.status === 'pending').length,
    [patientSuggestions]
  );
  const t = useT();
  const monthsLong = monthNames(useLocale());

  const resetAgenda = useStore(s => s.resetAgenda);
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const calColorMap = useMemo(() => {
    const map = {};
    (config.googleCalendar?.calendars || []).forEach(cal => {
      if (cal.color) map[cal.id] = cal.color;
    });
    return map;
  }, [config.googleCalendar?.calendars]);

  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month' | 'list'
  const [cursor, setCursor] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [modalDefaults, setModalDefaults] = useState(null);
  const [editConsultation, setEditConsultation] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [showPersonalEvents, setShowPersonalEvents] = useState(true);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const stats = await googleCalendar.syncAll(useStore.getState());
      const parts = [];
      if (stats.pushed) parts.push(`${stats.pushed} ${t.gcal_sync_pushed}`);
      if (stats.pulled) parts.push(`${stats.pulled} ${t.gcal_sync_pulled}`);
      if (stats.updated) parts.push(`${stats.updated} ${t.gcal_sync_updated}`);
      if (stats.errors > 0) parts.push(`${stats.errors} ${t.gcal_sync_errors}`);
      toast.success(`${t.gcal_synced}${parts.length ? ' — ' + parts.join(', ') : ''}`);
      if (stats.conflicts > 0) {
        toast.info(`${stats.conflicts} ${stats.conflicts > 1 ? t.sync_conflict_resolved_plural : t.sync_conflict_resolved}`);
      }
      setLastSyncTime(new Date());
    } catch (e) {
      setSyncError(e?.message || String(e));
      toast.error(t.gcal_sync_error_detail.replace('{error}', e?.message || String(e)));
    } finally {
      setSyncing(false);
    }
  }, [syncing, toast, t]);

  const handleReset = useCallback(async () => {
    const total = consultations.length;
    if (!total) { toast.info(t.calendar_nothing_to_delete); return; }

    const ok = await confirm({
      title: t.calendar_reset_title,
      message: t.calendar_reset_message.replace('{n}', total),
      danger: true,
    });
    if (!ok) return;

    setResetting(true);
    try {
      resetAgenda();
      toast.success(t.calendar_reset_done.replace('{n}', total));
    } catch (e) {
      toast.error(t.calendar_reset_error.replace('{error}', e?.message || String(e)));
    } finally {
      setResetting(false);
    }
  }, [consultations, confirm, resetAgenda, toast, t]);

  // Auto-sync runs app-wide in useBackgroundJobs (App.jsx), not only while
  // this view is mounted.

  const weekStart = startOfWeek(cursor);
  const monthStart = startOfMonth(cursor);

  // Filter consultations to visible window
  const visibleConsults = useMemo(() => {
    if (viewMode === 'week') {
      const from = toISO(weekStart);
      const to = toISO(addDays(weekStart, 6));
      return consultations.filter(c => c.fecha >= from && c.fecha <= to);
    }
    if (viewMode === 'month') {
      const from = toISO(startOfWeek(monthStart)); // grid may start before 1st
      const to = toISO(addDays(startOfWeek(monthStart), 41));
      return consultations.filter(c => c.fecha >= from && c.fecha <= to);
    }
    // list: show upcoming 30 days
    const from = toISO(cursor);
    const to = toISO(addDays(cursor, 30));
    return consultations.filter(c => c.fecha >= from && c.fecha <= to);
  }, [consultations, viewMode, cursor, weekStart, monthStart]);

  // Parallel filter for personal events — same date window as visibleConsults.
  // Respects the showPersonalEvents toggle (returns empty when hidden).
  const visiblePersonal = useMemo(() => {
    if (!showPersonalEvents) return [];
    if (viewMode === 'week') {
      const from = toISO(weekStart);
      const to = toISO(addDays(weekStart, 6));
      return personalEvents.filter(e => e.fecha >= from && e.fecha <= to);
    }
    if (viewMode === 'month') {
      const from = toISO(startOfWeek(monthStart));
      const to = toISO(addDays(startOfWeek(monthStart), 41));
      return personalEvents.filter(e => e.fecha >= from && e.fecha <= to);
    }
    const from = toISO(cursor);
    const to = toISO(addDays(cursor, 30));
    return personalEvents.filter(e => e.fecha >= from && e.fecha <= to);
  }, [personalEvents, showPersonalEvents, viewMode, cursor, weekStart, monthStart]);

  const navigate = (dir) => {
    setCursor(prev => {
      const d = new Date(prev);
      if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
      // Day 1 first: Jan 31 + 1 month would otherwise overflow to March.
      else if (viewMode === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir); }
      else d.setDate(d.getDate() + dir * 30);
      return d;
    });
  };

  const goToday = () => setCursor(new Date());

  const headerLabel = () => {
    if (viewMode === 'week') {
      const end = addDays(weekStart, 6);
      const sameMonth = weekStart.getMonth() === end.getMonth();
      if (sameMonth) return `${weekStart.getDate()}–${end.getDate()} ${monthsLong[weekStart.getMonth()]} ${weekStart.getFullYear()}`;
      return `${weekStart.getDate()} ${monthsLong[weekStart.getMonth()]} – ${end.getDate()} ${monthsLong[end.getMonth()]} ${end.getFullYear()}`;
    }
    if (viewMode === 'month') return `${monthsLong[cursor.getMonth()]} ${cursor.getFullYear()}`;
    return t.calendar_upcoming;
  };

  const openNew = (defaults = {}) => {
    setModalDefaults(defaults);
    setEditConsultation(null);
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditConsultation(c);
    setModalDefaults(null);
    setShowModal(true);
  };

  return (
    <div className="flex flex-col gap-4 animate-fadeIn h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-serif text-title text-sage-900">{t.agenda_title}</h1>
        <div className="flex items-center gap-2">
          {config.googleCalendar?.connected && (
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  title={t.calendar_sync_button}
                  aria-label={t.calendar_sync_button}
                  className={`p-1.5 rounded-button text-sage-500 hover:bg-sage-100 transition-colors disabled:opacity-50 ${syncing ? 'cursor-not-allowed' : ''}`}
                >
                  <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting || syncing}
                  title={t.calendar_reset_button}
                  aria-label={t.calendar_reset_button}
                  className="p-1.5 rounded-button text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {syncError ? (
                <p className="text-[11px] text-danger leading-tight">{t.calendar_sync_failed}</p>
              ) : lastSyncTime ? (
                <p className="text-[11px] text-sage-400 leading-tight">
                  {t.calendar_last_sync.replace('{time}', `${lastSyncTime.getHours().toString().padStart(2, '0')}:${lastSyncTime.getMinutes().toString().padStart(2, '0')}`)}
                </p>
              ) : null}
            </div>
          )}
          <Button variant="primary" icon={Plus} onClick={() => openNew({ fecha: todayISO() })}>
            {t.new_consultation}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label={t.previous} title={t.previous} className="p-1.5 rounded-button text-sage-500 hover:bg-sage-100 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={goToday} className="px-3 py-1 text-xs rounded-button border border-sage-300 text-sage-600 hover:bg-sage-50 transition-colors">
            {t.today}
          </button>
          <button onClick={() => navigate(1)} aria-label={t.next} title={t.next} className="p-1.5 rounded-button text-sage-500 hover:bg-sage-100 transition-colors">
            <ChevronRight size={16} />
          </button>
          <span className="text-sm font-medium text-sage-800 ml-1">{headerLabel()}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Personal events toggle */}
          {allPersonalEvents.filter(e => !e.cancelled).length > 0 && (
            <button
              onClick={() => setShowPersonalEvents(v => !v)}
              title={showPersonalEvents ? t.calendar_hide_personal : t.calendar_show_personal}
              aria-pressed={showPersonalEvents}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-button border transition-colors ${
                showPersonalEvents
                  ? 'bg-sage-100 border-sage-300 text-sage-600 hover:bg-sage-200'
                  : 'bg-white border-sage-200 text-sage-400 hover:bg-sage-50'
              }`}
            >
              <EyeOff size={13} />
              {t.personal_event_prefix}
            </button>
          )}

          {/* View toggle */}
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'week',  label: t.week_view },
              { value: 'month', label: t.month_view },
              { value: 'list',  label: t.view_list },
            ]}
          />
        </div>
      </div>

      {/* Mass-delete banners — one per suspended calendar */}
      {massDeleteCalendars.map(cal => (
        <div key={cal.id} className="flex items-start gap-3 px-4 py-3 bg-danger-light border border-danger/30 rounded-soft text-sm">
          <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-danger-dark">
              {t.mass_delete_title} "{cal.name || cal.id}"
            </p>
            <p className="text-danger-dark text-xs mt-0.5">
              {t.calendar_mass_delete_detail
                .replace('{prev}', cal.massDeletePending.prevCount)
                .replace('{new}', cal.massDeletePending.newCount)
                .replace('{drop}', cal.massDeletePending.drop)}
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => ignoreMassDeleteOnce(cal.id)}
              className="px-2.5 py-1 text-xs font-medium bg-white border border-danger/30 text-danger-dark rounded-button hover:bg-danger-light transition-colors"
            >
              {t.mass_delete_ignore}
            </button>
            <button
              onClick={() => acceptMassDelete(cal.id)}
              className="px-2.5 py-1 text-xs font-medium bg-danger text-white rounded-button hover:bg-danger-dark transition-colors"
            >
              {t.mass_delete_accept}
            </button>
            <button
              onClick={() => {
                const cals = (config.googleCalendar?.calendars || []).map(c =>
                  c.id === cal.id ? { ...c, massDeletePending: null, syncMode: 'disabled' } : c
                );
                updateConfig({ googleCalendar: { ...config.googleCalendar, calendars: cals } });
              }}
              className="px-2.5 py-1 text-xs text-danger hover:text-danger-dark transition-colors"
            >
              {t.mass_delete_suspend}
            </button>
          </div>
        </div>
      ))}

      {/* Banners — auto-match confirmations and unknown patients */}
      {pendingConfirmCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-info-light border border-info/30 rounded-soft text-sm">
          <CheckCircle2 size={16} className="text-info shrink-0" />
          <span className="flex-1 text-info-dark">
            <strong>{pendingConfirmCount}</strong>{' '}
            {plural(t, 'calendar_banner_confirm', pendingConfirmCount)}
          </span>
          <button
            onClick={() => setCurrentView('inbox')}
            className="px-3 py-1 text-xs font-medium bg-info text-white rounded-button hover:bg-info-dark transition-colors whitespace-nowrap"
          >
            {t.new_patients_review} →
          </button>
        </div>
      )}
      {pendingReviewCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-terra-50 border border-terra-200 rounded-soft text-sm">
          <AlertCircle size={16} className="text-terra-500 shrink-0" />
          <span className="flex-1 text-terra-700">
            <strong>{pendingReviewCount}</strong>{' '}
            {plural(t, 'calendar_banner_review', pendingReviewCount)}
          </span>
          <button
            onClick={() => setCurrentView('inbox')}
            className="px-3 py-1 text-xs font-medium bg-terra-500 text-white rounded-button hover:brightness-90 transition-colors whitespace-nowrap"
          >
            {t.new_patients_review} →
          </button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="bg-white border border-sage-200 rounded-soft shadow-card overflow-hidden flex-1 min-h-0 flex flex-col">
        {viewMode === 'week' && (
          <WeekView
            weekStart={weekStart}
            consultations={visibleConsults}
            personalEvents={visiblePersonal}
            clients={clients}
            config={config}
            calColorMap={calColorMap}
            onNewConsultation={openNew}
            onEditConsultation={openEdit}
          />
        )}
        {viewMode === 'month' && (
          <MonthView
            monthStart={monthStart}
            consultations={visibleConsults}
            personalEvents={visiblePersonal}
            clients={clients}
            calColorMap={calColorMap}
            onNewConsultation={openNew}
            onEditConsultation={openEdit}
          />
        )}
        {viewMode === 'list' && (
          <div className="p-4">
            <ListView
              consultations={visibleConsults}
              clients={clients}
              config={config}
              calColorMap={calColorMap}
              onEdit={openEdit}
            />
          </div>
        )}
      </div>

      {showModal && (
        <ConsultationModal
          consultation={editConsultation}
          defaultDate={modalDefaults?.fecha}
          defaultHora={modalDefaults?.hora}
          onClose={() => { setShowModal(false); setEditConsultation(null); setModalDefaults(null); }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default CalendarView;
