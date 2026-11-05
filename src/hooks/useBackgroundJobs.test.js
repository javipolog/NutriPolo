import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn(async () => null) }));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { staleCalendarIds } = await import('./useBackgroundJobs');

const NOW = Date.parse('2026-11-05T10:00:00Z');
const gc = (extra = {}) => ({
  connected: true,
  calendars: [
    { id: 'own', syncMode: 'bidirectional' },
    { id: 'clinic', syncMode: 'readonly' },
    { id: 'off', syncMode: 'disabled' },
  ],
  ...extra,
});
const ids = (set) => [...set].sort();

describe('staleCalendarIds', () => {
  it('trusts calendars that synced fine in this tick', () => {
    expect(ids(staleCalendarIds(gc(), { syncRan: true, now: NOW }))).toEqual([]);
  });

  it('holds the calendars that failed, or all of them if the sync failed', () => {
    expect(ids(staleCalendarIds(gc(), { syncRan: true, failedIds: ['clinic'], now: NOW }))).toEqual(['clinic']);
    expect(ids(staleCalendarIds(gc(), { syncRan: true, syncFailed: true, now: NOW }))).toEqual(['clinic', 'own']);
  });

  it('holds everything when Google is disconnected or needs reconnecting', () => {
    expect(ids(staleCalendarIds(gc({ connected: false }), { now: NOW }))).toEqual(['clinic', 'own']);
    expect(ids(staleCalendarIds(gc({ needsReauth: true }), { syncRan: true, now: NOW }))).toEqual(['clinic', 'own']);
  });

  it('without automatic sync, trusts only a full sync of the last hour', () => {
    expect(ids(staleCalendarIds(gc(), { lastFullSyncAt: '2026-11-05T09:30:00Z', now: NOW }))).toEqual([]);
    expect(ids(staleCalendarIds(gc(), { lastFullSyncAt: '2026-11-05T07:00:00Z', now: NOW }))).toEqual(['clinic', 'own']);
  });

  it('holds a calendar stopped by the mass-delete guard', () => {
    const config = gc({ calendars: [{ id: 'own', syncMode: 'bidirectional', massDeletePending: { drop: 9 } }] });
    expect(ids(staleCalendarIds(config, { syncRan: true, now: NOW }))).toEqual(['own']);
  });

  it('has nothing to hold without Google calendars', () => {
    expect(ids(staleCalendarIds({ connected: false, calendars: [] }, { now: NOW }))).toEqual([]);
  });
});
