import { describe, it, expect } from 'vitest';
import {
  extractPatientName, fuzzyScore, findBestMatches, normalizePhone, normalizeEmail,
  extractContacts, isNoiseEvent, buildClientIndex, matchPatient,
} from './fuzzyMatcher.js';

// Invented people only: no real patient data in tests.
const CLIENTS = [
  { id: 'c1', nombre: 'Lucía Ferrer Soto', email: 'lucia.ferrer@example.com', telefono: '+34 600 11 22 33' },
  { id: 'c2', nombre: 'Marcos Prieto', telefono: '611 22 33 44' },
  { id: 'c3', nombre: 'Elena Ruiz', email: 'familia.ruiz@example.com', telefono: '622334455' },
  { id: 'c4', nombre: 'Pablo Ruiz', email: 'familia.ruiz@example.com', whatsapp: '0034 622 33 44 55' },
  { id: 'c5', nombre: 'Sara Gil' },
  { id: 'c6', nombre: 'Sara Gil' },
  { id: 'c7', nombre: 'Irene Montalbán-Vidal' },
];
const index = buildClientIndex(CLIENTS);
const match = (event, opts) => matchPatient(event, index, opts);

describe('extractPatientName', () => {
  it('strips appointment boilerplate', () => {
    expect(extractPatientName('Consulta - Lucía Ferrer')).toBe('Lucía Ferrer');
    expect(extractPatientName('Seguimiento Marcos Prieto')).toBe('Marcos Prieto');
    expect(extractPatientName('Marcos Prieto (online) 10:30h')).toBe('Marcos Prieto');
    expect(extractPatientName('Cita: Elena Ruiz - 1ª visita')).toBe('Elena Ruiz');
    expect(extractPatientName('Marcos Prieto 35€')).toBe('Marcos Prieto');
  });

  it('keeps hyphenated surnames whole', () => {
    expect(extractPatientName('Irene Montalbán-Vidal')).toBe('Irene Montalbán-Vidal');
    expect(extractPatientName('Irene Montalbán-Vidal - revisión')).toBe('Irene Montalbán-Vidal');
  });
});

describe('contacts', () => {
  it('normalizes phones without spaces or the Spanish prefix', () => {
    expect(normalizePhone('+34 600 11 22 33')).toBe('600112233');
    expect(normalizePhone('0034600112233')).toBe('600112233');
    expect(normalizePhone('600-11-22-33')).toBe('600112233');
    expect(normalizePhone('10:30')).toBe('');
    expect(normalizeEmail(' Lucia.Ferrer@Example.com ')).toBe('lucia.ferrer@example.com');
    expect(normalizeEmail('no-email')).toBe('');
  });

  it('reads emails and phones from a description, ignoring dates and prices', () => {
    const { emails, phones } = extractContacts(
      'Tel: <a href="tel:+34600112233">+34 600 11 22 33</a><br>Mail: lucia.ferrer@example.com · 2026-10-20 · 45€'
    );
    expect(emails).toEqual(['lucia.ferrer@example.com']);
    expect(phones).toEqual(['600112233']);
  });
});

describe('isNoiseEvent', () => {
  it('flags blocks and untitled events', () => {
    for (const s of ['', 'Bloqueo', 'Comida', 'Comida con Laura', 'Personal', 'NO DISPONIBLE', 'Vacaciones 🌴']) {
      expect(isNoiseEvent(s)).toBe(true);
    }
    expect(isNoiseEvent('Marcos Prieto')).toBe(false);
    expect(isNoiseEvent('Consulta - Sara Gil')).toBe(false);
  });
});

describe('matchPatient', () => {
  it('assigns by guest email or by a phone in the description', () => {
    expect(match({ summary: 'Cita', attendees: ['LUCIA.FERRER@example.com'] }))
      .toMatchObject({ result: 'assign', clienteId: 'c1', via: 'email' });
    expect(match({ summary: 'Primera visita', description: 'Llamar al 611223344' }))
      .toMatchObject({ result: 'assign', clienteId: 'c2', via: 'phone' });
  });

  it('settles a shared family email with the name, and asks otherwise', () => {
    expect(match({ summary: 'Pablo Ruiz', attendees: ['familia.ruiz@example.com'] }))
      .toMatchObject({ result: 'assign', clienteId: 'c4' });
    const shared = match({ summary: 'Consulta', attendees: ['familia.ruiz@example.com'] });
    expect(shared.result).toBe('review');
    expect(shared.candidates.map(c => c.clienteId).sort()).toEqual(['c3', 'c4']);
    expect(shared.normalizedName).toBe('familia.ruiz@example.com');
  });

  it('asks when the contact and the name point to different clients', () => {
    const m = match({ summary: 'Marcos Prieto', attendees: ['lucia.ferrer@example.com'] });
    expect(m.result).toBe('review');
    expect(m.candidates.map(c => c.clienteId).sort()).toEqual(['c1', 'c2']);
  });

  it('assigns a unique exact name, never a duplicated one', () => {
    expect(match({ summary: 'Consulta - marcos  PRIETO' })).toMatchObject({ result: 'assign', clienteId: 'c2', via: 'name' });
    expect(match({ summary: 'Irene Montalbán-Vidal' })).toMatchObject({ result: 'assign', clienteId: 'c7' });
    const dup = match({ summary: 'Sara Gil' });
    expect(dup.result).toBe('review');
    expect(dup.clienteId).toBeUndefined();
    expect(dup.candidates.map(c => c.clienteId)).toEqual(['c5', 'c6']);
  });

  it('only proposes a fuzzy match, never assigns it', () => {
    const m = match({ summary: 'Lucia Ferer Soto' });
    expect(m.result).toBe('confirm');
    expect(m.clienteId).toBe('c1');
    expect(m.score).toBeGreaterThanOrEqual(0.92);
    expect(match({ summary: 'Marco Prieto' })).toMatchObject({ result: 'confirm', clienteId: 'c2' });
    expect(match({ summary: 'Marcos Prieto Lago' }, { suggestThreshold: 0.7 }).result).toBe('review');
  });

  it('offers a new client when nothing matches, with what the event says', () => {
    const m = match({ summary: 'Consulta - Nuria Campos', description: 'nuria.campos@example.com · 633 44 55 66' });
    expect(m).toMatchObject({
      result: 'new', rawName: 'Nuria Campos', normalizedName: 'nuria campos',
      contact: { email: 'nuria.campos@example.com', phone: '633445566' },
    });
  });

  it('suggests nothing for noise, bare appointment words or unnamed all-day events', () => {
    expect(match({ summary: 'Bloqueo' }).result).toBe('noise');
    expect(match({ summary: 'Consulta' }).result).toBe('noise');
    expect(match({ summary: 'Cumpleaños tía', allDay: true }).result).toBe('noise');
    // …but a sure match still counts on an all-day event
    expect(match({ summary: 'Marcos Prieto', allDay: true }).result).toBe('assign');
  });

  it('ignores the calendar owner address', () => {
    const m = match({ summary: 'Nuria Campos', attendees: ['lucia.ferrer@example.com'] },
      { ignoreEmails: new Set(['lucia.ferrer@example.com']) });
    expect(m.result).toBe('new');
  });

  it('keeps the existing fuzzy scoring', () => {
    expect(fuzzyScore('Ana Ruiz', 'Ana Pérez')).toBeLessThanOrEqual(0.85);
    expect(findBestMatches('Marcos Prieto', CLIENTS).auto?.clienteId).toBe('c2');
  });
});
