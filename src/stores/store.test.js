import { describe, it, expect, vi, beforeEach } from 'vitest';

// Auto-backups read by restoreFromAutoBackup (replaces the Rust IPC commands)
const files = {};
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(async (cmd, args) => {
    if (cmd === 'load_data') {
      if (!(args.key in files)) throw 'not_found';
      return files[args.key];
    }
    if (cmd === 'save_data') { files[args.key] = args.value; return null; }
    if (cmd === 'delete_data') { delete files[args.key]; return null; }
    if (cmd === 'list_data_keys') return Object.keys(files).filter(k => k.startsWith(args.prefix)).sort();
    return null;
  }),
}));

// Outside Tauri the store persists to localStorage
const saved = {};
globalThis.localStorage = {
  getItem: (k) => saved[k] ?? null,
  setItem: (k, v) => { saved[k] = v; },
  removeItem: (k) => { delete saved[k]; },
};

const { default: useStore, changedFields, lastVisitByClient, canDeleteInvoice, flushAllPending, readBackup, todayISO } = await import('./store');

const initial = useStore.getState();
// Like the app: nothing is written before the data has been loaded
await useStore.persist.rehydrate();

beforeEach(() => {
  useStore.setState(initial, true);
  for (const k of Object.keys(files)) delete files[k];
});

describe('persistence', () => {
  it('serializes each changed part once per write, not on every change', async () => {
    await flushAllPending(); await flushAllPending();   // whatever an earlier test left queued
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let i = 0; i < 20; i++) useStore.getState().addClient({ nombre: `Cliente ${i}` });
    expect(stringify).not.toHaveBeenCalled();

    await flushAllPending();
    // Only the clients part: not the appointments, the plans, the photos nor the main file
    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();
    expect(JSON.parse(saved['nutripolo-clients'])).toHaveLength(20);
  });

  it('writes nothing when only what is not saved changes (changing view)', async () => {
    await flushAllPending(); await flushAllPending();
    const stringify = vi.spyOn(JSON, 'stringify');
    useStore.getState().setCurrentView('clients');
    useStore.getState().setCurrentView('invoices');
    await flushAllPending();
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('moves from the single file to parts without ever leaving an incomplete main file', async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    saved['nutripolo-storage'] = JSON.stringify({ version: 17, state: { clients: [{ id: 'k1', nombre: 'Ana' }], consultations: [{ id: 'c1' }] } });
    await useStore.persist.rehydrate();
    const order = [];
    const write = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (k, v) => { order.push([k, JSON.parse(v)?.split === true]); write(k, v); };
    // The first change writes every part
    useStore.getState().setSidebarCollapsed(true);
    await flushAllPending(); await flushAllPending();
    globalThis.localStorage.setItem = write;

    expect(JSON.parse(saved['nutripolo-consultations'])).toEqual([{ id: 'c1' }]);
    const main = JSON.parse(saved['nutripolo-storage']);
    expect(main.split).toBe(true);
    expect(main.state.clients).toBeUndefined();
    // The small main file is only written once every part is on disk
    const firstSplit = order.findIndex(([k, split]) => k === 'nutripolo-storage' && split);
    const parts = new Set(order.slice(0, firstSplit).map(([k]) => k).filter(k => k !== 'nutripolo-storage'));
    expect(parts.size).toBe(10);

    useStore.setState({ clients: [], consultations: [] });
    await useStore.persist.rehydrate();
    expect(useStore.getState().clients.map(c => c.nombre)).toEqual(['Ana']);
    expect(useStore.getState().consultations.map(c => c.id)).toEqual(['c1']);
  });

  it('writes nothing before the data is loaded', async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    saved['nutripolo-storage'] = JSON.stringify({ version: 17, state: { clients: [{ id: 'k1', nombre: 'Ana' }] } });
    const loading = useStore.persist.rehydrate();
    useStore.setState({ clients: [] });   // a change while the file is being read
    await loading;
    await flushAllPending();
    expect(JSON.parse(saved['nutripolo-storage']).state.clients).toHaveLength(1);
  });

  it('does not load a split store with a part missing', async () => {
    useStore.getState().addClient({ nombre: 'Para escribir' });
    await flushAllPending(); await flushAllPending();
    expect(JSON.parse(saved['nutripolo-storage']).split).toBe(true);
    const backup = saved['nutripolo-invoices'];
    delete saved['nutripolo-invoices'];
    const { getLoadFailure, clearLoadFailure } = await import('./store');
    await useStore.persist.rehydrate();
    expect(getLoadFailure()).toMatchObject({ key: 'nutripolo-invoices', error: 'missing' });
    clearLoadFailure();
    saved['nutripolo-invoices'] = backup;
  });

  it('turns read-only calendars saved as bidirectional off on load', async () => {
    saved['nutripolo-storage'] = JSON.stringify({ version: 14, state: { config: { googleCalendar: {
      calendars: [{ id: 'r', accessRole: 'reader', syncMode: 'bidirectional' }, { id: 'w', accessRole: 'owner', syncMode: 'bidirectional' }],
      defaultPushCalendarId: 'r',
    } } } });
    await useStore.persist.rehydrate();
    const gc = useStore.getState().config.googleCalendar;
    expect(gc.calendars.map(c => c.syncMode)).toEqual(['disabled', 'bidirectional']);
    expect(gc.defaultPushCalendarId).toBeNull();
  });

  it('reads back what it wrote', async () => {
    useStore.getState().addClient({ nombre: 'Ana' });
    await flushAllPending();
    useStore.setState({ clients: [] });
    await useStore.persist.rehydrate();
    expect(useStore.getState().clients.map(c => c.nombre)).toEqual(['Ana']);
  });
});

describe('changedFields', () => {
  it('keeps only the edited fields and treats empty values as equal', () => {
    const original = { id: 'c1', fecha: '2026-10-01', notasPrivadas: '', proximaCita: undefined, duracion: 45 };
    const edited = { ...original, notasPrivadas: 'Nota', proximaCita: '', duracion: '45' };
    expect(changedFields(original, edited)).toEqual({ notasPrivadas: 'Nota' });
  });
});

describe('saving a consultation opened before a reminder was sent', () => {
  it('does not wipe the reminder record (it would be sent again)', () => {
    const c = useStore.getState().addConsultation({ clienteId: 'k1', fecha: '2026-11-02', hora: '10:00' });
    useStore.getState().setConsultationReminder(c.id, 'whatsapp', { status: 'opened', slot: '2026-11-02T10:00' });
    // The modal copies the consultation on open…
    const snapshot = useStore.getState().consultations.find(x => x.id === c.id);
    const form = { ...snapshot, notasPrivadas: 'Trae analítica' };
    // …then the email reminder goes out while it is open…
    useStore.getState().setConsultationReminder(c.id, 'email', { status: 'sent', slot: '2026-11-02T10:00' });
    // …and the user saves.
    useStore.getState().updateConsultation(c.id, changedFields(snapshot, form));

    const saved = useStore.getState().consultations.find(x => x.id === c.id);
    expect(saved.notasPrivadas).toBe('Trae analítica');
    expect(saved.reminders.email.status).toBe('sent');
    expect(saved.reminders.whatsapp.status).toBe('opened');
  });

  it('ignores reminder and review records in user writes even when sent whole', () => {
    const c = useStore.getState().addConsultation({ clienteId: 'k1', fecha: '2026-11-02' });
    useStore.getState().setConsultationReviewRequest(c.id, 'email', { status: 'sent' });
    useStore.getState().updateConsultation(c.id, { reminders: {}, reviewRequest: {} });
    expect(useStore.getState().consultations.find(x => x.id === c.id).reviewRequest.email.status).toBe('sent');
  });
});

describe('last visit', () => {
  it('is the newest completed consultation or measurement, never moving back', () => {
    const { addClient, addConsultation, updateConsultation, addMeasurement } = useStore.getState();
    const client = addClient({ nombre: 'Ana' });
    const old = addConsultation({ clienteId: client.id, fecha: '2026-03-01', estado: 'completada' });
    addConsultation({ clienteId: client.id, fecha: '2026-09-15', estado: 'completada' });
    addConsultation({ clienteId: client.id, fecha: '2026-12-01', estado: 'programada' });
    // Editing the old consultation or adding an old measurement used to set it back to March.
    updateConsultation(old.id, { notasPrivadas: 'revisado' });
    addMeasurement({ clienteId: client.id, fecha: '2026-02-01', peso: 70 });

    expect(lastVisitByClient(useStore.getState()).get(client.id)).toBe('2026-09-15');
  });

  it('drives the pending follow-ups list', () => {
    const { addClient, addMeasurement, getPendingFollowUps } = useStore.getState();
    const recent = addClient({ nombre: 'Reciente' });
    const stale = addClient({ nombre: 'Antiguo' });
    addMeasurement({ clienteId: recent.id, peso: 60 });            // today
    addMeasurement({ clienteId: stale.id, fecha: '2020-01-01', peso: 80 });

    const ids = getPendingFollowUps(30).map(c => c.id);
    expect(ids).toContain(stale.id);
    expect(ids).not.toContain(recent.id);
  });
});

describe('measurements', () => {
  it('recomputes the BMI when the weight is edited', () => {
    const { addClient, addMeasurement, updateMeasurement } = useStore.getState();
    const client = addClient({ nombre: 'Ana', altura: 160 });
    const m = addMeasurement({ clienteId: client.id, masaOsea: 2.5 });
    expect(m.imc).toBeNull();

    updateMeasurement(m.id, { peso: 64 });
    const get = () => useStore.getState().measurements.find(x => x.id === m.id);
    expect(get().imc).toBe(25);
    updateMeasurement(m.id, { agua: 50 });
    expect(get().imc).toBe(25);
    updateMeasurement(m.id, { peso: null });
    expect(get().imc).toBeNull();
    expect(get().masaOsea).toBe(2.5);
  });
});

// Issuing needs the professional's NIF; drafts do not.
const withNif = () => useStore.setState(s => ({ config: { ...s.config, nif: '00000000T' } }));
const issue = (fecha, extra = {}) => {
  const draft = useStore.getState().saveInvoiceDraft({ fecha, clienteId: 'k1', items: [{ id: 'l', descripcion: 'Consulta', cantidad: 1, precioUnitario: 40 }], ...extra });
  const result = useStore.getState().issueInvoice(draft.id);
  if (!result.ok) throw new Error(result.problems.map(p => p.code).join());
  return result.invoice;
};

describe('invoices', () => {
  beforeEach(withNif);

  it('gives the number on issue, from the series of the invoice date', () => {
    const draft = useStore.getState().saveInvoiceDraft({ fecha: '2025-12-30', clienteId: 'k1', items: [] });
    expect(draft.numero).toBeUndefined();
    expect(useStore.getState().issueInvoice(draft.id).invoice.numero).toBe('NP-2025-001');
    expect(issue('2026-01-02').numero).toBe('NP-2026-001');
    expect(issue('2025-12-31').numero).toBe('NP-2025-002');
  });

  it("does not issue without the professional's NIF", () => {
    useStore.setState(s => ({ config: { ...s.config, nif: '' } }));
    const draft = useStore.getState().saveInvoiceDraft({ fecha: '2026-03-01', clienteId: 'k1', items: [] });
    expect(useStore.getState().issueInvoice(draft.id)).toMatchObject({ ok: false, problems: [{ code: 'issuer_nif' }] });
  });

  it('only deletes drafts, and an issued invoice only changes how it was paid', () => {
    const draft = useStore.getState().saveInvoiceDraft({ fecha: '2026-03-01', clienteId: 'k1', items: [] });
    const issued = issue('2026-03-02');
    expect(canDeleteInvoice(useStore.getState().invoices, draft)).toBe(true);
    expect(useStore.getState().deleteInvoice(issued.id)).toBe(false);
    expect(useStore.getState().deleteInvoice(draft.id)).toBe(true);

    useStore.getState().updateInvoice(issued.id, { estado: 'pagada', fechaCobro: '2026-03-05', fecha: '2020-01-01', items: [], estado2: 'x' });
    const after = useStore.getState().invoices.find(i => i.id === issued.id);
    expect(after).toMatchObject({ estado: 'pagada', fechaCobro: '2026-03-05', fecha: '2026-03-02', total: 40 });
    // "Anulada" only comes from a corrective invoice
    useStore.getState().updateInvoice(issued.id, { estado: 'anulada' });
    expect(useStore.getState().invoices.find(i => i.id === issued.id).estado).toBe('pagada');
  });

  it('cancels an invoice with a corrective one in its own series', () => {
    const original = issue('2026-03-02', { items: [{ id: 'l', descripcion: 'Consulta', cantidad: 1, precioUnitario: 40, consultationId: 'c1' }] });
    const draft = useStore.getState().createCorrectiveDraft(original.id);
    expect(draft).toMatchObject({ tipo: 'rectificativa', rectificaNumero: original.numero, total: -40 });
    expect(useStore.getState().issueInvoice(draft.id).ok).toBe(false);   // needs a reason
    useStore.getState().saveInvoiceDraft({ motivoRectificacion: 'Cobrada dos veces' }, draft.id);
    const corrective = useStore.getState().issueInvoice(draft.id).invoice;
    expect(corrective.numero).toBe('R-2026-001');
    const updated = useStore.getState().invoices.find(i => i.id === original.id);
    expect(updated).toMatchObject({ estado: 'anulada', rectificadaPor: [corrective.id] });
  });

  it('keeps the client data on the invoice when the client record changes', () => {
    useStore.setState({ clients: [{ id: 'k1', nombre: 'Ana', nif: '11111111H' }] });
    const inv = issue('2026-03-02');
    useStore.getState().updateClient('k1', { nombre: 'Ana Cambiada' });
    expect(useStore.getState().invoices.find(i => i.id === inv.id).destinatario.nombre).toBe('Ana');
  });
});

describe('undo', () => {
  beforeEach(withNif);

  it('restores a deleted draft', () => {
    const draft = useStore.getState().saveInvoiceDraft({ fecha: '2026-03-01', clienteId: 'k1', items: [] });
    useStore.getState().deleteInvoice(draft.id);
    expect(useStore.getState().undo()).toEqual({ ok: true });
    expect(useStore.getState().invoices.map(i => i.id)).toEqual([draft.id]);
  });

  it('undoes a new client only while it is untouched', () => {
    const client = useStore.getState().addClient({ nombre: 'Nueva' });
    expect(useStore.getState().undo()).toEqual({ ok: true });
    expect(useStore.getState().clients).toHaveLength(0);
    // Redo brings it back
    useStore.getState().redo();
    expect(useStore.getState().clients.map(c => c.id)).toEqual([client.id]);
  });

  it('keeps a new client once it has been edited', () => {
    const client = useStore.getState().addClient({ nombre: 'Nueva' });
    useStore.getState().updateClient(client.id, { entrevista: { motivo: 'Primera visita' } });
    expect(useStore.getState().undo()).toEqual({ ok: false, reason: 'client_in_use' });
    expect(useStore.getState().clients[0].entrevista.motivo).toBe('Primera visita');
  });

  it('keeps a new client that already has a measurement', () => {
    const client = useStore.getState().addClient({ nombre: 'Nueva' });
    useStore.getState().addMeasurement({ clienteId: client.id, fecha: '2026-11-04', peso: 70 });
    expect(useStore.getState().undo()).toEqual({ ok: false, reason: 'client_in_use' });
    expect(useStore.getState().clients).toHaveLength(1);
  });
});

describe('restoring a backup', () => {
  it('migrates an old backup and clears the undo history', async () => {
    const { addClient, deleteClient } = useStore.getState();
    const current = addClient({ nombre: 'Actual' });
    deleteClient(current.id);
    expect(useStore.getState()._history.length).toBeGreaterThan(0);

    files['backup-2026-01-10'] = JSON.stringify({
      version: 10,
      data: {
        clients: [{ id: 'k1', nombre: 'Ana', fechaUltimaConsulta: '2025-01-01' }],
        consultations: [{ id: 'c1', clienteId: 'k1', fecha: '2026-01-12', hora: '10:00', lastWhatsappReminder: '2026-01-11T09:00:00Z' }],
        patientSuggestions: [{ id: 'sg1', status: 'pending' }],
      },
    });
    await useStore.getState().restoreFromAutoBackup('2026-01-10');

    const s = useStore.getState();
    expect(s._history).toEqual([]);
    expect(s._future).toEqual([]);
    expect(s.clients).toEqual([{ id: 'k1', nombre: 'Ana' }]);
    // v10 → v11: the old WhatsApp stamp becomes a reminder record
    expect(s.consultations[0].reminders.whatsapp).toMatchObject({ status: 'opened', slot: '2026-01-12T10:00' });
    expect(s.consultations[0].lastWhatsappReminder).toBeUndefined();
    expect(s.patientSuggestions.map(sg => sg.id)).toEqual(['sg1']);

    // Undo after a restore must not bring back data from before it
    s.undo();
    expect(useStore.getState().clients.map(c => c.id)).toEqual(['k1']);
  });

  it('keeps the current inbox when the backup predates it', async () => {
    useStore.setState({ patientSuggestions: [{ id: 'live', status: 'pending' }] });
    files['backup-2026-02-01'] = JSON.stringify({ version: 13, data: { clients: [] } });
    await useStore.getState().restoreFromAutoBackup('2026-02-01');
    expect(useStore.getState().patientSuggestions.map(sg => sg.id)).toEqual(['live']);
  });

  it("does not show an appointment twice after restoring the copy from before converting its calendar", async () => {
    useStore.setState({
      consultations: [],
      personalEvents: [
        { id: 'p1', googleEventId: 'g1', sourceCalendarId: 'cal', title: 'Ana', fecha: '2026-02-03', hora: '10:00' },
        { id: 'p2', googleEventId: 'g2', sourceCalendarId: 'cal', title: 'Ballet', fecha: '2026-02-04', hora: '18:00' },
      ],
    });
    files['backup-2026-02-01'] = JSON.stringify({ version: 17, data: {
      clients: [{ id: 'k1', nombre: 'Ana' }],
      consultations: [{ id: 'c1', clienteId: 'k1', googleEventId: 'g1', sourceCalendarId: 'cal', fecha: '2026-02-03', hora: '10:00' }],
    } });
    await useStore.getState().restoreFromAutoBackup('2026-02-01');
    const s = useStore.getState();
    expect(s.consultations.map(c => c.id)).toEqual(['c1']);
    expect(s.personalEvents.map(e => e.id)).toEqual(['p2']);
  });

  it('keeps what was already sent for events waiting to be imported again', async () => {
    const sent = { email: { status: 'sent', slot: '2026-02-03T10:00' } };
    useStore.setState({ clients: [{ id: 'k1', nombre: 'Ana' }], sentByEvent: { g1: { reminders: sent } }, lastBackupDate: null });
    await useStore.getState().runAutoBackup();
    const key = Object.keys(files).find(k => /^backup-\d/.test(k));
    expect(JSON.parse(files[key]).data.sentByEvent).toEqual({ g1: { reminders: sent } });

    // Restored on another installation that has nothing pending
    useStore.setState({ sentByEvent: {} });
    await useStore.getState().restoreFromAutoBackup(key.slice('backup-'.length));
    expect(useStore.getState().sentByEvent).toEqual({ g1: { reminders: sent } });
  });

  it('includes the patient inbox in new backups', async () => {
    useStore.setState({ clients: [{ id: 'k1', nombre: 'Ana' }], patientSuggestions: [{ id: 'sg9', status: 'pending' }], lastBackupDate: null });
    const { invoke } = await import('@tauri-apps/api/tauri');
    invoke.mockClear();
    await useStore.getState().runAutoBackup();
    const call = invoke.mock.calls.find(([cmd, args]) => cmd === 'save_data' && args.key.startsWith('backup-2'));
    expect(JSON.parse(call[1].value).data.patientSuggestions).toEqual([{ id: 'sg9', status: 'pending' }]);
  });
});

describe('backups', () => {
  const backupFile = (data, version = 16) => JSON.stringify({ version, date: '2026-11-01T08:00:00Z', data });

  it('rejects files that are not a NutriPolo backup or come from a newer version', () => {
    expect(() => readBackup({ name: 'x', version: '1.0.0', dependencies: {} })).toThrow('not_a_backup');
    expect(() => readBackup({ version: 16, data: { clients: {} } })).toThrow('not_a_backup');
    expect(() => readBackup({ version: 16, data: { clients: [], invoices: 'x' } })).toThrow('not_a_backup');
    expect(() => readBackup({ version: 999, data: { clients: [] } })).toThrow('backup_newer');
    const ok = readBackup({ version: 16, date: '2026-11-01T08:00:00Z', data: { clients: [{ id: 'k1' }], invoices: [{ id: 'i1' }] } });
    expect(ok.counts).toMatchObject({ clients: 1, invoices: 1, consultations: 0 });
    expect(ok.date).toBe('2026-11-01T08:00:00Z');
  });

  it('saves the current data first and keeps invoices and reminders that happened after the backup', async () => {
    useStore.setState({
      clients: [{ id: 'k1', nombre: 'Ana' }],
      invoices: [
        { id: 'i1', numero: 'NP-2026-001' },
        { id: 'i2', numero: 'NP-2026-002' },   // issued after the backup
      ],
      consultations: [{ id: 'c1', clienteId: 'k1', reminders: { email: { status: 'sent', slot: '2026-11-05T10:00' } } }],
    });
    files['backup-2026-11-01'] = backupFile({
      clients: [{ id: 'k1', nombre: 'Ana (copia)' }],
      invoices: [{ id: 'i1', numero: 'NP-2026-001' }],
      consultations: [{ id: 'c1', clienteId: 'k1' }],
    });
    const result = await useStore.getState().restoreFromAutoBackup('2026-11-01');

    const s = useStore.getState();
    expect(s.clients[0].nombre).toBe('Ana (copia)');
    expect(s.invoices.map(i => i.numero)).toEqual(['NP-2026-001', 'NP-2026-002']);
    expect(result.keptInvoices).toBe(1);
    // The reminder sent after the backup is not sent again
    expect(s.consultations[0].reminders.email.status).toBe('sent');
    // What was there before can be brought back
    expect(JSON.parse(files['backup-safety']).data.clients[0].nombre).toBe('Ana');
    expect((await s.getAutoBackupInfo()).safety).not.toBeNull();
  });

  it('does not replace anything if the backup cannot be read', async () => {
    useStore.setState({ clients: [{ id: 'k1', nombre: 'Ana' }] });
    files['backup-2026-11-01'] = JSON.stringify({ name: 'otro', version: '2.0.0' });
    await expect(useStore.getState().restoreFromAutoBackup('2026-11-01')).rejects.toThrow('not_a_backup');
    expect(useStore.getState().clients.map(c => c.nombre)).toEqual(['Ana']);
    expect(files['backup-safety']).toBeUndefined();
  });

  it('treats invoices from before v17 as issued, with the data they have now', () => {
    const { data } = readBackup({ version: 16, data: {
      config: { nombre: 'Nutricionista', nif: '00000000T' },
      clients: [{ id: 'k1', nombre: 'Ana', nif: '11111111H' }],
      invoices: [{ id: 'i1', numero: 'NP-2026-001', fecha: '2026-02-03', clienteId: 'k1' }, { id: 'i2', numero: 'NP-2026-002', fecha: '2026-02-04', clienteId: 'gone' }],
    } });
    expect(data.invoices[0]).toMatchObject({ emitidaAt: '2026-02-03T12:00:00.000Z', emisor: { nif: '00000000T' }, destinatario: { nombre: 'Ana', nif: '11111111H' } });
    expect(data.invoices[1].destinatario.nombre).toBe('');
  });

  it('does not back up an empty store over a real backup', async () => {
    useStore.setState({ lastBackupDate: null });
    expect(await useStore.getState().runAutoBackup()).toEqual({ ok: true, skipped: true });
    expect(Object.keys(files)).toEqual([]);
  });

  it('finds the backups on disk even with a damaged manifest, and keeps 7', async () => {
    for (let d = 1; d <= 7; d++) files[`backup-2026-10-0${d}`] = backupFile({ clients: [] });
    files['backup-manifest'] = '{ not json';
    useStore.setState({ clients: [{ id: 'k1', nombre: 'Ana' }], lastBackupDate: null });
    expect(await useStore.getState().runAutoBackup()).toEqual({ ok: true });

    const today = todayISO();
    const info = await useStore.getState().getAutoBackupInfo();
    expect(info.count).toBe(7);
    expect(info.lastDate).toBe(today);
    expect(info.dates[0]).toBe('2026-10-02');   // the oldest one was rotated out
    expect(files['backup-2026-10-01']).toBeUndefined();
    expect(JSON.parse(files['backup-manifest'])).toEqual(info.dates);
  });
});

describe('agenda and clients without losing what happened', () => {
  it('drops the notes of a deleted client from the appointments kept for Google, and undo brings them back', () => {
    useStore.setState({
      clients: [{ id: 'k1', nombre: 'Ana' }],
      consultations: [{ id: 'c1', clienteId: 'k1', googleEventId: 'g1', notasPrivadas: 'privada', notasCliente: 'para ella' }],
    });
    useStore.getState().deleteClient('k1');
    expect(useStore.getState().consultations[0]).toMatchObject({ clienteId: null, notasPrivadas: '', notasCliente: '' });
    useStore.getState().undo();
    expect(useStore.getState().consultations[0]).toMatchObject({ clienteId: 'k1', notasPrivadas: 'privada' });
  });

  it('remembers what was already sent when the agenda is reset', () => {
    useStore.setState({ consultations: [{ id: 'c1', googleEventId: 'g1', reminders: { email: { status: 'sent' } } }, { id: 'c2' }] });
    useStore.getState().resetAgenda();
    expect(useStore.getState().consultations).toEqual([]);
    expect(useStore.getState().takeSentStatus('g1')).toEqual({ reminders: { email: { status: 'sent' } }, reviewRequest: undefined });
    // Only once
    expect(useStore.getState().takeSentStatus('g1')).toBeNull();
  });

  it('keeps the data as it was before a new version migrates it', async () => {
    for (const k of Object.keys(saved)) delete saved[k];
    saved['nutripolo-storage'] = JSON.stringify({ version: 16, state: { clients: [{ id: 'k1', nombre: 'Ana' }],
      config: { smtp: { host: 'smtp.example.com', password: 'secreta' }, googleCalendar: { refreshToken: 'rt', accessToken: 'at' } } } });
    await useStore.persist.rehydrate();
    const copy = JSON.parse(files['backup-safety']);
    // Never the secrets an old file may still carry
    expect(copy.data.config.smtp.password).toBe('');
    expect(copy.data.config.googleCalendar.refreshToken).toBe('');
    expect(copy.version).toBe(16);
    expect(copy.data.clients[0].nombre).toBe('Ana');
    expect(JSON.parse(files['backup-safety-info']).reason).toBe('update');
  });
});
