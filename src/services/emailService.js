/**
 * emailService.js — NutriPolo
 * ============================
 * Servicio de envío de emails para la práctica de nutrición.
 * Soporta: entrega de plan nutricional, recordatorio de cita, factura.
 * SMTP directo vía backend Rust (lettre) o apertura de cliente de correo web.
 */

import { invoke } from '@tauri-apps/api/tauri';
import { open as openUrl } from '@tauri-apps/api/shell';

// ── Template variable resolver ─────────────────────────────────────────────

/**
 * Variables disponibles:
 *   {{clientNom}}     {{citaData}}    {{planNom}}       {{nutriNom}}
 *   {{clientEmail}}   {{citaHora}}    {{planFechaInicio}}{{nutriEmail}}
 *   {{citaUbicacio}}  {{citaTipus}}   {{planFechaFin}}   {{nutriTel}}
 *   {{facturaNum}}    {{facturaTotal}}                   {{nutriWeb}}
 */
export const resolveTemplate = (template, { client, consultation, plan, invoice, document, config, locationName } = {}) => {
  if (!template) return '';

  const fmt = (d) => {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  };
  const fmtCurrency = (n) => n != null
    ? new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR' }).format(n)
    : '—';

  const vars = {
    '{{clientNom}}':       client?.nombre        || '—',
    '{{clientEmail}}':     client?.email         || '—',
    '{{citaData}}':        fmt(consultation?.fecha),
    '{{citaHora}}':        consultation?.hora    || '—',
    '{{citaUbicacio}}':    locationName?.(consultation?.locationId) || consultation?.locationId || '—',
    '{{citaTipus}}':       consultation?.tipo    || '—',
    '{{planNom}}':         plan?.nombre          || '—',
    '{{planFechaInicio}}': fmt(plan?.fechaInicio),
    '{{planFechaFin}}':    fmt(plan?.fechaFin),
    '{{facturaNum}}':      invoice?.numero       || '—',
    '{{facturaTotal}}':    fmtCurrency(invoice?.total ?? invoice?.importe),
    '{{facturaConcepte}}': invoice?.items?.map(i => i.descripcion).filter(Boolean).join(', ') || invoice?.concepto || '—',
    '{{docNom}}':          document?.nombre      || document?.fileName || '—',
    '{{nutriNom}}':        config?.nombre        || '—',
    '{{nutriEmail}}':      config?.email         || '—',
    '{{nutriTel}}':        config?.telefono      || '—',
    '{{nutriWeb}}':        config?.web           || '—',
  };

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
};

// ── Default templates ──────────────────────────────────────────────────────

export const DEFAULT_PLAN_TEMPLATES = {
  es: {
    subject: 'Tu plan nutricional – {{planNom}}',
    body: `Hola {{clientNom}},

Te envío adjunto tu plan nutricional personalizado: {{planNom}}.

Este plan está diseñado para el período {{planFechaInicio}} – {{planFechaFin}}. Léelo con calma y apunta cualquier duda para comentarla en nuestra próxima consulta.

Si tienes alguna pregunta antes de esa fecha, no dudes en escribirme.

Un abrazo,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
  ca: {
    subject: 'El teu pla nutricional – {{planNom}}',
    body: `Hola {{clientNom}},

T'envio adjunt el teu pla nutricional personalitzat: {{planNom}}.

Aquest pla és per al període {{planFechaInicio}} – {{planFechaFin}}. Llegeix-lo amb calma i apunta qualsevol dubte per comentar-lo a la propera consulta.

Si tens alguna pregunta abans, no dubtis en escriure'm.

Una abraçada,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
  en: {
    subject: 'Your nutrition plan – {{planNom}}',
    body: `Hi {{clientNom}},

Please find attached your personalised nutrition plan: {{planNom}}.

This plan covers the period {{planFechaInicio}} – {{planFechaFin}}. Take your time reading it and note down any questions for our next appointment.

Feel free to reach out if you have any questions before then.

Best wishes,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
};

export const DEFAULT_APPOINTMENT_TEMPLATES = {
  es: {
    subject: 'Recordatorio de cita – {{citaData}}',
    body: `Hola {{clientNom}},

Te recuerdo que tienes una cita programada:

📅 Fecha: {{citaData}}
🕐 Hora: {{citaHora}}
📍 Lugar: {{citaUbicacio}}
🗂 Tipo: {{citaTipus}}

Si necesitas cambiar o cancelar la cita, escríbeme con antelación.

¡Hasta pronto!
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
  ca: {
    subject: 'Recordatori de cita – {{citaData}}',
    body: `Hola {{clientNom}},

Et recordo que tens una cita programada:

📅 Data: {{citaData}}
🕐 Hora: {{citaHora}}
📍 Lloc: {{citaUbicacio}}
🗂 Tipus: {{citaTipus}}

Si necessites canviar o cancel·lar la cita, escriu-me amb antelació.

Fins aviat!
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
  en: {
    subject: 'Appointment reminder – {{citaData}}',
    body: `Hi {{clientNom}},

Just a reminder that you have an appointment scheduled:

📅 Date: {{citaData}}
🕐 Time: {{citaHora}}
📍 Location: {{citaUbicacio}}
🗂 Type: {{citaTipus}}

Please let me know in advance if you need to reschedule or cancel.

See you soon!
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
};

export const DEFAULT_INVOICE_TEMPLATES = {
  es: {
    subject: 'Factura {{facturaNum}} – {{nutriNom}}',
    body: `Hola {{clientNom}},

Adjunto encontrarás la factura {{facturaNum}} por importe de {{facturaTotal}}.

Concepto: {{facturaConcepte}}

Gracias por tu confianza. Cualquier duda, no dudes en contactarme.

Un abrazo,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
  ca: {
    subject: 'Factura {{facturaNum}} – {{nutriNom}}',
    body: `Hola {{clientNom}},

Adjunt trobaràs la factura {{facturaNum}} per import de {{facturaTotal}}.

Concepte: {{facturaConcepte}}

Gràcies per la teva confiança. Qualsevol dubte, no dubtis en contactar-me.

Una abraçada,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
  en: {
    subject: 'Invoice {{facturaNum}} – {{nutriNom}}',
    body: `Hi {{clientNom}},

Please find attached invoice {{facturaNum}} for {{facturaTotal}}.

Description: {{facturaConcepte}}

Thank you for trusting me. Please don't hesitate to reach out with any questions.

Best,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}`,
  },
};

export const DEFAULT_DOCUMENT_TEMPLATES = {
  es: {
    subject: 'Documento adjunto – {{docNom}}',
    body: `Hola {{clientNom}},

Te envío adjunto el siguiente documento: {{docNom}}.

Si tienes alguna pregunta, no dudes en escribirme.

Un abrazo,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
  ca: {
    subject: 'Document adjunt – {{docNom}}',
    body: `Hola {{clientNom}},

T'envio adjunt el següent document: {{docNom}}.

Si tens cap dubte, no dubtis en escriure'm.

Una abraçada,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
  en: {
    subject: 'Attached document – {{docNom}}',
    body: `Hi {{clientNom}},

Please find attached the following document: {{docNom}}.

If you have any questions, don't hesitate to reach out.

Best,
{{nutriNom}}
{{nutriEmail}} | {{nutriTel}}
{{nutriWeb}}`,
  },
};

// ── Available variables list (for UI helper) ───────────────────────────────

export const AVAILABLE_VARIABLES = [
  { key: '{{clientNom}}',      label: 'Nombre del cliente' },
  { key: '{{clientEmail}}',    label: 'Email del cliente' },
  { key: '{{citaData}}',       label: 'Fecha de la cita' },
  { key: '{{citaHora}}',       label: 'Hora de la cita' },
  { key: '{{citaUbicacio}}',   label: 'Ubicación de la cita' },
  { key: '{{citaTipus}}',      label: 'Tipo de consulta' },
  { key: '{{planNom}}',        label: 'Nombre del plan' },
  { key: '{{planFechaInicio}}',label: 'Fecha inicio del plan' },
  { key: '{{planFechaFin}}',   label: 'Fecha fin del plan' },
  { key: '{{facturaNum}}',     label: 'Número de factura' },
  { key: '{{facturaTotal}}',   label: 'Importe de la factura' },
  { key: '{{docNom}}',         label: 'Nombre del documento' },
  { key: '{{nutriNom}}',       label: 'Tu nombre' },
  { key: '{{nutriEmail}}',     label: 'Tu email' },
  { key: '{{nutriTel}}',       label: 'Tu teléfono' },
  { key: '{{nutriWeb}}',       label: 'Tu web' },
];

// ── Email providers (webmail openers) ─────────────────────────────────────

const EMAIL_PROVIDERS = {
  gmail: {
    label: 'Gmail',
    buildUrl: ({ to, subject, body }) => {
      const e = encodeURIComponent;
      return `https://mail.google.com/mail/?view=cm&to=${e(to)}&su=${e(subject)}&body=${e(body)}`;
    },
  },
  outlook: {
    label: 'Outlook',
    buildUrl: ({ to, subject, body }) => {
      const e = encodeURIComponent;
      return `https://outlook.live.com/mail/0/deeplink/compose?to=${e(to)}&subject=${e(subject)}&body=${e(body)}`;
    },
  },
  mailto: {
    label: 'Cliente nativo',
    buildUrl: ({ to, subject, body }) => {
      const e = encodeURIComponent;
      return `mailto:${to}?subject=${e(subject)}&body=${e(body)}`;
    },
  },
};
export { EMAIL_PROVIDERS };

// ── Open webmail client ────────────────────────────────────────────────────

export const openMailClient = async ({ to, subject, body, provider = 'gmail' }) => {
  const prov = EMAIL_PROVIDERS[provider] || EMAIL_PROVIDERS.gmail;
  const url = prov.buildUrl({ to, subject, body });
  try {
    await openUrl(url);
    return { success: true };
  } catch {
    window.open(url, '_blank');
    return { success: true };
  }
};

// ── SMTP helpers ───────────────────────────────────────────────────────────

const uint8ArrayToBase64 = (bytes) => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

export const sendEmailSMTP = async ({ to, toName, subject, body, pdfBytes, pdfFilename, smtpConfig }) => {
  const pdfBase64 = pdfBytes ? uint8ArrayToBase64(pdfBytes) : null;
  try {
    const result = await invoke('send_email_smtp', {
      toEmail: to,
      toName: toName || null,
      subject,
      bodyText: body,
      pdfBase64,
      pdfFilename: pdfFilename || 'documento.pdf',
      smtpConfig,
    });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

export const testSmtpConnection = async (smtpConfig) => {
  try {
    const result = await invoke('test_smtp_connection', { smtpConfig });
    return result;
  } catch (e) {
    return { success: false, error: String(e) };
  }
};

// ── High-level send functions ──────────────────────────────────────────────

/**
 * Send a nutrition plan (optionally with PDF attachment).
 */
export const sendPlanEmail = async ({ client, plan, config, subject, body, pdfBytes, useSmtp, smtpConfig }) => {
  if (useSmtp && smtpConfig) {
    const safeName = (plan?.nombre || 'plan').replace(/[^a-zA-Z0-9_-]/g, '_');
    return sendEmailSMTP({
      to: client?.email || '',
      toName: client?.nombre,
      subject, body, pdfBytes,
      pdfFilename: `${safeName}.pdf`,
      smtpConfig,
    });
  }
  return openMailClient({ to: client?.email || '', subject, body, provider: config?.emailProvider || 'gmail' });
};

/**
 * Send an appointment reminder.
 */
export const sendAppointmentReminder = async ({ client, consultation, config, subject, body, useSmtp, smtpConfig }) => {
  if (useSmtp && smtpConfig) {
    return sendEmailSMTP({ to: client?.email || '', toName: client?.nombre, subject, body, smtpConfig });
  }
  return openMailClient({ to: client?.email || '', subject, body, provider: config?.emailProvider || 'gmail' });
};
