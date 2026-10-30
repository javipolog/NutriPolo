process.env.TZ = 'Europe/Madrid';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Fake Google Calendar backend (replaces the Rust IPC commands) ────────
const google = { calendars: {}, offline: false, failNext: null, calls: [] };

function cal(id) {
  return (google.calendars[id] ||= new Map());
}

function stamp() {
  return new Date().toISOString();
}

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(async (cmd, args) => {
    google.calls.push(cmd);
    if (google.failNext) {
      const err = google.failNext;
      google.failNext = null;
      throw err;
    }
    if (google.offline && cmd.startsWith('gcal_')) throw new Error(`${cmd} failed: network error: offline`);
    const events = cal(args?.calendarId);
    switch (cmd) {
      case 'gcal_list_events':
        return [...events.values()].filter(ev => ev.status === 'cancelled'
          || (ev.start_datetime >= args.timeMin.slice(0, 10) && ev.start_datetime <= args.timeMax));
      case 'gcal_get_event': {
        const ev = events.get(args.eventId);
        if (!ev) throw new Error('Get event failed (404) [notFound]: Not Found');
        return ev;
      }
      case 'gcal_create_event': {
        const id = args.event.id;
        const existing = events.get(id);
        const ev = { ...existing, ...args.event, id, updated: stamp() };
        events.set(id, ev);
        return ev;
      }
      case 'gcal_update_event': {
        const existing = events.get(args.eventId);
        if (!existing) throw new Error('Update event failed (404) [notFound]: Not Found');
        const ev = { ...existing, ...args.event, id: args.eventId, updated: stamp() };
        events.set(args.eventId, ev);
        return ev;
      }
      case 'gcal_delete_event': {
        const existing = events.get(args.eventId);
        if (existing) events.set(args.eventId, { id: args.eventId, status: 'cancelled', start_datetime: '', end_datetime: '', updated: stamp() });
        return null;
      }
      default:
        return null;
    }
  }),
}));

const { default: useStore } = await import('../stores/store');
const {
  googleCalendar, parseGoogleDateTime, googleEventIdFor, isRetryableError, parseGcalError,
} = await import('./googleCalendarService');

const CAL = 'np-cal';
const CLINIC = 'clinic-cal';
const initial = useStore.getState();

let clock;
const tick = (ms = 1000) => { clock += ms; vi.setSystemTime(clock); };

function connect(extra = {}) {
  useStore.setState(s => ({
    config: {
      ...s.config,
      googleCalendar: {
        connected: true,
        accessToken: 'token',
        expiresAt: Date.now() + 3600e3,
        refreshToken: 'refresh',
        calendars: [
          { id: CAL, name: 'NutriPolo', syncMode: 'bidirectional', purpose: 'primary' },
          { id: CLINIC, name: 'Clínica', syncMode: 'readonly', purpose: 'other' },
        ],
        defaultPushCalendarId: CAL,
        ...extra,
      },
    },
  }));
}

const consultation = (id) => useStore.getState().consultations.find(c => c.id === id);
const liveEvents = (calId = CAL) => [...cal(calId).values()].filter(e => e.status !== 'cancelled');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = new Date(2026, 9, 14, 10, 0).getTime();
  vi.setSystemTime(clock);
  google.calendars = {};
  google.offline = false;
  google.failNext = null;
  google.calls = [];
  useStore.setState({
    ...initial,
    clients: [{ id: 'ana', nombre: 'Ana López' }],
    consultations: [],
    measurements: [],
    invoices: [],
    gcalPendingDeletes: [],
    _history: [],
    _future: [],
  });
  connect();
  // Same retry logic, without waiting for the backoff.
  const realWithRetry = googleCalendar.withRetry;
  vi.spyOn(googleCalendar, 'withRetry').mockImplementation(function (fn, opts) {
    return realWithRetry.call(this, fn, { ...opts, backoffMs: 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe('parseGoogleDateTime', () => {
  it('converts timed events to the local timezone', () => {
    expect(parseGoogleDateTime('2026-04-01T07:00:00Z')).toMatchObject({ fecha: '2026-04-01', hora: '09:00', allDay: false });
    expect(parseGoogleDateTime('2026-04-01T12:30:00+05:30')).toMatchObject({ fecha: '2026-04-01', hora: '09:00' });
    expect(parseGoogleDateTime('2026-04-01T23:30:00Z')).toMatchObject({ fecha: '2026-04-02', hora: '01:30' });
  });

  it('keeps all-day dates and rejects empty values', () => {
    expect(parseGoogleDateTime('2026-04-01')).toMatchObject({ fecha: '2026-04-01', allDay: true });
    expect(parseGoogleDateTime('')).toBeNull();
    expect(parseGoogleDateTime('garbage')).toBeNull();
  });

  it('uses the local hour when importing an event', () => {
    const c = googleCalendar.eventToConsultation(
      { id: 'e1', summary: 'Consulta - Ana López', start_datetime: '2026-10-20T08:00:00Z', end_datetime: '2026-10-20T08:45:00Z' }, CAL,
    );
    expect(c).toMatchObject({ fecha: '2026-10-20', hora: '10:00', duracion: 45 });
    // The patient is decided by the sync, never by the conversion.
    expect('clienteId' in c).toBe(false);
    expect(googleCalendar.eventToConsultation({ id: 'e2', status: 'cancelled', start_datetime: '' }, CAL)).toBeNull();
  });
});

describe('googleEventIdFor', () => {
  it('produces a valid, stable Google event id', () => {
    const id = googleEventIdFor('3f2a9c1e-7b4d-4e8a-9f00-123456789abc');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(googleEventIdFor('3f2a9c1e-7b4d-4e8a-9f00-123456789abc')).toBe(id);
    expect(googleEventIdFor('other')).not.toBe(id);
  });
});

describe('error handling', () => {
  it('classifies retryable errors', () => {
    expect(isRetryableError(new Error('List events failed: network error: x'))).toBe(true);
    expect(isRetryableError('Update event failed (503) [backendError]: x')).toBe(true);
    expect(isRetryableError('Update event failed (429) [rateLimitExceeded]: x')).toBe(true);
    expect(isRetryableError('Update event failed (403) [userRateLimitExceeded]: x')).toBe(true);
    expect(isRetryableError('Update event failed (403) [forbidden]: x')).toBe(false);
    expect(isRetryableError('Update event failed (404) [notFound]: x')).toBe(false);
    expect(isRetryableError('oauth_invalid_grant')).toBe(false);
    expect(parseGcalError('Get event failed (410) [deleted]: Gone')).toMatchObject({ status: 410, reason: 'deleted' });
  });

  it('retries rate limits and refreshes the token once on 401', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('X failed (429) [rateLimitExceeded]: slow down'))
      .mockRejectedValueOnce(new Error('X failed (401) [authError]: expired'))
      .mockResolvedValue('ok');
    const ensure = vi.spyOn(googleCalendar, 'ensureToken').mockResolvedValue('fresh');
    await expect(googleCalendar.withRetry(fn, { token: 'old', backoffMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith('fresh');
    ensure.mockRestore();
  });

  it('does not retry permanent errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('X failed (404) [notFound]: gone'));
    await expect(googleCalendar.withRetry(fn, { backoffMs: 0 })).rejects.toThrow('404');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── Sync scenarios ───────────────────────────────────────────────────────

function newConsultation(over = {}) {
  return useStore.getState().addConsultation({
    clienteId: 'ana', fecha: '2026-10-20', hora: '10:00', duracion: 45, estado: 'programada', ...over,
  });
}

describe('push', () => {
  it('a save made offline is pushed by the next sync', async () => {
    const c = newConsultation();
    google.offline = true;
    tick();
    await expect(googleCalendar.pushConsultation(c.id)).rejects.toThrow();
    expect(liveEvents()).toHaveLength(0);

    google.offline = false;
    tick();
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(1);
    expect(consultation(c.id)).toMatchObject({ googleEventId: googleEventIdFor(c.id), sourceCalendarId: CAL, syncPending: false });
  });

  it('an edit of a linked consultation (modal form) is pushed, not lost', async () => {
    const c = newConsultation();
    await googleCalendar.pushConsultation(c.id);
    tick();
    // The modal saves the whole form, including the stale sync fields.
    useStore.getState().updateConsultation(c.id, { ...consultation(c.id), hora: '12:00', lastSyncedAt: '2000-01-01T00:00:00Z' });
    expect(consultation(c.id).lastSyncedAt).not.toBe('2000-01-01T00:00:00Z');
    google.offline = true;
    await expect(googleCalendar.pushConsultation(c.id)).rejects.toThrow();

    google.offline = false;
    tick();
    await googleCalendar.syncAll();
    expect(liveEvents()[0].start_datetime).toContain('T12:00');
  });

  it('a save racing the background sync creates a single event', async () => {
    const c = newConsultation();
    tick();
    await Promise.all([googleCalendar.syncAll(), googleCalendar.pushConsultation(c.id), googleCalendar.syncAll()]);
    expect(liveEvents()).toHaveLength(1);
  });

  it('never writes to a read-only calendar', async () => {
    cal(CLINIC).set('ext1', { id: 'ext1', summary: 'Ana López', start_datetime: '2026-10-21T09:00:00+02:00', end_datetime: '2026-10-21T10:00:00+02:00', updated: stamp() });
    tick();
    await googleCalendar.syncAll();
    const imported = useStore.getState().consultations.find(c => c.googleEventId === 'ext1');
    expect(imported.sourceCalendarId).toBe(CLINIC);

    tick();
    useStore.getState().updateConsultation(imported.id, { notasPrivadas: 'nota' });
    await expect(googleCalendar.pushConsultation(imported.id)).resolves.toBeNull();
    google.calls = [];
    await googleCalendar.syncAll();
    expect(google.calls).not.toContain('gcal_update_event');
    expect(google.calls).not.toContain('gcal_create_event');
  });

  it('does not upload cancelled consultations that were never linked', async () => {
    newConsultation({ estado: 'cancelada' });
    tick();
    await googleCalendar.syncAll();
    expect(cal(CAL).size).toBe(0);
  });
});

describe('pull', () => {
  it('imports remote events and applies remote edits', async () => {
    cal(CAL).set('g1', { id: 'g1', summary: 'Consulta - Ana López', start_datetime: '2026-10-22T08:00:00Z', end_datetime: '2026-10-22T09:00:00Z', updated: stamp() });
    tick();
    await googleCalendar.syncAll();
    const c = useStore.getState().consultations.find(x => x.googleEventId === 'g1');
    expect(c).toMatchObject({ hora: '10:00', clienteId: 'ana' });
    expect(c.localUpdatedAt).toBeUndefined();

    tick();
    cal(CAL).set('g1', { ...cal(CAL).get('g1'), start_datetime: '2026-10-22T09:00:00Z', end_datetime: '2026-10-22T10:00:00Z', updated: stamp() });
    tick();
    google.calls = [];
    await googleCalendar.syncAll();
    expect(consultation(c.id).hora).toBe('11:00');
    expect(google.calls).not.toContain('gcal_update_event'); // no echo back to Google
  });

  it('follows an event moved outside the sync window', async () => {
    const c = newConsultation();
    await googleCalendar.pushConsultation(c.id);
    tick();
    const id = consultation(c.id).googleEventId;
    cal(CAL).set(id, { ...cal(CAL).get(id), start_datetime: '2027-06-01T10:00:00+02:00', end_datetime: '2027-06-01T10:45:00+02:00', updated: stamp() });
    tick();
    await googleCalendar.syncAll();
    expect(consultation(c.id).fecha).toBe('2027-06-01');
  });
});

describe('delete', () => {
  it('deleting here deletes in Google', async () => {
    const c = newConsultation();
    await googleCalendar.pushConsultation(c.id);
    const res = await googleCalendar.deleteConsultation(c.id);
    expect(res.remote).toBe('deleted');
    expect(liveEvents()).toHaveLength(0);
    expect(consultation(c.id)).toBeUndefined();

    tick();
    await googleCalendar.syncAll();
    expect(useStore.getState().consultations).toHaveLength(0);
  });

  it('a delete made offline reaches Google on the next sync and is not re-imported', async () => {
    const c = newConsultation();
    await googleCalendar.pushConsultation(c.id);
    google.offline = true;
    const res = await googleCalendar.deleteConsultation(c.id);
    expect(res.remote).toBe('pending');
    expect(useStore.getState().gcalPendingDeletes).toHaveLength(1);

    google.offline = false;
    tick();
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(0);
    expect(useStore.getState().consultations).toHaveLength(0);
    expect(useStore.getState().gcalPendingDeletes).toHaveLength(0);
  });

  it('a consultation deleted before its create was confirmed is not re-imported', async () => {
    const c = newConsultation();
    // The create reached Google but the response was lost: no googleEventId here.
    const event = googleCalendar.consultationToEvent(consultation(c.id), useStore.getState().clients);
    cal(CAL).set(event.id, { ...event, updated: new Date().toISOString() });
    google.offline = true;
    await expect(googleCalendar.pushConsultation(c.id)).rejects.toThrow();
    expect(consultation(c.id).googleEventId).toBeUndefined();

    google.offline = false;
    const res = await googleCalendar.deleteConsultation(c.id);
    expect(res.remote).toBe('none');
    tick();
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(0);
    expect(useStore.getState().consultations).toHaveLength(0);
    expect(useStore.getState().gcalPendingDeletes).toHaveLength(0);
  });

  it('deleting a local consultation that never reached Google stays silent offline', async () => {
    const c = newConsultation();
    google.offline = true;
    const res = await googleCalendar.deleteConsultation(c.id);
    expect(res.remote).toBe('none');
    google.offline = false;
    tick();
    await googleCalendar.syncAll();
    expect(useStore.getState().gcalPendingDeletes).toHaveLength(0);
    expect(useStore.getState().consultations).toHaveLength(0);
  });

  it('undo restores the event in Google', async () => {
    const c = newConsultation();
    await googleCalendar.pushConsultation(c.id);
    await googleCalendar.deleteConsultation(c.id);
    tick();
    useStore.getState().undo();
    await googleCalendar.syncAll();
    expect(consultation(c.id)).toBeDefined();
    expect(liveEvents()).toHaveLength(1);
  });

  it('a deletion in Google removes empty appointments and cancels ones with notes', async () => {
    const empty = newConsultation();
    const withNotes = newConsultation({ hora: '12:00', notasPrivadas: 'Historia clínica' });
    tick();
    await googleCalendar.syncAll();
    tick();
    for (const c of [empty, withNotes]) {
      const id = consultation(c.id).googleEventId;
      cal(CAL).set(id, { id, status: 'cancelled', start_datetime: '', updated: stamp() });
    }
    tick();
    google.calls = [];
    await googleCalendar.syncAll();
    expect(consultation(empty.id)).toBeUndefined();
    expect(consultation(withNotes.id)).toMatchObject({ estado: 'cancelada', remoteDeleted: true });
    expect(google.calls).not.toContain('gcal_update_event'); // never resurrected

    // Editing the kept record does not bring the event back...
    tick();
    useStore.getState().updateConsultation(withNotes.id, { notasPrivadas: 'más notas' });
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(0);
  });
});

describe('reconnect', () => {
  it('disconnecting and reconnecting does not duplicate anything', async () => {
    const c = newConsultation();
    cal(CLINIC).set('ext1', { id: 'ext1', summary: 'Otro paciente', start_datetime: '2026-10-21T09:00:00+02:00', end_datetime: '2026-10-21T10:00:00+02:00', updated: stamp() });
    tick();
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(1);
    expect(useStore.getState().consultations).toHaveLength(2);

    useStore.getState().clearGoogleCalendarData();
    tick();
    connect();
    await googleCalendar.syncAll();
    expect(liveEvents()).toHaveLength(1);
    expect(liveEvents(CLINIC)).toHaveLength(1);
    expect(useStore.getState().consultations).toHaveLength(2);
    expect(consultation(c.id).googleEventId).toBe(googleEventIdFor(c.id));
  });

  it('consultations of calendars a new account cannot see are never uploaded', async () => {
    newConsultation();
    tick();
    await googleCalendar.syncAll();
    useStore.getState().clearGoogleCalendarData();
    useStore.getState().detachConsultationsFromCalendars(['other-account-cal']);
    connect({
      calendars: [{ id: 'other-account-cal', name: 'NutriPolo', syncMode: 'bidirectional', purpose: 'primary' }],
      defaultPushCalendarId: 'other-account-cal',
    });
    tick();
    await googleCalendar.syncAll();
    expect(cal('other-account-cal').size).toBe(0);
    expect(useStore.getState().consultations[0].detachedFromGoogle).toBe(true);
  });
});

describe('session', () => {
  it('stops the sync and asks to reconnect when the scope is missing', async () => {
    google.failNext = new Error('List events failed (403) [insufficientPermissions]: Request had insufficient authentication scopes.');
    await expect(googleCalendar.syncAll()).rejects.toThrow('insufficient');
    expect(useStore.getState().config.googleCalendar.needsReauth).toBe(true);
  });

  it('reports which calendar failed', async () => {
    google.failNext = new Error('List events failed (404) [notFound]: Not Found');
    const stats = await googleCalendar.syncAll();
    expect(stats.errors).toBe(1);
    expect(stats.errorDetails[0]).toMatchObject({ calendar: 'NutriPolo' });
  });
});

// ── Patient matching on import ───────────────────────────────────────────
// Invented people only: no real patient data in tests.

describe('patient matching', () => {
  const PATIENTS = [
    { id: 'lucia', nombre: 'Lucía Ferrer Soto', email: 'lucia.ferrer@example.com', telefono: '+34 600 11 22 33' },
    { id: 'marcos', nombre: 'Marcos Prieto', telefono: '611223344' },
    { id: 'sara1', nombre: 'Sara Gil' },
    { id: 'sara2', nombre: 'Sara Gil' },
  ];

  beforeEach(() => {
    useStore.setState({ clients: PATIENTS.map(c => ({ ...c })), patientSuggestions: [] });
  });

  function remote(id, summary, extra = {}, calId = CAL) {
    cal(calId).set(id, {
      id, summary, start_datetime: '2026-10-22T10:00:00+02:00', end_datetime: '2026-10-22T10:45:00+02:00', updated: stamp(), ...extra,
    });
  }
  const byEvent = (id) => useStore.getState().consultations.find(c => c.googleEventId === id);
  const open = () => useStore.getState().patientSuggestions.filter(sg => sg.status === 'pending' || sg.status === 'pending-confirm');
  async function sync() {
    tick();
    return googleCalendar.syncAll();
  }
  const googleWrites = () => google.calls.filter(c => ['gcal_create_event', 'gcal_update_event', 'gcal_delete_event'].includes(c));

  it('assigns by guest email and by a phone in the description', async () => {
    remote('e-mail', 'Cita', { attendees: ['Lucia.Ferrer@example.com'] });
    remote('e-tel', 'Primera visita', { description: 'Tel. 611 22 33 44' });
    const stats = await sync();
    expect(byEvent('e-mail')).toMatchObject({ clienteId: 'lucia', matchStatus: 'exact', matchedBy: 'system', matchedVia: 'email', matchScore: 1 });
    expect(byEvent('e-tel')).toMatchObject({ clienteId: 'marcos', matchedVia: 'phone' });
    expect(byEvent('e-mail').matchedAt).toBeTruthy();
    expect(open()).toHaveLength(0);
    expect(stats.suggested).toBe(0);
  });

  it('assigns a unique exact name', async () => {
    remote('e1', 'Consulta - Marcos Prieto');
    await sync();
    expect(byEvent('e1')).toMatchObject({ clienteId: 'marcos', matchedVia: 'name', tipo: 'Google Calendar' });
  });

  it('does not assign a name shared by two clients: asks instead', async () => {
    remote('e1', 'Sara Gil');
    const stats = await sync();
    expect(byEvent('e1')).toMatchObject({ clienteId: null, matchStatus: 'suggested' });
    expect(open()).toHaveLength(1);
    expect(open()[0].candidates.map(c => c.clienteId).sort()).toEqual(['sara1', 'sara2']);
    expect(stats.suggested).toBe(1);
  });

  it('proposes a fuzzy match without linking it', async () => {
    remote('e1', 'Marco Prieto');
    await sync();
    const c = byEvent('e1');
    expect(c).toMatchObject({ clienteId: null, matchStatus: 'auto-pending-review', suggestedClienteId: 'marcos' });
    expect(open()[0]).toMatchObject({ status: 'pending-confirm', suggestedClienteId: 'marcos', consultationIds: [c.id] });

    useStore.getState().confirmAutoMatch(open()[0].id);
    expect(byEvent('e1')).toMatchObject({ clienteId: 'marcos', matchStatus: 'manual', matchedBy: 'user' });
  });

  it('offers to create the client, prefilled, and links every appointment of it', async () => {
    remote('e1', 'Consulta - Nuria Campos', { attendees: ['nuria.campos@example.com'], description: 'Móvil 633 44 55 66' });
    remote('e2', 'Nuria Campos (seguimiento)', { start_datetime: '2026-10-29T10:00:00+01:00', end_datetime: '2026-10-29T10:45:00+01:00' });
    const stats = await sync();
    expect(open()).toHaveLength(1);
    const sg = open()[0];
    expect(sg).toMatchObject({
      status: 'pending', candidates: [], normalizedName: 'nuria campos', displayName: 'Nuria Campos',
      contactEmail: 'nuria.campos@example.com', contactPhone: '633445566', occurrences: 2,
    });
    expect(sg.consultationIds).toHaveLength(2);
    expect(byEvent('e1').matchStatus).toBe('unknown');
    expect(stats.suggested).toBe(1);

    const client = useStore.getState().createClientFromSuggestion(sg.id, { nombre: 'Nuria Campos', email: sg.contactEmail, telefono: sg.contactPhone });
    expect(byEvent('e1').clienteId).toBe(client.id);
    expect(byEvent('e2').clienteId).toBe(client.id);

    // Resyncing changes nothing and creates no new suggestion.
    google.calls = [];
    expect((await sync()).suggested).toBe(0);
    expect(byEvent('e2').clienteId).toBe(client.id);
    expect(googleWrites()).toEqual([]);
  });

  it('a dismissed name does not come back', async () => {
    remote('e1', 'Nuria Campos');
    await sync();
    useStore.getState().dismissPatientSuggestion(open()[0].id);
    remote('e2', 'Consulta - Nuria Campos', { start_datetime: '2026-10-30T10:00:00+01:00', end_datetime: '2026-10-30T11:00:00+01:00' });
    const stats = await sync();
    expect(open()).toHaveLength(0);
    expect(stats.suggested).toBe(0);
    expect(byEvent('e2')).toMatchObject({ clienteId: null, matchStatus: 'dismissed' });
  });

  it('never overwrites a choice of the user when resyncing', async () => {
    remote('e1', 'Sara Gil');
    await sync();
    useStore.getState().linkPatientSuggestion(open()[0].id, 'sara2');
    // Retitled in Google to another existing client.
    remote('e1', 'Marcos Prieto');
    await sync();
    expect(byEvent('e1')).toMatchObject({ clienteId: 'sara2', matchedBy: 'user', googleSummary: 'Marcos Prieto' });
  });

  it('can undo an automatic link, without writing to Google, and it is not redone', async () => {
    remote('e1', 'Marcos Prieto');
    await sync();
    google.calls = [];
    expect(useStore.getState().unlinkAutoMatch(byEvent('e1').id)).toBe(true);
    expect(byEvent('e1')).toMatchObject({ clienteId: null, matchedBy: 'user', rejectedClienteId: 'marcos' });
    await sync();
    expect(byEvent('e1').clienteId).toBeNull();
    expect(open()).toHaveLength(0);
    expect(googleWrites()).toEqual([]);
  });

  it('never re-evaluates an appointment created in the app', async () => {
    const c = newConsultation({ clienteId: 'lucia' });
    await googleCalendar.pushConsultation(c.id);
    const id = consultation(c.id).googleEventId;
    remote(id, 'Consulta - Marcos Prieto', { nutripolo_id: c.id });
    await sync();
    expect(consultation(c.id).clienteId).toBe('lucia');
    expect(consultation(c.id).matchStatus).toBeUndefined();
    expect(open()).toHaveLength(0);
  });

  it('fills in appointments imported before matching existed, once', async () => {
    remote('old-known', 'Marcos Prieto');
    remote('old-unknown', 'Nuria Campos');
    // As imported by older versions: no client, no match fields, up to date.
    for (const id of ['old-known', 'old-unknown']) {
      useStore.getState().addConsultation({
        ...googleCalendar.eventToConsultation(cal(CAL).get(id), CAL), clienteId: null, remoteUpdated: cal(CAL).get(id).updated,
      }, { sync: true });
    }
    await sync();
    expect(byEvent('old-known')).toMatchObject({ clienteId: 'marcos', matchedBy: 'system' });
    expect(open()).toHaveLength(1);
    expect(open()[0].consultationIds).toEqual([byEvent('old-unknown').id]);

    await sync();
    await sync();
    expect(useStore.getState().patientSuggestions).toHaveLength(1);
    expect(open()[0]).toMatchObject({ occurrences: 1, consultationIds: [byEvent('old-unknown').id] });
    expect(useStore.getState().consultations).toHaveLength(2);
  });

  it('follows a title fixed in Google', async () => {
    remote('e1', 'Marcos Prietto Lago');
    await sync();
    expect(open()).toHaveLength(1);
    remote('e1', 'Marcos Prieto');
    await sync();
    expect(byEvent('e1')).toMatchObject({ clienteId: 'marcos', matchStatus: 'exact' });
    expect(open()).toHaveLength(0);
    expect(useStore.getState().patientSuggestions).toHaveLength(0);
  });

  it('ignores events that are not appointments', async () => {
    remote('n1', 'Bloqueo');
    remote('n2', 'Comida con Laura');
    remote('n3', '');
    remote('n4', 'Consulta');
    remote('n5', 'Cumpleaños tía', { start_datetime: '2026-10-23', end_datetime: '2026-10-24' });
    const stats = await sync();
    expect(useStore.getState().patientSuggestions).toHaveLength(0);
    expect(stats.suggested).toBe(0);
    expect(useStore.getState().consultations.every(c => !c.matchStatus)).toBe(true);
  });

  it('matches the external clinic calendars the same way', async () => {
    connect({
      calendars: [
        { id: CAL, name: 'NutriPolo', syncMode: 'bidirectional', purpose: 'primary' },
        { id: CLINIC, name: 'Clínica', syncMode: 'readonly', purpose: 'external-clinic' },
      ],
    });
    remote('x1', 'Sara Gil', {}, CLINIC);
    remote('x2', 'Lucia', { description: 'lucia.ferrer@example.com' }, CLINIC);
    await sync();
    expect(byEvent('x1')).toMatchObject({ clienteId: null, matchStatus: 'suggested' });
    expect(byEvent('x2')).toMatchObject({ clienteId: 'lucia', matchedVia: 'email' });
    expect(open()[0].sourceCalendarId).toBe(CLINIC);
  });

  it('keeps the Google title of an automatically linked appointment', async () => {
    remote('e1', 'Cita online', { attendees: ['lucia.ferrer@example.com'] });
    await sync();
    tick();
    useStore.getState().updateConsultation(byEvent('e1').id, { notasPrivadas: 'nota' });
    await googleCalendar.pushConsultation(byEvent('e1').id);
    expect(cal(CAL).get('e1').summary).toBe('Cita online');
  });

  it('none of the matching writes looks like a local edit', async () => {
    remote('a', 'Marcos Prieto');
    remote('b', 'Sara Gil');
    remote('c', 'Marco Prieto');
    remote('d', 'Nuria Campos', { attendees: ['nuria.campos@example.com'] });
    remote('e', 'Cita', { description: '600 11 22 33' });
    await sync();
    useStore.getState().confirmAutoMatch(open().find(sg => sg.status === 'pending-confirm').id);
    useStore.getState().linkPatientSuggestion(open().find(sg => sg.normalizedName === 'sara gil').id, 'sara1');
    useStore.getState().createClientFromSuggestion(open()[0].id, { nombre: 'Nuria Campos' });
    google.calls = [];
    await sync();
    for (const c of useStore.getState().consultations) expect(c.localUpdatedAt).toBeUndefined();
    expect(googleWrites()).toEqual([]);
  });
});
