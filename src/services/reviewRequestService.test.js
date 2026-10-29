import { describe, it, expect } from 'vitest';
import {
  getReviewCandidates, reviewState, reviewUrlFor, isFirstVisit, isReviewAutoSendable,
  buildReviewEmail, buildReviewWhatsApp, consultationEnd,
} from './reviewRequestService';
import { MAX_AUTO_ATTEMPTS } from './reminderService';

// Fixed "now": Wednesday 2026-10-14 15:00 local time.
const NOW = new Date(2026, 9, 14, 15, 0).getTime();
const URL_CENTRO = 'https://g.page/r/centro/review';
const URL_GENERAL = 'https://g.page/r/general/review';
const config = {
  appLang: 'es', whatsappCountryCode: '34', nombre: 'Nutri', defaultConsultationDuration: 45,
  locations: [{ id: 'l1', name: 'Centro' }, { id: 'l2', name: 'Natura' }, { id: 'online', name: 'Online' }],
  reviewRequests: {
    enabled: true,
    defaultUrl: URL_GENERAL,
    locations: { l1: { enabled: true, url: URL_CENTRO } },
  },
};
const withReview = (patch) => ({ ...config, reviewRequests: { ...config.reviewRequests, ...patch } });
const client = { id: 'c1', nombre: 'Ana', email: 'ana@example.com', telefono: '622 123 456' };
// Ends at 10:45 → 4 h 15 min before NOW.
const consult = (over = {}) => ({ id: 'k1', clienteId: 'c1', fecha: '2026-10-14', hora: '10:00', duracion: 45, estado: 'completada', locationId: 'l1', ...over });
const earlier = (over = {}) => consult({ id: 'k0', fecha: '2026-09-01', ...over });

const state = (c, { cl = client, cfg = config, history = [c], channel = 'email' } = {}) =>
  reviewState({ consultation: c, client: cl, channel, config: cfg, now: NOW, history });
const candidates = (consultations, cfg = config, clients = [client]) =>
  getReviewCandidates({ consultations, clients, config: cfg, now: NOW });

describe('first visit', () => {
  it('is the first visit with no earlier consultation', () => {
    expect(isFirstVisit(consult(), [consult()])).toBe(true);
  });
  it('is a follow-up after an earlier attended consultation', () => {
    expect(isFirstVisit(consult(), [earlier(), consult()])).toBe(false);
  });
  it('ignores earlier cancelled and no-show consultations', () => {
    const history = [earlier({ estado: 'cancelada' }), earlier({ id: 'k00', estado: 'no_show' }), consult()];
    expect(isFirstVisit(consult(), history)).toBe(true);
  });
  it('ignores other clients', () => {
    expect(isFirstVisit(consult(), [earlier({ clienteId: 'c2' }), consult()])).toBe(true);
  });
});

describe('visit kind filter', () => {
  it('asks after the first visit by default', () => {
    expect(candidates([consult()]).map(e => e.channel)).toEqual(['email', 'whatsapp']);
  });
  it('skips follow-ups by default', () => {
    expect(candidates([earlier(), consult()]).filter(e => e.consultation.id === 'k1')).toEqual([]);
  });
  it('asks after follow-ups when enabled', () => {
    const cfg = withReview({ afterFirstVisit: false, afterFollowUp: true });
    const entries = candidates([earlier(), consult()], cfg);
    expect(entries.every(e => e.consultation.id === 'k1' && !e.firstVisit)).toBe(true);
  });
});

describe('location', () => {
  it('uses the location link', () => {
    expect(reviewUrlFor(consult(), config)).toBe(URL_CENTRO);
  });
  it('falls back to the general link', () => {
    expect(reviewUrlFor(consult({ locationId: 'l2' }), config)).toBe(URL_GENERAL);
  });
  it('is no_link without any valid https link', () => {
    const cfg = withReview({ defaultUrl: 'g.page/r/x', locations: {} });
    expect(state(consult(), { cfg })).toBe('no_link');
  });
  it('leaves out disabled locations', () => {
    const cfg = withReview({ locations: { l1: { enabled: false, url: URL_CENTRO } } });
    expect(candidates([consult()], cfg)).toEqual([]);
  });
});

describe('timing', () => {
  it('is due after delayHours', () => {
    expect(state(consult())).toBe('due');
  });
  it('is waiting before delayHours', () => {
    expect(state(consult(), { cfg: withReview({ delayHours: 6 }) })).toBe('waiting');
  });
  it('uses the default duration when missing', () => {
    expect(consultationEnd(consult({ duracion: undefined }), config).getMinutes()).toBe(45);
  });
  it('leaves out consultations not finished yet', () => {
    expect(candidates([consult({ hora: '14:30' })])).toEqual([]);
  });
  it('leaves out consultations older than maxAgeDays', () => {
    expect(candidates([consult({ fecha: '2026-10-01' })])).toEqual([]);
  });
  it('includes past consultations still marked programada', () => {
    expect(candidates([consult({ estado: 'programada' })])).toHaveLength(2);
  });
  it('leaves out cancelled and no-show consultations', () => {
    expect(candidates([consult({ estado: 'cancelada' }), consult({ id: 'k2', estado: 'no_show' })])).toEqual([]);
  });
  it('is disabled by default', () => {
    expect(candidates([consult()], { ...config, reviewRequests: undefined })).toEqual([]);
  });
});

describe('asked once', () => {
  it('is already_asked after a request on an earlier consultation', () => {
    const asked = earlier({ reviewRequest: { whatsapp: { status: 'opened', at: '2026-09-01T12:00:00Z' } } });
    expect(state(consult(), { history: [asked, consult()] })).toBe('already_asked');
  });
  it('is already_asked when the other channel of the same consultation was used', () => {
    const c = consult({ reviewRequest: { email: { status: 'sent', at: '2026-10-14T14:00:00Z' } } });
    expect(state(c, { channel: 'whatsapp' })).toBe('already_asked');
    expect(state(c, { channel: 'email' })).toBe('sent');
  });
  it('a failed attempt does not count as asked', () => {
    const failed = earlier({ reviewRequest: { email: { status: 'error', at: '2026-09-01T12:00:00Z' } } });
    expect(state(consult(), { history: [failed, consult()] })).toBe('due');
  });
  it('respects the client opt-out', () => {
    expect(state(consult(), { cl: { ...client, recordatorios: { review: false } } })).toBe('opted_out');
  });
  it('is no_contact without email', () => {
    expect(state(consult(), { cl: { ...client, email: '' } })).toBe('no_contact');
  });
});

describe('auto sending', () => {
  const entry = (over) => ({ channel: 'email', state: 'due', record: null, consultation: consult(), ...over });
  it('picks due emails and retries errors up to the limit', () => {
    expect(isReviewAutoSendable(entry())).toBe(true);
    expect(isReviewAutoSendable(entry({ state: 'error', record: { attempts: 1 } }))).toBe(true);
    expect(isReviewAutoSendable(entry({ state: 'error', record: { attempts: MAX_AUTO_ATTEMPTS } }))).toBe(false);
    expect(isReviewAutoSendable(entry({ channel: 'whatsapp' }))).toBe(false);
  });
  it('never sends on its own for a visit not marked as completed', () => {
    expect(isReviewAutoSendable(entry({ consultation: consult({ estado: 'programada' }) }))).toBe(false);
  });
});

describe('messages', () => {
  it('puts the location link in the email', () => {
    const { subject, body } = buildReviewEmail({ consultation: consult(), client, config });
    expect(subject).toContain('Ana');
    expect(body).toContain(URL_CENTRO);
    expect(body).toContain('14/10/2026');
  });
  it('builds a WhatsApp link with the review link', () => {
    const built = buildReviewWhatsApp({ consultation: consult({ locationId: 'l2' }), client, config });
    expect(built.phone).toBe('34622123456');
    expect(built.text).toContain(URL_GENERAL);
    expect(built.url).toContain(encodeURIComponent(URL_GENERAL));
  });
  it('uses the client language and custom templates', () => {
    const cfg = withReview({ whatsapp: { enabled: true, templates: { en: 'Review: {{resenaUrl}}' } } });
    const built = buildReviewWhatsApp({ consultation: consult(), client: { ...client, idioma: 'en' }, config: cfg });
    expect(built.text).toBe(`Review: ${URL_CENTRO}`);
  });
});
