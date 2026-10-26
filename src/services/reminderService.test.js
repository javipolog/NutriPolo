import { describe, it, expect } from 'vitest';
import {
  normalizeWhatsAppPhone, getReminderCandidates, reminderState, reminderSlot, isQuietTime,
  isAutoSendable, buildReminderWhatsApp, buildReminderEmail, consultationStart, MAX_AUTO_ATTEMPTS,
} from './reminderService';
import { resolveTemplate } from './emailService';

// Fixed "now": Wednesday 2026-10-14 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0).getTime();
const config = { appLang: 'es', whatsappCountryCode: '34', nombre: 'Nutri', locations: [{ id: 'l1', name: 'Centro', address: 'C/ Mayor 1' }] };
const client = { id: 'c1', nombre: 'Ana', email: 'ana@example.com', telefono: '622 123 456' };
const consult = (over = {}) => ({ id: 'k1', clienteId: 'c1', fecha: '2026-10-15', hora: '09:30', estado: 'programada', locationId: 'l1', ...over });

const state = (c, cl = client, cfg = config) => reminderState({ consultation: c, client: cl, channel: 'email', config: cfg, now: NOW });

describe('normalizeWhatsAppPhone', () => {
  it.each([
    ['622 123 456', '34622123456'],
    ['+34 622 123 456', '34622123456'],
    ['0034622123456', '34622123456'],
    ['34622123456', '34622123456'],
    ['+44 7700 900123', '447700900123'],
    ['', ''],
    ['123', ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeWhatsAppPhone(raw, '34')).toBe(expected);
  });
});

describe('reminder window', () => {
  it('is due inside the lead window', () => {
    expect(state(consult())).toBe('due'); // 23.5 h before
  });
  it('is upcoming before the lead window opens', () => {
    expect(state(consult({ fecha: '2026-10-16' }))).toBe('upcoming');
  });
  it('is too late inside minLeadHours', () => {
    expect(state(consult({ fecha: '2026-10-14', hora: '11:00' }))).toBe('too_late');
  });
  it('honours a custom lead time', () => {
    const cfg = { ...config, reminders: { email: { leadHours: 48 } } };
    expect(state(consult({ fecha: '2026-10-16' }), client, cfg)).toBe('due');
  });
  it('defaults to 09:00 when the consultation has no time', () => {
    expect(consultationStart(consult({ hora: '' })).getHours()).toBe(9);
  });
});

describe('reminder records', () => {
  it('reports the stored status for the same slot', () => {
    const c = consult();
    c.reminders = { email: { status: 'sent', at: new Date(NOW).toISOString(), slot: reminderSlot(c) } };
    expect(state(c)).toBe('sent');
  });
  it('re-arms after a reschedule (slot changes)', () => {
    const c = consult({ hora: '08:30' });
    c.reminders = { email: { status: 'sent', at: new Date(NOW).toISOString(), slot: '2026-10-15T09:30' } };
    expect(state(c)).toBe('due');
  });
  it('treats a stale "sending" record as an error', () => {
    const c = consult();
    c.reminders = { email: { status: 'sending', at: new Date(NOW - 60 * 60000).toISOString(), slot: reminderSlot(c) } };
    expect(state(c)).toBe('error');
  });
  it('stops automatic retries after MAX_AUTO_ATTEMPTS', () => {
    const entry = { channel: 'email', state: 'error', record: { attempts: MAX_AUTO_ATTEMPTS } };
    expect(isAutoSendable(entry)).toBe(false);
    expect(isAutoSendable({ ...entry, record: { attempts: 1 } })).toBe(true);
  });
});

describe('client preferences and contact data', () => {
  it('respects opt-out per channel', () => {
    expect(state(consult(), { ...client, recordatorios: { email: false } })).toBe('opted_out');
  });
  it('needs a valid email', () => {
    expect(state(consult(), { ...client, email: 'not-an-email' })).toBe('no_contact');
  });
  it('needs a phone for WhatsApp', () => {
    const s = reminderState({ consultation: consult(), client: { ...client, telefono: '' }, channel: 'whatsapp', config, now: NOW });
    expect(s).toBe('no_contact');
  });
});

describe('getReminderCandidates', () => {
  it('skips non-programmed and past consultations, flags unlinked ones', () => {
    const entries = getReminderCandidates({
      consultations: [
        consult(),
        consult({ id: 'k2', estado: 'cancelada' }),
        consult({ id: 'k3', fecha: '2026-10-13' }),
        consult({ id: 'k4', clienteId: null }),
      ],
      clients: [client],
      config,
      now: NOW,
    });
    expect(entries.filter(e => e.consultation.id === 'k1').map(e => e.channel).sort()).toEqual(['email', 'whatsapp']);
    expect(entries.some(e => e.consultation.id === 'k2' || e.consultation.id === 'k3')).toBe(false);
    expect(entries.find(e => e.consultation.id === 'k4').state).toBe('no_client');
  });
  it('omits disabled channels', () => {
    const cfg = { ...config, reminders: { whatsapp: { enabled: false } } };
    const entries = getReminderCandidates({ consultations: [consult()], clients: [client], config: cfg, now: NOW });
    expect(entries.map(e => e.channel)).toEqual(['email']);
  });
});

describe('isQuietTime', () => {
  const qh = { enabled: true, from: '21:00', to: '08:00' };
  it('handles windows crossing midnight', () => {
    expect(isQuietTime(new Date(2026, 9, 14, 23, 0), qh)).toBe(true);
    expect(isQuietTime(new Date(2026, 9, 14, 7, 59), qh)).toBe(true);
    expect(isQuietTime(new Date(2026, 9, 14, 8, 0), qh)).toBe(false);
  });
  it('is off when disabled', () => {
    expect(isQuietTime(new Date(2026, 9, 14, 23, 0), { ...qh, enabled: false })).toBe(false);
  });
});

describe('message building', () => {
  it('builds a wa.me link in the client language', () => {
    const r = buildReminderWhatsApp({ consultation: consult(), client: { ...client, idioma: 'ca' }, config });
    expect(r.url.startsWith('https://wa.me/34622123456?text=')).toBe(true);
    expect(r.text).toContain('et recordo');
    expect(r.text).toContain('15/10/2026');
    expect(r.text).toContain('Centro');
  });
  it('builds a whatsapp:// link for the desktop app', () => {
    const cfg = { ...config, reminders: { whatsapp: { openWith: 'desktop' } } };
    const r = buildReminderWhatsApp({ consultation: consult(), client, config: cfg });
    expect(r.url.startsWith('whatsapp://send?phone=34622123456&text=')).toBe(true);
    expect(decodeURIComponent(r.url.split('&text=')[1])).toBe(r.text);
  });
  it('uses the edited text when given', () => {
    const r = buildReminderWhatsApp({ consultation: consult(), client, config, text: 'Hola & adiós' });
    expect(r.url).toBe(`https://wa.me/34622123456?text=${encodeURIComponent('Hola & adiós')}`);
  });
  it('uses custom email templates when set', () => {
    const cfg = { ...config, reminders: { email: { templates: { es: { subject: 'Cita {{citaHora}}', body: 'Hola {{clientNom}}' } } } } };
    const m = buildReminderEmail({ consultation: consult(), client, config: cfg });
    expect(m.subject).toBe('Cita 09:30');
    expect(m.body).toBe('Hola Ana');
  });
});

describe('resolveTemplate', () => {
  it('inserts values literally (no $& replacement patterns)', () => {
    expect(resolveTemplate('Hola {{clientNom}}', { client: { nombre: 'A$&B' } })).toBe('Hola A$&B');
  });
  it('resolves weekday, address and duration', () => {
    const out = resolveTemplate('{{citaDia}}|{{citaDireccio}}|{{citaDuracio}}', {
      consultation: consult({ duracion: 45 }), config, lang: 'es',
    });
    expect(out).toBe('jueves|C/ Mayor 1|45 min');
  });
});
