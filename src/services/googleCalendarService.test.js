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
      { id: 'e1', summary: 'Consulta - Ana López', start_datetime: '2026-10-20T08:00:00Z', end_datetime: '2026-10-20T08:45:00Z' },
      [{ id: 'ana', nombre: 'Ana López' }], CAL,
    );
    expect(c).toMatchObject({ fecha: '2026-10-20', hora: '10:00', duracion: 45, clienteId: 'ana' });
    expect(googleCalendar.eventToConsultation({ id: 'e2', status: 'cancelled', start_datetime: '' }, [], CAL)).toBeNull();
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
