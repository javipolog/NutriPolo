import { describe, it, expect, vi, beforeEach } from 'vitest';

// Auto-backups read by restoreFromAutoBackup (replaces the Rust IPC commands)
const files = {};
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(async (cmd, args) => {
    if (cmd === 'load_data') {
      if (!(args.key in files)) throw 'not_found';
      return files[args.key];
    }
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

const { default: useStore, changedFields, lastVisitByClient, canDeleteInvoice, flushAllPending } = await import('./store');

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
  for (const k of Object.keys(files)) delete files[k];
});

describe('persistence', () => {
  it('serializes the store once per write, not on every change', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let i = 0; i < 20; i++) useStore.getState().addClient({ nombre: `Cliente ${i}` });
    expect(stringify).not.toHaveBeenCalled();

    await flushAllPending();
    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();
    const persisted = JSON.parse(saved['nutripolo-storage']);
    expect(persisted.state.clients).toHaveLength(20);
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

describe('invoice numbering', () => {
  const add = (fecha) => useStore.getState().addInvoice({ fecha, clienteId: 'k1', items: [] });

  it('uses the series of the invoice date, not of today', () => {
    expect(add('2025-12-30').numero).toBe('NP-2025-001');
    expect(add('2026-01-02').numero).toBe('NP-2026-001');
    expect(add('2025-12-31').numero).toBe('NP-2025-002');
  });

  it('only deletes the last invoice of a series, so there are no gaps', () => {
    const first = add('2026-03-01');
    const second = add('2026-03-02');
    const otherYear = add('2027-01-10');
    const manual = useStore.getState().addInvoice({ numero: 'R-1', fecha: '2026-03-03', items: [] });
    const { invoices } = useStore.getState();
    expect(canDeleteInvoice(invoices, first)).toBe(false);
    expect(canDeleteInvoice(invoices, second)).toBe(true);
    expect(canDeleteInvoice(invoices, otherYear)).toBe(true);
    expect(canDeleteInvoice(invoices, manual)).toBe(true);

    expect(useStore.getState().deleteInvoice(first.id)).toBe(false);
    expect(useStore.getState().deleteInvoice(second.id)).toBe(true);
    expect(useStore.getState().invoices.map(i => i.numero)).toEqual(['NP-2026-001', 'NP-2027-001', 'R-1']);
    // The freed number is the next one again
    expect(useStore.getState().generateInvoiceNumber('2026-04-01')).toBe('NP-2026-002');
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

  it('includes the patient inbox in new backups', async () => {
    useStore.setState({ patientSuggestions: [{ id: 'sg9', status: 'pending' }], lastBackupDate: null });
    const { invoke } = await import('@tauri-apps/api/tauri');
    invoke.mockClear();
    await useStore.getState().runAutoBackup();
    const call = invoke.mock.calls.find(([cmd, args]) => cmd === 'save_data' && args.key.startsWith('backup-2'));
    expect(JSON.parse(call[1].value).data.patientSuggestions).toEqual([{ id: 'sg9', status: 'pending' }]);
  });
});
