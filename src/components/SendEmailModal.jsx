import React, { useState, useMemo } from 'react';
import { Send, Loader2, Eye, EyeOff, Mail } from 'lucide-react';
import { Modal, Button, Input, Textarea, useToast } from './UI';
import useStore from '../stores/store';
import {
  resolveTemplate, AVAILABLE_VARIABLES,
  DEFAULT_PLAN_TEMPLATES, DEFAULT_APPOINTMENT_TEMPLATES, DEFAULT_INVOICE_TEMPLATES, DEFAULT_DOCUMENT_TEMPLATES,
  sendPlanEmail, sendAppointmentReminder, sendEmailSMTP, openMailClient,
} from '../services/emailService';
import { useT } from '../i18n';

const MODES = [
  { id: 'plan',         label: 'Enviar plan nutricional' },
  { id: 'appointment',  label: 'Recordatorio de cita' },
  { id: 'invoice',      label: 'Enviar factura' },
  { id: 'document',     label: 'Enviar documento' },
];

export const SendEmailModal = ({
  mode: initialMode = 'plan',
  client,
  plan,
  consultation,
  invoice,
  document: docRecord,
  pdfBytes,
  onClose,
}) => {
  const config = useStore(s => s.config);
  const smtpPassword = useStore(s => s.smtpPassword);
  const clients = useStore(s => s.clients);
  const t = useT();
  const toast = useToast();

  const [mode, setMode] = useState(initialMode);
  const [lang, setLang] = useState(config.appLang || 'es');
  const [useSmtp, setUseSmtp] = useState(!!(config.smtp?.host && smtpPassword));
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // If no client passed, allow selecting one
  const [selectedClientId, setSelectedClientId] = useState(client?.id || '');
  const resolvedClient = client || clients.find(c => c.id === selectedClientId);

  const [docPdfBytes, setDocPdfBytes] = useState(pdfBytes);

  // Load document bytes lazily when mode is 'document'
  React.useEffect(() => {
    if (mode === 'document' && docRecord && !pdfBytes) {
      import('../services/documentService').then(({ getDocumentBase64 }) => {
        getDocumentBase64(docRecord.clienteId, docRecord.storedFileName)
          .then(b64 => {
            const binaryStr = atob(b64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            setDocPdfBytes(bytes);
          })
          .catch(() => { toast.error('Error al cargar el documento adjunto'); });
      });
    }
  }, [mode, docRecord]);

  // Build template defaults from mode
  const defaultTemplates = {
    plan: DEFAULT_PLAN_TEMPLATES,
    appointment: DEFAULT_APPOINTMENT_TEMPLATES,
    invoice: DEFAULT_INVOICE_TEMPLATES,
    document: DEFAULT_DOCUMENT_TEMPLATES,
  };

  const defaults = defaultTemplates[mode]?.[lang] || defaultTemplates[mode]?.es || { subject: '', body: '' };
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);

  // When mode or lang changes, reset template
  const resetTemplate = (newMode, newLang) => {
    const tmpl = defaultTemplates[newMode]?.[newLang] || defaultTemplates[newMode]?.es;
    if (tmpl) { setSubject(tmpl.subject); setBody(tmpl.body); }
  };

  const locationName = (id) => config.locations?.find(l => l.id === id)?.name || id || '';

  const resolveCtx = {
    client: resolvedClient,
    consultation,
    plan,
    invoice,
    document: docRecord,
    config,
    locationName,
  };

  const resolvedSubject = useMemo(() => resolveTemplate(subject, resolveCtx), [subject, resolvedClient, consultation, plan, invoice, config]);
  const resolvedBody    = useMemo(() => resolveTemplate(body, resolveCtx),    [body, resolvedClient, consultation, plan, invoice, config]);

  const smtpConfig = config.smtp?.host ? {
    host: config.smtp.host,
    port: config.smtp.port || 587,
    username: config.smtp.user,
    password: smtpPassword,
    fromEmail: config.smtp.user,
    fromName: config.nombre,
    useTls: config.smtp.secure !== false,
  } : null;

  const handleSend = async () => {
    if (!resolvedClient?.email) { toast.error('El cliente no tiene email registrado'); return; }

    setSending(true);
    try {
      let result;
      if (mode === 'plan') {
        result = await sendPlanEmail({
          client: resolvedClient, plan, config,
          subject: resolvedSubject, body: resolvedBody,
          pdfBytes, useSmtp, smtpConfig,
        });
      } else if (mode === 'appointment') {
        result = await sendAppointmentReminder({
          client: resolvedClient, consultation, config,
          subject: resolvedSubject, body: resolvedBody,
          useSmtp, smtpConfig,
        });
      } else if (mode === 'document') {
        const effectiveBytes = docPdfBytes || pdfBytes;
        if (useSmtp && smtpConfig) {
          result = await sendEmailSMTP({
            to: resolvedClient.email, toName: resolvedClient.nombre,
            subject: resolvedSubject, body: resolvedBody,
            pdfBytes: effectiveBytes, pdfFilename: docRecord?.fileName || 'documento.pdf',
            smtpConfig,
          });
        } else {
          result = await openMailClient({ to: resolvedClient.email, subject: resolvedSubject, body: resolvedBody });
        }
      } else {
        if (useSmtp && smtpConfig) {
          result = await sendEmailSMTP({
            to: resolvedClient.email, toName: resolvedClient.nombre,
            subject: resolvedSubject, body: resolvedBody,
            pdfBytes, pdfFilename: `${invoice?.numero || 'factura'}.pdf`,
            smtpConfig,
          });
        } else {
          result = await openMailClient({ to: resolvedClient.email, subject: resolvedSubject, body: resolvedBody });
        }
      }

      if (result?.success !== false) {
        toast.success(useSmtp ? 'Email enviado' : 'Cliente de correo abierto');
        onClose();
      } else {
        toast.error(result?.error || 'Error al enviar');
      }
    } catch (e) {
      toast.error(e.message || 'Error inesperado');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Enviar email" size="lg">
      <div className="space-y-4">
        {/* Mode selector */}
        <div className="flex gap-1 bg-sage-100 p-1 rounded-button">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setMode(id); resetTemplate(id, lang); }}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                mode === id ? 'bg-white text-sage-800 shadow-sm' : 'text-sage-500 hover:text-sage-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Client selector (if not pre-set) */}
        {!client && (
          <div>
            <label className="block text-xs font-medium text-sage-600 mb-1">Cliente *</label>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-sage-300 rounded-button bg-white text-sage-700 focus:outline-none focus:border-wellness-400"
            >
              <option value="">Seleccionar cliente...</option>
              {[...clients].sort((a,b) => a.nombre.localeCompare(b.nombre)).map(c => (
                <option key={c.id} value={c.id}>{c.nombre} {c.email ? `(${c.email})` : '(sin email)'}</option>
              ))}
            </select>
          </div>
        )}

        {/* To address */}
        {resolvedClient && (
          <div className="flex items-center gap-2 text-xs text-sage-500 bg-sage-50 px-3 py-2 rounded-button">
            <Mail size={12} />
            <span>Para: <strong className="text-sage-800">{resolvedClient.nombre}</strong> &lt;{resolvedClient.email || 'sin email'}&gt;</span>
          </div>
        )}

        {/* Language */}
        <div className="flex gap-2 items-center">
          <span className="text-xs text-sage-500">Idioma:</span>
          {['es','ca','en'].map(l => (
            <button
              key={l}
              onClick={() => { setLang(l); resetTemplate(mode, l); }}
              className={`px-2 py-0.5 text-xs rounded-badge transition-colors ${
                lang === l ? 'bg-wellness-400 text-white' : 'bg-sage-100 text-sage-600 hover:bg-sage-200'
              }`}
            >
              {l === 'es' ? 'ES' : l === 'ca' ? 'CA' : 'EN'}
            </button>
          ))}
        </div>

        {/* Subject */}
        <div>
          <label className="block text-xs font-medium text-sage-600 mb-1">Asunto</label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </div>

        {/* Body */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-sage-600">Mensaje</label>
            <button
              onClick={() => setShowPreview(p => !p)}
              className="flex items-center gap-1 text-xs text-sage-400 hover:text-sage-600"
            >
              {showPreview ? <EyeOff size={11} /> : <Eye size={11} />}
              {showPreview ? 'Editar' : 'Vista previa'}
            </button>
          </div>
          {showPreview ? (
            <div className="p-3 bg-sage-50 border border-sage-200 rounded-soft text-xs text-sage-700 whitespace-pre-wrap min-h-[160px]">
              {resolvedBody}
            </div>
          ) : (
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={8} />
          )}
        </div>

        {/* Variables hint */}
        <details className="text-xs">
          <summary className="cursor-pointer text-sage-400 hover:text-sage-600">Variables disponibles</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {AVAILABLE_VARIABLES.map(v => (
              <button
                key={v.key}
                onClick={() => setBody(b => b + v.key)}
                className="px-1.5 py-0.5 bg-sage-100 text-sage-600 rounded font-mono hover:bg-sage-200 transition-colors"
                title={v.label}
              >
                {v.key}
              </button>
            ))}
          </div>
        </details>

        {/* Send method */}
        <div className="flex items-center gap-3 pt-1">
          <label className="flex items-center gap-2 text-xs text-sage-600 cursor-pointer">
            <input
              type="checkbox"
              checked={useSmtp}
              onChange={e => setUseSmtp(e.target.checked)}
              disabled={!smtpConfig}
            />
            Enviar vía SMTP {!smtpConfig && <span className="text-sage-400">(configura SMTP en Ajustes)</span>}
          </label>
        </div>

        {(pdfBytes || docPdfBytes) && (
          <p className="text-xs text-wellness-600 bg-wellness-50 px-3 py-1.5 rounded-button">
            PDF adjunto listo para enviar {docRecord?.fileName ? `(${docRecord.fileName})` : ''}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-sage-200 mt-4">
        <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
        <Button
          variant="primary"
          icon={sending ? Loader2 : Send}
          onClick={handleSend}
          disabled={sending || (!resolvedClient?.email)}
        >
          {sending ? 'Enviando...' : useSmtp ? 'Enviar' : 'Abrir cliente de correo'}
        </Button>
      </div>
    </Modal>
  );
};

export default SendEmailModal;
