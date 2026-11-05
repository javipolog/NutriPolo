import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { extractPatientName, normalize as fuzzyNormalize, findBestMatches } from '../services/fuzzyMatcher.js';
import { DEFAULT_REMINDER_CONFIG, reminderSlot } from '../services/reminderService.js';
import { PLAN_FORMAT, collectOwnRecipes, mergeOwnRecipes, addMissingRecipes, replaceSeedRecipes } from '../services/planificacion.js';
import RECETAS_PLANIFICACIONES from '../data/recetasPlanificaciones.json';
import RECETAS_V15_A_NUEVAS from '../data/recetasPlanificacionesV15.json';
import {
  isIssued, isCorrective, issuerSnapshot, recipientSnapshot, nextInvoiceNumber, issueProblems, issueFields,
  correctiveDraft, cancelsInFull, billedConsultationIds, PAYMENT_FIELDS, SERIES,
} from '../services/invoicing.js';

// ============================================
// TAURI STORAGE — Write queue amb debounce
// ============================================
const writeQueue = {};
const writeTimers = {};
const RETRY_DELAY_MS = 5000;

// Outside Tauri (plain `npm run dev` in a browser) there is no IPC bridge;
// persist to localStorage so the UI can still be exercised.
// Checked per call (not cached at import time) so a late-injected bridge is never missed.
const isTauri = () => typeof window !== 'undefined' && typeof window.__TAURI_IPC__ === 'function';

// Set when the persisted file exists but cannot be read (corrupt JSON,
// decrypt failure…). While set, writes are blocked so the default empty
// state never overwrites the real data on disk.
let loadFailure = null;
export const getLoadFailure = () => loadFailure;
export function clearLoadFailure() { loadFailure = null; }

function reportSaveError(error) {
  const current = useStore.getState().saveError;
  if (current !== error) useStore.setState({ saveError: error });
}

function flushWrite(name) {
  const queued = writeQueue[name];
  if (queued === undefined) return Promise.resolve();
  delete writeQueue[name];
  // Serialized here, once per write, not on every state change (see setItem).
  const value = typeof queued === 'string' ? queued : JSON.stringify(queued);
  if (!isTauri()) {
    try { localStorage.setItem(name, value); } catch {}
    partWritten(name);
    return Promise.resolve();
  }
  return invoke('save_data', { key: name, value })
    .then(() => {
      partWritten(name);
      if (useStore.getState().saveError) reportSaveError(null);
    })
    .catch((err) => {
      // Keep the value queued (unless a newer one arrived) and retry.
      if (writeQueue[name] === undefined) writeQueue[name] = value;
      clearTimeout(writeTimers[name]);
      writeTimers[name] = setTimeout(() => flushWrite(name), RETRY_DELAY_MS);
      reportSaveError(String(err || 'save_failed'));
    });
}

async function loadRaw(name) {
  if (!isTauri()) return localStorage.getItem(name);
  try {
    return await invoke('load_data', { key: name });
  } catch (err) {
    const msg = String(err || '');
    // Nothing saved yet (first launch).
    if (msg.includes('not_found')) return null;
    // Anything else means the file exists but is unreadable: never fall back
    // to empty defaults silently, or the next save would destroy the real
    // data. That includes `not_unlocked`: hydration only runs once the vault
    // is open, so it means an encrypted file whose `encryption.json` is gone.
    loadFailure = { key: name, error: msg };
    return null;
  }
}

// ── Split storage ───────────────────────────────────────────────────────────
// The store is saved in parts: each large collection in its own file, the
// rest (config, sync state, preferences) in `nutripolo-storage`. A change
// rewrites only the parts whose data changed, by reference: typing in a
// client's interview writes the clients, not the appointments or the
// product photos; changing view writes nothing.
//
// Migration from the single file is safe: until every part has been written
// once, `nutripolo-storage` keeps the whole store (as before), so a crash
// half-way leaves a complete file to load. Only then does it become the
// small main part, marked `split`, and a load of it requires every part.
const omit = (obj, key) => { const { [key]: _, ...rest } = obj || {}; return rest; };
const entriesOf = (obj) => Object.keys(obj || {}).sort().flatMap(k => [k, obj[k]]);
const STORE_PARTS = [
  ['nutripolo-clients', 'clients'],
  ['nutripolo-consultations', 'consultations'],
  ['nutripolo-measurements', 'measurements'],
  ['nutripolo-plans', 'nutritionPlans'],
  ['nutripolo-invoices', 'invoices'],
  ['nutripolo-documents', 'clientDocuments'],
  ['nutripolo-suggestions', 'patientSuggestions'],
  ['nutripolo-personal-events', 'personalEvents'],
].map(([key, field]) => ({
  key,
  get: (st) => st[field],
  put: (st, v) => { st[field] = v; },
  deps: (st) => [st[field]],
  field,
})).concat([
  // Product photos apart from the rest of the library: they are most of the bytes
  {
    key: 'nutripolo-library-products',
    get: (st) => st.planLibrary?.productos,
    put: (st, v) => { st.planLibrary = { ...(st.planLibrary || {}), productos: v }; },
    deps: (st) => [st.planLibrary?.productos],
  },
  {
    key: 'nutripolo-library',
    get: (st) => omit(st.planLibrary, 'productos'),
    put: (st, v) => { st.planLibrary = { ...(v || {}), ...(st.planLibrary?.productos ? { productos: st.planLibrary.productos } : {}) }; },
    deps: (st) => entriesOf(omit(st.planLibrary, 'productos')),
    field: 'planLibrary',
  },
]);
const MAIN_KEY = 'nutripolo-storage';
/** Every key the store is saved under (main part first). */
export const STORE_KEYS = [MAIN_KEY, ...STORE_PARTS.map(p => p.key)];
const PART_FIELDS = new Set(STORE_PARTS.map(p => p.field).filter(Boolean));
const mainState = (st) => Object.fromEntries(Object.entries(st).filter(([k]) => !PART_FIELDS.has(k)));

let storeLoaded = false;         // getItem has read the files (nothing is written before)
let splitReady = false;          // the main file on disk is the small `split` one
const lastDeps = {};             // per key: references of the data last queued
const partsWritten = new Set();  // parts written at least once since loading
let lastValue = null;            // last { state, version } from persist

const sameDeps = (a, b) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

function queueWrite(name, value) {
  writeQueue[name] = value;
  clearTimeout(writeTimers[name]);
  writeTimers[name] = setTimeout(() => flushWrite(name), 300);
}

function partWritten(name) {
  if (splitReady || name === MAIN_KEY) return;
  partsWritten.add(name);
  if (STORE_PARTS.every(p => partsWritten.has(p.key)) && lastValue) {
    // Every part is on disk: the main file can become the small one
    splitReady = true;
    const { state, version } = lastValue;
    queueWrite(MAIN_KEY, { version, state: mainState(state), split: true });
  }
}

/**
 * Before a new version migrates the data, keep it as it was in the safety
 * copy ("previous copy" in Settings and on the load error screen): a
 * migration with a mistake would otherwise be saved over it, and the daily
 * backups would go through the same migration on restore.
 */
async function saveBeforeUpdate(state, version) {
  if (!Number.isInteger(version) || version >= STORE_VERSION || !state || !hasData(state)) return;
  try {
    await invoke('save_data', { key: SAFETY_BACKUP_KEY, value: JSON.stringify({ version, date: new Date().toISOString(), data: state }) });
    await invoke('save_data', { key: SAFETY_INFO_KEY, value: JSON.stringify({ date: new Date().toISOString(), reason: 'update' }) });
  } catch { /* outside Tauri, or the disk: the load goes on */ }
}

// Persist storage for zustand (objects in, objects out).
const tauriStorage = {
  // A JSON parse error throws: the persist middleware reports it as a load failure.
  getItem: async (name) => {
    storeLoaded = false;
    // What is on disk becomes the state: writes queued from the state it
    // replaces must not land on top of it.
    for (const key of STORE_KEYS) { clearTimeout(writeTimers[key]); delete writeTimers[key]; delete writeQueue[key]; }
    // Until every part is written again, the main file keeps the whole store
    const startOver = () => {
      splitReady = false;
      partsWritten.clear();
      for (const key of STORE_KEYS) delete lastDeps[key];
      storeLoaded = true;
    };
    const raw = await loadRaw(name);
    if (raw == null) { startOver(); return null; }   // first launch (or loadFailure)
    const main = JSON.parse(raw);
    // Single file (before v1.19): the next change writes every part
    if (!main?.split) { startOver(); await saveBeforeUpdate(main?.state, main?.version); return main; }
    const state = { ...main.state };
    for (const part of STORE_PARTS) {
      const partRaw = await loadRaw(part.key);
      if (partRaw == null) {
        // A part the main file says exists is missing: never load without it
        if (!loadFailure) loadFailure = { key: part.key, error: 'missing' };
        startOver();
        return null;
      }
      try {
        part.put(state, JSON.parse(partRaw));
      } catch (e) {
        loadFailure = { key: part.key, error: String(e?.message || e) };
        startOver();
        return null;
      }
    }
    splitReady = true;
    for (const part of STORE_PARTS) lastDeps[part.key] = part.deps(state);
    await saveBeforeUpdate(state, main.version);
    storeLoaded = true;
    return { ...main, state };
  },
  // `value` is the persisted object ({ state, version }). Zustand calls this on
  // every set(); only the parts whose data changed are queued, and they are
  // turned into JSON when the debounced write runs, so bursts of updates (a
  // sync, typing) cost one serialization of what changed.
  setItem: (name, value) => {
    // Before the files are read the state is the empty default: writing it
    // would replace the real data. And never while a file is unreadable.
    if (!storeLoaded || loadFailure) return;
    lastValue = value;
    const { state, version } = value;
    let changed = false;
    for (const part of STORE_PARTS) {
      const deps = part.deps(state);
      if (sameDeps(lastDeps[part.key], deps)) continue;
      lastDeps[part.key] = deps;
      queueWrite(part.key, part.get(state));
      changed = true;
    }
    const main = mainState(state);
    const mainDeps = [version, ...entriesOf(main)];
    // The small main file only when its own data changed; while it still holds
    // the whole store (before every part is on disk), on any change
    if (sameDeps(lastDeps[MAIN_KEY], mainDeps) && (splitReady || !changed)) return;
    lastDeps[MAIN_KEY] = mainDeps;
    // Until every part is on disk the main file keeps the whole store
    queueWrite(name, splitReady ? { version, state: main, split: true } : value);
  },
  removeItem: async () => {
    for (const key of STORE_KEYS) {
      clearTimeout(writeTimers[key]);
      delete writeQueue[key];
      delete writeTimers[key];
      delete lastDeps[key];
      if (!isTauri()) { localStorage.removeItem(key); continue; }
      await invoke('delete_data', { key }).catch(() => {});
    }
  },
};

/**
 * Write every queued value now. Await it before locking the vault or quitting.
 * Resolves to true when everything reached the disk, false when a write
 * failed (it stays queued and is retried).
 */
export async function flushAllPending() {
  const names = new Set([...Object.keys(writeTimers), ...Object.keys(writeQueue)]);
  await Promise.all([...names].map(name => {
    clearTimeout(writeTimers[name]);
    delete writeTimers[name];
    return flushWrite(name);
  }));
  return Object.keys(writeQueue).length === 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAllPending);
}

// ============================================
// UTILITIES
// ============================================
export function generateId() {
  // Prefer crypto.randomUUID (available in Tauri's Chrome ≥92 webview).
  // Collision-free even under heavy batch inserts (e.g. import of
  // hundreds of clients inside the same millisecond).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — should not be reached in the Tauri runtime.
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function formatCurrency(num) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(num || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/** Readable message for any thrown value: Tauri `invoke` rejects with plain strings. */
export function errMsg(e) {
  if (typeof e === 'string') return e;
  return e?.message || String(e);
}

/** YYYY-MM-DD in local time (toISOString() would give the UTC date). */
export function localISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function todayISO() {
  return localISODate(new Date());
}

export function calcIMC(peso, altura) {
  if (!peso || !altura) return null;
  const h = altura / 100;
  return Math.round((peso / (h * h)) * 10) / 10;
}

// ============================================
// CALENDAR VISIBILITY FILTER
// ============================================
export function filterVisibleConsultations(consultations, googleCalendarConfig) {
  const calendars = googleCalendarConfig?.calendars || [];
  if (calendars.length === 0) return consultations;
  // Build set of enabled (non-disabled) calendar IDs
  const enabledIds = new Set(
    calendars.filter(c => c.syncMode !== 'disabled').map(c => c.id)
  );
  return consultations.filter(c =>
    // Keep local consultations (no sourceCalendarId) and those from enabled calendars
    !c.sourceCalendarId || enabledIds.has(c.sourceCalendarId)
  );
}

// Parallel filter for personal events (ballet, birthdays, etc. from read-only personal calendars).
// These live in their own collection and must NEVER leak into consultations / billing / stats.
export function filterVisiblePersonalEvents(personalEvents, googleCalendarConfig) {
  if (!Array.isArray(personalEvents)) return [];
  const calendars = googleCalendarConfig?.calendars || [];
  if (calendars.length === 0) return personalEvents;
  const enabledIds = new Set(
    calendars.filter(c => c.syncMode !== 'disabled').map(c => c.id)
  );
  return personalEvents.filter(e =>
    !e.sourceCalendarId || enabledIds.has(e.sourceCalendarId)
  );
}

// Detect Google "holiday" / festive calendars from id+name heuristics.
// Defined as hoisted function so migrateStore (below) can call it.
export function isHolidayCalendarLike(cal) {
  if (!cal) return false;
  const id = (cal.id || '').toLowerCase();
  const name = (cal.name || cal.summary || '').toLowerCase();
  return (
    id.endsWith('@holiday.calendar.google.com') ||
    id.includes('holiday@group.v.calendar.google.com') ||
    /holiday|holidays|festivo|festivos|vacaciones|días festivos/.test(name)
  );
}

// Infer a reasonable default `purpose` for a calendar entry that existed before
// the multi-purpose migration. Manual override via Settings is still required
// for anything the heuristic gets wrong.
//   primary         — NutriPolo's own calendar (bidirectional)
//   external-clinic — Sinergia / external agenda we read patients from
//   personal        — ballet, birthdays, private events (NOT consultations)
//   holidays        — Google's holiday calendars
//   other           — unknown, safest readonly default
export function inferCalendarPurpose(cal) {
  if (!cal) return 'other';
  if (isHolidayCalendarLike(cal)) return 'holidays';
  const name = (cal.name || cal.summary || '').toLowerCase();
  // Primary check runs first: "NutriPolo App" matches here and skips the broader /nutri/ bucket below.
  if (cal.syncMode === 'bidirectional' || /nutripolo/.test(name)) return 'primary';
  // Broader fallback — "Raquel Polo Nutri" (Sinergia) lands here via "nutri".
  if (/sinergia|clínica|clinica|clinic|nutri/.test(name)) return 'external-clinic';
  return 'other';
}

// ============================================
// INVOICE TOTALS COMPUTATION
// ============================================
export function computeInvoiceTotals(items = [], ivaPct = 0, irpfPct = 0) {
  // All arithmetic in integer cents to avoid IEEE-754 drift when
  // summing many line items with 21% IVA. ivaPct and irpfPct are
  // percentages (e.g. 21 = 21%), NOT ratios.
  const iva = Number(ivaPct) || 0;
  const irpf = Number(irpfPct) || 0;
  const baseCents = items.reduce((sum, item) => {
    const qty = Number(item.cantidad) || 0;
    const price = Number(item.precioUnitario) || 0;
    return sum + Math.round(qty * price * 100);
  }, 0);
  const ivaCents  = Math.round(baseCents * iva  / 100);
  const irpfCents = Math.round(baseCents * irpf / 100);
  const totalCents = baseCents + ivaCents - irpfCents;
  return {
    baseImponible: baseCents  / 100,
    ivaImporte:    ivaCents   / 100,
    irpfImporte:   irpfCents  / 100,
    total:         totalCents / 100,
  };
}

// ============================================
// INVOICE NUMBERING
// ============================================
/**
 * Only a draft can be deleted: it has no number yet, so no gap is left.
 * An issued invoice is corrected with a corrective invoice instead
 * (see services/invoicing.js).
 */
export function canDeleteInvoice(invoices, invoice) {
  return !!invoice && !isIssued(invoice);
}

const invoiceTotalsFields = (inv) => {
  const items = inv.items || [];
  const totals = computeInvoiceTotals(items, inv.ivaPct ?? 0, inv.irpfPct ?? 0);
  return {
    ...totals,
    // backward-compat fields
    concepto: items.map(i => i.descripcion).filter(Boolean).join(', '),
    importe: totals.total,
  };
};

// ============================================
// DEFAULT DATA
// ============================================
const DEFAULT_LOCATIONS = [
  { id: 'elda',    name: 'Centro Synergia', address: 'C/ Jardines 29, Elda',         type: 'presencial' },
  { id: 'monovar', name: 'Natura',          address: 'C/ Carlos Tortosa 5, Monóvar', type: 'presencial' },
  { id: 'online',  name: 'Online',          address: '',                              type: 'online' },
];

const DEFAULT_SERVICES = [
  { id: 'svc1', nombre: 'Primera visita',      descripcion: 'Valoración inicial y anamnesis completa', precio: 60,  numSesiones: 1,  duracion: 60, activo: true },
  { id: 'svc2', nombre: 'Seguimiento mensual', descripcion: 'Consulta de seguimiento mensual',         precio: 40,  numSesiones: 1,  duracion: 45, activo: true },
  { id: 'svc3', nombre: 'Pack 4 sesiones',     descripcion: 'Bono de 4 consultas de seguimiento',      precio: 140, numSesiones: 4,  duracion: 45, activo: true },
  { id: 'svc4', nombre: 'Pack 10 sesiones',    descripcion: 'Bono de 10 consultas de seguimiento',     precio: 320, numSesiones: 10, duracion: 45, activo: true },
  { id: 'svc5', nombre: 'Plan online',         descripcion: 'Seguimiento nutricional online mensual',  precio: 35,  numSesiones: 1,  duracion: 30, activo: true },
];

// alimentos: canvis propis a la biblioteca d'aliments, { [foodId]: { imagen?, por100g?, updatedAt } }
export const EMPTY_PLAN_LIBRARY = { productos: [], recetas: [], alimentos: {} };

// ============================================
// SCHEMA MIGRATION
// ============================================
const STORE_VERSION = 17;

// ── Default invoice design (exported for reuse) ──
export const DEFAULT_INVOICE_DESIGN = {
  preset: 'terra',
  colors: {
    accent:      '#C15F3C',  // barra superior, labels, totales
    accentDark:  '#A84E30',  // texto total, IRPF
    accentMid:   '#E8C4B4',  // líneas decorativas
    accentLight: '#F5EDE8',  // fondo cabecera tabla, footer, card totales
    primary:     '#1C1B18',  // texto principal
    secondary:   '#4A4840',  // texto secundario
    muted:       '#65635B',  // labels
    cardBg:      '#FAFAF8',  // filas alternas tabla
  },
  logo: null,                // { data: 'data:image/...;base64,...', type: 'png'|'jpg', width, height } | null
  showTagline: true,
  taglineText: 'Nutrición Clínica',
};

// Zustand passes the bare persisted state to `migrate`, but the legacy
// steps below were written against a `{ state }` wrapper and therefore
// never ran (the v4 step even threw). `migrateStore` boxes the state so
// they apply as originally intended.
function migrateStore(persistedState, version) {
  const box = { state: persistedState || {} };
  migrateLegacy(box, version);
  const s = box.state;
  if (version < 17 && Array.isArray(s.invoices)) {
    // v16 → v17: draft → issued. Every invoice so far was handed out when it
    // was created, so it counts as issued, with the issuer's and client's
    // data as they are now (the closest there is to the day it was issued).
    const clientsById = new Map((s.clients || []).map(c => [c.id, c]));
    const emisor = issuerSnapshot(s.config || {});
    s.invoices = s.invoices.map(inv => (inv.emitidaAt ? inv : {
      ...inv,
      emitidaAt: inv.fecha ? `${inv.fecha}T12:00:00.000Z` : new Date().toISOString(),
      emisor,
      destinatario: recipientSnapshot(clientsById.get(inv.clienteId) || {}),
    }));
  }
  if (version === 15 && Array.isArray(s.planLibrary?.recetas)) {
    // v15 → v16: les receptes de Canva que va sembrar la v1.18.0 i que no
    // s'han tocat passen a la versió neta (errates, unitats, duplicats fusionats).
    s.planLibrary = { ...s.planLibrary, recetas: replaceSeedRecipes(s.planLibrary.recetas, RECETAS_V15_A_NUEVAS, RECETAS_PLANIFICACIONES) };
  }
  if (version < 15) {
    // v14 → v15: "Mis recetas" s'omple amb els plats i opcions de les
    // planificacions fetes amb Canva (scripts/recetas). Les que ja hi són no es toquen.
    const planLibrary = { ...EMPTY_PLAN_LIBRARY, ...(s.planLibrary || {}) };
    s.planLibrary = { ...planLibrary, recetas: addMissingRecipes(planLibrary.recetas || [], RECETAS_PLANIFICACIONES) };
  }
  if (version < 14 && Array.isArray(s.clients)) {
    // v13 → v14: l'última visita es calcula (lastVisitByClient); el camp desat
    // podia anar enrere en editar una consulta antiga.
    s.clients = s.clients.map(({ fechaUltimaConsulta, ...c }) => c);
  }
  if (version < 13 && Array.isArray(s.nutritionPlans)) {
    // v12 → v13: "Mis recetas". Es sembra amb els plats de les planificacions
    // existents (de la més antiga a la més nova, perquè mani l'última versió).
    const web = s.planLibrary?.recetasWeb?.items || [];
    const recetas = s.nutritionPlans
      .filter(p => p.formato === PLAN_FORMAT)
      .sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || '') || (Number(a.numero) || 0) - (Number(b.numero) || 0))
      .reduce((list, p) => mergeOwnRecipes(list, collectOwnRecipes(p, web)), s.planLibrary?.recetas || []);
    s.planLibrary = { productos: [], ...(s.planLibrary || {}), recetas };
  }
  if (version < 12 && s.config) {
    // v11 → v12: Onest a tota l'app (UI i PDFs). Les famílies no es poden
    // triar enlloc, així que es reescriuen.
    const { fontFamily, ...invoiceDesign } = s.config.invoiceDesign || {};
    s.config = {
      ...s.config,
      appFont: 'Onest', appFontHeading: 'Onest', appFontMono: 'Onest',
      ...(s.config.invoiceDesign ? { invoiceDesign } : {}),
    };
  }
  if (version < 11) {
    // v10 → v11: appointment reminders. The old WhatsApp stamp becomes a
    // reminder record (config.reminders defaults arrive via the config merge).
    if (Array.isArray(s.consultations)) {
      s.consultations = s.consultations.map(c => {
        if (!c.lastWhatsappReminder) return c;
        const { lastWhatsappReminder, ...rest } = c;
        return {
          ...rest,
          reminders: { ...(c.reminders || {}), whatsapp: { status: 'opened', at: lastWhatsappReminder, slot: reminderSlot(c) } },
        };
      });
    }
  }
  return s;
}

function migrateLegacy(persistedState, version) {
  if (version < 2) {
    // v1 → v2: replace calendarId scalar with calendars array
    const gc = persistedState.state?.config?.googleCalendar;
    if (gc && 'calendarId' in gc) {
      const oldCalendarId = gc.calendarId;
      persistedState.state.config.googleCalendar = {
        ...gc,
        calendars: oldCalendarId
          ? [{ id: oldCalendarId, name: 'Primary', syncMode: 'bidirectional' }]
          : [],
      };
      delete persistedState.state.config.googleCalendar.calendarId;

      // Backfill sourceCalendarId on any consultation that was already synced
      if (Array.isArray(persistedState.state?.consultations)) {
        persistedState.state.consultations = persistedState.state.consultations.map(c =>
          c.googleEventId && !c.sourceCalendarId
            ? { ...c, sourceCalendarId: oldCalendarId || 'primary' }
            : c
        );
      }
    }
  }
  if (version < 3) {
    // v2 → v3: convert single-field invoices (concepto+importe) to items array
    if (Array.isArray(persistedState.state?.invoices)) {
      persistedState.state.invoices = persistedState.state.invoices.map(inv => {
        if (inv.items) return inv; // already on new schema
        const item = {
          id: generateId(),
          descripcion: inv.concepto || '',
          cantidad: 1,
          precioUnitario: parseFloat(inv.importe) || 0,
          servicioId: inv.servicioId || null,
          consultationId: null,
        };
        const baseImponible = Math.round((item.precioUnitario) * 100) / 100;
        return {
          ...inv,
          items: [item],
          ivaPct: 0,
          irpfPct: 0,
          baseImponible,
          ivaImporte: 0,
          irpfImporte: 0,
          total: baseImponible,
        };
      });
    }
  }
  if (version < 4) {
    // v3 → v4: add invoiceDesign to config
    if (persistedState.state?.config && !persistedState.state.config.invoiceDesign) {
      persistedState.state.config.invoiceDesign = DEFAULT_INVOICE_DESIGN;
    }
  }
  if (version < 5) {
    // v4 → v5: add clientDocuments collection
    if (!persistedState.state?.clientDocuments) {
      persistedState.state.clientDocuments = [];
    }
  }
  if (version < 6) {
    // v5 → v6: rename smtpConfig → smtp, add missing config defaults
    const cfg = persistedState.state?.config;
    if (cfg) {
      if (cfg.smtpConfig !== undefined && cfg.smtp === undefined) {
        cfg.smtp = cfg.smtpConfig;
      }
      delete cfg.smtpConfig;
    }
  }
  if (version < 7) {
    // v6 → v7: invoice counter is now derived from invoices[] on demand.
    // Drop the stale persisted field so it can't desync from reality again.
    if (persistedState.state && 'invoiceCounter' in persistedState.state) {
      delete persistedState.state.invoiceCounter;
    }
  }
  if (version < 8) {
    // v7 → v8: multi-calendar purposes, personal events collection, mass-delete tracking.
    // Bidirectional vs readonly (transport) is now separate from purpose (semantics):
    //   primary           → bidirectional sync, our own agenda
    //   external-clinic   → readonly, fuzzy-match new patients to existing clients
    //   personal          → readonly, land in personalEvents (NEVER consultations)
    //   holidays / other  → readonly, plain events
    const s = persistedState.state;
    if (s) {
      if (!Array.isArray(s.personalEvents))    s.personalEvents    = [];
      if (!Array.isArray(s.patientSuggestions)) s.patientSuggestions = [];
      if (!s.syncAudit) {
        s.syncAudit = { lastFullSyncAt: null, lastSyncStats: {}, massDeleteEvents: [] };
      }
      const cals = s.config?.googleCalendar?.calendars;
      if (Array.isArray(cals)) {
        s.config.googleCalendar.calendars = cals.map(c => ({
          ...c,
          purpose: c.purpose || inferCalendarPurpose(c),
          lastKnownRemoteCount: c.lastKnownRemoteCount ?? null,
          lastKnownRemoteSyncAt: c.lastKnownRemoteSyncAt || null,
          massDeletePending: c.massDeletePending || null,
          fuzzyAutoThreshold: c.fuzzyAutoThreshold ?? 0.92,
          fuzzySuggestThreshold: c.fuzzySuggestThreshold ?? 0.75,
        }));
      }
    }
  }
  if (version < 9) {
    // v8 → v9: manual-approval for external-clinic matches.
    // All external-clinic consultations get a matchStatus field.
    // fuzzyAutoLinked=true rows become auto-pending-review (clienteId cleared, suggestedClienteId set).
    // Existing patientSuggestions get consultationIds / topScore / suggestedClienteId fields.
    // New 'pending-confirm' suggestion cards are created for auto-pending-review consultations.
    const s = persistedState.state;
    if (s) {
      const externalClinicIds = new Set(
        (s.config?.googleCalendar?.calendars || [])
          .filter(c => c.purpose === 'external-clinic')
          .map(c => c.id)
      );

      // Normalisation helper (mirrors fuzzyMatcher.normalize, no import here)
      const _norm = (str) =>
        (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

      // Map clientId → nombre for suggestion creation
      const clientMap = {};
      (s.clients || []).forEach(c => { if (c.id) clientMap[c.id] = c.nombre || ''; });

      // Track pending-confirm groups: key = `${calId}||${normName}`, value = suggestion obj
      const pendingConfirmMap = {};

      // Migrate existing patientSuggestions first
      s.patientSuggestions = (s.patientSuggestions || []).map(sg => ({
        ...sg,
        consultationIds: sg.consultationIds || [],
        topScore: sg.topScore ?? (sg.candidates?.[0]?.score ?? null),
        suggestedClienteId: sg.suggestedClienteId || null,
      }));

      // Migrate consultations
      s.consultations = (s.consultations || []).map(c => {
        if (!externalClinicIds.has(c.sourceCalendarId)) return c;

        let matchStatus;
        if (c.clienteId && !c.fuzzyAutoLinked)     matchStatus = 'exact';
        else if (c.clienteId && c.fuzzyAutoLinked) matchStatus = 'auto-pending-review';
        else if (!c.clienteId && c.suggestedFromId) matchStatus = 'suggested';
        else                                         matchStatus = 'unknown';

        const next = {
          ...c,
          matchStatus,
          matchedBy: 'system',
          matchedAt: c.lastSyncedAt || null,
          matchedByAt: null,
        };
        delete next.fuzzyAutoLinked;

        if (matchStatus === 'auto-pending-review') {
          // Save the auto-linked client as suggested, clear clienteId so it's not
          // attributed silently until user confirms
          next.suggestedClienteId = c.clienteId;
          next.clienteId = null;

          // Build / update pending-confirm suggestion for this (calId, normalizedName) pair
          const rawName = c.googleSummary || clientMap[c.clienteId] || '';
          const normName = _norm(rawName);
          const mapKey = `${c.sourceCalendarId}||${normName}`;
          if (!pendingConfirmMap[mapKey]) {
            const existingPendingConfirm = s.patientSuggestions.find(sg =>
              sg.status === 'pending-confirm' &&
              sg.sourceCalendarId === c.sourceCalendarId &&
              sg.normalizedName === normName
            );
            if (existingPendingConfirm) {
              pendingConfirmMap[mapKey] = existingPendingConfirm;
            } else {
              // Create a new pending-confirm suggestion
              const newSg = {
                id: `mig-${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`,
                status: 'pending-confirm',
                occurrences: 1,
                candidates: c.suggestedClienteId
                  ? [{ clienteId: c.suggestedClienteId, nombre: clientMap[c.suggestedClienteId] || '', score: 1 }]
                  : (c.suggestedClienteId
                    ? [{ clienteId: c.suggestedClienteId, nombre: clientMap[c.suggestedClienteId] || '', score: 1 }]
                    : []),
                suggestedClienteId: next.suggestedClienteId,
                topScore: 1,
                linkedClienteId: null,
                dismissedAt: null,
                detectedAt: c.lastSyncedAt || new Date().toISOString(),
                sourceCalendarId: c.sourceCalendarId,
                rawSummary: rawName,
                normalizedName: normName,
                firstSeenFecha: c.fecha || null,
                firstSeenHora: c.hora || null,
                consultationIds: [],
              };
              s.patientSuggestions = [...s.patientSuggestions, newSg];
              pendingConfirmMap[mapKey] = newSg;
            }
          }
          next.suggestedFromId = pendingConfirmMap[mapKey].id;
          pendingConfirmMap[mapKey].consultationIds.push(c.id);
          pendingConfirmMap[mapKey].occurrences = pendingConfirmMap[mapKey].consultationIds.length;
        }

        return next;
      });
    }
  }
  if (version < 10) {
    // v9 → v10: Backfill patientSuggestion for orphaned 'unknown' external-clinic
    // consultations. v8→v9 only created suggestions for auto-pending-review rows;
    // pure 'unknown' rows (no clienteId, no suggestedFromId) were left orphaned
    // and never showed up in the inbox. This migration groups them by
    // (sourceCalendarId, normalizedName) and creates one suggestion per group,
    // re-running fuzzy matching against the current client list.
    const s = persistedState.state;
    if (s) {
      const externalClinicIds = new Set(
        (s.config?.googleCalendar?.calendars || [])
          .filter(c => c.purpose === 'external-clinic')
          .map(c => c.id)
      );
      const clients = s.clients || [];
      const existingSuggestions = s.patientSuggestions || [];

      const dismissedKeys = new Set(
        existingSuggestions
          .filter(sg => sg.status === 'dismissed')
          .map(sg => `${sg.sourceCalendarId}||${sg.normalizedName}`)
      );
      // Index active suggestions so orphans can attach to them instead of duplicating
      const activeByKey = new Map();
      for (const sg of existingSuggestions) {
        if (sg.status === 'pending' || sg.status === 'pending-confirm') {
          activeByKey.set(`${sg.sourceCalendarId}||${sg.normalizedName}`, sg);
        }
      }

      // Group orphan consultations by (calId, normName)
      const groups = new Map();
      const attachments = []; // { consultationId, suggestionId } for existing-active cases

      for (const c of (s.consultations || [])) {
        if (!externalClinicIds.has(c.sourceCalendarId)) continue;
        if (c.matchStatus !== 'unknown') continue;
        if (c.suggestedFromId) continue;

        const rawName  = extractPatientName(c.googleSummary || '');
        const normName = fuzzyNormalize(rawName);
        if (!normName) continue; // no extractable name — leave as-is
        const key = `${c.sourceCalendarId}||${normName}`;
        if (dismissedKeys.has(key)) continue;

        const activeSg = activeByKey.get(key);
        if (activeSg) {
          // Attach to existing active suggestion instead of creating a duplicate
          attachments.push({ consultationId: c.id, suggestionId: activeSg.id });
          continue;
        }

        if (!groups.has(key)) {
          groups.set(key, {
            rawName, normName, calId: c.sourceCalendarId,
            consultationIds: [], fechas: [], horas: [],
            firstSummary: c.googleSummary || '',
          });
        }
        const g = groups.get(key);
        g.consultationIds.push(c.id);
        if (c.fecha) g.fechas.push(c.fecha);
        if (c.hora)  g.horas.push(c.hora);
      }

      // Build new suggestions from groups using fresh fuzzy matching
      const now = new Date().toISOString();
      const newSuggestions = [];
      const perConsultationPatch = new Map(); // consultationId → patch object

      for (const g of groups.values()) {
        const { auto, candidates } = findBestMatches(
          g.rawName, clients, { autoThreshold: 0.92, suggestThreshold: 0.75 }
        );
        g.fechas.sort();
        g.horas.sort();

        let status = 'pending';
        let suggestedClienteId = null;
        let topScore = null;
        let rowMatchStatus = 'unknown';
        if (auto) {
          status = 'pending-confirm';
          suggestedClienteId = auto.clienteId;
          topScore = auto.score;
          rowMatchStatus = 'auto-pending-review';
        } else if (candidates.length > 0) {
          topScore = candidates[0].score;
          rowMatchStatus = 'suggested';
        }

        const sgId = `mig10-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        newSuggestions.push({
          id: sgId,
          status,
          occurrences: g.consultationIds.length,
          candidates: candidates.map(c => ({ clienteId: c.clienteId, score: c.score, nombre: c.nombre })),
          suggestedClienteId,
          topScore,
          linkedClienteId: null,
          dismissedAt: null,
          detectedAt: now,
          sourceCalendarId: g.calId,
          rawSummary: g.firstSummary,
          normalizedName: g.normName,
          firstSeenFecha: g.fechas[0] || null,
          firstSeenHora:  g.horas[0]  || null,
          consultationIds: [...g.consultationIds],
        });
        for (const cid of g.consultationIds) {
          perConsultationPatch.set(cid, {
            suggestedFromId: sgId,
            suggestedClienteId: suggestedClienteId || undefined,
            matchScore: topScore ?? undefined,
            matchStatus: rowMatchStatus,
            matchedBy: 'system',
          });
        }
      }

      // Build attachMap for consultations that link to existing active suggestions
      const attachMap = new Map(); // suggestionId → Set<consultationId>
      for (const { consultationId, suggestionId } of attachments) {
        if (!attachMap.has(suggestionId)) attachMap.set(suggestionId, new Set());
        attachMap.get(suggestionId).add(consultationId);
        perConsultationPatch.set(consultationId, {
          suggestedFromId: suggestionId,
          matchedBy: 'system',
        });
      }

      // Single immutable pass: append new suggestions + patch attach targets
      s.patientSuggestions = [
        ...existingSuggestions.map(sg => {
          const extra = attachMap.get(sg.id);
          if (!extra) return sg;
          const mergedIds = Array.from(new Set([...(sg.consultationIds || []), ...extra]));
          return { ...sg, consultationIds: mergedIds, occurrences: mergedIds.length };
        }),
        ...newSuggestions,
      ];

      // Single immutable pass over consultations: apply patches
      s.consultations = (s.consultations || []).map(c => {
        const patch = perConsultationPatch.get(c.id);
        if (!patch) return c;
        return { ...c, ...patch, matchedAt: c.matchedAt || now };
      });
    }
  }
  return persistedState;
}

// ── Google OAuth secrets ──
// refreshToken / clientSecret live in the OS credential store (like the
// SMTP password) and accessToken only in memory. They are stripped from
// the persisted store, auto-backups and exports.
const GCAL_SECRET_NAMES = { refreshToken: 'gcal_refresh_token', clientSecret: 'gcal_client_secret' };

export function stripGoogleSecrets(config) {
  if (!config?.googleCalendar) return config;
  return {
    ...config,
    googleCalendar: { ...config.googleCalendar, accessToken: '', refreshToken: '', clientSecret: '', expiresAt: 0 },
  };
}

// Restored backups must not replace the live Google connection.
function mergeRestoredConfig(current, restored) {
  if (!restored) return current;
  return { ...current, ...restored, googleCalendar: current.googleCalendar };
}

/**
 * Called once after hydration. Moves legacy plaintext secrets into the
 * keyring, or loads them from it, then keeps the keyring in sync.
 */
let secretsSyncStarted = false;
export async function syncGoogleSecrets() {
  if (!isTauri() || secretsSyncStarted) return;
  secretsSyncStarted = true;
  const gc = useStore.getState().config.googleCalendar || {};
  try {
    const loaded = {};
    for (const [field, name] of Object.entries(GCAL_SECRET_NAMES)) {
      if (gc[field]) {
        // Legacy store still holds it in plaintext → migrate.
        await invoke('secret_set', { name, value: gc[field] });
      } else {
        const value = await invoke('secret_get', { name });
        if (value) loaded[field] = value;
      }
    }
    // Always set: this also rewrites the persisted file without the legacy secrets.
    useStore.setState(s => ({
      config: { ...s.config, googleCalendar: { ...s.config.googleCalendar, ...loaded } },
    }));
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Keyring sync failed:', e);
  }

  const timers = {};
  useStore.subscribe((state, prev) => {
    const now = state.config.googleCalendar || {};
    const before = prev.config.googleCalendar || {};
    for (const [field, name] of Object.entries(GCAL_SECRET_NAMES)) {
      if (now[field] === before[field]) continue;
      clearTimeout(timers[field]);
      timers[field] = setTimeout(() => {
        invoke('secret_set', { name, value: useStore.getState().config.googleCalendar?.[field] || '' })
          .catch(e => { if (import.meta.env.DEV) console.warn('Keyring write failed:', e); });
      }, 800);
    }
  });
}

// Fields owned by the Google Calendar sync. Only sync writes may set them.
const SYNC_FIELDS = [
  'googleEventId', 'sourceCalendarId', 'googleSummary', 'lastSyncedAt', 'remoteUpdated',
  'syncPending', 'syncError', 'syncErrorFor', 'syncAttempts', 'syncConflict', 'conflictShadow',
  'detachedFromGoogle', 'remoteDeleted', 'restoreRemote',
];

// Written only by setConsultationReminder / setConsultationReviewRequest. A
// form saved with an old copy must not wipe a reminder sent meanwhile, or it
// would be sent again.
const BOOKKEEPING_FIELDS = ['reminders', 'reviewRequest'];

function withoutSyncFields(data) {
  if (!data) return data;
  const out = { ...data };
  for (const f of SYNC_FIELDS) delete out[f];
  for (const f of BOOKKEEPING_FIELDS) delete out[f];
  return out;
}

/**
 * Fields of `edited` that differ from `original` (a form vs the record it
 * was opened with). Empty values ('', null, undefined) count as equal.
 */
export function changedFields(original, edited) {
  const norm = (v) => (v == null || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const out = {};
  for (const [k, v] of Object.entries(edited || {})) {
    if (k !== 'id' && norm(v) !== norm(original?.[k])) out[k] = v;
  }
  return out;
}

/**
 * Last visit per client (Map clienteId → YYYY-MM-DD): the newest completed
 * consultation or measurement. Derived on demand so editing an old record
 * can never move it back in time.
 */
export function lastVisitByClient({ consultations, measurements }) {
  const last = new Map();
  const bump = (id, fecha) => { if (id && fecha && !(last.get(id) >= fecha)) last.set(id, fecha); };
  for (const c of consultations || []) if (c.estado === 'completada') bump(c.clienteId, c.fecha);
  for (const m of measurements || []) bump(m.clienteId, m.fecha);
  return last;
}

/**
 * True when NutriPolo may write to this Google calendar: bidirectional and
 * meant for consultations (external clinic and personal calendars are pull-only).
 */
export function canPushToCalendar(googleCalendarConfig, calendarId) {
  if (!calendarId) return false;
  const cal = (googleCalendarConfig?.calendars || []).find(c => c.id === calendarId);
  return !!cal && cal.syncMode === 'bidirectional' && cal.purpose !== 'external-clinic' && cal.purpose !== 'personal';
}

// Undo of a consultation delete: drop its tombstone and ask the next sync to
// restore the Google event (it may already be deleted there).
function restoreDeletedConsultation(s, item) {
  const restored = item.googleEventId
    ? { ...item, restoreRemote: true, remoteDeleted: false, localUpdatedAt: new Date().toISOString() }
    : item;
  return {
    consultations: [restored, ...s.consultations],
    gcalPendingDeletes: s.gcalPendingDeletes.filter(d => d.consultationId !== item.id),
  };
}

// Redo of a consultation delete: same as the original delete (tombstone).
function redeleteConsultation(s, item) {
  const patch = { consultations: s.consultations.filter(c => c.id !== item.id) };
  if (item.googleEventId && item.sourceCalendarId) {
    patch.gcalPendingDeletes = [
      ...s.gcalPendingDeletes.filter(d => d.eventId !== item.googleEventId),
      {
        calendarId: item.sourceCalendarId, eventId: item.googleEventId, consultationId: item.id,
        remote: canPushToCalendar(s.config.googleCalendar, item.sourceCalendarId), at: new Date().toISOString(),
      },
    ];
  }
  return patch;
}

// Removes a client together with the records that only make sense with it.
// Invoices are kept (fiscal records). Google-synced consultations are
// unlinked instead of deleted, otherwise the next pull would re-import them.
// Returns the state patch plus a snapshot so undo can put everything back.
function buildClientDeletion(s, id) {
  const ownConsultations = s.consultations.filter(c => c.clienteId === id || c.suggestedClienteId === id);
  const snapshot = {
    consultations: ownConsultations,
    measurements: s.measurements.filter(m => m.clienteId === id),
    nutritionPlans: s.nutritionPlans.filter(p => p.clienteId === id),
  };
  const consultations = s.consultations.flatMap(c => {
    if (c.clienteId === id) {
      if (!c.googleEventId) return [];
      // Kept so the next pull does not import it again, but without the
      // patient's notes (undo brings them back from the snapshot).
      // matchedBy 'user': the sync must not propose the deleted patient again.
      return [{ ...c, clienteId: null, matchStatus: 'unknown', matchedBy: 'user', suggestedClienteId: undefined, matchScore: undefined,
        notasPrivadas: '', notasCliente: '' }];
    }
    if (c.suggestedClienteId === id) {
      return [{ ...c, suggestedClienteId: undefined, matchScore: undefined, matchStatus: 'suggested' }];
    }
    return [c];
  });
  const patch = {
    clients: s.clients.filter(c => c.id !== id),
    consultations,
    measurements: s.measurements.filter(m => m.clienteId !== id),
    nutritionPlans: s.nutritionPlans.filter(p => p.clienteId !== id),
    // The document files are removed from disk by the caller, so their
    // metadata goes for good (it is not part of the undo snapshot).
    clientDocuments: (s.clientDocuments || []).filter(d => d.clienteId !== id),
    // Downgrade any pending-confirm suggestions proposing this client
    patientSuggestions: s.patientSuggestions.map(sg => {
      const filteredCandidates = (sg.candidates || []).filter(c => c.clienteId !== id);
      const wasSuggestedClient = sg.suggestedClienteId === id;
      if (!wasSuggestedClient && !(sg.candidates || []).some(c => c.clienteId === id)) return sg;
      return {
        ...sg,
        candidates: filteredCandidates,
        topScore: filteredCandidates[0]?.score ?? null,
        suggestedClienteId: wasSuggestedClient ? null : sg.suggestedClienteId,
        status: (wasSuggestedClient && sg.status === 'pending-confirm') ? 'pending' : sg.status,
      };
    }),
  };
  return { patch, snapshot };
}

function restoreClientDeletion(s, entry) {
  const cascade = entry.cascade || {};
  const restoredIds = new Set((cascade.consultations || []).map(c => c.id));
  return {
    clients: [entry.item, ...s.clients],
    consultations: [...s.consultations.filter(c => !restoredIds.has(c.id)), ...(cascade.consultations || [])],
    measurements: [...s.measurements, ...(cascade.measurements || [])],
    nutritionPlans: [...s.nutritionPlans, ...(cascade.nutritionPlans || [])],
  };
}

/** A file that is not a usable NutriPolo backup; `code` is shown translated. */
export class BackupError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const BACKUP_ARRAYS = ['clients', 'measurements', 'consultations', 'nutritionPlans', 'services', 'invoices', 'clientDocuments'];

/**
 * Check a parsed backup and bring it up to the current schema, like a normal
 * load. Accepts exports/auto-backups (`{ version, data }`), the raw store
 * file (`{ version, state }`) and very old bare objects (taken as current).
 * Returns { data, date, counts }. Throws BackupError:
 *   not_a_backup → no NutriPolo data in it (another JSON, an empty object…)
 *   backup_newer → written by a newer version of the app
 */
export function readBackup(parsed) {
  const raw = parsed?.data || parsed?.state || parsed;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.clients)) throw new BackupError('not_a_backup');
  if (BACKUP_ARRAYS.some(k => raw[k] != null && !Array.isArray(raw[k]))) throw new BackupError('not_a_backup');
  const version = Number.isInteger(parsed?.version) ? parsed.version : STORE_VERSION;
  if (version > STORE_VERSION) throw new BackupError('backup_newer');
  const data = version < STORE_VERSION ? migrateStore(raw, version) : raw;
  const count = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  return {
    data,
    date: parsed?.exportDate || parsed?.date || null,
    counts: { clients: count('clients'), consultations: count('consultations'), invoices: count('invoices'), nutritionPlans: count('nutritionPlans') },
  };
}

const hasData = (s) => !!(s.clients?.length || s.consultations?.length || s.invoices?.length || s.nutritionPlans?.length);

// Copy of the data taken right before a restore or import replaces it, so a
// wrong file can be undone (Settings and the load error screen offer it).
const SAFETY_BACKUP_KEY = 'backup-safety';
const SAFETY_INFO_KEY = 'backup-safety-info';
const AUTO_BACKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates of the automatic backups on disk, oldest first. */
async function listAutoBackupDates() {
  // The files themselves are the truth: a damaged manifest must not hide them.
  const keys = await invoke('list_data_keys', { prefix: 'backup-' }).catch(() => null);
  let dates;
  if (Array.isArray(keys)) {
    dates = keys.map(k => k.slice('backup-'.length));
  } else {
    const raw = await invoke('load_data', { key: 'backup-manifest' }).catch(() => null);
    try { dates = raw ? JSON.parse(raw) : []; } catch { dates = []; }
    if (!Array.isArray(dates)) dates = [];
  }
  return [...new Set(dates)].filter(d => AUTO_BACKUP_DATE.test(d)).sort();
}

function backupSnapshot(s) {
  return { version: STORE_VERSION, date: new Date().toISOString(), data: { config: stripGoogleSecrets(s.config), ...backupCollections(s) } };
}

/** Save the current data as the safety copy (skipped when there is nothing to keep). Throws if it cannot. */
async function saveSafetyBackup(s) {
  if (!hasData(s)) return;
  await invoke('save_data', { key: SAFETY_BACKUP_KEY, value: JSON.stringify(backupSnapshot(s)) });
  await invoke('save_data', { key: SAFETY_INFO_KEY, value: JSON.stringify({ date: new Date().toISOString() }) });
}

/** Collections included in backups and exports (config is added stripped). */
function backupCollections(s) {
  const { clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments,
    emailTemplates, planLibrary, patientSuggestions } = s;
  return { clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments,
    emailTemplates, planLibrary, patientSuggestions };
}

/**
 * State patch that replaces the data with a backup's (`d` from readBackup).
 * Two things are kept from the current data, because they already happened
 * outside the app:
 *  - invoices issued after the backup (dropping them would hand their
 *    numbers out again), counted in `keptInvoices`;
 *  - the reminder / review-request status of each consultation (or the
 *    next tick would send them again).
 * The undo history belongs to the replaced data, so it is cleared.
 */
export function restoredState(d, current) {
  const backupInvoices = d.invoices || [];
  const ids = new Set(backupInvoices.map(i => i.id));
  const numbers = new Set(backupInvoices.map(i => i.numero).filter(Boolean));
  const newerInvoices = (current.invoices || []).filter(i => !ids.has(i.id) && !(i.numero && numbers.has(i.numero)));
  const sent = new Map((current.consultations || []).filter(c => c.reminders || c.reviewRequest).map(c => [c.id, c]));
  const consultations = (d.consultations || []).map(c => {
    const now = sent.get(c.id);
    return now ? { ...c, reminders: now.reminders ?? c.reminders, reviewRequest: now.reviewRequest ?? c.reviewRequest } : c;
  });
  return {
    keptInvoices: newerInvoices.length,
    patch: restoredPatch(d, current, { invoices: [...backupInvoices, ...newerInvoices], consultations }),
  };
}

function restoredPatch(d, current, { invoices, consultations }) {
  return {
    clients:        d.clients        || [],
    measurements:   d.measurements   || [],
    consultations,
    nutritionPlans: d.nutritionPlans || [],
    services:       d.services       || DEFAULT_SERVICES,
    invoices,
    clientDocuments:d.clientDocuments || [],
    emailTemplates: d.emailTemplates || null,
    planLibrary:    d.planLibrary    || EMPTY_PLAN_LIBRARY,
    // Older backups did not include the inbox; the sync rebuilds missing suggestions.
    patientSuggestions: Array.isArray(d.patientSuggestions) ? d.patientSuggestions : current.patientSuggestions,
    config: mergeRestoredConfig(current.config, d.config),
    selectedClientId: null,
    _history: [],
    _future: [],
  };
}

// Why an undo entry can no longer be applied safely (null = it can).
// - delete_invoice: its number was reused by a newer invoice → two invoices
//   with the same number (numbering must be unique and correlative).
// - add_client: undoing deletes the client; not once it has been edited
//   (interview, energy…) or has anything linked to it.
export function undoBlockReason(s, entry) {
  if (entry?.type === 'delete_invoice') {
    const { id, numero } = entry.item || {};
    return (s.invoices || []).some(i => i.id === id || (numero && i.numero === numero))
      ? 'invoice_number_taken' : null;
  }
  if (entry?.type === 'add_client') {
    const id = entry.item?.id;
    const current = (s.clients || []).find(c => c.id === id);
    if (!current) return null;
    const linked = [s.consultations, s.measurements, s.nutritionPlans, s.invoices, s.clientDocuments]
      .some(list => (list || []).some(x => x?.clienteId === id));
    return current !== entry.item || linked ? 'client_in_use' : null;
  }
  return null;
}

// Last config given to partialize and its stripped copy
const safeConfigCache = { from: undefined, to: undefined };

// ============================================
// STORE
// ============================================
const useStore = create(
  persist(
    (set, get) => ({
      // ---- CONFIG ----
      config: {
        nombre: 'Raquel Polo García',
        nif: '',
        iban: '',
        // Wording of the VAT exemption on invoices ('' = DEFAULT_VAT_EXEMPTION_TEXT)
        textoExencionIva: '',
        numColegiada: 'CV01944',
        email: 'nutripoloraquel@gmail.com',
        telefono: '+34 622 573 834',
        web: 'https://www.nutripoloraquel.com',
        direccion: '',
        locations: DEFAULT_LOCATIONS,
        consultationTypes: ['Primera visita', 'Seguimiento', 'Revisión', 'Urgencia'],
        defaultConsultationDuration: 45,
        appFont: 'Onest',
        appFontHeading: 'Onest',
        appFontMono: 'Onest',
        appTheme: 'auto',
        appLang: 'es',
        invoiceDesign: DEFAULT_INVOICE_DESIGN,
        smtpEnabled: false,
        smtp: null,
        tipoIva: 0,
        emailProvider: 'gmail',
        whatsappCountryCode: '34',
        reminders: DEFAULT_REMINDER_CONFIG,
        googleCalendar: {
          connected: false,
          clientId: '',
          clientSecret: '',
          accessToken: '',
          refreshToken: '',
          expiresAt: 0,
          calendars: [],  // Array of { id, name, color, accessRole, syncMode: 'bidirectional'|'readonly'|'disabled' }
          defaultPushCalendarId: null,
          autoSync: false,
          userEmail: '',
        },
        blockedHours: [],
        // Each entry: { id, dayOfWeek: 0-6 (0=Lun), startHour: 8-20, endHour: 8-20, label?: string }
        autoLockMinutes: 0, // 0 = disabled; otherwise lock the vault after N min of inactivity
        closeToTray: true,  // closing the window keeps the app running in the tray
      },
      updateConfig: (updates) => set(s => ({ config: { ...s.config, ...updates } })),

      // Disconnect: forget the credentials but keep the calendar settings and
      // the consultations' links to their Google events. Reconnecting the same
      // account re-pairs them instead of uploading everything again as new
      // events; calendars that are gone after reconnecting are detached by
      // detachConsultationsFromCalendars.
      clearGoogleCalendarData: () => set(s => ({
        config: {
          ...s.config,
          googleCalendar: {
            ...s.config.googleCalendar,
            connected: false,
            needsReauth: false,
            clientId: '',
            clientSecret: '',
            accessToken: '',
            refreshToken: '',
            expiresAt: 0,
            grantedScopes: '',
            autoSync: false,
          },
        },
        consultations: s.consultations.map(c => {
          if (!c.syncPending && !c.syncError && !c.syncConflict && !c.restoreRemote) return c;
          const { syncPending, syncError, syncErrorFor, syncAttempts, syncConflict, conflictShadow, restoreRemote, ...rest } = c;
          return rest;
        }),
        // Personal events come 100% from Google and are pulled again on reconnect.
        personalEvents: [],
        gcalPendingDeletes: [],
        syncAudit: { lastFullSyncAt: null, lastSyncStats: {}, massDeleteEvents: [] },
      })),

      // After (re)connecting: consultations linked to calendars this account
      // cannot see any more become local records. They are flagged so the sync
      // never uploads them as new events (they already exist in Google).
      detachConsultationsFromCalendars: (visibleCalendarIds) => set(s => {
        const visible = new Set(visibleCalendarIds);
        return {
          consultations: s.consultations.map(c => {
            if (!c.sourceCalendarId || visible.has(c.sourceCalendarId)) return c;
            const { googleEventId, sourceCalendarId, lastSyncedAt, remoteUpdated, syncPending, syncError, syncErrorFor,
              syncAttempts, syncConflict, conflictShadow, remoteDeleted, restoreRemote, ...rest } = c;
            return { ...rest, detachedFromGoogle: true };
          }),
          personalEvents: s.personalEvents.filter(e => !e.sourceCalendarId || visible.has(e.sourceCalendarId)),
        };
      }),

      // Tombstones of Google events whose consultation was deleted here.
      // `remote: true` → the event still has to be deleted in Google (offline
      // or failed); the sync retries it. `remote: false` → read-only calendar:
      // the event stays in Google and the tombstone only stops the pull from
      // importing it again. Either way the pull skips tombstoned events.
      gcalPendingDeletes: [],
      addGcalPendingDelete: ({ calendarId, eventId, consultationId = null, remote = true }) => set(s => ({
        gcalPendingDeletes: [
          ...s.gcalPendingDeletes.filter(d => !(d.calendarId === calendarId && d.eventId === eventId)),
          { calendarId, eventId, consultationId, remote, at: new Date().toISOString() },
        ],
      })),
      removeGcalPendingDelete: (calendarId, eventId) => set(s => ({
        gcalPendingDeletes: s.gcalPendingDeletes.filter(d => !(d.calendarId === calendarId && d.eventId === eventId)),
      })),
      setSyncAudit: (patch) => set(s => ({ syncAudit: { ...s.syncAudit, ...patch } })),

      // ---- CLIENTS ----
      clients: [],
      selectedClientId: null,
      setSelectedClientId: (id) => set({ selectedClientId: id }),

      addClient: (client) => {
        const newClient = {
          ...client,
          id: generateId(),
          fechaAlta: todayISO(),
          estado: client.estado || 'activo',
          alergias: client.alergias || [],
          intolerancias: client.intolerancias || [],
          patologias: client.patologias || [],
          objetivos: client.objetivos || [],
          restriccionesDieteticas: client.restriccionesDieteticas || [],
        };
        set(s => ({
          clients: [...s.clients, newClient],
          _history: [{ type: 'add_client', item: newClient }, ...s._history].slice(0, 20),
          _future: [],
        }));
        return newClient;
      },
      updateClient: (id, data) => set(s => ({
        clients: s.clients.map(c => c.id === id ? { ...c, ...data } : c),
      })),
      deleteClient: (id) => {
        const item = get().clients.find(c => c.id === id);
        if (!item) return;
        set(s => {
          const { patch, snapshot } = buildClientDeletion(s, id);
          return {
            ...patch,
            _history: [{ type: 'delete_client', item, cascade: snapshot }, ...s._history].slice(0, 20),
            _future: [],
          };
        });
      },

      // ---- MEASUREMENTS ----
      measurements: [],

      addMeasurement: (measurement) => {
        const client = get().clients.find(c => c.id === measurement.clienteId);
        const imc = (measurement.peso && client?.altura)
          ? calcIMC(measurement.peso, client.altura)
          : null;
        const newM = {
          ...measurement,
          id: generateId(),
          fecha: measurement.fecha || todayISO(),
          imc,
        };
        set(s => ({ measurements: [...s.measurements, newM] }));
        return newM;
      },
      updateMeasurement: (id, data) => set(s => ({
        measurements: s.measurements.map(m => {
          if (m.id !== id) return m;
          const next = { ...m, ...data };
          // A new weight changes the BMI (computed with the client's current height)
          if ('peso' in data) {
            const client = s.clients.find(c => c.id === m.clienteId);
            next.imc = (next.peso && client?.altura) ? calcIMC(next.peso, client.altura) : null;
          }
          return next;
        }),
      })),
      deleteMeasurement: (id) => set(s => ({
        measurements: s.measurements.filter(m => m.id !== id),
      })),

      getClientMeasurements: (clienteId) =>
        get().measurements
          .filter(m => m.clienteId === clienteId)
          .sort((a, b) => a.fecha.localeCompare(b.fecha)),

      // ---- CONSULTATIONS ----
      consultations: [],

      // `{ sync: true }` marks writes made by the Google Calendar sync: they must
      // NOT get a fresh localUpdatedAt or they would be pushed back to Google
      // on the next cycle. User writes never touch the sync bookkeeping fields.
      addConsultation: (consultation, { sync = false } = {}) => {
        const isSyncOp = sync;
        const data = isSyncOp ? consultation : withoutSyncFields(consultation);
        const newC = {
          ...data,
          id: consultation.id || generateId(),
          estado: consultation.estado || 'programada',
          notasPrivadas: consultation.notasPrivadas || '',
          notasCliente: consultation.notasCliente || '',
          ...(isSyncOp ? {} : { localUpdatedAt: new Date().toISOString() }),
        };
        set(s => ({ consultations: [...s.consultations, newC] }));
        return newC;
      },
      updateConsultation: (id, input, { sync = false } = {}) => {
        // Only user edits bump localUpdatedAt. They also drop the sync fields:
        // the modal saves a copy taken when it opened, and a sync may have
        // updated them in the meantime.
        const isSyncOp = sync;
        const data = isSyncOp ? input : withoutSyncFields(input);
        const extra = isSyncOp ? {} : { localUpdatedAt: new Date().toISOString() };
        // An all-day event the user gives a date or time becomes a timed appointment
        const before = get().consultations.find(c => c.id === id);
        if (!isSyncOp && before?.allDay && ((data.hora && data.hora !== before.hora) || (data.fecha && data.fecha !== before.fecha))) {
          extra.allDay = false;
        }

        // Hook: if a user manually changes clienteId on a consultation matched by
        // the sync (pending review, or linked automatically), flip matchStatus to
        // 'manual' and write audit fields.
        const existing = get().consultations.find(c => c.id === id);
        const isManualClientLink =
          !isSyncOp &&
          'clienteId' in data &&
          data.clienteId &&
          data.clienteId !== existing?.clienteId &&
          existing?.matchStatus &&
          existing.matchStatus !== 'manual';
        const matchExtra = isManualClientLink ? {
          matchStatus: 'manual',
          matchedBy: 'user',
          matchedByAt: new Date().toISOString(),
          suggestedClienteId: undefined,
        } : {};

        set(s => ({ consultations: s.consultations.map(c => c.id === id ? { ...c, ...data, ...extra, ...matchExtra } : c) }));

        // If manual link, mark the associated suggestion as linked
        if (isManualClientLink && existing?.suggestedFromId) {
          set(s => ({
            patientSuggestions: s.patientSuggestions.map(sg =>
              sg.id === existing.suggestedFromId && (sg.status === 'pending' || sg.status === 'pending-confirm')
                ? { ...sg, status: 'linked', linkedClienteId: data.clienteId }
                : sg
            ),
          }));
        }
      },
      // Reminders and review requests already sent are remembered by Google
      // event, so the next sync does not import those appointments as if
      // nothing had been sent (see takeSentStatus).
      resetAgenda: (onlyGoogleSynced = false) => set(s => {
        const sent = { ...(s.sentByEvent || {}) };
        for (const c of s.consultations) {
          if (c.googleEventId && (c.reminders || c.reviewRequest)) {
            sent[c.googleEventId] = { reminders: c.reminders, reviewRequest: c.reviewRequest };
          }
        }
        return {
          consultations: onlyGoogleSynced ? s.consultations.filter(c => !c.googleEventId) : [],
          sentByEvent: sent,
          _history: [],
          _future: [],
        };
      }),
      sentByEvent: {},
      // The sent status remembered for a Google event, once (it is dropped).
      takeSentStatus: (googleEventId) => {
        const status = get().sentByEvent?.[googleEventId];
        if (!status) return null;
        set(s => ({ sentByEvent: omit(s.sentByEvent, googleEventId) }));
        return status;
      },
      // Copy of the current data before something that cannot be undone
      // (reset the agenda, turn a calendar's appointments into personal events)
      saveSafetyBackup: () => saveSafetyBackup(get()),

      removeConsultationsForCalendar: (calendarId) => set(s => ({
        consultations: s.consultations.filter(c => c.sourceCalendarId !== calendarId),
      })),

      // ---- PERSONAL EVENTS ----
      // Events pulled from calendars whose purpose === 'personal' (ballet, birthdays,
      // appointments that are NOT consultations). Deliberately isolated from
      // `consultations` so they can never contaminate revenue, billing, dashboard
      // stats or the "today's consultations" list.
      personalEvents: [],

      addPersonalEvent: (event) => {
        const newE = {
          id: event.id || generateId(),
          ...event,
        };
        set(s => ({ personalEvents: [...s.personalEvents, newE] }));
        return newE;
      },
      updatePersonalEvent: (id, data) => set(s => ({
        personalEvents: s.personalEvents.map(e => e.id === id ? { ...e, ...data } : e),
      })),
      deletePersonalEvent: (id) => set(s => ({
        personalEvents: s.personalEvents.filter(e => e.id !== id),
      })),
      removePersonalEventsForCalendar: (calendarId) => set(s => ({
        personalEvents: s.personalEvents.filter(e => e.sourceCalendarId !== calendarId),
      })),

      // Move consultations from a given calendar into personalEvents (used when
      // user switches a calendar's purpose to 'personal' and chooses "convert").
      // Strips all clinical fields — these are no longer consultas.
      convertConsultationsToPersonal: (calendarId) => set(s => {
        const toMove = s.consultations.filter(c => c.sourceCalendarId === calendarId);
        const converted = toMove.map(c => ({
          id: generateId(),
          googleEventId: c.googleEventId || null,
          sourceCalendarId: c.sourceCalendarId,
          title: c.googleSummary || c.clienteNombre || c.notasCliente || '(sin título)',
          fecha: c.fecha,
          hora: c.hora,
          duracion: c.duracion,
          allDay: false,
          lastSyncedAt: c.lastSyncedAt || null,
          remoteUpdated: c.remoteUpdated || null,
          cancelled: c.estado === 'cancelada',
        }));
        return {
          consultations: s.consultations.filter(c => c.sourceCalendarId !== calendarId),
          personalEvents: [...s.personalEvents, ...converted],
        };
      }),

      // ---- PATIENT SUGGESTIONS (Phase 2 — inbox for external-clinic detection) ----
      patientSuggestions: [],

      // Add or dedup a patient suggestion for an unrecognised external-clinic event.
      // Dedup rules:
      //   - pending-confirm + same (calId, normalizedName): increment occurrences
      //   - pending + same (calId, normalizedName) and new entry is pending-confirm:
      //     upgrade existing to pending-confirm with the new suggestedClienteId/topScore
      //   - pending + same (calId, normalizedName): increment occurrences
      addPatientSuggestion: (suggestion) => {
        const incomingStatus = suggestion.status || 'pending';
        const existing = get().patientSuggestions.find(sg =>
          (sg.status === 'pending' || sg.status === 'pending-confirm') &&
          sg.sourceCalendarId === suggestion.sourceCalendarId &&
          sg.normalizedName === suggestion.normalizedName
        );
        if (existing) {
          set(s => ({
            patientSuggestions: s.patientSuggestions.map(sg => {
              if (sg.id !== existing.id) return sg;
              const upgraded = incomingStatus === 'pending-confirm' && sg.status === 'pending';
              return {
                ...sg,
                occurrences: (sg.occurrences || 1) + 1,
                ...(upgraded ? {
                  status: 'pending-confirm',
                  suggestedClienteId: suggestion.suggestedClienteId ?? sg.suggestedClienteId,
                  topScore: suggestion.topScore ?? sg.topScore,
                  candidates: suggestion.candidates?.length ? suggestion.candidates : sg.candidates,
                } : {}),
              };
            }),
          }));
          return existing;
        }
        const newSg = {
          status: 'pending',
          occurrences: 1,
          candidates: [],
          linkedClienteId: null,
          dismissedAt: null,
          detectedAt: new Date().toISOString(),
          consultationIds: [],
          topScore: null,
          suggestedClienteId: null,
          ...suggestion,      // sourceCalendarId, rawSummary, normalizedName, etc.
          id: generateId(),   // always a fresh ID regardless of suggestion payload
        };
        set(s => ({ patientSuggestions: [...s.patientSuggestions, newSg] }));
        return newSg;
      },

      // Mark a suggestion as linked and backfill clienteId on every consultation
      // that was imported with suggestedFromId pointing to this suggestion.
      linkPatientSuggestion: (suggestionId, clienteId) => {
        const now = new Date().toISOString();
        set(s => ({
          patientSuggestions: s.patientSuggestions.map(sg =>
            sg.id === suggestionId
              ? { ...sg, status: 'linked', linkedClienteId: clienteId }
              : sg
          ),
          consultations: s.consultations.map(c =>
            c.suggestedFromId === suggestionId
              ? {
                  ...c,
                  clienteId,
                  suggestedFromId: undefined,
                  suggestedClienteId: undefined,
                  matchStatus: 'manual',
                  matchedBy: 'user',
                  matchedByAt: now,
                }
              : c
          ),
        }));
      },

      // Create a brand-new client and immediately link the suggestion to it.
      createClientFromSuggestion: (suggestionId, clientData) => {
        const newClient = get().addClient(clientData);
        get().linkPatientSuggestion(suggestionId, newClient.id);
        return newClient;
      },

      // Dismiss a suggestion so it never reappears in the inbox for this patient name.
      // _syncExternalClinic checks the dismissed set before creating new suggestions.
      // Cascade: linked consultations get matchStatus='dismissed' so the calendar stops
      // showing them as pending-review and shows them as greyed-out dismissed instead.
      dismissPatientSuggestion: (suggestionId) => {
        const now = new Date().toISOString();
        set(s => ({
          patientSuggestions: s.patientSuggestions.map(sg =>
            sg.id === suggestionId
              ? { ...sg, status: 'dismissed', dismissedAt: now }
              : sg
          ),
          consultations: s.consultations.map(c =>
            c.suggestedFromId === suggestionId
              ? {
                  ...c,
                  matchStatus: 'dismissed',
                  matchedBy: 'user',
                  matchedByAt: now,
                  suggestedClienteId: undefined,
                  matchScore: undefined,
                }
              : c
          ),
        }));
      },

      // 1-click confirmation of a high-confidence auto-match (pending-confirm → linked)
      confirmAutoMatch: (suggestionId) => {
        const sg = get().patientSuggestions.find(s => s.id === suggestionId);
        if (!sg || sg.status !== 'pending-confirm' || !sg.suggestedClienteId) return;
        get().linkPatientSuggestion(suggestionId, sg.suggestedClienteId);
      },

      // Override: user rejects the auto-proposed client and picks a different one
      overrideAutoMatch: (suggestionId, newClienteId) => {
        get().linkPatientSuggestion(suggestionId, newClienteId);
      },

      // Bulk confirm all pending-confirm suggestions at once
      confirmAllAutoMatches: () => {
        const pending = get().patientSuggestions.filter(sg => sg.status === 'pending-confirm');
        pending.forEach(sg => get().confirmAutoMatch(sg.id));
        return pending.length;
      },

      // Attach a consultation ID to a suggestion's consultationIds array (once).
      attachConsultationToSuggestion: (suggestionId, consultationId) => set(s => ({
        patientSuggestions: s.patientSuggestions.map(sg => {
          if (sg.id !== suggestionId) return sg;
          const consultationIds = Array.from(new Set([...(sg.consultationIds || []), consultationId]));
          return { ...sg, consultationIds, occurrences: Math.max(consultationIds.length, 1) };
        }),
      })),

      // The consultation no longer belongs to this suggestion (its title changed
      // in Google). An open suggestion left without consultations is dropped.
      detachConsultationFromSuggestion: (suggestionId, consultationId) => set(s => {
        const sg = s.patientSuggestions.find(x => x.id === suggestionId);
        if (!sg) return {};
        const consultationIds = (sg.consultationIds || []).filter(id => id !== consultationId);
        const stillUsed = consultationIds.length > 0
          || s.consultations.some(c => c.id !== consultationId && c.suggestedFromId === suggestionId);
        const open = sg.status === 'pending' || sg.status === 'pending-confirm';
        return {
          patientSuggestions: open && !stillUsed
            ? s.patientSuggestions.filter(x => x.id !== suggestionId)
            : s.patientSuggestions.map(x => x.id === suggestionId
              ? { ...x, consultationIds, occurrences: Math.max(consultationIds.length, 1) }
              : x),
        };
      }),

      // Undo an automatic link made by the sync (wrong patient). The
      // consultation is left without a client, marked as the user's decision
      // so the sync never links it again, and nothing is sent to Google.
      unlinkAutoMatch: (consultationId) => {
        const c = get().consultations.find(x => x.id === consultationId);
        if (!c || !c.clienteId || c.matchedBy !== 'system') return false;
        const now = new Date().toISOString();
        set(s => ({
          consultations: s.consultations.map(x => x.id === consultationId
            ? {
                ...x,
                clienteId: null,
                matchStatus: 'unknown',
                matchedBy: 'user',
                matchedByAt: now,
                rejectedClienteId: c.clienteId,
                matchedVia: undefined,
                matchScore: undefined,
              }
            : x),
        }));
        return true;
      },

      // ---- SYNC AUDIT (Phase 3 — mass-delete log, stats) ----
      syncAudit: { lastFullSyncAt: null, lastSyncStats: {}, massDeleteEvents: [] },

      // Mark a calendar as having a suspicious mass-delete pending review.
      markCalendarMassDeletePending: (calendarId, { prevCount, newCount, drop }) => {
        const detectedAt = new Date().toISOString();
        set(s => {
          const calendars = (s.config.googleCalendar?.calendars || []).map(c =>
            c.id === calendarId
              ? { ...c, massDeletePending: { detectedAt, prevCount, newCount, drop } }
              : c
          );
          const entry = { calendarId, detectedAt, prevCount, newCount, drop };
          const massDeleteEvents = [entry, ...(s.syncAudit.massDeleteEvents || [])].slice(0, 10);
          return {
            config: { ...s.config, googleCalendar: { ...s.config.googleCalendar, calendars } },
            syncAudit: { ...s.syncAudit, massDeleteEvents },
          };
        });
      },

      // Accept pending mass-delete: clear the pending flag and let cancelled events
      // flow through on the next sync. Does NOT modify consultations — the next sync
      // will mark them 'cancelada' via the normal cancelled-events pipeline.
      acceptMassDelete: (calendarId) => {
        set(s => {
          const calendars = (s.config.googleCalendar?.calendars || []).map(c =>
            c.id === calendarId
              ? { ...c, massDeletePending: null, lastKnownRemoteCount: null }
              : c
          );
          return { config: { ...s.config, googleCalendar: { ...s.config.googleCalendar, calendars } } };
        });
      },

      // Ignore mass-delete once: clear pending AND reset the baseline so the next
      // successful sync re-establishes lastKnownRemoteCount from the current remote
      // count via updateCalendarTracking. Without clearing the baseline, _detectMassDelete
      // sees the same drop on the very next sync and re-suspends immediately.
      ignoreMassDeleteOnce: (calendarId) => {
        set(s => {
          const calendars = (s.config.googleCalendar?.calendars || []).map(c =>
            c.id === calendarId
              ? { ...c, massDeletePending: null, lastKnownRemoteCount: null, lastKnownRemoteSyncAt: null }
              : c
          );
          return { config: { ...s.config, googleCalendar: { ...s.config.googleCalendar, calendars } } };
        });
      },

      // Called at end of every successful sync to update the baseline event count
      // used by detectMassDelete on the next cycle.
      updateCalendarTracking: (calendarId, remoteCount) => {
        set(s => {
          const calendars = (s.config.googleCalendar?.calendars || []).map(c =>
            c.id === calendarId
              ? { ...c, lastKnownRemoteCount: remoteCount, lastKnownRemoteSyncAt: new Date().toISOString() }
              : c
          );
          return { config: { ...s.config, googleCalendar: { ...s.config.googleCalendar, calendars } } };
        });
      },

      // Reminder bookkeeping (channel: 'email' | 'whatsapp'). Written directly,
      // without localUpdatedAt, so it never triggers a push to Google.
      setConsultationReminder: (id, channel, info) => set(s => ({
        consultations: s.consultations.map(c => c.id === id
          ? { ...c, reminders: { ...(c.reminders || {}), [channel]: info } }
          : c),
      })),

      // Google review request bookkeeping, same rules as reminders.
      setConsultationReviewRequest: (id, channel, info) => set(s => ({
        consultations: s.consultations.map(c => c.id === id
          ? { ...c, reviewRequest: { ...(c.reviewRequest || {}), [channel]: info } }
          : c),
      })),

      // Local delete with undo. Use googleCalendar.deleteConsultation from the
      // UI so the linked Google event is deleted (or tombstoned) as well.
      deleteConsultation: (id) => {
        const item = get().consultations.find(c => c.id === id);
        if (!item) return;
        set(s => ({
          consultations: s.consultations.filter(c => c.id !== id),
          _history: [{ type: 'delete_consultation', item }, ...s._history].slice(0, 20),
          _future: [],
        }));
      },

      // Deletes made by the sync (the event was deleted in Google): no undo entry.
      removeConsultationsSync: (ids) => {
        const drop = new Set(ids);
        set(s => ({ consultations: s.consultations.filter(c => !drop.has(c.id)) }));
      },

      getTodayConsultations: () => {
        const today = todayISO();
        const { consultations, config } = get();
        return filterVisibleConsultations(consultations, config.googleCalendar)
          .filter(c => c.fecha === today)
          .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
      },

      getUpcomingConsultations: (days = 7) => {
        const today = todayISO();
        const limit = new Date();
        limit.setDate(limit.getDate() + days);
        const limitStr = localISODate(limit);
        const { consultations, config } = get();
        return filterVisibleConsultations(consultations, config.googleCalendar)
          .filter(c => c.fecha >= today && c.fecha <= limitStr && c.estado === 'programada')
          .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || ''));
      },

      getPendingFollowUps: (days = 30) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = localISODate(cutoff);
        const lastVisit = lastVisitByClient(get());
        return get().clients.filter(c => {
          const last = lastVisit.get(c.id);
          return c.estado === 'activo' && (!last || last < cutoffStr);
        });
      },

      // ---- NUTRITION PLANS ----
      nutritionPlans: [],

      addNutritionPlan: (plan) => {
        const newP = {
          ...plan,
          id: generateId(),
          estado: plan.estado || 'borrador',
          comidas: plan.comidas || [],
          macros: plan.macros || { proteinas: 0, carbohidratos: 0, grasas: 0 },
        };
        set(s => ({ nutritionPlans: [...s.nutritionPlans, newP] }));
        return newP;
      },
      updateNutritionPlan: (id, data) => set(s => ({
        nutritionPlans: s.nutritionPlans.map(p => p.id === id ? { ...p, ...data } : p),
      })),
      deleteNutritionPlan: (id) => {
        const item = get().nutritionPlans.find(p => p.id === id);
        set(s => ({
          nutritionPlans: s.nutritionPlans.filter(p => p.id !== id),
          _history: [{ type: 'delete_plan', item }, ...s._history].slice(0, 20),
          _future: [],
        }));
      },

      getExpiringPlans: (days = 7) => {
        const today = todayISO();
        const limit = new Date();
        limit.setDate(limit.getDate() + days);
        const limitStr = localISODate(limit);
        return get().nutritionPlans.filter(p =>
          p.estado === 'activo' && p.fechaFin && p.fechaFin >= today && p.fechaFin <= limitStr
        );
      },

      // ---- PLAN LIBRARY (productes reutilitzables a les planificacions) ----
      planLibrary: EMPTY_PLAN_LIBRARY,

      addPlanProduct: (product) => {
        const newP = { ...product, id: generateId(), createdAt: new Date().toISOString() };
        set(s => ({ planLibrary: { ...s.planLibrary, productos: [...s.planLibrary.productos, newP] } }));
        return newP;
      },
      updatePlanProduct: (id, data) => set(s => ({
        planLibrary: { ...s.planLibrary, productos: s.planLibrary.productos.map(p => p.id === id ? { ...p, ...data } : p) },
      })),
      deletePlanProduct: (id) => set(s => ({
        planLibrary: { ...s.planLibrary, productos: s.planLibrary.productos.filter(p => p.id !== id) },
      })),
      // "Mis recetas": plats i opcions propis, desats en desar una planificació
      rememberRecipes: (entries) => {
        const prev = get().planLibrary.recetas || [];
        const recetas = mergeOwnRecipes(prev, entries);
        if (recetas !== prev) set(s => ({ planLibrary: { ...s.planLibrary, recetas } }));
      },
      deleteOwnRecipe: (id) => set(s => ({
        planLibrary: { ...s.planLibrary, recetas: (s.planLibrary.recetas || []).filter(r => r.id !== id) },
      })),
      // Foto o valors nutricionals propis d'un aliment de la biblioteca (el catàleg no es toca)
      setFoodEdit: (id, data) => set(s => {
        const alimentos = s.planLibrary.alimentos || {};
        return { planLibrary: { ...s.planLibrary, alimentos: { ...alimentos, [id]: { ...alimentos[id], ...data, updatedAt: new Date().toISOString() } } } };
      }),
      // Torna a l'original una part ('imagen' | 'por100g'); sense res editat, l'aliment surt del mapa
      clearFoodEdit: (id, field) => set(s => {
        const { [id]: edit, ...rest } = s.planLibrary.alimentos || {};
        if (!edit) return {};
        const { [field]: _removed, updatedAt, ...kept } = edit;
        const alimentos = Object.keys(kept).length ? { ...rest, [id]: { ...kept, updatedAt: new Date().toISOString() } } : rest;
        return { planLibrary: { ...s.planLibrary, alimentos } };
      }),
      // Memòria cau del receptari de la web (services/webRecipes.js)
      setWebRecipes: ({ items, syncedAt }) => set(s => ({
        planLibrary: { ...s.planLibrary, recetasWeb: { items, syncedAt } },
      })),

      // ---- CLIENT DOCUMENTS ----
      clientDocuments: [],

      addClientDocument: (doc) => {
        const newDoc = {
          ...doc,
          id: generateId(),
          fechaSubida: todayISO(),
        };
        set(s => ({ clientDocuments: [...s.clientDocuments, newDoc] }));
        return newDoc;
      },
      updateClientDocument: (id, data) => set(s => ({
        clientDocuments: s.clientDocuments.map(d => d.id === id ? { ...d, ...data } : d),
      })),
      // No undo: the caller deletes the file itself, so restoring the
      // metadata would list a document that no longer exists.
      deleteClientDocument: (id) => set(s => ({
        clientDocuments: s.clientDocuments.filter(d => d.id !== id),
      })),
      getClientDocuments: (clienteId) =>
        get().clientDocuments
          .filter(d => d.clienteId === clienteId)
          .sort((a, b) => (b.fechaSubida || '').localeCompare(a.fechaSubida || '')),

      // ---- SERVICES ----
      services: DEFAULT_SERVICES,

      addService: (service) => {
        const newS = { ...service, id: generateId(), activo: true };
        set(s => ({ services: [...s.services, newS] }));
        return newS;
      },
      updateService: (id, data) => set(s => ({
        services: s.services.map(sv => sv.id === id ? { ...sv, ...data } : sv),
      })),
      deleteService: (id) => set(s => ({ services: s.services.filter(sv => sv.id !== id) })),

      // ---- INVOICES ----
      invoices: [],

      // Next number of a series for the year of `fecha` (NP-YYYY-NNN, R-YYYY-NNN).
      generateInvoiceNumber: (fecha, serie = SERIES.ordinaria) => nextInvoiceNumber(get().invoices || [], fecha, serie),

      // Create (no id) or update a draft. A draft has no number: it gets one
      // when it is issued. Returns the saved draft.
      saveInvoiceDraft: (data, id = null) => {
        const existing = id ? get().invoices.find(i => i.id === id) : null;
        if (existing && isIssued(existing)) return existing;
        const { numero, emitidaAt, emisor, destinatario, ...fields } = data;
        const draft = {
          ...(existing || {}),
          ...fields,
          id: existing?.id || generateId(),
          estado: fields.estado || existing?.estado || 'pendiente',
          items: fields.items || existing?.items || [],
          ivaPct: fields.ivaPct ?? existing?.ivaPct ?? 0,
          irpfPct: fields.irpfPct ?? existing?.irpfPct ?? 0,
        };
        const saved = { ...draft, ...invoiceTotalsFields(draft) };
        set(s => ({ invoices: existing ? s.invoices.map(i => (i.id === saved.id ? saved : i)) : [...s.invoices, saved] }));
        return saved;
      },

      // Issue a draft: next number of its series, the issuer's and client's
      // data frozen, and no more edits. Returns { ok, invoice } or
      // { ok: false, problems } (see issueProblems).
      issueInvoice: (id) => {
        const s = get();
        const draft = s.invoices.find(i => i.id === id);
        if (!draft) return { ok: false, problems: [{ code: 'not_found' }] };
        if (isIssued(draft)) return { ok: true, invoice: draft };
        const client = s.clients.find(c => c.id === draft.clienteId);
        const problems = issueProblems(draft, client, s.config, s.invoices);
        if (problems.length) return { ok: false, problems };
        const invoice = { ...draft, ...issueFields(draft, client, s.config, s.invoices, new Date().toISOString()) };
        const original = isCorrective(invoice) ? s.invoices.find(i => i.id === invoice.rectificaA) : null;
        set(st => ({
          invoices: st.invoices.map(i => {
            if (i.id === invoice.id) return invoice;
            if (original && i.id === original.id) {
              return {
                ...i,
                rectificadaPor: [...(i.rectificadaPor || []), invoice.id],
                // Cancelled in full: its consultations can be billed again
                ...(cancelsInFull(invoice, i) ? { estado: 'anulada' } : {}),
              };
            }
            return i;
          }),
        }));
        return { ok: true, invoice };
      },

      // Draft of a corrective invoice for an issued one (full cancellation
      // to start with; its lines can be edited). Returns the draft.
      createCorrectiveDraft: (id) => {
        const original = get().invoices.find(i => i.id === id);
        if (!original || !isIssued(original) || isCorrective(original)) return null;
        return get().saveInvoiceDraft(correctiveDraft(original, { fecha: todayISO(), generateId }));
      },

      // A draft takes any change; an issued invoice only how and when it was
      // paid (PAYMENT_FIELDS), and is never set to "anulada" by hand.
      updateInvoice: (id, data) => {
        const existing = get().invoices.find(i => i.id === id);
        if (!existing) return;
        if (!isIssued(existing)) { get().saveInvoiceDraft(data, id); return; }
        const allowed = Object.fromEntries(Object.entries(data).filter(([k]) => PAYMENT_FIELDS.includes(k)));
        if (allowed.estado === 'anulada' && existing.estado !== 'anulada') delete allowed.estado;
        set(s => ({ invoices: s.invoices.map(i => (i.id === id ? { ...i, ...allowed } : i)) }));
      },

      // Only drafts can be deleted (see canDeleteInvoice). Returns whether it was deleted.
      deleteInvoice: (id) => {
        const item = get().invoices.find(i => i.id === id);
        if (!item || !canDeleteInvoice(get().invoices, item)) return false;
        set(s => ({
          invoices: s.invoices.filter(i => i.id !== id),
          _history: [{ type: 'delete_invoice', item }, ...s._history].slice(0, 20),
          _future: [],
        }));
        return true;
      },

      getUnbilledConsultations: (clienteId) => {
        const { consultations, invoices } = get();
        const billedIds = billedConsultationIds(invoices);
        return consultations.filter(c =>
          c.clienteId === clienteId &&
          c.estado === 'completada' &&
          !billedIds.has(c.id)
        );
      },

      // ---- UI STATE ----
      currentView: 'dashboard',
      sidebarCollapsed: false,
      appTheme: 'auto',
      clientSearch: '',
      clientFilters: { estado: 'all', objetivo: 'all' },
      consultationFilters: { dateRange: 'week', locationId: 'all', tipo: 'all', estado: 'all' },
      plansSection: 'plans', // Planes tab: 'plans' | 'foods' | 'recipes'

      setCurrentView: (view) => set({ currentView: view }),
      setPlansSection: (section) => set({ plansSection: section }),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setAppTheme: (theme) => set({ appTheme: theme }),
      setClientSearch: (v) => set({ clientSearch: v }),
      setClientFilters: (f) => set(s => ({ clientFilters: { ...s.clientFilters, ...f } })),
      setConsultationFilters: (f) => set(s => ({ consultationFilters: { ...s.consultationFilters, ...f } })),

      // ---- UNDO/REDO ----
      _history: [],
      _future: [],

      // "Undo" on the toast of a deletion: only if that deletion is still the
      // last thing in the history (nothing else gets undone by mistake).
      undoDeletion: (type, id) => {
        const last = get()._history[0];
        if (last?.type !== type || last.item?.id !== id) return { ok: false, reason: 'not_last' };
        return get().undo();
      },

      // Returns { ok: true } or { ok: false, reason } when undoing would break
      // data: the blocked entry is dropped so it doesn't stay stuck on top.
      undo: () => {
        const history = get()._history;
        if (!history.length) return { ok: false, reason: 'empty' };
        const [last, ...rest] = history;
        const reason = undoBlockReason(get(), last);
        if (reason) {
          set({ _history: rest });
          return { ok: false, reason };
        }
        // Single set() so every consumer sees a consistent snapshot —
        // previously this fired 2 separate updates and components could
        // observe the item list mutated before the history bookkeeping.
        set(s => {
          const next = {
            _future: [last, ...s._future].slice(0, 20),
            _history: rest,
          };
          if (last.type === 'delete_client')       Object.assign(next, restoreClientDeletion(s, last));
          if (last.type === 'add_client')          next.clients         = s.clients.filter(c => c.id !== last.item.id);
          if (last.type === 'delete_consultation') Object.assign(next, restoreDeletedConsultation(s, last.item));
          if (last.type === 'delete_plan')         next.nutritionPlans  = [last.item, ...s.nutritionPlans];
          if (last.type === 'delete_invoice')      next.invoices        = [last.item, ...s.invoices];
          return next;
        });
        return { ok: true };
      },
      redo: () => {
        const future = get()._future;
        if (!future.length) return;
        const [next, ...rest] = future;
        set(s => {
          const update = {
            _history: [next, ...s._history].slice(0, 20),
            _future: rest,
          };
          if (next.type === 'delete_client')       Object.assign(update, buildClientDeletion(s, next.item.id).patch);
          if (next.type === 'add_client')          update.clients         = [next.item, ...s.clients];
          if (next.type === 'delete_consultation') Object.assign(update, redeleteConsultation(s, next.item));
          if (next.type === 'delete_plan')         update.nutritionPlans  = s.nutritionPlans.filter(p => p.id !== next.item.id);
          if (next.type === 'delete_invoice')      update.invoices        = s.invoices.filter(i => i.id !== next.item.id);
          return update;
        });
      },

      // ---- DIAGNOSTICS ----
      // Last captured runtime error (from ErrorBoundary). Not persisted.
      lastError: null,
      setLastError: (err) => set({ lastError: err }),
      clearLastError: () => set({ lastError: null }),

      // ---- DATA INTEGRITY ----
      integrityWarnings: [],
      smtpPassword: '',
      // Last persistence error (string) or null. Not persisted.
      saveError: null,
      setSmtpPassword: (p) => set({ smtpPassword: p }),

      validateDataIntegrity: () => {
        const { clients, consultations, measurements, nutritionPlans, invoices, services, clientDocuments } = get();
        const clientIds = new Set(clients.map(c => c.id));
        const serviceIds = new Set(services.map(s => s.id));
        const warnings = [];

        const orphanedConsultations = consultations.filter(c => c.clienteId && !clientIds.has(c.clienteId));
        if (orphanedConsultations.length)
          warnings.push({ type: 'orphaned_consultations', count: orphanedConsultations.length, message: `${orphanedConsultations.length} consultas referencian clientes eliminados` });

        const orphanedMeasurements = measurements.filter(m => !clientIds.has(m.clienteId));
        if (orphanedMeasurements.length)
          warnings.push({ type: 'orphaned_measurements', count: orphanedMeasurements.length, message: `${orphanedMeasurements.length} mediciones referencian clientes eliminados` });

        const orphanedPlans = nutritionPlans.filter(p => !clientIds.has(p.clienteId));
        if (orphanedPlans.length)
          warnings.push({ type: 'orphaned_plans', count: orphanedPlans.length, message: `${orphanedPlans.length} planes referencian clientes eliminados` });

        const orphanedInvoices = invoices.filter(i =>
          (i.items || []).some(item => item.servicioId && !serviceIds.has(item.servicioId))
        );
        if (orphanedInvoices.length)
          warnings.push({ type: 'orphaned_invoices', count: orphanedInvoices.length, message: `${orphanedInvoices.length} facturas referencian servicios eliminados` });

        const orphanedDocuments = (clientDocuments || []).filter(d => d.clienteId && !clientIds.has(d.clienteId));
        if (orphanedDocuments.length)
          warnings.push({ type: 'orphaned_documents', count: orphanedDocuments.length, message: `${orphanedDocuments.length} documentos referencian clientes eliminados` });

        set({ integrityWarnings: warnings });
        return warnings;
      },

      // ---- BACKUP ----
      lastBackupDate: null,

      // Once a day, also while the app lives in the tray (useBackgroundJobs
      // calls it every few minutes). Returns { ok, skipped?, error? }.
      runAutoBackup: async () => {
        const today = todayISO();
        const s = get();
        if (s.lastBackupDate === today) return { ok: true, skipped: true };
        // A backup of nothing (e.g. right after "start empty") would push a
        // real one out of the rotation.
        if (!hasData(s)) return { ok: true, skipped: true };
        try {
          const dates = await listAutoBackupDates();
          await invoke('save_data', { key: `backup-${today}`, value: JSON.stringify(backupSnapshot(s)) });
          const keep = [...dates.filter(d => d !== today), today].slice(-7);
          await invoke('save_data', { key: 'backup-manifest', value: JSON.stringify(keep) });
          for (const old of dates.filter(d => !keep.includes(d))) {
            await invoke('delete_data', { key: `backup-${old}` }).catch(() => {});
          }
          set({ lastBackupDate: today });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e?.message || e) };
        }
      },

      // { count, lastDate, dates, safety: { date } | null }
      getAutoBackupInfo: async () => {
        const dates = await listAutoBackupDates().catch(() => []);
        const info = await invoke('load_data', { key: SAFETY_INFO_KEY }).then(JSON.parse).catch(() => null);
        return {
          count: dates.length,
          lastDate: dates.length > 0 ? dates[dates.length - 1] : null,
          dates,
          safety: info?.date ? { date: info.date } : null,
        };
      },

      // Read and check an automatic backup ('YYYY-MM-DD') or the copy taken
      // before the last restore ('safety'). Nothing changes yet.
      loadAutoBackup: async (date) => {
        const key = date === 'safety' ? SAFETY_BACKUP_KEY : `backup-${date}`;
        const raw = await invoke('load_data', { key });
        return readBackup(JSON.parse(raw));
      },

      // Replace the data with a checked backup (from loadAutoBackup or
      // pickBackupFile). The current data is first saved as the safety copy;
      // if that fails nothing is replaced. Returns { keptInvoices }.
      applyBackup: async (backup, { safety = true } = {}) => {
        if (safety) await saveSafetyBackup(get());
        const { patch, keptInvoices } = restoredState(backup.data, get());
        set(patch);
        return { keptInvoices };
      },

      restoreFromAutoBackup: async (date) => get().applyBackup(await get().loadAutoBackup(date)),

      // Returns { saved: false } if the save dialog is cancelled, or
      // { saved: true, skipped } once the file is on disk; a failed write throws
      // (the caller must not report a backup that does not exist).
      exportDataToZip: async (onProgress) => {
        const fileName = `nutripolo-backup-${todayISO()}.zip`;
        let path = null;
        if (isTauri()) {
          const { save } = await import('@tauri-apps/api/dialog');
          path = await save({ filters: [{ name: 'NutriPolo Backup', extensions: ['zip'] }], defaultPath: fileName });
          if (!path) return { saved: false };
        }
        const JSZip = (await import('jszip')).default;
        const { clientDocuments } = get();
        const payload = {
          version: STORE_VERSION,
          exportDate: new Date().toISOString(),
          data: { config: stripGoogleSecrets(get().config), ...backupCollections(get()) },
        };

        const zip = new JSZip();
        zip.file('data.json', JSON.stringify(payload, null, 2));

        // Add document files
        const docs = (clientDocuments || []).filter(d => d.clienteId && d.storedFileName);
        let skipped = 0;
        for (let i = 0; i < docs.length; i++) {
          onProgress?.({ current: i + 1, total: docs.length });
          try {
            const { appDataDir } = await import('@tauri-apps/api/path');
            const base = await appDataDir();
            const filePath = `${base}documents\\${docs[i].clienteId}\\${docs[i].storedFileName}`;
            const b64 = await invoke('read_file_as_base64', { path: filePath });
            const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            zip.file(`documents/${docs[i].clienteId}/${docs[i].storedFileName}`, binary);
          } catch {
            skipped++;
          }
        }

        const zipBytes = await zip.generateAsync({ type: 'uint8array' });

        if (!path) {
          // Browser preview only (npm run dev): plain download
          const url = URL.createObjectURL(new Blob([zipBytes], { type: 'application/zip' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return { saved: true, skipped };
        }
        const { writeBinaryFile } = await import('@tauri-apps/api/fs');
        await writeBinaryFile(path, zipBytes);
        return { saved: true, skipped };
      },

      // Choose a .zip export (or an old .json) and check it. Returns null if
      // the dialog is cancelled; throws BackupError / read errors. Nothing
      // changes until importBackup.
      pickBackupFile: async () => {
        const { open } = await import('@tauri-apps/api/dialog');
        const path = await open({ filters: [{ name: 'NutriPolo Backup', extensions: ['zip', 'json'] }] });
        if (!path) return null;
        const parse = (text) => {
          try { return JSON.parse(text); } catch { throw new BackupError('not_a_backup'); }
        };

        // JSON fallback for old backups
        if (path.toLowerCase().endsWith('.json')) {
          const { readTextFile } = await import('@tauri-apps/api/fs');
          return { ...readBackup(parse(await readTextFile(path))), zip: null, documents: 0 };
        }

        const JSZip = (await import('jszip')).default;
        const { readBinaryFile } = await import('@tauri-apps/api/fs');
        let zip;
        try { zip = await JSZip.loadAsync(await readBinaryFile(path)); } catch { throw new BackupError('not_a_backup'); }
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new BackupError('not_a_backup');
        const backup = readBackup(parse(await dataFile.async('string')));
        const documents = Object.keys(zip.files).filter(f => f.startsWith('documents/') && !zip.files[f].dir).length;
        return { ...backup, zip, documents };
      },

      // Apply a backup from pickBackupFile: safety copy of the current data,
      // then the documents, then the data.
      // Returns { documentsRestored, documentsFailed, keptInvoices }.
      importBackup: async (picked) => {
        await saveSafetyBackup(get());

        // Restore document files through the backend so they are encrypted
        // when at-rest encryption is on. Only `documents/<clientId>/<file>`
        // entries with safe names are accepted.
        const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
        let documentsRestored = 0;
        let documentsFailed = 0;
        const zip = picked.zip;
        const docFiles = zip ? Object.keys(zip.files).filter(f => f.startsWith('documents/') && !zip.files[f].dir) : [];
        for (const filePath of docFiles) {
          const parts = filePath.split('/');
          const [, clienteId, storedFileName] = parts;
          if (parts.length !== 3 || !SAFE_SEGMENT.test(clienteId) || !SAFE_SEGMENT.test(storedFileName)
            || clienteId.includes('..') || storedFileName.includes('..')) {
            documentsFailed++;
            continue;
          }
          try {
            const base64Data = await zip.files[filePath].async('base64');
            await invoke('save_bytes_to_documents', { clientId: clienteId, destFilename: storedFileName, base64Data });
            documentsRestored++;
          } catch (e) {
            documentsFailed++;
            if (import.meta.env.DEV) console.warn('Failed to restore document:', filePath, e);
          }
        }

        const { patch, keptInvoices } = restoredState(picked.data, get());
        set(patch);
        return { documentsRestored, documentsFailed, keptInvoices };
      },

      emailTemplates: null,
    }),
    {
      name: 'nutripolo-storage',
      storage: tauriStorage,
      version: STORE_VERSION,
      // Skip automatic hydration at module load. App.jsx explicitly calls
      // `useStore.persist.rehydrate()` after it has determined whether
      // at-rest encryption is enabled and, if so, once the user has
      // unlocked the vault. Without this the store would fire `getItem`
      // synchronously against a locked encrypted backend, fail silently,
      // and then hydrate with the real data *after* the user has
      // already interacted with the empty default state.
      skipHydration: true,
      migrate: migrateStore,
      // The default merge is shallow, so a persisted `config` would replace
      // the default one wholesale and new config keys would never appear for
      // existing installs. Merge config one level deeper.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
        config: { ...current.config, ...(persisted?.config || {}) },
      }),
      partialize: (s) => {
        // NEVER persist the SMTP password — it lives only in the OS
        // credential store (see store_smtp_password / get_smtp_password).
        // Strip it defensively before Zustand serializes the config.
        // The stripped copy is reused while the config is the same object, so
        // the storage sees it unchanged (see setItem) and does not rewrite it.
        if (s.config !== safeConfigCache.from) {
          let safeConfig = s.config
            ? { ...s.config, smtp: s.config.smtp ? { ...s.config.smtp, password: '' } : s.config.smtp }
            : s.config;
          // Google secrets live in the keyring (see syncGoogleSecrets).
          if (isTauri()) safeConfig = stripGoogleSecrets(safeConfig);
          safeConfigCache.from = s.config;
          safeConfigCache.to = safeConfig;
        }
        return {
          config: safeConfigCache.to,
          clients: s.clients,
          measurements: s.measurements,
          consultations: s.consultations,
          personalEvents: s.personalEvents,
          patientSuggestions: s.patientSuggestions,
          syncAudit: s.syncAudit,
          gcalPendingDeletes: s.gcalPendingDeletes,
          nutritionPlans: s.nutritionPlans,
          services: s.services,
          invoices: s.invoices,
          clientDocuments: s.clientDocuments,
          emailTemplates: s.emailTemplates,
          planLibrary: s.planLibrary,
          lastBackupDate: s.lastBackupDate,
          sentByEvent: s.sentByEvent,
          sidebarCollapsed: s.sidebarCollapsed,
          appTheme: s.appTheme,
          clientFilters: s.clientFilters,
          consultationFilters: s.consultationFilters,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error && !loadFailure) {
          loadFailure = { key: 'nutripolo-storage', error: String(error?.message || error) };
        }
        // Reader calendars can never be bidirectional nor the default push target.
        // Applied with setState (not by mutating `state`) so it re-renders and persists.
        const gc = state?.config?.googleCalendar;
        if (!gc?.calendars) return;
        const isReader = (id) => gc.calendars.some(c => c.id === id && c.accessRole === 'reader');
        const fixMode = gc.calendars.some(c => c.accessRole === 'reader' && c.syncMode === 'bidirectional');
        const fixDefault = !!gc.defaultPushCalendarId && isReader(gc.defaultPushCalendarId);
        if (!fixMode && !fixDefault) return;
        useStore.setState(s => ({
          config: {
            ...s.config,
            googleCalendar: {
              ...s.config.googleCalendar,
              calendars: s.config.googleCalendar.calendars.map(c =>
                c.accessRole === 'reader' && c.syncMode === 'bidirectional' ? { ...c, syncMode: 'disabled' } : c),
              ...(fixDefault ? { defaultPushCalendarId: null } : {}),
            },
          },
        }));
      },
    }
  )
);

export default useStore;
