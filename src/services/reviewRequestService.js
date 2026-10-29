/**
 * reviewRequestService.js — NutriPolo
 * =====================================
 * Asking patients for a Google review after their consultation.
 *
 *  - Sent `delayHours` after the consultation ends, by email (automatic over
 *    SMTP when enabled, see useBackgroundJobs) or WhatsApp (semi-automatic).
 *  - Configurable by visit kind (first visit / follow-up, from the client's
 *    history) and by location (each one can be switched off and have its own
 *    Google review link; the general link is the fallback).
 *  - Asked once per client: after any request was sent or opened, the
 *    client's other consultations show `already_asked`.
 *
 * The first half of this file is pure (no Tauri / store access) so the rules
 * can be unit-tested.
 */

import { resolveTemplate } from './emailService';
import {
  consultationStart, clientLanguage, channelContact, normalizeWhatsAppPhone, whatsAppUrl,
  openExternal, MAX_AUTO_ATTEMPTS,
} from './reminderService';

export const REVIEW_CHANNELS = ['email', 'whatsapp'];

export const DEFAULT_REVIEW_EMAIL_TEMPLATES = {
  es: {
    subject: 'Gracias por tu visita, {{clientNom}}',
    body: `Hola {{clientNom}},

Gracias por confiar en mí para tu consulta del {{citaData}}. Espero que te haya resultado útil.

Si tienes un minuto, me ayudaría mucho que dejaras tu opinión en Google. Así otras personas pueden conocer mi trabajo:

{{resenaUrl}}

¡Muchas gracias!
{{nutriNom}}`,
  },
  ca: {
    subject: 'Gràcies per la teva visita, {{clientNom}}',
    body: `Hola {{clientNom}},

Gràcies per confiar en mi per a la consulta del {{citaData}}. Espero que t'hagi estat útil.

Si tens un minut, m'ajudaria molt que deixessis la teva opinió a Google. Així altres persones poden conèixer la meva feina:

{{resenaUrl}}

Moltes gràcies!
{{nutriNom}}`,
  },
  en: {
    subject: 'Thank you for your visit, {{clientNom}}',
    body: `Hi {{clientNom}},

Thank you for trusting me with your appointment on {{citaData}}. I hope you found it helpful.

If you have a minute, it would mean a lot if you left a review on Google. It helps other people find my work:

{{resenaUrl}}

Many thanks!
{{nutriNom}}`,
  },
};

export const DEFAULT_REVIEW_WHATSAPP_TEMPLATES = {
  es: `Hola {{clientNom}}, ¡gracias por tu confianza! Si tienes un minuto, me ayudaría mucho que dejaras tu opinión en Google: {{resenaUrl}} ¡Muchas gracias! {{nutriNom}}`,
  ca: `Hola {{clientNom}}, gràcies per la teva confiança! Si tens un minut, m'ajudaria molt que deixessis la teva opinió a Google: {{resenaUrl}} Moltes gràcies! {{nutriNom}}`,
  en: `Hi {{clientNom}}, thank you for your trust! If you have a minute, it would mean a lot if you left a review on Google: {{resenaUrl}} Many thanks! {{nutriNom}}`,
};

export const DEFAULT_REVIEW_CONFIG = {
  enabled: false,
  afterFirstVisit: true,
  afterFollowUp: false,
  // Hours after the consultation ends before asking.
  delayHours: 3,
  // Consultations that ended longer ago than this are not offered any more.
  maxAgeDays: 7,
  // Fallback link for locations without their own.
  defaultUrl: '',
  // { [locationId]: { enabled, url } } — missing entries are enabled, no own link.
  locations: {},
  // `templates` holds only the languages the user customised.
  email:    { enabled: true, auto: false, templates: {} },
  whatsapp: { enabled: true, templates: {} },
};

const SENDING_STALE_MS = 10 * 60 * 1000;
const DONE_STATUSES = new Set(['sent', 'opened', 'manual', 'sending']);
const NOT_A_VISIT = new Set(['cancelada', 'no_show']);

/** Review settings with defaults filled in (config.reviewRequests may be partial or missing). */
export function getReviewConfig(config) {
  const r = config?.reviewRequests || {};
  return {
    ...DEFAULT_REVIEW_CONFIG,
    ...r,
    locations: { ...(r.locations || {}) },
    email:     { ...DEFAULT_REVIEW_CONFIG.email,    ...(r.email || {}) },
    whatsapp:  { ...DEFAULT_REVIEW_CONFIG.whatsapp, ...(r.whatsapp || {}) },
  };
}

export function isValidReviewUrl(url) {
  return /^https:\/\/\S+$/i.test(String(url || '').trim());
}

/** Whether review requests are on for a location (consultations without one count as on). */
export function isLocationEnabled(locationId, config) {
  return getReviewConfig(config).locations[locationId]?.enabled !== false;
}

/** Google review link for a consultation's location (own link, else the general one), or ''. */
export function reviewUrlFor(consultation, config) {
  const rv = getReviewConfig(config);
  const own = String(rv.locations[consultation?.locationId]?.url || '').trim();
  const url = own || String(rv.defaultUrl || '').trim();
  return isValidReviewUrl(url) ? url : '';
}

/** Local Date when a consultation ends. */
export function consultationEnd(c, config) {
  const start = consultationStart(c);
  if (!start) return null;
  const minutes = Number(c.duracion) || Number(config?.defaultConsultationDuration) || 45;
  return new Date(start.getTime() + minutes * 60000);
}

/** True when the client has no earlier (non-cancelled, attended) consultation. */
export function isFirstVisit(consultation, history) {
  const start = consultationStart(consultation);
  return !(history || []).some(h =>
    h.id !== consultation.id &&
    h.clienteId === consultation.clienteId &&
    !NOT_A_VISIT.has(h.estado) &&
    consultationStart(h) < start
  );
}

/** Whether the client was already asked for a review (another consultation or channel). */
function alreadyAsked(consultation, channel, history) {
  const otherChannelDone = REVIEW_CHANNELS.some(ch =>
    ch !== channel && DONE_STATUSES.has(consultation.reviewRequest?.[ch]?.status));
  if (otherChannelDone) return true;
  return (history || []).some(h =>
    h.id !== consultation.id &&
    h.clienteId === consultation.clienteId &&
    REVIEW_CHANNELS.some(ch => DONE_STATUSES.has(h.reviewRequest?.[ch]?.status))
  );
}

/**
 * State of one channel's review request for one (finished) consultation:
 *   sent | opened | manual | sending  → already handled
 *   error         → last attempt failed (`attempts` tells how many)
 *   opted_out     → the client does not want review requests
 *   already_asked → asked before (another consultation or channel)
 *   no_link       → no valid Google review link for the location
 *   no_contact    → missing / invalid email or phone
 *   waiting       → `delayHours` have not passed since the end
 *   due           → should be sent now
 * `history` is every consultation (for the "asked once" rule).
 */
export function reviewState({ consultation, client, channel, config, now, history }) {
  const rv = getReviewConfig(config);
  const record = consultation.reviewRequest?.[channel];
  if (record) {
    if (record.status === 'sending' && now - new Date(record.at).getTime() > SENDING_STALE_MS) return 'error';
    return record.status;
  }
  if (client?.recordatorios?.review === false) return 'opted_out';
  if (alreadyAsked(consultation, channel, history)) return 'already_asked';
  if (!reviewUrlFor(consultation, config)) return 'no_link';
  if (!channelContact(channel, client, config)) return 'no_contact';
  const end = consultationEnd(consultation, config);
  if (now - end.getTime() < rv.delayHours * 3600000) return 'waiting';
  return 'due';
}

/**
 * Review entries for consultations that ended within the last `maxAgeDays`,
 * at an enabled location and of a kind (first visit / follow-up) that is
 * switched on. `consultations` are the ones to list (visible calendars);
 * `history` is all of them. Most recent first.
 */
export function getReviewCandidates({ consultations, history = consultations, clients, config, now = Date.now() }) {
  const rv = getReviewConfig(config);
  if (!rv.enabled) return [];
  const channels = REVIEW_CHANNELS.filter(ch => rv[ch].enabled);
  const clientsById = new Map((clients || []).map(c => [c.id, c]));
  const historyByClient = new Map();
  for (const h of history || []) {
    if (!h.clienteId) continue;
    if (!historyByClient.has(h.clienteId)) historyByClient.set(h.clienteId, []);
    historyByClient.get(h.clienteId).push(h);
  }
  const maxAgeMs = rv.maxAgeDays * 86400000;
  const entries = [];
  for (const consultation of consultations || []) {
    if (consultation.estado !== 'completada' && consultation.estado !== 'programada') continue;
    const client = consultation.clienteId ? clientsById.get(consultation.clienteId) : null;
    if (!client) continue;
    const end = consultationEnd(consultation, config);
    if (!end) continue;
    const sinceEnd = now - end.getTime();
    if (sinceEnd < 0 || sinceEnd > maxAgeMs) continue;
    if (!isLocationEnabled(consultation.locationId, config)) continue;
    const clientHistory = historyByClient.get(client.id) || [];
    const firstVisit = isFirstVisit(consultation, clientHistory);
    if (firstVisit ? !rv.afterFirstVisit : !rv.afterFollowUp) continue;
    for (const channel of channels) {
      entries.push({
        consultation, client, channel, end, firstVisit,
        state: reviewState({ consultation, client, channel, config, now, history: clientHistory }),
        record: consultation.reviewRequest?.[channel] || null,
      });
    }
  }
  return entries.sort((a, b) => b.end - a.end);
}

/**
 * Whether automatic sending should pick this email entry up. Only for
 * consultations marked `completada`: one still `programada` may not have
 * taken place (it is offered in the panel, to be sent by hand).
 */
export function isReviewAutoSendable(entry) {
  if (entry.channel !== 'email' || entry.consultation?.estado !== 'completada') return false;
  if (entry.state === 'due') return true;
  return entry.state === 'error' && (entry.record?.attempts || 0) < MAX_AUTO_ATTEMPTS;
}

export function reviewEmailTemplate(config, lang) {
  const rv = getReviewConfig(config);
  return rv.email.templates?.[lang] || DEFAULT_REVIEW_EMAIL_TEMPLATES[lang] || DEFAULT_REVIEW_EMAIL_TEMPLATES.es;
}

export function reviewWhatsAppTemplate(config, lang) {
  const rv = getReviewConfig(config);
  return rv.whatsapp.templates?.[lang] || DEFAULT_REVIEW_WHATSAPP_TEMPLATES[lang] || DEFAULT_REVIEW_WHATSAPP_TEMPLATES.es;
}

export function buildReviewEmail({ consultation, client, config }) {
  const lang = clientLanguage(client, config);
  const tmpl = reviewEmailTemplate(config, lang);
  const ctx = { client, consultation, config, lang, reviewUrl: reviewUrlFor(consultation, config) };
  return { subject: resolveTemplate(tmpl.subject, ctx), body: resolveTemplate(tmpl.body, ctx), lang };
}

/** `text` overrides the template (the queue lets the user edit the message). */
export function buildReviewWhatsApp({ consultation, client, config, text: override }) {
  const phone = normalizeWhatsAppPhone(client?.whatsapp || client?.telefono, config?.whatsappCountryCode);
  if (!phone) return { error: 'no_phone' };
  const lang = clientLanguage(client, config);
  const reviewUrl = reviewUrlFor(consultation, config);
  const text = override ?? resolveTemplate(reviewWhatsAppTemplate(config, lang), { client, consultation, config, lang, reviewUrl });
  return { url: whatsAppUrl(phone, text, config), text, phone };
}

// ── Side effects ────────────────────────────────────────────────────────────

export async function openWhatsAppReview({ consultation, client, config, text }) {
  const built = buildReviewWhatsApp({ consultation, client, config, text });
  if (built.error) return { success: false, error: built.error };
  await openExternal(built.url);
  return { success: true };
}
