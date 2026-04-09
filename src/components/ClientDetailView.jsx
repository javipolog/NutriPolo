import React, { useState } from 'react';
import { ArrowLeft, Edit2, MessageCircle, Phone, Mail, Calendar, Leaf, Receipt, FileText } from 'lucide-react';
import { Button, useToast } from './UI';
import useStore, { formatDate, calcIMC } from '../stores/store';
import { useT } from '../i18n';
import { ClientModal } from './ClientModal';
import { MeasurementChart } from './MeasurementChart';
import { ClientDocuments } from './ClientDocuments';
import { SendEmailModal } from './SendEmailModal';
import { openWhatsAppReminder } from '../services/whatsappService';

const OBJETIVO_LABELS = {
  perdida_grasa: 'Pérdida grasa', ganancia_muscular: 'Ganancia muscular',
  mejora_digestiva: 'Mejora digestiva', rendimiento_deportivo: 'Deporte',
  dietoterapia: 'Dietoterapia', relacion_alimentacion: 'Relación alimentación',
};

const InfoRow = ({ label, value }) => (
  <div className="flex justify-between py-1.5 border-b border-sage-100 last:border-0">
    <span className="text-xs text-sage-500">{label}</span>
    <span className="text-xs text-sage-800 font-medium text-right max-w-xs">{value || '—'}</span>
  </div>
);

export const ClientDetailView = ({ clientId, onBack }) => {
  const client = useStore(s => s.clients.find(c => c.id === clientId));
  const consultations = useStore(s => s.consultations.filter(c => c.clienteId === clientId));
  const nutritionPlans = useStore(s => s.nutritionPlans.filter(p => p.clienteId === clientId));
  const invoices = useStore(s => s.invoices.filter(i => i.clienteId === clientId));
  const measurements = useStore(s => s.getClientMeasurements(clientId));
  const config = useStore(s => s.config);
  const updateConsultation = useStore(s => s.updateConsultation);
  const setCurrentView = useStore(s => s.setCurrentView);

  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState('profile');
  const [showEdit, setShowEdit] = useState(false);
  const [emailDoc, setEmailDoc] = useState(null);

  if (!client) { onBack(); return null; }

  const lastMeasurement = measurements[measurements.length - 1];
  const currentIMC = lastMeasurement?.imc || (lastMeasurement?.peso && client.altura ? calcIMC(lastMeasurement.peso, client.altura) : null);

  const openWhatsApp = () => {
    const phone = (client.whatsapp || client.telefono || '').replace(/\D/g, '');
    if (!phone) { toast.error(t.no_phone_number); return; }
    const cc = (config.whatsappCountryCode || '34').replace(/\D/g, '');
    window.open(`https://wa.me/${cc}${phone}`, '_blank');
  };

  const locationName = (id) => config.locations?.find(l => l.id === id)?.name || id || '';

  const handleWhatsAppReminder = (consultation) => {
    const result = openWhatsAppReminder({ client, consultation, config, locationName });
    if (result.error === 'no_phone') { toast.error(t.whatsapp_no_phone); return; }
    if (result.success) {
      updateConsultation(consultation.id, { lastWhatsappReminder: new Date().toISOString() });
      toast.success(t.whatsapp_reminder_sent);
    }
  };

  const TABS = [
    { id: 'profile',       label: t.tab_profile },
    { id: 'measurements',  label: t.tab_measurements },
    { id: 'consultations', label: t.tab_consultations },
    { id: 'plans',         label: t.tab_plans },
    { id: 'payments',      label: t.tab_payments },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
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
              <h1 className="text-xl font-bold text-sage-900">{client.nombre}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-sage-500">
                {client.email && <span className="flex items-center gap-1"><Mail size={11} />{client.email}</span>}
                {client.telefono && <span className="flex items-center gap-1"><Phone size={11} />{client.telefono}</span>}
                <span>{t.client_since}: {formatDate(client.fechaAlta)}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(client.objetivos || []).map(o => (
                  <span key={o} className="text-[10px] px-2 py-0.5 bg-wellness-50 text-wellness-600 rounded-badge">
                    {OBJETIVO_LABELS[o] || o}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={openWhatsApp} icon={MessageCircle}>WhatsApp</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)} icon={Edit2}>{t.edit}</Button>
          </div>
        </div>

        {/* Quick stats */}
        {lastMeasurement && (
          <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-sage-100">
            <div className="text-center">
              <p className="text-xs text-sage-400">{t.measurement_weight}</p>
              <p className="text-lg font-bold text-sage-800">{lastMeasurement.peso}<span className="text-xs font-normal text-sage-400"> kg</span></p>
            </div>
            {currentIMC && (
              <div className="text-center">
                <p className="text-xs text-sage-400">{t.measurement_bmi}</p>
                <p className="text-lg font-bold text-sage-800">{currentIMC}</p>
              </div>
            )}
            {lastMeasurement.grasaCorporal && (
              <div className="text-center">
                <p className="text-xs text-sage-400">{t.measurement_body_fat}</p>
                <p className="text-lg font-bold text-sage-800">{lastMeasurement.grasaCorporal}<span className="text-xs font-normal text-sage-400"> %</span></p>
              </div>
            )}
            {client.altura && (
              <div className="text-center">
                <p className="text-xs text-sage-400">{t.client_height}</p>
                <p className="text-lg font-bold text-sage-800">{client.altura}<span className="text-xs font-normal text-sage-400"> cm</span></p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-sage-200">
        {TABS.map(tb => (
          <button
            key={tb.id}
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
      <div className="animate-fadeIn">
        {tab === 'profile' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white border border-sage-200 rounded-soft p-4">
              <h3 className="text-sm font-semibold text-sage-700 mb-3">{t.client_personal_data}</h3>
              <InfoRow label="Email" value={client.email} />
              <InfoRow label="Teléfono" value={client.telefono} />
              <InfoRow label="NIF" value={client.nif} />
              <InfoRow label={t.client_street} value={client.calle} />
              <InfoRow label={t.client_city} value={[client.codigoPostal, client.ciudad, client.provincia].filter(Boolean).join(', ')} />
              <InfoRow label="Fecha nacimiento" value={formatDate(client.fechaNacimiento)} />
              <InfoRow label="Género" value={client.genero === 'M' ? 'Hombre' : client.genero === 'F' ? 'Mujer' : client.genero} />
              <InfoRow label="Altura" value={client.altura ? `${client.altura} cm` : null} />
              <InfoRow label="Nivel actividad" value={client.nivelActividad} />
            </div>
            <div className="bg-white border border-sage-200 rounded-soft p-4">
              <h3 className="text-sm font-semibold text-sage-700 mb-3">{t.client_health_profile}</h3>
              {(client.alergias || []).length > 0 && <InfoRow label="Alergias" value={client.alergias.join(', ')} />}
              {(client.intolerancias || []).length > 0 && <InfoRow label="Intolerancias" value={client.intolerancias.join(', ')} />}
              {(client.patologias || []).length > 0 && <InfoRow label="Patologías" value={client.patologias.join(', ')} />}
              {client.medicacion && <InfoRow label="Medicación" value={client.medicacion} />}
              {client.ejercicio && <InfoRow label="Ejercicio" value={client.ejercicio} />}
              {(client.restriccionesDieteticas || []).length > 0 && <InfoRow label="Restricciones" value={client.restriccionesDieteticas.join(', ')} />}
            </div>
            {client.notas && (
              <div className="col-span-full bg-warning-light border border-warning/20 rounded-soft p-4">
                <p className="text-xs font-semibold text-warning-dark mb-1">{t.client_private_notes}</p>
                <p className="text-sm text-warning-dark whitespace-pre-wrap">{client.notas}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'measurements' && (
          <MeasurementChart clientId={clientId} measurements={measurements} clientHeight={client.altura} />
        )}

        {tab === 'consultations' && (
          <div className="space-y-3">
            {consultations.length === 0 ? (
              <p className="text-center text-sage-400 py-12">{t.no_consultations}</p>
            ) : (
              consultations.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => (
                <div key={c.id} className="bg-white border border-sage-200 rounded-soft p-4 flex items-start gap-4">
                  <div className="text-center w-14 shrink-0">
                    <p className="text-xs font-bold text-wellness-500">{formatDate(c.fecha)}</p>
                    <p className="text-xs text-sage-400">{c.hora}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-sage-800">{c.tipo}</p>
                    {c.notasCliente && <p className="text-xs text-sage-500 mt-1">{c.notasCliente}</p>}
                  </div>
                  {c.estado === 'programada' && (
                    <button
                      onClick={() => handleWhatsAppReminder(c)}
                      title={t.whatsapp_reminder}
                      className="p-1.5 rounded-button text-sage-400 hover:text-success hover:bg-success-light transition-colors shrink-0"
                    >
                      <MessageCircle size={14} className={c.lastWhatsappReminder ? 'text-success' : ''} />
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
                  <div key={p.id} className="bg-white dark:bg-sage-800 border border-sage-200 dark:border-sage-700 rounded-soft p-4">
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
                  </div>
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
              invoices.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(inv => (
                <div key={inv.id} className="bg-white border border-sage-200 rounded-soft p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-sage-800">{inv.numero}</p>
                    <p className="text-xs text-sage-400">
                      {formatDate(inv.fecha)} · {inv.items?.[0]?.descripcion || inv.concepto || '—'}
                      {inv.items?.length > 1 && ` +${inv.items.length - 1}`}
                    </p>
                  </div>
                  <p className="font-mono font-semibold text-sage-800">{(inv.total ?? inv.importe ?? 0).toFixed(2)} €</p>
                  <span className={`text-xs px-2 py-0.5 rounded-badge ${
                    inv.estado === 'pagada' ? 'bg-success-light text-success' :
                    inv.estado === 'anulada' ? 'bg-danger-light text-danger' :
                    'bg-warning-light text-warning'
                  }`}>{inv.estado}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showEdit && <ClientModal client={client} onClose={() => setShowEdit(false)} />}
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
