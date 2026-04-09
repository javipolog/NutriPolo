import React, { useState, useMemo } from 'react';
import { Calendar, List, Plus, Edit2, Trash2, Clock, MapPin, MessageCircle } from 'lucide-react';
import { Button, EmptyState, useToast, useConfirm } from './UI';
import useStore, { formatDate, filterVisibleConsultations } from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';
import { useT } from '../i18n';
import { ConsultationModal } from './ConsultationModal';
import { openWhatsAppReminder } from '../services/whatsappService';

const STATUS_COLORS = {
  programada: 'bg-wellness-50 text-wellness-600',
  completada:  'bg-success-light text-success',
  cancelada:   'bg-danger-light text-danger',
  no_show:     'bg-sage-100 text-sage-500',
};

export const ConsultationsView = () => {
  const allConsultations = useStore(s => s.consultations);
  const clients = useStore(s => s.clients);
  const config = useStore(s => s.config);
  const consultations = useMemo(
    () => filterVisibleConsultations(allConsultations, config.googleCalendar),
    [allConsultations, config.googleCalendar]
  );
  const deleteConsultation = useStore(s => s.deleteConsultation);
  const updateConsultation = useStore(s => s.updateConsultation);
  const updateConfig = useStore(s => s.updateConfig);
  const consultationFilters = useStore(s => s.consultationFilters);
  const setConsultationFilters = useStore(s => s.setConsultationFilters);

  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editConsultation, setEditConsultation] = useState(null);

  const locationName = (id) => config.locations?.find(l => l.id === id)?.name || id || '';

  const getDateRange = () => {
    const today = new Date().toISOString().slice(0, 10);
    switch (consultationFilters.dateRange) {
      case 'today':
        return [today, today];
      case 'week': {
        const end = new Date(); end.setDate(end.getDate() + 7);
        return [today, end.toISOString().slice(0, 10)];
      }
      case 'month': {
        const start = new Date(); start.setDate(1);
        const end = new Date(start); end.setMonth(end.getMonth() + 1); end.setDate(0);
        return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
      }
      default:
        return [null, null];
    }
  };

  const filtered = useMemo(() => {
    const [from, to] = getDateRange();
    return consultations.filter(c => {
      if (from && c.fecha < from) return false;
      if (to && c.fecha > to) return false;
      if (consultationFilters.locationId !== 'all' && c.locationId !== consultationFilters.locationId) return false;
      if (consultationFilters.tipo !== 'all' && c.tipo !== consultationFilters.tipo) return false;
      if (consultationFilters.estado !== 'all' && c.estado !== consultationFilters.estado) return false;
      return true;
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.hora || '').localeCompare(a.hora || ''));
  }, [consultations, consultationFilters]);

  const handleDelete = async (c) => {
    const ok = await confirm(`¿Eliminar la consulta del ${formatDate(c.fecha)}?`);
    if (!ok) return;
    deleteConsultation(c.id);
    toast.success('Consulta eliminada');
    if (config.googleCalendar?.connected && c.googleEventId) {
      try {
        const gcalConfig = config.googleCalendar;
        const cals = gcalConfig.calendars || [];
        const targetCal = cals.find(cal => cal.id === c.sourceCalendarId)
          || cals.find(cal => cal.syncMode === 'bidirectional');
        // Skip if no writable calendar found for this event
        if (!targetCal || targetCal.syncMode === 'readonly' || targetCal.syncMode === 'disabled') return;
        const tokenResult = await googleCalendar.getValidToken(gcalConfig);
        const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
        if (typeof tokenResult !== 'string') {
          updateConfig({ googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken } });
        }
        await googleCalendar.deleteEvent(token, targetCal.id, c.googleEventId);
      } catch (e) {
        toast.error('Error al eliminar en Google Calendar: ' + (e?.message || String(e)));
      }
    }
  };

  const handleWhatsAppReminder = (consultation, client) => {
    const result = openWhatsAppReminder({ client, consultation, config, locationName });
    if (result.error === 'no_phone') { toast.error(t.whatsapp_no_phone); return; }
    if (result.success) {
      updateConsultation(consultation.id, { lastWhatsappReminder: new Date().toISOString() });
      toast.success(t.whatsapp_reminder_sent);
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-900">{t.agenda_title}</h1>
        <Button variant="primary" icon={Plus} onClick={() => { setEditConsultation(null); setShowModal(true); }}>
          {t.new_consultation}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 bg-sage-100 p-1 rounded-button">
          {[['today','Hoy'],['week','7 días'],['month','Mes'],['all','Todas']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setConsultationFilters({ dateRange: id })}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                consultationFilters.dateRange === id ? 'bg-white text-sage-800 shadow-sm' : 'text-sage-500 hover:text-sage-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={consultationFilters.locationId}
          onChange={e => setConsultationFilters({ locationId: e.target.value })}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todas las ubicaciones</option>
          {(config.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select
          value={consultationFilters.estado}
          onChange={e => setConsultationFilters({ estado: e.target.value })}
          className="px-3 py-1.5 text-xs border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
        >
          <option value="all">Todos los estados</option>
          {['programada','completada','cancelada','no_show'].map(s => (
            <option key={s} value={s}>{t[`status_${s}`] || s}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-sage-500">{filtered.length} consulta{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={t.no_consultations}
          action={{ label: t.new_consultation, onClick: () => setShowModal(true) }}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const client = clients.find(x => x.id === c.clienteId);
            return (
              <div key={c.id} className="bg-white border border-sage-200 rounded-soft shadow-card p-4 flex items-start gap-4 hover:shadow-card-hover transition-shadow">
                {/* Date/time */}
                <div className="text-center w-16 shrink-0">
                  <p className="text-xs font-bold text-wellness-500">{formatDate(c.fecha)}</p>
                  {c.hora && <p className="text-xs text-sage-400 flex items-center gap-0.5 justify-center mt-0.5"><Clock size={9} />{c.hora}</p>}
                </div>

                {/* Client + info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sage-900">{client?.nombre || c.googleSummary || 'Sin cliente'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-sage-500">
                    <span>{c.tipo}</span>
                    {c.locationId && (
                      <span className="flex items-center gap-1"><MapPin size={9} />{locationName(c.locationId)}</span>
                    )}
                    {c.duracion && <span>{c.duracion} min</span>}
                  </div>
                  {c.notasCliente && <p className="text-xs text-sage-400 mt-1 truncate">{c.notasCliente}</p>}
                </div>

                {/* Status */}
                <span className={`text-xs px-2 py-0.5 rounded-badge font-medium shrink-0 ${STATUS_COLORS[c.estado] || 'bg-sage-100 text-sage-500'}`}>
                  {t[`status_${c.estado}`] || c.estado}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {c.estado === 'programada' && client && (
                    <button onClick={() => handleWhatsAppReminder(c, client)}
                      title={t.whatsapp_reminder}
                      className="p-1.5 rounded-button text-sage-400 hover:text-success hover:bg-success-light transition-colors">
                      <MessageCircle size={14} className={c.lastWhatsappReminder ? 'text-success' : ''} />
                    </button>
                  )}
                  <button onClick={() => { setEditConsultation(c); setShowModal(true); }}
                    className="p-1.5 rounded-button text-sage-400 hover:text-sage-700 hover:bg-sage-100 transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => handleDelete(c)}
                    className="p-1.5 rounded-button text-sage-400 hover:text-danger hover:bg-danger-light transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <ConsultationModal
          consultation={editConsultation}
          onClose={() => { setShowModal(false); setEditConsultation(null); }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
};

export default ConsultationsView;
