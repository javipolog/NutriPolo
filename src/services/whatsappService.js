/**
 * whatsappService.js — NutriPolo
 * ================================
 * Servicio de recordatorio de cita vía WhatsApp.
 * Abre WhatsApp Web/Desktop con un mensaje pre-rellenado.
 */

import { resolveTemplate } from './emailService';

// ── Default WhatsApp reminder templates (concise for chat) ────────────────

export const DEFAULT_WHATSAPP_REMINDER_TEMPLATES = {
  es: `Hola {{clientNom}}, te recuerdo tu cita el {{citaData}} a las {{citaHora}} en {{citaUbicacio}}. Si necesitas cambiarla, avísame con antelación. {{nutriNom}}`,
  ca: `Hola {{clientNom}}, et recordo la teva cita el {{citaData}} a les {{citaHora}} a {{citaUbicacio}}. Si necessites canviar-la, avisa'm amb antelació. {{nutriNom}}`,
  en: `Hi {{clientNom}}, just a reminder about your appointment on {{citaData}} at {{citaHora}} in {{citaUbicacio}}. Please let me know in advance if you need to reschedule. {{nutriNom}}`,
};

// ── Build WhatsApp URL with pre-filled message ────────────────────────────

export function buildWhatsAppReminderUrl({ client, consultation, config, locationName }) {
  const phone = (client.whatsapp || client.telefono || '').replace(/\D/g, '');
  if (!phone) return { error: 'no_phone' };

  const countryCode = (config.whatsappCountryCode || '34').replace(/\D/g, '');
  const lang = config.appLang || 'es';
  const template = config.whatsappReminderTemplate?.[lang]
    || DEFAULT_WHATSAPP_REMINDER_TEMPLATES[lang]
    || DEFAULT_WHATSAPP_REMINDER_TEMPLATES.es;

  const text = resolveTemplate(template, { client, consultation, config, locationName });
  const url = `https://wa.me/${countryCode}${phone}?text=${encodeURIComponent(text)}`;

  return { url, text };
}

// ── High-level: open WhatsApp with reminder ───────────────────────────────

export function openWhatsAppReminder({ client, consultation, config, locationName }) {
  const result = buildWhatsAppReminderUrl({ client, consultation, config, locationName });
  if (result.error) return { success: false, error: result.error };

  window.open(result.url, '_blank');
  return { success: true };
}
