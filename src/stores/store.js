import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';

// ============================================
// TAURI STORAGE — Write queue amb debounce
// ============================================
const writeQueue = {};
const writeTimers = {};

function flushWrite(name) {
  const value = writeQueue[name];
  if (value === undefined) return;
  delete writeQueue[name];
  invoke('save_data', { key: name, value }).catch(() => {});
}

const tauriStorage = {
  getItem: async (name) => {
    try {
      return await invoke('load_data', { key: name });
    } catch (err) {
      const msg = String(err || '');
      // If the vault is locked we must NOT fall back to localStorage;
      // that would clobber the real data with empty defaults the next
      // time the user saves. Return null so Zustand keeps its defaults
      // and let App.jsx re-trigger rehydration after unlock.
      if (msg.includes('not_unlocked')) {
        return null;
      }
      return localStorage.getItem(name);
    }
  },
  setItem: (name, value) => {
    writeQueue[name] = value;
    clearTimeout(writeTimers[name]);
    writeTimers[name] = setTimeout(() => flushWrite(name), 300);
  },
  removeItem: async (name) => {
    clearTimeout(writeTimers[name]);
    delete writeQueue[name];
    delete writeTimers[name];
    try { await invoke('delete_data', { key: name }); }
    catch { localStorage.removeItem(name); }
  },
};

export function flushAllPending() {
  Object.keys(writeTimers).forEach(name => {
    clearTimeout(writeTimers[name]);
    delete writeTimers[name];
    flushWrite(name);
  });
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

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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

// ============================================
// SCHEMA MIGRATION
// ============================================
const STORE_VERSION = 9;

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
  fontFamily: 'worksans',    // 'worksans' | 'roboto' | 'helvetica'
  logo: null,                // { data: 'data:image/...;base64,...', type: 'png'|'jpg', width, height } | null
  showTagline: true,
  taglineText: 'Nutrición Clínica',
};

function migrateStore(persistedState, version) {
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
    if (!persistedState.state?.config?.invoiceDesign) {
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
  return persistedState;
}

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
        numColegiada: 'CV01944',
        email: 'nutripoloraquel@gmail.com',
        telefono: '+34 622 573 834',
        web: 'https://www.nutripoloraquel.com',
        direccion: '',
        locations: DEFAULT_LOCATIONS,
        consultationTypes: ['Primera visita', 'Seguimiento', 'Revisión', 'Urgencia'],
        defaultConsultationDuration: 45,
        appFont: 'Inter',
        appFontHeading: 'Playfair Display',
        appFontMono: 'JetBrains Mono',
        appTheme: 'auto',
        appLang: 'es',
        invoiceDesign: DEFAULT_INVOICE_DESIGN,
        smtpEnabled: false,
        smtp: null,
        tipoIva: 0,
        emailProvider: 'gmail',
        whatsappCountryCode: '34',
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
      },
      updateConfig: (updates) => set(s => ({ config: { ...s.config, ...updates } })),

      clearGoogleCalendarData: () => set(s => ({
        config: {
          ...s.config,
          googleCalendar: {
            connected: false,
            clientId: '',
            clientSecret: '',
            accessToken: '',
            refreshToken: '',
            expiresAt: 0,
            calendars: [],
            defaultPushCalendarId: null,
            autoSync: false,
            userEmail: '',
          },
        },
        consultations: s.consultations.map(c => {
          if (!c.googleEventId) return c;
          const { googleEventId, lastSyncedAt, googleSummary, sourceCalendarId, remoteUpdated, ...rest } = c;
          return rest;
        }),
        // Personal events come 100% from Google; disconnecting orphans them.
        personalEvents: [],
        // Patient suggestions are generated from external-clinic pulls → same rule.
        patientSuggestions: [],
        syncAudit: { lastFullSyncAt: null, lastSyncStats: {}, massDeleteEvents: [] },
      })),

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
          fechaUltimaConsulta: null,
        };
        set(s => ({
          clients: [...s.clients, newClient],
          _history: [{ type: 'delete_client', item: newClient }, ...s._history].slice(0, 20),
        }));
        return newClient;
      },
      updateClient: (id, data) => set(s => ({
        clients: s.clients.map(c => c.id === id ? { ...c, ...data } : c),
      })),
      deleteClient: (id) => {
        const item = get().clients.find(c => c.id === id);
        set(s => ({
          clients: s.clients.filter(c => c.id !== id),
          _history: [{ type: 'delete_client', item }, ...s._history].slice(0, 20),
          // Cascade: downgrade any pending-confirm suggestions proposing this client
          patientSuggestions: s.patientSuggestions.map(sg => {
            const filteredCandidates = (sg.candidates || []).filter(c => c.clienteId !== id);
            const wasSuggestedClient = sg.suggestedClienteId === id;
            if (!wasSuggestedClient && !(sg.candidates || []).some(c => c.clienteId === id)) return sg;
            return {
              ...sg,
              candidates: filteredCandidates,
              topScore: filteredCandidates[0]?.score ?? null,
              suggestedClienteId: wasSuggestedClient ? null : sg.suggestedClienteId,
              status: (wasSuggestedClient && sg.status === 'pending-confirm')
                ? (filteredCandidates.length > 0 ? 'pending' : 'pending')
                : sg.status,
            };
          }),
          // Cascade: downgrade consultations that pointed to the deleted client
          consultations: s.consultations.map(c => {
            if (c.suggestedClienteId !== id) return c;
            return {
              ...c,
              suggestedClienteId: undefined,
              matchScore: undefined,
              matchStatus: 'suggested',
            };
          }),
        }));
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
        if (newM.clienteId) {
          set(s => ({
            clients: s.clients.map(c =>
              c.id === newM.clienteId ? { ...c, fechaUltimaConsulta: newM.fecha } : c
            ),
          }));
        }
        return newM;
      },
      updateMeasurement: (id, data) => set(s => ({
        measurements: s.measurements.map(m => m.id === id ? { ...m, ...data } : m),
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

      addConsultation: (consultation) => {
        // Detect sync operations the same way updateConsultation does — sync-pulled
        // records must NOT get a fresh localUpdatedAt or they'll be pushed back to
        // Google on the next sync cycle, creating a perpetual loop.
        const isSyncOp = 'lastSyncedAt' in consultation || 'googleEventId' in consultation;
        const newC = {
          ...consultation,
          id: consultation.id || generateId(),
          estado: consultation.estado || 'programada',
          notasPrivadas: consultation.notasPrivadas || '',
          notasCliente: consultation.notasCliente || '',
          ...(isSyncOp ? {} : { localUpdatedAt: new Date().toISOString() }),
        };
        set(s => ({ consultations: [...s.consultations, newC] }));
        if (newC.estado === 'completada' && newC.clienteId) {
          set(s => ({
            clients: s.clients.map(c =>
              c.id === newC.clienteId ? { ...c, fechaUltimaConsulta: newC.fecha } : c
            ),
          }));
        }
        return newC;
      },
      updateConsultation: (id, data) => {
        // Only bump localUpdatedAt for user edits. Sync operations pass lastSyncedAt
        // or googleEventId so we can distinguish them and avoid falsely marking the
        // record as locally newer than Google's copy on the next sync.
        const isSyncOp = 'lastSyncedAt' in data || 'googleEventId' in data;
        const extra = isSyncOp ? {} : { localUpdatedAt: new Date().toISOString() };

        // Hook: if a user manually changes clienteId on a pending-review consultation,
        // flip matchStatus to 'manual' and write audit fields.
        const existing = get().consultations.find(c => c.id === id);
        const isManualClientLink =
          !isSyncOp &&
          'clienteId' in data &&
          data.clienteId &&
          data.clienteId !== existing?.clienteId &&
          existing?.matchStatus &&
          existing.matchStatus !== 'exact' &&
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

        const updated = get().consultations.find(c => c.id === id);
        if (updated?.estado === 'completada' && updated?.clienteId) {
          set(s => ({
            clients: s.clients.map(c =>
              c.id === updated.clienteId ? { ...c, fechaUltimaConsulta: updated.fecha } : c
            ),
          }));
        }
      },
      resetAgenda: (onlyGoogleSynced = false) => set(s => ({
        consultations: onlyGoogleSynced
          ? s.consultations.filter(c => !c.googleEventId)
          : [],
        _history: [],
        _future: [],
      })),

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

      // Attach a consultation ID to a suggestion's consultationIds array
      attachConsultationToSuggestion: (suggestionId, consultationId) => set(s => ({
        patientSuggestions: s.patientSuggestions.map(sg =>
          sg.id === suggestionId
            ? { ...sg, consultationIds: [...(sg.consultationIds || []), consultationId] }
            : sg
        ),
      })),

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

      deleteConsultation: (id) => {
        const item = get().consultations.find(c => c.id === id);
        set(s => ({
          consultations: s.consultations.filter(c => c.id !== id),
          _history: [{ type: 'delete_consultation', item }, ...s._history].slice(0, 20),
        }));
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
        const limitStr = limit.toISOString().slice(0, 10);
        const { consultations, config } = get();
        return filterVisibleConsultations(consultations, config.googleCalendar)
          .filter(c => c.fecha >= today && c.fecha <= limitStr && c.estado === 'programada')
          .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || ''));
      },

      getPendingFollowUps: (days = 30) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return get().clients.filter(c =>
          c.estado === 'activo' &&
          (!c.fechaUltimaConsulta || c.fechaUltimaConsulta < cutoffStr)
        );
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
        }));
      },

      getClientPlans: (clienteId) =>
        get().nutritionPlans
          .filter(p => p.clienteId === clienteId)
          .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || '')),

      getExpiringPlans: (days = 7) => {
        const today = todayISO();
        const limit = new Date();
        limit.setDate(limit.getDate() + days);
        const limitStr = limit.toISOString().slice(0, 10);
        return get().nutritionPlans.filter(p =>
          p.estado === 'activo' && p.fechaFin && p.fechaFin >= today && p.fechaFin <= limitStr
        );
      },

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
      deleteClientDocument: (id) => {
        const item = get().clientDocuments.find(d => d.id === id);
        set(s => ({
          clientDocuments: s.clientDocuments.filter(d => d.id !== id),
          _history: [{ type: 'delete_document', item }, ...s._history].slice(0, 20),
        }));
      },
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

      // Derives the next invoice number from the current invoices list for the
      // active year. Self-healing: tolerates deletions, imports, and year
      // rollovers without needing a persisted counter to stay in sync.
      generateInvoiceNumber: () => {
        const year = new Date().getFullYear();
        const prefix = `NP-${year}-`;
        const invoices = get().invoices || [];
        const maxSeq = invoices.reduce((max, inv) => {
          if (!inv?.numero || !inv.numero.startsWith(prefix)) return max;
          const match = inv.numero.match(/-(\d+)$/);
          if (!match) return max;
          const n = parseInt(match[1], 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
      },

      addInvoice: (invoice) => {
        let numero = invoice.numero || get().generateInvoiceNumber();
        // Defensive: if the caller supplied a number that collides with an
        // existing invoice (e.g. manual edit), regenerate to avoid duplicates.
        if (get().invoices.some(i => i.numero === numero)) {
          console.warn(`[addInvoice] Duplicate invoice number "${numero}" detected, regenerating`);
          numero = get().generateInvoiceNumber();
        }
        const items = invoice.items || [];
        const ivaPct = invoice.ivaPct ?? 0;
        const irpfPct = invoice.irpfPct ?? 0;
        const totals = computeInvoiceTotals(items, ivaPct, irpfPct);
        const newI = {
          ...invoice,
          id: generateId(),
          numero,
          estado: invoice.estado || 'pendiente',
          items,
          ivaPct,
          irpfPct,
          ...totals,
          // backward-compat fields
          concepto: items.map(i => i.descripcion).filter(Boolean).join(', '),
          importe: totals.total,
        };
        set(s => ({ invoices: [...s.invoices, newI] }));
        return newI;
      },
      updateInvoice: (id, data) => {
        const existing = get().invoices.find(i => i.id === id);
        if (!existing) return;
        // Duplicate numero check: reject a change that would collide
        // with another invoice's number (fiscal audit integrity).
        let safeData = data;
        if (data.numero && data.numero !== existing.numero) {
          const dup = get().invoices.some(i => i.id !== id && i.numero === data.numero);
          if (dup) {
            if (import.meta.env.DEV) {
              console.warn(`[updateInvoice] Duplicate numero "${data.numero}" — keeping previous "${existing.numero}"`);
            }
            safeData = { ...data, numero: existing.numero };
          }
        }
        const merged = { ...existing, ...safeData };
        const items = merged.items || [];
        const ivaPct = merged.ivaPct ?? 0;
        const irpfPct = merged.irpfPct ?? 0;
        const totals = computeInvoiceTotals(items, ivaPct, irpfPct);
        const updated = {
          ...merged,
          ...totals,
          concepto: items.map(i => i.descripcion).filter(Boolean).join(', '),
          importe: totals.total,
        };
        set(s => ({ invoices: s.invoices.map(i => i.id === id ? updated : i) }));
      },
      deleteInvoice: (id) => {
        const item = get().invoices.find(i => i.id === id);
        set(s => ({
          invoices: s.invoices.filter(i => i.id !== id),
          _history: [{ type: 'delete_invoice', item }, ...s._history].slice(0, 20),
        }));
      },

      getMonthRevenue: (year, month) => {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        return get().invoices
          .filter(i => i.fecha?.startsWith(prefix) && i.estado === 'pagada')
          .reduce((sum, i) => sum + (i.total || i.importe || 0), 0);
      },

      getUnbilledConsultations: (clienteId) => {
        const { consultations, invoices } = get();
        const billedIds = new Set(
          invoices.flatMap(inv => (inv.items || []).map(item => item.consultationId).filter(Boolean))
        );
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
      planFilters: { estado: 'all', clienteId: 'all' },
      invoiceFilters: { estado: 'all', year: 'all' },

      setCurrentView: (view) => set({ currentView: view }),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setAppTheme: (theme) => set({ appTheme: theme }),
      setClientSearch: (v) => set({ clientSearch: v }),
      setClientFilters: (f) => set(s => ({ clientFilters: { ...s.clientFilters, ...f } })),
      setConsultationFilters: (f) => set(s => ({ consultationFilters: { ...s.consultationFilters, ...f } })),
      setPlanFilters: (f) => set(s => ({ planFilters: { ...s.planFilters, ...f } })),
      setInvoiceFilters: (f) => set(s => ({ invoiceFilters: { ...s.invoiceFilters, ...f } })),

      // ---- UNDO/REDO ----
      _history: [],
      _future: [],

      undo: () => {
        const history = get()._history;
        if (!history.length) return;
        const [last, ...rest] = history;
        // Single set() so every consumer sees a consistent snapshot —
        // previously this fired 2 separate updates and components could
        // observe the item list mutated before the history bookkeeping.
        set(s => {
          const next = {
            _future: [last, ...s._future].slice(0, 20),
            _history: rest,
          };
          if (last.type === 'delete_client')       next.clients         = [last.item, ...s.clients];
          if (last.type === 'delete_consultation') next.consultations   = [last.item, ...s.consultations];
          if (last.type === 'delete_plan')         next.nutritionPlans  = [last.item, ...s.nutritionPlans];
          if (last.type === 'delete_invoice')      next.invoices        = [last.item, ...s.invoices];
          if (last.type === 'delete_document')     next.clientDocuments = [last.item, ...s.clientDocuments];
          return next;
        });
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
          if (next.type === 'delete_client')       update.clients         = s.clients.filter(c => c.id !== next.item.id);
          if (next.type === 'delete_consultation') update.consultations   = s.consultations.filter(c => c.id !== next.item.id);
          if (next.type === 'delete_plan')         update.nutritionPlans  = s.nutritionPlans.filter(p => p.id !== next.item.id);
          if (next.type === 'delete_invoice')      update.invoices        = s.invoices.filter(i => i.id !== next.item.id);
          if (next.type === 'delete_document')     update.clientDocuments = s.clientDocuments.filter(d => d.id !== next.item.id);
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
      isLoading: false,
      smtpPassword: '',
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

      runAutoBackup: async () => {
        const today = todayISO();
        if (get().lastBackupDate === today) return;
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates } = get();
        const backup = {
          version: STORE_VERSION,
          date: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates },
        };
        try {
          const manifestRaw = await invoke('load_data', { key: 'backup-manifest' }).catch(() => null);
          const manifest = manifestRaw ? JSON.parse(manifestRaw) : [];
          await invoke('save_data', { key: `backup-${today}`, value: JSON.stringify(backup) });
          const newManifest = [...manifest.filter(d => d !== today), today].slice(-7);
          await invoke('save_data', { key: 'backup-manifest', value: JSON.stringify(newManifest) });
          for (const old of manifest.slice(0, Math.max(0, manifest.length - 6))) {
            await invoke('delete_data', { key: `backup-${old}` }).catch(() => {});
          }
          set({ lastBackupDate: today });
        } catch (e) { if (import.meta.env.DEV) console.warn('Backup failed:', e); }
      },

      getAutoBackupInfo: async () => {
        try {
          const manifestRaw = await invoke('load_data', { key: 'backup-manifest' }).catch(() => null);
          const manifest = manifestRaw ? JSON.parse(manifestRaw) : [];
          return { count: manifest.length, lastDate: manifest.length > 0 ? manifest[manifest.length - 1] : null, dates: manifest };
        } catch { return { count: 0, lastDate: null, dates: [] }; }
      },

      restoreFromAutoBackup: async (date) => {
        const raw = await invoke('load_data', { key: `backup-${date}` });
        const parsed = JSON.parse(raw);
        const d = parsed.data || parsed;
        set({
          clients:        d.clients        || [],
          measurements:   d.measurements   || [],
          consultations:  d.consultations  || [],
          nutritionPlans: d.nutritionPlans || [],
          services:       d.services       || DEFAULT_SERVICES,
          invoices:       d.invoices       || [],
          clientDocuments:d.clientDocuments || [],
          emailTemplates: d.emailTemplates || null,
          config: d.config ? { ...get().config, ...d.config } : get().config,
        });
      },

      exportDataToZip: async (onProgress) => {
        const JSZip = (await import('jszip')).default;
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates } = get();
        const payload = {
          version: STORE_VERSION,
          exportDate: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates },
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

        try {
          const { save } = await import('@tauri-apps/api/dialog');
          const { writeBinaryFile } = await import('@tauri-apps/api/fs');
          const path = await save({ filters: [{ name: 'NutriPolo Backup', extensions: ['zip'] }], defaultPath: `nutripolo-backup-${todayISO()}.zip` });
          if (path) {
            await writeBinaryFile(path, zipBytes);
          }
        } catch {
          const blob = new Blob([zipBytes], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `nutripolo-backup-${todayISO()}.zip`;
          a.click();
          URL.revokeObjectURL(url);
        }

        return { skipped };
      },

      importDataFromZip: async () => {
        const { open } = await import('@tauri-apps/api/dialog');
        const path = await open({ filters: [{ name: 'NutriPolo Backup', extensions: ['zip', 'json'] }] });
        if (!path) return null;

        // JSON fallback for old backups
        if (path.endsWith('.json')) {
          const { readTextFile } = await import('@tauri-apps/api/fs');
          const raw = await readTextFile(path);
          const parsed = JSON.parse(raw);
          const d = parsed.data || parsed;
          set({
            clients:        d.clients        || [],
            measurements:   d.measurements   || [],
            consultations:  d.consultations  || [],
            nutritionPlans: d.nutritionPlans || [],
            services:       d.services       || DEFAULT_SERVICES,
            invoices:       d.invoices       || [],
            clientDocuments:d.clientDocuments || [],
            emailTemplates: d.emailTemplates || null,
            config: d.config ? { ...get().config, ...d.config } : get().config,
          });
          return { documentsRestored: 0 };
        }

        // ZIP import
        const JSZip = (await import('jszip')).default;
        const { readBinaryFile, writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
        const { appDataDir } = await import('@tauri-apps/api/path');

        const zipBytes = await readBinaryFile(path);
        const zip = await JSZip.loadAsync(zipBytes);

        // Restore data.json
        const dataFile = zip.file('data.json');
        if (!dataFile) throw new Error('Invalid backup: data.json not found');
        const dataRaw = await dataFile.async('string');
        const parsed = JSON.parse(dataRaw);
        const d = parsed.data || parsed;

        // Restore document files
        const base = await appDataDir();
        let documentsRestored = 0;
        const docFiles = Object.keys(zip.files).filter(f => f.startsWith('documents/') && !zip.files[f].dir);
        for (const filePath of docFiles) {
          try {
            const parts = filePath.split('/');
            if (parts.length < 3) continue;
            const clienteId = parts[1];
            const storedFileName = parts.slice(2).join('/');
            const dirPath = `${base}documents\\${clienteId}`;
            await createDir(dirPath, { recursive: true });
            const content = await zip.files[filePath].async('uint8array');
            await writeBinaryFile(`${dirPath}\\${storedFileName}`, content);
            documentsRestored++;
          } catch (e) {
            if (import.meta.env.DEV) console.warn('Failed to restore document:', filePath, e);
          }
        }

        // Apply data to store
        set({
          clients:        d.clients        || [],
          measurements:   d.measurements   || [],
          consultations:  d.consultations  || [],
          nutritionPlans: d.nutritionPlans || [],
          services:       d.services       || DEFAULT_SERVICES,
          invoices:       d.invoices       || [],
          clientDocuments:d.clientDocuments || [],
          emailTemplates: d.emailTemplates || null,
          config: d.config ? { ...get().config, ...d.config } : get().config,
        });

        return { documentsRestored };
      },

      // Legacy — kept for backwards compatibility
      exportDataToJSON: async () => {
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates } = get();
        const data = JSON.stringify({
          version: STORE_VERSION,
          exportDate: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, clientDocuments, emailTemplates },
        }, null, 2);
        try {
          const { save } = await import('@tauri-apps/api/dialog');
          const { writeBinaryFile } = await import('@tauri-apps/api/fs');
          const path = await save({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: `nutripolo-backup-${todayISO()}.json` });
          if (path) {
            const encoder = new TextEncoder();
            await writeBinaryFile(path, encoder.encode(data));
          }
        } catch {
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `nutripolo-backup-${todayISO()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      },

      importDataFromJSON: async (mode = 'replace') => {
        try {
          const { open } = await import('@tauri-apps/api/dialog');
          const { readTextFile } = await import('@tauri-apps/api/fs');
          const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
          if (!path) return;
          const raw = await readTextFile(path);
          const parsed = JSON.parse(raw);
          const d = parsed.data || parsed;
          if (mode === 'replace') {
            set({
              clients:        d.clients        || [],
              measurements:   d.measurements   || [],
              consultations:  d.consultations  || [],
              nutritionPlans: d.nutritionPlans || [],
              services:       d.services       || DEFAULT_SERVICES,
              invoices:       d.invoices       || [],
              clientDocuments:d.clientDocuments || [],
              emailTemplates: d.emailTemplates || null,
              config: d.config ? { ...get().config, ...d.config } : get().config,
            });
          } else {
            set(s => ({
              clients:        [...s.clients,        ...(d.clients        || []).filter(c => !s.clients.find(x => x.id === c.id))],
              measurements:   [...s.measurements,   ...(d.measurements   || []).filter(m => !s.measurements.find(x => x.id === m.id))],
              consultations:  [...s.consultations,  ...(d.consultations  || []).filter(c => !s.consultations.find(x => x.id === c.id))],
              nutritionPlans: [...s.nutritionPlans, ...(d.nutritionPlans || []).filter(p => !s.nutritionPlans.find(x => x.id === p.id))],
              invoices:       [...s.invoices,       ...(d.invoices       || []).filter(i => !s.invoices.find(x => x.id === i.id))],
              clientDocuments:[...s.clientDocuments, ...(d.clientDocuments|| []).filter(d2=> !s.clientDocuments.find(x => x.id === d2.id))],
            }));
          }
        } catch (e) { throw e; }
      },

      emailTemplates: null,
    }),
    {
      name: 'nutripolo-storage',
      storage: createJSONStorage(() => tauriStorage),
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
      partialize: (s) => {
        // NEVER persist the SMTP password — it lives only in the OS
        // credential store (see store_smtp_password / get_smtp_password).
        // Strip it defensively before Zustand serializes the config.
        const safeConfig = s.config
          ? { ...s.config, smtp: s.config.smtp ? { ...s.config.smtp, password: '' } : s.config.smtp }
          : s.config;
        return {
          config: safeConfig,
          clients: s.clients,
          measurements: s.measurements,
          consultations: s.consultations,
          personalEvents: s.personalEvents,
          patientSuggestions: s.patientSuggestions,
          syncAudit: s.syncAudit,
          nutritionPlans: s.nutritionPlans,
          services: s.services,
          invoices: s.invoices,
          clientDocuments: s.clientDocuments,
          emailTemplates: s.emailTemplates,
          lastBackupDate: s.lastBackupDate,
          sidebarCollapsed: s.sidebarCollapsed,
          appTheme: s.appTheme,
          clientFilters: s.clientFilters,
          consultationFilters: s.consultationFilters,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoading = false;
          // Sanitize reader-only calendars — never allow bidirectional on reader calendars
          const gc = state.config?.googleCalendar;
          if (gc?.calendars) {
            let dirty = false;
            const sanitized = gc.calendars.map(c => {
              if (c.accessRole === 'reader' && c.syncMode === 'bidirectional') {
                dirty = true;
                return { ...c, syncMode: 'disabled' };
              }
              return c;
            });
            if (dirty) gc.calendars = sanitized;
            // Clear default if it points to a reader calendar
            if (gc.defaultPushCalendarId) {
              const def = gc.calendars.find(c => c.id === gc.defaultPushCalendarId);
              if (def?.accessRole === 'reader') gc.defaultPushCalendarId = null;
            }
          }
        }
      },
    }
  )
);

export default useStore;
