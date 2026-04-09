import React, { useState, useMemo } from 'react';
import { Button, Modal, Input, Textarea, useToast } from './UI';
import useStore, { todayISO } from '../stores/store';
import { googleCalendar } from '../services/googleCalendarService';
import { useT } from '../i18n';
import { AlertTriangle } from 'lucide-react';

export const ConsultationModal = ({ consultation, defaultClientId, defaultDate, defaultHora, onClose }) => {
  const clients = useStore(s => s.clients);
  const config = useStore(s => s.config);
  const addConsultation = useStore(s => s.addConsultation);
  const updateConsultation = useStore(s => s.updateConsultation);
  const updateConfig = useStore(s => s.updateConfig);
  const addMeasurement = useStore(s => s.addMeasurement);
  const t = useT();
  const toast = useToast();
  const isEdit = !!consultation;

  const [form, setForm] = useState({
    clienteId: defaultClientId || '',
    fecha: defaultDate || todayISO(),
    hora: defaultHora || '09:00',
    locationId: config.locations?.[0]?.id || '',
    tipo: config.consultationTypes?.[0] || 'Primera visita',
    duracion: config.defaultConsultationDuration || 45,
    estado: 'programada',
    notasPrivadas: '',
    notasCliente: '',
    proximaCita: '',
    ...consultation,
  });
  const [takeMeasurement, setTakeMeasurement] = useState(false);
  const [measureForm, setMeasureForm] = useState({ peso: '', grasaCorporal: '', cintura: '' });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pushToGCal = async (savedConsultation) => {
    // Read fresh config from store — closure config may be stale if settings changed
    const freshConfig = useStore.getState().config;
    const gcalConfig = freshConfig.googleCalendar;
    if (!gcalConfig?.connected) {
      return { ok: false, reason: 'not_connected' };
    }

    // Find the target calendar: sourceCalendarId → defaultPushCalendarId → first bidirectional
    const cals = gcalConfig.calendars || [];

    let targetCal;
    if (savedConsultation.sourceCalendarId) {
      targetCal = cals.find(c => c.id === savedConsultation.sourceCalendarId);
    }
    if (!targetCal && gcalConfig.defaultPushCalendarId) {
      targetCal = cals.find(c => c.id === gcalConfig.defaultPushCalendarId && c.syncMode === 'bidirectional');
    }
    if (!targetCal) {
      targetCal = cals.find(c => c.syncMode === 'bidirectional');
    }
    // Skip if no bidirectional calendar or calendar is readonly
    if (!targetCal || targetCal.syncMode === 'readonly' || targetCal.syncMode === 'disabled') {
      return { ok: false, reason: 'no_bidirectional' };
    }

    try {
      const tokenResult = await googleCalendar.getValidToken(gcalConfig);
      const token = typeof tokenResult === 'string' ? tokenResult : tokenResult.newToken;
      if (typeof tokenResult !== 'string') {
        useStore.getState().updateConfig({
          googleCalendar: { ...gcalConfig, accessToken: tokenResult.newToken, expiresAt: tokenResult.expiresAt, refreshToken: tokenResult.refreshToken },
        });
      }
      const freshClients = useStore.getState().clients;
      const client = freshClients.find(c => c.id === savedConsultation.clienteId);
      const event = googleCalendar.consultationToEvent(savedConsultation, client, freshConfig.locations);

      if (savedConsultation.googleEventId) {
        await googleCalendar.updateEvent(token, targetCal.id, savedConsultation.googleEventId, event);
        useStore.getState().updateConsultation(savedConsultation.id, { lastSyncedAt: new Date().toISOString() });
      } else {
        const created = await googleCalendar.createEvent(token, targetCal.id, event);
        useStore.getState().updateConsultation(savedConsultation.id, { googleEventId: created.id, sourceCalendarId: targetCal.id, lastSyncedAt: new Date().toISOString() });
      }
      return { ok: true };
    } catch (e) {
      if (import.meta.env.DEV) console.error('[GCal Push] FAILED:', e?.message || String(e), e);
      return { ok: false, reason: 'error', message: e?.message || String(e) };
    }
  };

  const validate = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = 'Selecciona un cliente';
    if (!form.fecha) e.fecha = 'Requerido';
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    const handleGCalResult = (result) => {
      if (!result || result.reason === 'not_connected') return;
      if (result.ok) {
        toast.info('Sincronizado con Google Calendar');
      } else if (result.reason === 'no_bidirectional') {
        toast.warning('No hay calendario bidireccional configurado en Ajustes');
      } else if (result.reason === 'error') {
        toast.error('Error al sincronizar: ' + result.message);
      }
    };

    if (isEdit) {
      updateConsultation(consultation.id, form);
      const updatedC = { ...consultation, ...form };
      toast.success('Consulta actualizada');
      const gcConnected = useStore.getState().config.googleCalendar?.connected;
      if (gcConnected) pushToGCal(updatedC).then(handleGCalResult);
      onClose();
    } else {
      const newC = addConsultation(form);
      if (takeMeasurement && (measureForm.peso || measureForm.grasaCorporal)) {
        addMeasurement({
          clienteId: form.clienteId,
          consultaId: newC.id,
          fecha: form.fecha,
          peso: measureForm.peso ? parseFloat(measureForm.peso) : null,
          grasaCorporal: measureForm.grasaCorporal ? parseFloat(measureForm.grasaCorporal) : null,
          cintura: measureForm.cintura ? parseFloat(measureForm.cintura) : null,
        });
      }
      toast.success('Consulta creada');
      const gcConnected = useStore.getState().config.googleCalendar?.connected;
      if (gcConnected) pushToGCal(newC).then(handleGCalResult);
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Editar consulta' : t.new_consultation} size="lg">
      <div className="space-y-4">
        {/* Client */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_client} *</label>
          <select
            value={form.clienteId}
            onChange={e => set('clienteId', e.target.value)}
            className={`w-full px-3 py-2 text-sm border rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400 ${errors.clienteId ? 'border-danger' : 'border-sage-300'}`}
          >
            <option value="">Seleccionar cliente...</option>
            {clients.sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
        </div>

        {/* Date + time */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_date} *</label>
            <Input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} error={errors.fecha} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_hour}</label>
            <Input type="time" value={form.hora} onChange={e => set('hora', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_duration}</label>
            <Input type="number" value={form.duracion} onChange={e => set('duracion', e.target.value)} />
          </div>
        </div>

        {/* Blocked hour warning */}
        {(() => {
          if (!form.fecha || !form.hora) return null;
          const d = new Date(form.fecha + 'T00:00:00');
          const jsDay = d.getDay();
          const dow = jsDay === 0 ? 6 : jsDay - 1;
          const h = parseInt(form.hora.split(':')[0]);
          const blocked = (config.blockedHours || []).some(b => b.dayOfWeek === dow && h >= b.startHour && h < b.endHour);
          if (!blocked) return null;
          return (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-soft text-xs text-amber-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{t.blocked_hours_warning}</span>
            </div>
          );
        })()}

        {/* Location + type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_location}</label>
            <select value={form.locationId} onChange={e => set('locationId', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400">
              {(config.locations || []).map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_type}</label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400">
              {(config.consultationTypes || []).map(tp => (
                <option key={tp} value={tp}>{tp}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_status}</label>
          <div className="flex gap-2">
            {['programada','completada','cancelada','no_show'].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => set('estado', s)}
                className={`px-3 py-1 text-xs rounded-badge transition-colors ${
                  form.estado === s ? 'bg-wellness-400 text-white' : 'bg-sage-100 text-sage-600 hover:bg-sage-200'
                }`}
              >
                {t[`status_${s}`] || s}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_private_notes}</label>
            <Textarea value={form.notasPrivadas} onChange={e => set('notasPrivadas', e.target.value)} rows={3} placeholder="Solo visible para ti..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_client_notes}</label>
            <Textarea value={form.notasCliente} onChange={e => set('notasCliente', e.target.value)} rows={3} placeholder="Instrucciones para el cliente..." />
          </div>
        </div>

        {/* Next appointment */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_next}</label>
          <Input type="date" value={form.proximaCita} onChange={e => set('proximaCita', e.target.value)} />
        </div>

        {/* Measurement section */}
        {!isEdit && (
          <div className="border border-sage-200 rounded-soft p-4">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={takeMeasurement}
                onChange={e => setTakeMeasurement(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm font-medium text-sage-700">{t.consultation_measurement}</span>
            </label>
            {takeMeasurement && (
              <div className="grid grid-cols-3 gap-3">
                {[['peso','Peso (kg)'],['grasaCorporal','Grasa (%)'],['cintura','Cintura (cm)']].map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs text-sage-500 mb-1">{label}</label>
                    <input
                      type="number" step="0.1"
                      value={measureForm[field]}
                      onChange={e => setMeasureForm(f => ({ ...f, [field]: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-sage-200 mt-4">
        <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
        <Button variant="primary" onClick={handleSave}>{t.save}</Button>
      </div>
    </Modal>
  );
};

export default ConsultationModal;
