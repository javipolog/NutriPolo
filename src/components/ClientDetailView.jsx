import React, { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft, Edit2, MessageCircle, Phone, Mail, Leaf, FileText, Calendar, ClipboardList, Receipt, ClipboardEdit, Unlink } from 'lucide-react';
import { Button, StatusBadge, useToast, useConfirm } from './UI';
import useStore, { formatDate, formatCurrency, calcIMC } from '../stores/store';
import { useT, useLocale } from '../i18n';
import { GOALS, DIET_RESTRICTIONS, ACTIVITY_LEVELS, optionLabel } from '../clientOptions';
import { ClientModal } from './ClientModal';
import { ConsultationModal } from './ConsultationModal';
import { InvoiceModal } from './InvoiceModal';
import { PlanEditorModal } from './NutritionPlanEditor';
import { MeasurementChart } from './MeasurementChart';
import { InterviewTab } from './client/InterviewTab';
import { entrevistaTotals } from '../services/entrevista';
import { ClientDocuments } from './ClientDocuments';
import { SendEmailModal } from './SendEmailModal';
import { openWhatsAppChat } from '../services/reminderService';
import { useReminderActions } from '../hooks/useReminderActions';


const InfoRow = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-sage-100 last:border-0">
      <span className="text-xs text-sage-500">{label}</span>
      <span className="text-xs text-sage-800 font-medium text-right max-w-xs">{value}</span>
    </div>
  );
};

/** Latest value of a measurement plus its change since the first one. */
const MetricStat = ({ label, value, unit, delta, since, locale }) => {
  const t = useT();
  const fmt = n => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  return (
    <div>
      <p className="text-xs text-sage-500">{label}</p>
      <p className="text-xl font-semibold text-sage-900 tabular-nums">
        {fmt(value)}{unit && <span className="text-xs font-normal text-sage-500"> {unit}</span>}
      </p>
      {delta != null && delta !== 0 && (
        <p className="text-xs text-sage-500 tabular-nums">
          {t.client_change_since.replace('{delta}', `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}${unit ? ` ${unit}` : ''}`).replace('{date}', formatDate(since))}
        </p>
      )}
    </div>
  );
};

export const ClientDetailView = ({ clientId, onBack }) => {
  const client = useStore(s => s.clients.find(c => c.id === clientId));
  // useShallow: these selectors build new arrays, which would otherwise
  // re-render the view on every unrelated store change.
  const consultations = useStore(useShallow(s => s.consultations.filter(c => c.clienteId === clientId)));
  const nutritionPlans = useStore(useShallow(s => s.nutritionPlans.filter(p => p.clienteId === clientId)));
  const invoices = useStore(useShallow(s => s.invoices.filter(i => i.clienteId === clientId)));
  const measurements = useStore(useShallow(s => s.getClientMeasurements(clientId)));
  const config = useStore(s => s.config);
  const setCurrentView = useStore(s => s.setCurrentView);

  const unlinkAutoMatch = useStore(s => s.unlinkAutoMatch);

  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState('profile');
  const [showEdit, setShowEdit] = useState(false);
  const [emailDoc, setEmailDoc] = useState(null);
  const [creating, setCreating] = useState(null); // 'consultation' | 'plan' | 'invoice'
  const [editingPlan, setEditingPlan] = useState(null);
  const locale = useLocale();
  const { sendWhatsApp } = useReminderActions();

  // Client deleted while open: leave the view (side effect, not during render).
  useEffect(() => { if (!client) onBack(); }, [client, onBack]);
  if (!client) return null;

  const firstMeasurement = measurements[0];
  const lastMeasurement = measurements[measurements.length - 1];
  const altura = client.altura || lastMeasurement?.altura;
  const currentIMC = lastMeasurement?.imc || (lastMeasurement?.peso && altura ? calcIMC(lastMeasurement.peso, altura) : null);
  const deltaOf = key => (measurements.length > 1 && firstMeasurement[key] != null && lastMeasurement[key] != null)
    ? Number(lastMeasurement[key]) - Number(firstMeasurement[key])
    : null;
  const interview = entrevistaTotals(client);
  const hasHealthData = ['alergias', 'intolerancias', 'patologias', 'restriccionesDieteticas'].some(k => (client[k] || []).length > 0)
    || client.medicacion || client.ejercicio;

  const openWhatsApp = async () => {
    const result = await openWhatsAppChat(client, config);
    if (!result.success) toast.error(t.no_phone_number);
  };

  const TABS = [
    { id: 'profile',       label: t.tab_profile },
    { id: 'interview',     label: t.tab_interview },
    { id: 'measurements',  label: t.tab_measurements },
    { id: 'consultations', label: t.tab_consultations },
    { id: 'plans',         label: t.tab_plans },
    { id: 'payments',      label: t.tab_payments },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      {ConfirmDialog}
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-sage-500 hover:text-sage-800 transition-colors">
          <ArrowLeft size={15} />
          {t.clients_title}
        </button>
        <span className="text-sage-300">/</span>
        <span className="text-sm font-medium text-sage-900">{client.nombre}</span>
      </div>

      {/* Client header card */}
      <div className="bg-white border border-sage-200 rounded-soft shadow-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-wellness-100 flex items-center justify-center text-wellness-600 font-bold text-xl shrink-0">
              {client.nombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="font-serif text-heading text-sage-900">{client.nombre}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-sage-500">
                {client.email && <span className="flex items-center gap-1"><Mail size={11} />{client.email}</span>}
                {client.telefono && <span className="flex items-center gap-1"><Phone size={11} />{client.telefono}</span>}
                <span>{t.client_since}: {formatDate(client.fechaAlta)}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(client.objetivos || []).map(o => (
                  <span key={o} className="text-[11px] px-2 py-0.5 bg-wellness-50 text-wellness-600 rounded-badge">
                    {optionLabel(GOALS, t, o)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={openWhatsApp} icon={MessageCircle}>WhatsApp</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)} icon={Edit2}>{t.edit}</Button>
            </div>
            {/* Create records for this client without leaving the profile */}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" icon={Calendar} onClick={() => setCreating('consultation')}>{t.new_consultation}</Button>
              <Button size="sm" variant="secondary" icon={ClipboardList} onClick={() => setCreating('plan')}>{t.new_plan}</Button>
              <Button size="sm" variant="secondary" icon={Receipt} onClick={() => setCreating('invoice')}>{t.new_invoice}</Button>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        {lastMeasurement && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-sage-100">
            {lastMeasurement.peso != null && (
              <MetricStat label={t.measurement_weight} value={Number(lastMeasurement.peso)} unit="kg" delta={deltaOf('peso')} since={firstMeasurement.fecha} locale={locale} />
            )}
            {currentIMC && <MetricStat label={t.measurement_bmi} value={Number(currentIMC)} locale={locale} />}
            {lastMeasurement.grasaCorporal != null && (
              <MetricStat label={t.measurement_body_fat} value={Number(lastMeasurement.grasaCorporal)} unit="%" delta={deltaOf('grasaCorporal')} since={firstMeasurement.fecha} locale={locale} />
            )}
            {altura && <MetricStat label={t.client_height} value={Number(altura)} unit="cm" locale={locale} />}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-sage-200"
        role="tablist"
        onKeyDown={e => {
          // Arrow keys move between tabs (WAI-ARIA tabs pattern)
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = TABS.findIndex(tb => tb.id === tab);
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
          setTab(next.id);
          document.getElementById(`client-tab-${next.id}`)?.focus();
        }}
      >
        {TABS.map(tb => (
          <button
            key={tb.id}
            id={`client-tab-${tb.id}`}
            role="tab"
            aria-selected={tab === tb.id}
            aria-controls="client-tabpanel"
            tabIndex={tab === tb.id ? 0 : -1}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tb.id
                ? 'border-wellness-400 text-wellness-600'
                : 'border-transparent text-sage-500 hover:text-sage-700'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fadeIn" id="client-tabpanel" role="tabpanel" aria-labelledby={`client-tab-${tab}`}>
        {tab === 'profile' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white border border-sage-200 rounded-soft p-4">
              <h3 className="text-sm font-semibold text-sage-700 mb-3">{t.client_personal_data}</h3>
              <InfoRow label={t.email} value={client.email} />
              <InfoRow label={t.phone} value={client.telefono} />
              <InfoRow label="NIF" value={client.nif} />
              <InfoRow label={t.client_street} value={client.calle} />
              <InfoRow label={t.client_city} value={[client.codigoPostal, client.ciudad, client.provincia].filter(Boolean).join(', ')} />
              <InfoRow label={t.client_birth} value={formatDate(client.fechaNacimiento)} />
              <InfoRow label={t.client_gender} value={client.genero === 'M' ? t.client_gender_m : client.genero === 'F' ? t.client_gender_f : client.genero} />
              <InfoRow label={t.client_height} value={altura} />
              <InfoRow label={t.client_activity} value={client.nivelActividad && optionLabel(ACTIVITY_LEVELS, t, client.nivelActividad)} />
            </div>
            <div className="bg-white border border-sage-200 rounded-soft p-4">
              <h3 className="text-sm font-semibold text-sage-700 mb-3">{t.client_health_profile}</h3>
              {!hasHealthData && <p className="text-xs text-sage-500">{t.client_health_empty}</p>}
              {(client.alergias || []).length > 0 && <InfoRow label={t.client_allergies} value={client.alergias.join(', ')} />}
              {(client.intolerancias || []).length > 0 && <InfoRow label={t.client_intolerances} value={client.intolerancias.join(', ')} />}
              {(client.patologias || []).length > 0 && <InfoRow label={t.client_pathologies} value={client.patologias.join(', ')} />}
              {client.medicacion && <InfoRow label={t.client_medication} value={client.medicacion} />}
              {client.ejercicio && <InfoRow label={t.client_exercise} value={client.ejercicio} />}
              {(client.restriccionesDieteticas || []).length > 0 && <InfoRow label={t.client_diet_restrictions} value={client.restriccionesDieteticas.map(r => optionLabel(DIET_RESTRICTIONS, t, r)).join(', ')} />}
            </div>
            <div className="col-span-full bg-white border border-sage-200 rounded-soft p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-sage-700">{t.tab_interview}</h3>
                <p className="text-xs text-sage-500 mt-0.5 tabular-nums">
                  {interview.done === 0
                    ? t.ent_not_started
                    : t.ent_progress.replace('{done}', interview.done).replace('{total}', interview.total)}
                </p>
                {client.entrevista?.motivo && (
                  <p className="text-sm text-sage-800 mt-1 line-clamp-2">
                    <span className="text-sage-500">{t.ent_q_motivo_short}: </span>{client.entrevista.motivo}
                  </p>
                )}
              </div>
              <Button size="sm" variant="secondary" icon={ClipboardEdit} onClick={() => setTab('interview')}>
                {interview.done === 0 ? t.ent_start : t.ent_open}
              </Button>
            </div>
            {client.notas && (
              <div className="col-span-full bg-warning-light border border-warning/20 rounded-soft p-4">
                <p className="text-xs font-semibold text-warning-dark mb-1">{t.client_private_notes}</p>
                <p className="text-sm text-warning-dark whitespace-pre-wrap">{client.notas}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'interview' && <InterviewTab client={client} />}

        {tab === 'measurements' && (
          <MeasurementChart client={client} measurements={measurements} />
        )}

        {tab === 'consultations' && (
          <div className="space-y-3">
            {consultations.length === 0 ? (
              <p className="text-center text-sage-400 py-12">{t.no_consultations}</p>
            ) : (
              [...consultations].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => (
                <div key={c.id} className="bg-white border border-sage-200 rounded-soft p-4 flex items-start gap-4">
                  <div className="text-center w-14 shrink-0">
                    <p className="text-xs font-bold text-wellness-500">{formatDate(c.fecha)}</p>
                    <p className="text-xs text-sage-400">{c.hora}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-sage-800">{c.tipo}</p>
                    {c.notasCliente && <p className="text-xs text-sage-500 mt-1">{c.notasCliente}</p>}
                  </div>
                  {c.matchedBy === 'system' && c.matchStatus === 'exact' && (
                    <button
                      onClick={async () => {
                        const ok = await confirm({ title: t.consultation_unlink_auto, message: t.consultation_unlink_confirm });
                        if (ok && unlinkAutoMatch(c.id)) toast.info(t.consultation_unlinked_ok);
                      }}
                      title={t.client_consultation_auto_title.replace('{via}', t[`match_via_${c.matchedVia || 'name'}`])}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-badge bg-info-light text-info hover:bg-info/20 transition-colors shrink-0"
                    >
                      <Unlink size={11} />
                      {t.client_consultation_auto}
                    </button>
                  )}
                  {c.estado === 'programada' && (
                    <button
                      onClick={() => sendWhatsApp(c, client)}
                      title={t.whatsapp_reminder}
                      aria-label={t.whatsapp_reminder}
                      className="p-1.5 rounded-button text-sage-400 hover:text-success hover:bg-success-light transition-colors shrink-0"
                    >
                      <MessageCircle size={14} className={c.reminders?.whatsapp ? 'text-success' : ''} />
                    </button>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-badge ${
                    c.estado === 'completada' ? 'bg-success-light text-success' :
                    c.estado === 'cancelada' ? 'bg-danger-light text-danger' :
                    'bg-wellness-50 text-wellness-500'
                  }`}>{c.estado}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'plans' && (
          <div className="space-y-6">
            {/* Planes nutricionales internos */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider flex items-center gap-2">
                <Leaf size={13} />
                {t.tab_plans}
              </h3>
              {nutritionPlans.length === 0 ? (
                <p className="text-center text-sage-400 py-8 text-sm">{t.no_plans}</p>
              ) : (
                nutritionPlans.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setEditingPlan(p)}
                    className="w-full text-left bg-white dark:bg-sage-800 border border-sage-200 dark:border-sage-700 rounded-soft p-4 hover:border-sage-300 hover:shadow-card transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sage-800 dark:text-sage-100">{p.nombre}</p>
                        <p className="text-xs text-sage-400 mt-0.5">{formatDate(p.fechaInicio)} — {formatDate(p.fechaFin)}</p>
                        {p.kcalObjetivo && <p className="text-xs text-wellness-500 mt-1">{p.kcalObjetivo} kcal/día</p>}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-badge ${
                        p.estado === 'activo' ? 'bg-success-light text-success' :
                        p.estado === 'borrador' ? 'bg-warning-light text-warning' :
                        'bg-sage-100 text-sage-500'
                      }`}>{p.estado}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Separador */}
            <div className="border-t border-sage-200 dark:border-sage-700" />

            {/* Documentos PDF vinculados */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider flex items-center gap-2">
                <FileText size={13} />
                {t.tab_documents}
              </h3>
              <ClientDocuments clientId={clientId} client={client} onSendEmail={(doc) => setEmailDoc(doc)} />
            </div>
          </div>
        )}

        {tab === 'payments' && (
          <div className="space-y-3">
            {invoices.length === 0 ? (
              <p className="text-center text-sage-400 py-12">{t.no_invoices}</p>
            ) : (
              [...invoices].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(inv => (
                <div key={inv.id} className="bg-white border border-sage-200 rounded-soft p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-sage-800">{inv.numero}</p>
                    <p className="text-xs text-sage-400">
                      {formatDate(inv.fecha)} · {inv.items?.[0]?.descripcion || inv.concepto || '—'}
                      {inv.items?.length > 1 && ` +${inv.items.length - 1}`}
                    </p>
                  </div>
                  <p className="tabular-nums font-semibold text-sage-800">{formatCurrency(inv.total ?? inv.importe ?? 0)}</p>
                  {/* StatusBadge calls a pending invoice "emitida" */}
                  <StatusBadge status={inv.estado === 'pendiente' ? 'emitida' : inv.estado} />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showEdit && <ClientModal client={client} onClose={() => setShowEdit(false)} />}
      {creating === 'consultation' && <ConsultationModal defaultClientId={client.id} onClose={() => setCreating(null)} />}
      {creating === 'plan' && <PlanEditorModal defaultClientId={client.id} onClose={() => setCreating(null)} />}
      {editingPlan && <PlanEditorModal plan={editingPlan} onClose={() => setEditingPlan(null)} />}
      {creating === 'invoice' && <InvoiceModal defaultClientId={client.id} onClose={() => setCreating(null)} />}
      {emailDoc && (
        <SendEmailModal
          mode="document"
          client={client}
          document={emailDoc}
          onClose={() => setEmailDoc(null)}
        />
      )}
    </div>
  );
};

export default ClientDetailView;
