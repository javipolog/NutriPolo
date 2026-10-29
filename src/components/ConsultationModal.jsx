import React, { useState, useMemo } from 'react';
import { Button, Modal, Input, Textarea, SegmentedControl, Combobox, useToast, useConfirm } from './UI';
import useStore, { todayISO, canPushToCalendar, changedFields } from '../stores/store';
import { useT, useLocale } from '../i18n';
import { AlertTriangle, CheckCircle2, Mail, MessageCircle, Trash2 } from 'lucide-react';
import { googleCalendar, shortGcalError } from '../services/googleCalendarService';
import { reminderSlot } from '../services/reminderService';
import { useReminderActions } from '../hooks/useReminderActions';
import { SendEmailModal } from './SendEmailModal';

export const ConsultationModal = ({ consultation, defaultClientId, defaultDate, defaultHora, onClose }) => {
  const clients = useStore(s => s.clients);
  const addConsultation = useStore(s => s.addConsultation);
  const updateConsultation = useStore(s => s.updateConsultation);
  const addMeasurement = useStore(s => s.addMeasurement);
  const confirmAutoMatch = useStore(s => s.confirmAutoMatch);
  const patientSuggestions = useStore(s => s.patientSuggestions);
  const config = useStore(s => s.config);
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isEdit = !!consultation;
  // Phone or email as a hint, to tell apart clients with the same name
  const clientOptions = useMemo(() => [...clients]
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    .map(c => ({ value: c.id, label: c.nombre, hint: c.telefono || c.email || '' })), [clients]);

  // Reminders act on the saved consultation (live from the store).
  const liveConsultation = useStore(s => consultation ? s.consultations.find(c => c.id === consultation.id) : null);
  const reminderClient = liveConsultation?.estado === 'programada'
    ? clients.find(c => c.id === liveConsultation.clienteId) : null;
  const { sendWhatsApp } = useReminderActions();
  const [showReminderEmail, setShowReminderEmail] = useState(false);
  const reminderInfo = useMemo(() => {
    if (!liveConsultation?.reminders) return '';
    const slot = reminderSlot(liveConsultation);
    const fmt = (iso) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return ['email', 'whatsapp']
      .map(ch => liveConsultation.reminders[ch])
      .map((r, i) => (r && r.slot === slot && r.at ? `${i === 0 ? 'Email' : 'WhatsApp'} ${fmt(r.at)}` : null))
      .filter(Boolean)
      .join(' · ');
  }, [liveConsultation]);

  // Determine if the source calendar is read-only (external-clinic or personal).
  // In that case, fecha/hora/duracion come from Google and must not be overwritten locally.
  const sourceCal = useMemo(() =>
    (config.googleCalendar?.calendars || []).find(c => c.id === consultation?.sourceCalendarId),
    [config.googleCalendar?.calendars, consultation?.sourceCalendarId]
  );
  const isReadonly = isEdit && sourceCal?.syncMode === 'readonly';
  const isPendingReview = isEdit && consultation?.matchStatus === 'auto-pending-review';

  const proposedClient = useMemo(
    () => clients.find(c => c.id === consultation?.suggestedClienteId),
    [clients, consultation?.suggestedClienteId]
  );

  const [reviewBannerDismissed, setReviewBannerDismissed] = useState(false);

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

  const validate = () => {
    const e = {};
    if (!form.clienteId) e.clienteId = t.select_client_error;
    if (!form.fecha) e.fecha = t.field_required;
    return e;
  };

  // Pushed to the consultation's own calendar (or the default one when it is
  // not linked yet). A failure keeps the change; the next sync retries it.
  const pushToGoogle = (consultationId) => {
    googleCalendar.pushConsultation(consultationId).catch(err => {
      if (import.meta.env.DEV) console.error('[GCal Push]', err);
      toast.error(t.gcal_push_failed.replace('{error}', shortGcalError(err)));
    });
  };

  const handleDelete = async () => {
    const gc = useStore.getState().config.googleCalendar;
    const linked = !!(consultation.googleEventId && consultation.sourceCalendarId);
    const writable = linked && canPushToCalendar(gc, consultation.sourceCalendarId);
    const ok = await confirm({
      title: t.consultation_delete_title,
      message: !linked ? t.consultation_delete_message
        : writable ? t.consultation_delete_message_gcal
        : t.consultation_delete_message_readonly.replace('{calendar}', sourceCal?.name || t.calendar_external),
      danger: true,
    });
    if (!ok) return;
    onClose();
    const { remote } = await googleCalendar.deleteConsultation(consultation.id);
    if (remote === 'pending') toast.info(t.consultation_deleted_gcal_pending);
    else toast.success(t.consultation_deleted);
  };

  const handleInlineConfirm = () => {
    const sg = patientSuggestions.find(s => s.id === consultation?.suggestedFromId);
    if (sg) {
      confirmAutoMatch(sg.id);
    }
    toast.success(t.inbox_confirmed_ok || 'Coincidencia confirmada');
    onClose();
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    if (isEdit) {
      // Only what was edited here: the form is a copy taken on open, and the
      // sync or a reminder may have changed other fields since.
      const changes = changedFields(consultation, form);
      if (Object.keys(changes).length) {
        updateConsultation(consultation.id, changes);
        pushToGoogle(consultation.id);
      }
      toast.success(t.consultation_updated);
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
      toast.success(t.consultation_created);
      pushToGoogle(newC.id);
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t.consultation_edit : t.new_consultation}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reminderClient && (
            <div className="flex flex-wrap items-center gap-1 mr-auto">
              <span className="text-xs text-sage-500 mr-1">{t.reminders_panel_title}:</span>
              <Button variant="ghost" size="sm" icon={Mail} onClick={() => setShowReminderEmail(true)}>Email</Button>
              <Button variant="ghost" size="sm" icon={MessageCircle} onClick={() => sendWhatsApp(liveConsultation, reminderClient)}>WhatsApp</Button>
              {reminderInfo && <span className="text-[11px] text-sage-400">{t.reminders_last_sent} {reminderInfo}</span>}
            </div>
          )}
          {isEdit && (
            <Button variant="ghost" icon={Trash2} onClick={handleDelete} className={reminderClient ? '' : 'mr-auto'}>
              {t.delete}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
          <Button variant="primary" onClick={handleSave}>{t.save}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Readonly warning */}
        {isReadonly && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-warning-light border border-warning/30 rounded-soft text-xs text-warning-dark">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {t.consultation_readonly_warning
                ? t.consultation_readonly_warning.replace('{cal}', sourceCal?.name || 'calendario externo')
                : t.consultation_readonly_external.replace('{calendar}', sourceCal?.name || t.calendar_external)}
            </span>
          </div>
        )}

        {/* Auto-match review banner */}
        {isPendingReview && !reviewBannerDismissed && (
          <div className="p-3 bg-info-light border border-info/30 rounded-soft">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-info shrink-0" />
              <span className="text-xs font-semibold text-info-dark">
                {t.consultation_auto_match_title}
                {consultation.matchScore != null && ` · ${t.consultation_auto_match_score.replace('{n}', Math.round(consultation.matchScore * 100))}`}
              </span>
            </div>
            <p className="text-sm text-sage-700 mb-2">
              {t.consultation_auto_match_text} <strong>{proposedClient?.nombre || '?'}</strong>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={handleInlineConfirm}>
                {t.inbox_confirm || 'Confirmar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReviewBannerDismissed(true)}>
                {t.inbox_pick_other || 'Elegir otro'}
              </Button>
            </div>
          </div>
        )}

        {/* Client */}
        <div>
          <label htmlFor="consultation-client" className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_client} *</label>
          <Combobox
            id="consultation-client"
            value={form.clienteId}
            onChange={v => set('clienteId', v)}
            placeholder={t.search_clients}
            emptyText={t.no_results}
            error={errors.clienteId}
            options={clientOptions}
          />
          {errors.clienteId && <p className="text-xs text-danger mt-1">{errors.clienteId}</p>}
        </div>

        {/* Date + time */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_date} *</label>
            <Input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} error={errors.fecha} disabled={isReadonly} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_hour}</label>
            <Input type="time" value={form.hora} onChange={e => set('hora', e.target.value)} disabled={isReadonly} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_duration}</label>
            <Input type="number" value={form.duracion} onChange={e => set('duracion', e.target.value === '' ? '' : Number(e.target.value))} disabled={isReadonly} />
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
            <div className="flex items-center gap-2 px-3 py-2 bg-warning-light border border-warning/30 rounded-soft text-xs text-warning">
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
          <SegmentedControl
            ariaLabel={t.consultation_status}
            value={form.estado}
            onChange={v => set('estado', v)}
            options={['programada', 'completada', 'cancelada', 'no_show'].map(s => ({ value: s, label: t[`status_${s}`] || s }))}
          />
        </div>

        {/* Notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_private_notes}</label>
            <Textarea value={form.notasPrivadas} onChange={e => set('notasPrivadas', e.target.value)} rows={3} placeholder={t.only_you_placeholder} />
          </div>
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">{t.consultation_client_notes}</label>
            <Textarea value={form.notasCliente} onChange={e => set('notasCliente', e.target.value)} rows={3} placeholder={t.consultation_client_notes_placeholder} />
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
                {[['peso', t.measurement_weight], ['grasaCorporal', t.measurement_body_fat], ['cintura', t.measurement_waist]].map(([field, label]) => (
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

      {/* Audit footer */}
      {isEdit && consultation?.matchedAt && (
        <p className="text-xs text-sage-400 text-center mt-3">
          {consultation.matchedBy === 'user'
            ? t.consultation_matched_user.replace('{confirmed}', new Date(consultation.matchedByAt || consultation.matchedAt).toLocaleDateString(locale)).replace('{detected}', new Date(consultation.matchedAt).toLocaleDateString(locale))
            : t.consultation_matched_auto.replace('{date}', new Date(consultation.matchedAt).toLocaleDateString(locale))
          }
        </p>
      )}

      {ConfirmDialog}

      {showReminderEmail && reminderClient && (
        <SendEmailModal
          mode="appointment"
          client={reminderClient}
          consultation={liveConsultation}
          onSent={({ manual }) => useStore.getState().setConsultationReminder(liveConsultation.id, 'email', {
            status: manual ? 'manual' : 'sent', at: new Date().toISOString(), slot: reminderSlot(liveConsultation),
          })}
          onClose={() => setShowReminderEmail(false)}
        />
      )}
    </Modal>
  );
};

export default ConsultationModal;
