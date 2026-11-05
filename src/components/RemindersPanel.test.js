import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn(async () => null) }));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { countPendingReminders } = await import('./RemindersPanel');
const { getReminderCandidates } = await import('../services/reminderService');
const { getReviewCandidates } = await import('../services/reviewRequestService');

// Invented people only.
const NOW = new Date(2026, 10, 5, 10, 0).getTime();
const day = (offset) => { const d = new Date(NOW + offset * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const clients = [{ id: 'k1', nombre: 'Ana', telefono: '600000000', email: 'ana@example.com' }];
const config = {
  appLang: 'es', locations: [],
  reviewRequests: { enabled: true, defaultUrl: 'https://g.page/r/x/review' },
};
const consultations = [];
for (let offset = -400; offset <= 400; offset += 1) {
  consultations.push({ id: `c${offset}`, clienteId: 'k1', fecha: day(offset), hora: '10:00', duracion: 45,
    estado: offset < 0 ? 'completada' : 'programada' });
}
// Tomorrow just inside the reminder window
consultations.push({ id: 'soon', clienteId: 'k1', fecha: day(1), hora: '09:30', duracion: 45, estado: 'programada' });

describe('countPendingReminders', () => {
  it('counts the same as looking at every appointment', () => {
    // Same rule as the panel: WhatsApp to open by hand, email not sent on its own (no SMTP)
    const needsUser = (e) => e.state === 'due' || e.state === 'error';
    const full = getReminderCandidates({ consultations, clients, config, now: NOW }).filter(needsUser).length
      + getReviewCandidates({ consultations, history: consultations, clients, config, now: NOW }).filter(needsUser).length;
    expect(full).toBeGreaterThan(0);
    expect(countPendingReminders({ config, consultations, clients }, NOW)).toBe(full);
  });
});
