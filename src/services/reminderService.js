/**
 * reminderService.js — NutriPolo
 * ================================
 * Appointment reminders by email and WhatsApp.
 *
 *  - Email: sent automatically over SMTP when the reminder window opens
 *    (see useBackgroundJobs), or by hand from the Dashboard panel.
 *  - WhatsApp: semi-automatic. The app builds a wa.me link with the message
 *    pre-filled and opens it; the nutritionist presses "Send" in WhatsApp.
 *
 * The first half of this file is pure (no Tauri / store access) so the
 * scheduling rules can be unit-tested.
 */

import { open as openUrl } from '@tauri-apps/api/shell';
import {
  resolveTemplate, DEFAULT_APPOINTMENT_TEMPLATES, sendEmailSMTP, openMailClient, buildSmtpConfig,
} from './emailService';

export const REMINDER_CHANNELS = ['email', 'whatsapp'];

export const DEFAULT_WHATSAPP_REMINDER_TEMPLATES = {
  es: `Hola {{clientNom}}, te recuerdo tu cita del {{citaDia}} {{citaData}} a las {{citaHora}} en {{citaUbicacio}}. Si necesitas cambiarla, avísame con antelación. {{nutriNom}}`,
  ca: `Hola {{clientNom}}, et recordo la teva cita del {{citaDia}} {{citaData}} a les {{citaHora}} a {{citaUbicacio}}. Si necessites canviar-la, avisa'm amb antelació. {{nutriNom}}`,
  en: `Hi {{clientNom}}, just a reminder about your appointment on {{citaDia}} {{citaData}} at {{citaHora}} in {{citaUbicacio}}. Please let me know in advance if you need to reschedule. {{nutriNom}}`,
};

export const DEFAULT_REMINDER_CONFIG = {
  // `templates` holds only the languages the user customised; the rest fall
  // back to the defaults above / DEFAULT_APPOINTMENT_TEMPLATES.
  email:    { enabled: true, auto: false, leadHours: 24, templates: {} },
  whatsapp: { enabled: true, leadHours: 24, templates: {} },
  // Never remind when the appointment is closer than this (late bookings).
  minLeadHours: 2,
  // No automatic emails inside this window (crosses midnight when from > to).
  quietHours: { enabled: true, from: '21:00', to: '08:00' },
};

const SENDING_STALE_MS = 10 * 60 * 1000;
export const MAX_AUTO_ATTEMPTS = 3;

/** Reminder settings with defaults filled in (config.reminders may be partial or missing). */
export function getReminderConfig(config) {
  const r = config?.reminders || {};
  return {
    ...DEFAULT_REMINDER_CONFIG,
    ...r,
    email:      { ...DEFAULT_REMINDER_CONFIG.email,      ...(r.email || {}) },
    whatsapp:   { ...DEFAULT_REMINDER_CONFIG.whatsapp,   ...(r.whatsapp || {}) },
    quietHours: { ...DEFAULT_REMINDER_CONFIG.quietHours, ...(r.quietHours || {}) },
  };
}

/** Local Date for a consultation's start (09:00 when it has no time). */
export function consultationStart(c) {
  if (!c?.fecha) return null;
  const [y, m, d] = c.fecha.split('-').map(Number);
  const [hh, mm] = (c.hora || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

/** Identifies the scheduled slot; a reschedule changes it and re-arms the reminder. */
export function reminderSlot(c) {
  return `${c.fecha}T${c.hora || ''}`;
}

/**
 * Digits-only international number for wa.me, or '' when unusable.
 *  "+34 622…" / "0034622…" → kept as international
 *  "34622…" (prefix + 9 digits) → kept
 *  "622…"   → country code prepended
 */
export function normalizeWhatsAppPhone(raw, countryCode = '34') {
  const s = String(raw || '').trim();
  if (!s) return '';
  let digits = s.replace(/\D/g, '');
  const code = String(countryCode || '34').replace(/\D/g, '');
  if (s.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!(code && digits.startsWith(code) && digits.length >= code.length + 9)) {
    digits = code + digits;
  }
  return digits.length >= 8 ? digits : '';
}

export function clientLanguage(client, config) {
  const lang = client?.idioma || config?.appLang || 'es';
  return ['es', 'ca', 'en'].includes(lang) ? lang : 'es';
}

export function isQuietTime(now, quietHours) {
  if (!quietHours?.enabled || !quietHours.from || !quietHours.to) return false;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMin(quietHours.from);
  const to = toMin(quietHours.to);
  if (from === to) return false;
  return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function channelContact(channel, client, config) {
  if (channel === 'email') return EMAIL_RE.test(client?.email || '') ? client.email : '';
  return normalizeWhatsAppPhone(client?.whatsapp || client?.telefono, config?.whatsappCountryCode);
}

/**
 * State of one channel's reminder for one consultation:
 *   sent | opened | manual | sending  → already handled for this slot
 *   error      → last attempt failed (`attempts` tells how many)
 *   opted_out  → the client disabled this channel
 *   no_contact → missing / invalid email or phone
 *   upcoming   → window not open yet
 *   due        → should be sent now
 *   too_late   → closer than minLeadHours to the appointment
 */
export function reminderState({ consultation, client, channel, config, now }) {
  const rc = getReminderConfig(config);
  const start = consultationStart(consultation);
  const record = consultation.reminders?.[channel];
  if (record && record.slot === reminderSlot(consultation)) {
    if (record.status === 'sending' && now - new Date(record.at).getTime() > SENDING_STALE_MS) return 'error';
    return record.status;
  }
  if (client?.recordatorios?.[channel] === false) return 'opted_out';
  if (!channelContact(channel, client, config)) return 'no_contact';
  const msToStart = start.getTime() - now;
  if (msToStart < rc.minLeadHours * 3600000) return 'too_late';
  if (msToStart > rc[channel].leadHours * 3600000) return 'upcoming';
  return 'due';
}

/**
 * Reminder entries for programmed consultations starting within the next
 * `horizonHours`. Pass only consultations from visible calendars.
 * Consultations without a linked client yield one entry with channel null
 * and state 'no_client' (their reminders cannot be sent).
 */
export function getReminderCandidates({ consultations, clients, config, now = Date.now(), horizonHours }) {
  const rc = getReminderConfig(config);
  const channels = REMINDER_CHANNELS.filter(ch => rc[ch].enabled);
  const horizon = (horizonHours ?? Math.max(rc.email.leadHours, rc.whatsapp.leadHours) + 24) * 3600000;
  const clientsById = new Map((clients || []).map(c => [c.id, c]));
  const entries = [];
  for (const consultation of consultations || []) {
    if (consultation.estado !== 'programada') continue;
    const start = consultationStart(consultation);
    if (!start) continue;
    const ms = start.getTime() - now;
    if (ms <= 0 || ms > horizon) continue;
    const client = consultation.clienteId ? clientsById.get(consultation.clienteId) : null;
    if (!client) {
      entries.push({ consultation, client: null, channel: null, state: 'no_client', start });
      continue;
    }
    for (const channel of channels) {
      entries.push({
        consultation, client, channel, start,
        state: reminderState({ consultation, client, channel, config, now }),
        record: consultation.reminders?.[channel] || null,
      });
    }
  }
  return entries.sort((a, b) => a.start - b.start);
}

/** Whether automatic sending should pick this email entry up. */
export function isAutoSendable(entry) {
  if (entry.channel !== 'email') return false;
  if (entry.state === 'due') return true;
  return entry.state === 'error' && (entry.record?.attempts || 0) < MAX_AUTO_ATTEMPTS;
}

export function buildReminderEmail({ consultation, client, config }) {
  const rc = getReminderConfig(config);
  const lang = clientLanguage(client, config);
  const tmpl = rc.email.templates?.[lang] || DEFAULT_APPOINTMENT_TEMPLATES[lang] || DEFAULT_APPOINTMENT_TEMPLATES.es;
  const ctx = { client, consultation, config, lang };
  return { subject: resolveTemplate(tmpl.subject, ctx), body: resolveTemplate(tmpl.body, ctx), lang };
}

export function whatsAppTemplate(config, lang) {
  const rc = getReminderConfig(config);
  return rc.whatsapp.templates?.[lang]
    || config?.whatsappReminderTemplate?.[lang]   // pre-1.10 setting
    || DEFAULT_WHATSAPP_REMINDER_TEMPLATES[lang]
    || DEFAULT_WHATSAPP_REMINDER_TEMPLATES.es;
}

export function buildReminderWhatsApp({ consultation, client, config }) {
  const phone = normalizeWhatsAppPhone(client?.whatsapp || client?.telefono, config?.whatsappCountryCode);
  if (!phone) return { error: 'no_phone' };
  const lang = clientLanguage(client, config);
  const text = resolveTemplate(whatsAppTemplate(config, lang), { client, consultation, config, lang });
  return { url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, text, phone };
}

// ── Side effects ────────────────────────────────────────────────────────────

/** Open an https URL in the system browser (window.open is unreliable in Tauri 1). */
export async function openExternal(url) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

/** Open a WhatsApp chat (no message) with a client. */
export async function openWhatsAppChat(client, config) {
  const phone = normalizeWhatsAppPhone(client?.whatsapp || client?.telefono, config?.whatsappCountryCode);
  if (!phone) return { success: false, error: 'no_phone' };
  await openExternal(`https://wa.me/${phone}`);
  return { success: true };
}

export async function openWhatsAppReminder({ consultation, client, config }) {
  const built = buildReminderWhatsApp({ consultation, client, config });
  if (built.error) return { success: false, error: built.error };
  await openExternal(built.url);
  return { success: true };
}

/**
 * Send an email reminder. With SMTP configured it is sent directly;
 * otherwise the user's mail client opens pre-filled (`manual: true`).
 */
export async function sendEmailReminder({ consultation, client, config, smtpPassword = '', subject, body }) {
  const built = buildReminderEmail({ consultation, client, config });
  const finalSubject = subject ?? built.subject;
  const finalBody = body ?? built.body;
  const smtpConfig = buildSmtpConfig(config, smtpPassword);
  if (smtpConfig) {
    const result = await sendEmailSMTP({
      to: client.email, toName: client.nombre, subject: finalSubject, body: finalBody, smtpConfig,
    });
    return { success: !!result?.success, error: result?.error || null, manual: false };
  }
  const result = await openMailClient({
    to: client.email, subject: finalSubject, body: finalBody, provider: config?.emailProvider || 'gmail',
  });
  return { success: result?.success !== false, error: result?.error || null, manual: true };
}
