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
    } catch {
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
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
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

// ============================================
// INVOICE TOTALS COMPUTATION
// ============================================
export function computeInvoiceTotals(items = [], ivaPct = 0, irpfPct = 0) {
  const baseImponible = items.reduce((sum, item) => {
    const qty = parseFloat(item.cantidad) || 0;
    const price = parseFloat(item.precioUnitario) || 0;
    return sum + qty * price;
  }, 0);
  const ivaImporte = Math.round(baseImponible * ivaPct) / 100;
  const irpfImporte = Math.round(baseImponible * irpfPct) / 100;
  const total = baseImponible + ivaImporte - irpfImporte;
  return {
    baseImponible: Math.round(baseImponible * 100) / 100,
    ivaImporte: Math.round(ivaImporte * 100) / 100,
    irpfImporte: Math.round(irpfImporte * 100) / 100,
    total: Math.round(total * 100) / 100,
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
const STORE_VERSION = 6;

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
          const { googleEventId, lastSyncedAt, googleSummary, sourceCalendarId, ...rest } = c;
          return rest;
        }),
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
        set(s => ({ consultations: s.consultations.map(c => c.id === id ? { ...c, ...data, ...extra } : c) }));
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
      invoiceCounter: 0,

      generateInvoiceNumber: () => {
        const counter = (get().invoiceCounter || 0) + 1;
        const year = new Date().getFullYear();
        return `NP-${year}-${String(counter).padStart(3, '0')}`;
      },

      addInvoice: (invoice) => {
        const numero = invoice.numero || get().generateInvoiceNumber();
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
        const match = numero.match(/(\d+)$/);
        const usedCounter = match ? parseInt(match[1], 10) : get().invoiceCounter + 1;
        const newCounter = Math.max(get().invoiceCounter + 1, usedCounter);
        set(s => ({ invoices: [...s.invoices, newI], invoiceCounter: newCounter }));
        return newI;
      },
      updateInvoice: (id, data) => {
        const existing = get().invoices.find(i => i.id === id);
        if (!existing) return;
        const merged = { ...existing, ...data };
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
        const stateUpdate = { invoices: get().invoices.map(i => i.id === id ? updated : i) };
        if (data.numero && data.numero !== existing.numero) {
          const match = data.numero.match(/(\d+)$/);
          if (match) {
            const usedCounter = parseInt(match[1], 10);
            if (usedCounter > get().invoiceCounter) stateUpdate.invoiceCounter = usedCounter;
          }
        }
        set(s => ({ ...stateUpdate }));
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
        set(s => ({ _future: [last, ...s._future].slice(0, 20), _history: rest }));
        if (last.type === 'delete_client')       set(s => ({ clients:         [last.item, ...s.clients] }));
        if (last.type === 'delete_consultation') set(s => ({ consultations:  [last.item, ...s.consultations] }));
        if (last.type === 'delete_plan')         set(s => ({ nutritionPlans: [last.item, ...s.nutritionPlans] }));
        if (last.type === 'delete_invoice')      set(s => ({ invoices:       [last.item, ...s.invoices] }));
        if (last.type === 'delete_document')     set(s => ({ clientDocuments:[last.item, ...s.clientDocuments] }));
      },
      redo: () => {
        const future = get()._future;
        if (!future.length) return;
        const [next, ...rest] = future;
        set(s => ({ _history: [next, ...s._history].slice(0, 20), _future: rest }));
        if (next.type === 'delete_client')       set(s => ({ clients:         s.clients.filter(c => c.id !== next.item.id) }));
        if (next.type === 'delete_consultation') set(s => ({ consultations:  s.consultations.filter(c => c.id !== next.item.id) }));
        if (next.type === 'delete_plan')         set(s => ({ nutritionPlans: s.nutritionPlans.filter(p => p.id !== next.item.id) }));
        if (next.type === 'delete_invoice')      set(s => ({ invoices:       s.invoices.filter(i => i.id !== next.item.id) }));
        if (next.type === 'delete_document')     set(s => ({ clientDocuments:s.clientDocuments.filter(d => d.id !== next.item.id) }));
      },

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
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates } = get();
        const backup = {
          version: STORE_VERSION,
          date: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates },
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
          invoiceCounter: d.invoiceCounter || 0,
          clientDocuments:d.clientDocuments || [],
          emailTemplates: d.emailTemplates || null,
          config: d.config ? { ...get().config, ...d.config } : get().config,
        });
      },

      exportDataToZip: async (onProgress) => {
        const JSZip = (await import('jszip')).default;
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates } = get();
        const payload = {
          version: STORE_VERSION,
          exportDate: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates },
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
            invoiceCounter: d.invoiceCounter || 0,
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
          invoiceCounter: d.invoiceCounter || 0,
          clientDocuments:d.clientDocuments || [],
          emailTemplates: d.emailTemplates || null,
          config: d.config ? { ...get().config, ...d.config } : get().config,
        });

        return { documentsRestored };
      },

      // Legacy — kept for backwards compatibility
      exportDataToJSON: async () => {
        const { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates } = get();
        const data = JSON.stringify({
          version: STORE_VERSION,
          exportDate: new Date().toISOString(),
          data: { config, clients, measurements, consultations, nutritionPlans, services, invoices, invoiceCounter, clientDocuments, emailTemplates },
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
              invoiceCounter: d.invoiceCounter || 0,
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
      migrate: migrateStore,
      partialize: (s) => ({
        config: s.config,
        clients: s.clients,
        measurements: s.measurements,
        consultations: s.consultations,
        nutritionPlans: s.nutritionPlans,
        services: s.services,
        invoices: s.invoices,
        invoiceCounter: s.invoiceCounter,
        clientDocuments: s.clientDocuments,
        emailTemplates: s.emailTemplates,
        lastBackupDate: s.lastBackupDate,
        sidebarCollapsed: s.sidebarCollapsed,
        appTheme: s.appTheme,
        clientFilters: s.clientFilters,
        consultationFilters: s.consultationFilters,
      }),
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
