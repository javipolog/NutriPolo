import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { save as tauriSaveDialog, open as tauriOpenDialog } from '@tauri-apps/api/dialog';
import { writeBinaryFile, readTextFile } from '@tauri-apps/api/fs';

// Default configuration
const defaultConfig = {
  nombre: 'Javier Polo García',
  nif: '46088365E',
  direccion: 'Carrer Gandia 17, baix dreta\n46007 (VALÈNCIA)',
  email: 'polo@javipolo.com',
  telefono: '635248644',
  web: 'javipolo.com',
  iban: 'ES75 0182 3033 1102 0152 4582',
  tipoIva: 21,
  tipoIrpf: 15,
  idiomaDefecto: 'es',
  expensesFolder: '',
  appFont: 'Inter'
};

// ============================================
// WRITE QUEUE AMB DEBOUNCE (#3)
// Evita race conditions quan el watcher i l'usuari escriuen simultàniament
// ============================================
const writeQueue = {};
const writeTimers = {};

const flushWrite = async (name, value) => {
  try {
    await invoke('save_data', { key: name, value });
  } catch (e) {
    console.error('Failed to save:', e);
  }
};

// Custom storage adapter for Tauri amb write queue
const tauriStorage = {
  getItem: async (name) => {
    try {
      const data = await invoke('load_data', { key: name });
      return data;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    // Cancel timer anterior per a aquesta clau
    if (writeTimers[name]) clearTimeout(writeTimers[name]);
    writeQueue[name] = value;
    // Debounce 300ms: si arriben múltiples escriptures ràpides, només es fa l'última
    writeTimers[name] = setTimeout(() => {
      const val = writeQueue[name];
      delete writeQueue[name];
      delete writeTimers[name];
      flushWrite(name, val);
    }, 300);
  },
  removeItem: async (name) => {
    // Cancelar qualsevol escriptura pendent
    if (writeTimers[name]) clearTimeout(writeTimers[name]);
    delete writeQueue[name];
    delete writeTimers[name];
    try {
      await invoke('delete_data', { key: name });
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  },
};

// Fallback to localStorage if Tauri is not available
const storage = window.__TAURI__ ? createJSONStorage(() => tauriStorage) : createJSONStorage(() => localStorage);

// ============================================
// MIGRACIÓ D'ESQUEMA (#21)
// v0 → v1: normalitzar tipus numèrics i recalcular ivaImporte
// v1 → v2: Fase 3 - tipoDocumento, pagos, plantilles recurrents, rectificatives
// ============================================
const migrateStore = (persistedState, version) => {
  let state = persistedState;

  if (version < 1) {
    state = {
      ...state,
      invoices: (state.invoices || []).map(inv => ({
        ...inv,
        ivaPorcentaje: Number(inv.ivaPorcentaje) || 21,
        irpfPorcentaje: Number(inv.irpfPorcentaje) || 15,
        iva: Number(inv.iva) || 0,
        irpf: Number(inv.irpf) || 0,
        total: Number(inv.total) || 0,
        subtotal: Number(inv.subtotal) || 0,
      })),
      expenses: (state.expenses || []).map(exp => ({
        ...exp,
        baseImponible: Number(exp.baseImponible) || 0,
        ivaPorcentaje: Number(exp.ivaPorcentaje) || 0,
        ivaImporte: parseFloat(
          (parseFloat(exp.baseImponible || 0) * (parseFloat(exp.ivaPorcentaje || 0) / 100)).toFixed(2)
        ),
        total: Number(exp.total) || 0,
      })),
      invoiceCounters: state.invoiceCounters || {},
    };
  }

  if (version < 2) {
    // Afegir nous camps a totes les factures/documents existents
    state = {
      ...state,
      invoices: (state.invoices || []).map(inv => ({
        ...inv,
        tipoDocumento: inv.tipoDocumento || 'factura',
        pagos: inv.pagos || [],
        esPlantilla: inv.esPlantilla || false,
        periodicidad: inv.periodicidad || null,
        proximaFecha: inv.proximaFecha || null,
        rectificadaId: inv.rectificadaId || null,
      })),
    };
  }

  if (version < 3) {
    // Migrar expenses antics: `deducible` → `deducibleIrpf` + `deducibleIva`
    state = {
      ...state,
      expenses: (state.expenses || []).map(exp => ({
        ...exp,
        deducibleIrpf: exp.deducibleIrpf ?? exp.deducible ?? true,
        deducibleIva:  exp.deducibleIva  ?? exp.deducible ?? true,
      })),
    };
  }

  return state;
};

// Main store
export const useStore = create(
  persist(
    (set, get) => ({
      // Config
      config: defaultConfig,
      setConfig: (config) => set({ config }),

      // Clients
      clients: [],
      setClients: (clients) => set({ clients }),
      addClient: (client) => set((state) => ({ clients: [...state.clients, client] })),
      updateClient: (id, data) => set((state) => ({
        clients: state.clients.map((c) => (c.id === id ? { ...c, ...data } : c))
      })),
      deleteClient: (id) => set((state) => {
        const item = state.clients.find(c => c.id === id);
        return {
          clients: state.clients.filter((c) => c.id !== id),
          _history: item ? [...state._history.slice(-19), { type: 'delete_client', item }] : state._history,
          _future: [],
        };
      }),

      // Invoices i documents (facturas, presupuestos, rectificatives)
      invoices: [],
      invoiceCounters: {}, // Comptador persistent per sèrie (mai decreix): { "YY_COD": lastSeq, "P-YY_COD": lastSeq, "R-YY_COD": lastSeq }
      setInvoices: (invoices) => set({ invoices }),
      addInvoice: (invoice) => set((state) => {
        // Actualitzar el comptador de sèrie al crear document nou
        const parts = (invoice.numero || '').split('_');
        let newCounters = state.invoiceCounters;
        if (parts.length >= 3) {
          const seq = parseInt(parts[parts.length - 1], 10);
          const series = parts.slice(0, -1).join('_');
          if (!isNaN(seq) && series) {
            newCounters = { ...state.invoiceCounters, [series]: Math.max(state.invoiceCounters[series] || 0, seq) };
          }
        }
        return { invoices: [...state.invoices, invoice], invoiceCounters: newCounters };
      }),
      updateInvoice: (id, data) => set((state) => ({
        invoices: state.invoices.map((i) => (i.id === id ? { ...i, ...data } : i))
      })),
      deleteInvoice: (id) => set((state) => {
        const item = state.invoices.find(i => i.id === id);
        return {
          invoices: state.invoices.filter((i) => i.id !== id),
          _history: item ? [...state._history.slice(-19), { type: 'delete_invoice', item }] : state._history,
          _future: [],
        };
      }),

      // Pagaments parcials (#11): afegir o eliminar pagaments d'una factura
      addPago: (invoiceId, pago) => set((state) => ({
        invoices: state.invoices.map((inv) => {
          if (inv.id !== invoiceId) return inv;
          const pagos = [...(inv.pagos || []), { ...pago, id: generateId() }];
          const totalPagado = pagos.reduce((sum, p) => sum + (Number(p.importe) || 0), 0);
          const estado = totalPagado >= (inv.total || 0) ? 'pagada'
            : totalPagado > 0 ? 'parcial'
            : inv.estado;
          return {
            ...inv, pagos, estado,
            fechaPago: estado === 'pagada' ? new Date().toISOString().split('T')[0] : inv.fechaPago,
          };
        })
      })),
      deletePago: (invoiceId, pagoId) => set((state) => ({
        invoices: state.invoices.map((inv) => {
          if (inv.id !== invoiceId) return inv;
          const pagos = (inv.pagos || []).filter(p => p.id !== pagoId);
          const totalPagado = pagos.reduce((sum, p) => sum + (Number(p.importe) || 0), 0);
          const estado = totalPagado >= (inv.total || 0) ? 'pagada'
            : totalPagado > 0 ? 'parcial'
            : 'emitida';
          return { ...inv, pagos, estado };
        })
      })),

      // Rectificatives (#7): crea una factura rectificativa (negativa) referenciada a l'original
      createRectificativa: (invoiceId) => {
        const state = get();
        const original = state.invoices.find(i => i.id === invoiceId);
        if (!original) return null;

        const today = new Date().toISOString().split('T')[0];
        const rectNum = generateDocumentNumber('R', state.clients, state.invoices, original.clienteId, today, state.invoiceCounters);

        const rectificativa = {
          ...original,
          id: generateId(),
          numero: rectNum,
          tipoDocumento: 'rectificativa',
          rectificadaId: invoiceId,
          fecha: today,
          fechaFin: '',
          fechaFacturacion: '',
          estado: 'borrador',
          pagos: [],
          esPlantilla: false,
          periodicidad: null,
          proximaFecha: null,
          subtotal: -(original.subtotal || 0),
          iva: -(original.iva || 0),
          irpf: -(original.irpf || 0),
          total: -(original.total || 0),
          baseImponible: original.tipo === 'classic' ? -(original.baseImponible || 0) : original.baseImponible,
          concepto: `Rectificativa de ${original.numero}: ${original.concepto}`,
        };

        const parts = rectNum.split('_');
        const series = parts.slice(0, -1).join('_');
        const seq = parseInt(parts[parts.length - 1], 10);

        set((s) => ({
          invoices: [...s.invoices, rectificativa],
          invoiceCounters: { ...s.invoiceCounters, [series]: Math.max(s.invoiceCounters[series] || 0, seq) },
        }));
        return rectificativa;
      },

      // Plantilles recurrents (#8): genera una factura nova a partir d'una plantilla
      generateFromTemplate: (templateId) => {
        const state = get();
        const template = state.invoices.find(i => i.id === templateId);
        if (!template || !template.esPlantilla) return null;

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const numero = generateInvoiceNumber(state.clients, state.invoices, template.clienteId, todayStr, state.invoiceCounters);

        const newInvoice = {
          ...template,
          id: generateId(),
          numero,
          tipoDocumento: 'factura',
          esPlantilla: false,
          periodicidad: null,
          proximaFecha: null,
          rectificadaId: null,
          fecha: todayStr,
          fechaFin: '',
          fechaFacturacion: '',
          estado: 'borrador',
          pagos: [],
        };

        // Calcular la pròxima data de generació per a la plantilla
        let proxima = new Date(today);
        if (template.periodicidad === 'mensual') proxima.setMonth(proxima.getMonth() + 1);
        else if (template.periodicidad === 'trimestral') proxima.setMonth(proxima.getMonth() + 3);
        else if (template.periodicidad === 'semestral') proxima.setMonth(proxima.getMonth() + 6);
        else if (template.periodicidad === 'anual') proxima.setFullYear(proxima.getFullYear() + 1);

        const parts = numero.split('_');
        const series = parts.slice(0, -1).join('_');
        const seq = parseInt(parts[parts.length - 1], 10);

        set((s) => ({
          invoices: [
            ...s.invoices.map(i => i.id === templateId
              ? { ...i, proximaFecha: proxima.toISOString().split('T')[0] }
              : i
            ),
            newInvoice,
          ],
          invoiceCounters: { ...s.invoiceCounters, [series]: Math.max(s.invoiceCounters[series] || 0, seq) },
        }));
        return newInvoice;
      },

      // Convertir pressupost a factura (#9)
      convertPresupuestoToFactura: (presupuestoId) => {
        const state = get();
        const presupuesto = state.invoices.find(i => i.id === presupuestoId);
        if (!presupuesto || presupuesto.tipoDocumento !== 'presupuesto') return null;

        const today = new Date().toISOString().split('T')[0];
        const numero = generateInvoiceNumber(state.clients, state.invoices, presupuesto.clienteId, today, state.invoiceCounters);

        const parts = numero.split('_');
        const series = parts.slice(0, -1).join('_');
        const seq = parseInt(parts[parts.length - 1], 10);

        set((s) => ({
          invoices: s.invoices.map(i => i.id === presupuestoId ? {
            ...i,
            tipoDocumento: 'factura',
            numero,
            fecha: today,
            estado: 'borrador',
            pagos: [],
            rectificadaId: null,
          } : i),
          invoiceCounters: { ...s.invoiceCounters, [series]: Math.max(s.invoiceCounters[series] || 0, seq) },
        }));
        return numero;
      },

      // Expenses
      expenses: [],
      setExpenses: (expenses) => set({ expenses }),
      addExpense: (expense) => set((state) => ({ expenses: [...state.expenses, expense] })),
      updateExpense: (id, data) => set((state) => ({
        expenses: state.expenses.map((e) => (e.id === id ? { ...e, ...data } : e))
      })),
      deleteExpense: (id) => set((state) => {
        const item = state.expenses.find(e => e.id === id);
        return {
          expenses: state.expenses.filter((e) => e.id !== id),
          _history: item ? [...state._history.slice(-19), { type: 'delete_expense', item }] : state._history,
          _future: [],
        };
      }),
      deleteExpenses: (ids) => set((state) => {
        const idSet = new Set(ids);
        const items = state.expenses.filter(e => idSet.has(e.id));
        return {
          expenses: state.expenses.filter((e) => !idSet.has(e.id)),
          _history: items.length > 0 ? [...state._history.slice(-19), { type: 'delete_expenses', items }] : state._history,
          _future: [],
        };
      }),

      // UI State
      currentView: 'dashboard',
      setCurrentView: (view) => set({ currentView: view }),

      // Sidebar col·lapsable (#20)
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      // Columnes visibles a la taula de factures (#18)
      invoiceVisibleColumns: {
        cod: true, work: true, cliente: true,
        importe: false, iva: false, irpf: false,
        total: true, pagado: true, pendiente: true,
        status: true, fecha: true,
      },
      setInvoiceVisibleColumns: (cols) => set({ invoiceVisibleColumns: cols }),

      // Tema de l'app (#19): 'dark' | 'light' | 'auto'
      appTheme: 'dark',
      setAppTheme: (theme) => set({ appTheme: theme }),

      // Undo/Redo (#16): stack d'operacions reversibles (no persistit)
      _history: [],
      _future: [],
      undo: () => set((state) => {
        if (state._history.length === 0) return {};
        const last = state._history[state._history.length - 1];
        const newHistory = state._history.slice(0, -1);
        const newFuture = [...state._future, last];
        let updates = { _history: newHistory, _future: newFuture };
        switch (last.type) {
          case 'delete_invoice':
            updates.invoices = [...state.invoices, last.item];
            break;
          case 'delete_client':
            updates.clients = [...state.clients, last.item];
            break;
          case 'delete_expense': {
            updates.expenses = [...state.expenses, last.item];
            break;
          }
          case 'delete_expenses': {
            const existingIds = new Set(state.expenses.map(e => e.id));
            updates.expenses = [...state.expenses, ...last.items.filter(i => !existingIds.has(i.id))];
            break;
          }
        }
        return updates;
      }),
      redo: () => set((state) => {
        if (state._future.length === 0) return {};
        const next = state._future[state._future.length - 1];
        const newFuture = state._future.slice(0, -1);
        const newHistory = [...state._history, next];
        let updates = { _history: newHistory, _future: newFuture };
        switch (next.type) {
          case 'delete_invoice':
            updates.invoices = state.invoices.filter(i => i.id !== next.item.id);
            break;
          case 'delete_client':
            updates.clients = state.clients.filter(c => c.id !== next.item.id);
            break;
          case 'delete_expense':
            updates.expenses = state.expenses.filter(e => e.id !== next.item.id);
            break;
          case 'delete_expenses': {
            const ids = new Set(next.items.map(i => i.id));
            updates.expenses = state.expenses.filter(e => !ids.has(e.id));
            break;
          }
        }
        return updates;
      }),

      // Filters & Search Memory
      invoiceSearch: '',
      setInvoiceSearch: (invoiceSearch) => set({ invoiceSearch }),
      invoiceFilters: {
        status: 'all',
        client: 'all',
        year: new Date().getFullYear().toString(),
        month: 'all'
      },
      setInvoiceFilters: (invoiceFilters) => set({ invoiceFilters }),

      invoiceSortConfig: { key: 'fecha', direction: 'desc' },
      setInvoiceSortConfig: (invoiceSortConfig) => set({ invoiceSortConfig }),

      expenseSortConfig: { key: 'fecha', direction: 'desc' },
      setExpenseSortConfig: (expenseSortConfig) => set({ expenseSortConfig }),

      expenseSearch: '',
      setExpenseSearch: (expenseSearch) => set({ expenseSearch }),
      expenseFilters: {
        year: new Date().getFullYear().toString(),
        period: 'all',
        category: 'all',
        groupBy: 'none'
      },
      setExpenseFilters: (expenseFilters) => set({ expenseFilters }),

      dashboardFilters: {
        year: new Date().getFullYear(),
        quarter: 'all'
      },
      setDashboardFilters: (dashboardFilters) => set({ dashboardFilters }),

      dashboardConfig: {
        showStats: true,
        showMainChart: true,
        showAlerts: true,
        showDistribution: true,
        showClients: true,
        showRecent: true
      },
      setDashboardConfig: (updater) => set((state) => {
        const defaultDashboardConfig = {
          showStats: true,
          showMainChart: true,
          showAlerts: true,
          showDistribution: true,
          showClients: true,
          showRecent: true,
        };
        const next = typeof updater === 'function'
          ? updater(state.dashboardConfig)
          : updater;
        return { dashboardConfig: { ...defaultDashboardConfig, ...next } };
      }),

      // Backup
      lastBackupDate: null,
      setLastBackupDate: (date) => set({ lastBackupDate: date }),

      // Integritat de dades (no persistit, es recalcula al boot)
      integrityWarnings: [],
      setIntegrityWarnings: (warnings) => set({ integrityWarnings: warnings }),

      // Loading state
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'contabilidad-storage',
      storage,
      version: 3,
      migrate: migrateStore,
      partialize: (state) => ({
        config: state.config,
        clients: state.clients,
        invoices: state.invoices,
        invoiceCounters: state.invoiceCounters,
        expenses: state.expenses,
        invoiceSearch: state.invoiceSearch,
        invoiceFilters: state.invoiceFilters,
        invoiceSortConfig: state.invoiceSortConfig,
        expenseSortConfig: state.expenseSortConfig,
        expenseSearch: state.expenseSearch,
        expenseFilters: state.expenseFilters,
        dashboardFilters: state.dashboardFilters,
        dashboardConfig: state.dashboardConfig,
        lastBackupDate: state.lastBackupDate,
        sidebarCollapsed: state.sidebarCollapsed,
        invoiceVisibleColumns: state.invoiceVisibleColumns,
        appTheme: state.appTheme,
      }),
    }
  )
);

// Utility functions
export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

export const formatCurrency = (num) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(Number(num) || 0) + '€';

export const formatDate = (date) => new Date(date).toLocaleDateString('es-ES');

export const formatDateShort = (date) => {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
};

export const generateClientCode = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z\s]/g, '').split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 'XXX';
  if (words.length === 1) return words[0].slice(0, 3);
  return words.slice(0, 3).map((w) => w[0]).join('');
};

export const generateInvoiceNumber = (clients, invoices, clientId, date, counters = {}) => {
  const year = new Date(date).getFullYear().toString().slice(-2);
  const client = clients.find((c) => c.id === clientId);

  let code = 'XXX';
  if (client) {
    if (client.codigo && client.codigo.length === 3) {
      code = client.codigo;
    } else if (client.nombre) {
      code = generateClientCode(client.nombre);
    }
  }

  const series = `${year}_${code}`;
  const persistentMax = counters[series] || 0;

  const existingMax = invoices.reduce((max, i) => {
    if (!i.numero) return max;
    const parts = i.numero.split('_');
    if (parts.length < 3) return max;
    const invSeries = parts.slice(0, -1).join('_');
    if (invSeries !== series) return max;
    const seq = parseInt(parts[parts.length - 1], 10);
    return isNaN(seq) ? max : Math.max(max, seq);
  }, 0);

  const nextSeq = Math.max(persistentMax, existingMax) + 1;
  return `${series}_${String(nextSeq).padStart(3, '0')}`;
};

export const calcularFactura = (tipo, data, ivaPct = 21, irpfPct = 15) => {
  const subtotal = tipo === 'classic' ? (data.baseImponible || 0) : (data.jornadas || 0) * (data.tarifaDia || 0);
  const iva = subtotal * (ivaPct / 100);
  const irpf = subtotal * (irpfPct / 100);
  const total = subtotal + iva - irpf;
  return { subtotal, iva, irpf, total };
};

export const getQuarter = (date) => Math.ceil((new Date(date).getMonth() + 1) / 3);

export const distributeInvoiceByMonth = (invoice, field = 'subtotal') => {
  const amount = invoice[field] || 0;
  const start = new Date(invoice.fecha);
  const distribution = {};

  if (!invoice.fechaFin || invoice.fechaFin === invoice.fecha) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  const end = new Date(invoice.fechaFin);

  if (end < start) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (totalDays <= 0) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  let cursor = new Date(start);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const key = `${year}-${month}`;

    const monthStart = (cursor.getFullYear() === start.getFullYear() && cursor.getMonth() === start.getMonth())
      ? start.getDate()
      : 1;

    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const monthEnd = (year === end.getFullYear() && month === end.getMonth())
      ? end.getDate()
      : lastDayOfMonth;

    const daysInThisMonth = monthEnd - monthStart + 1;
    distribution[key] = (daysInThisMonth / totalDays) * amount;

    cursor = new Date(year, month + 1, 1);
  }

  return distribution;
};

export const defaultCategories = [
  'Material de oficina',
  'Software y suscripciones',
  'Equipos informáticos',
  'Telecomunicaciones',
  'Transporte',
  'Formación',
  'Seguros',
  'Gestoría y asesoría',
  'Marketing y publicidad',
  'Suministros',
  'Servicios profesionales',
  'Otros'
];

// ============================================
// VALIDACIONS NIF/CIF/IBAN
// ============================================

export const validateNIF = (nif) => {
  if (!nif) return false;
  const clean = nif.toUpperCase().replace(/[\s-]/g, '');

  const nifRegex = /^[0-9]{8}[A-Z]$/;
  if (nifRegex.test(clean)) {
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    const number = parseInt(clean.substring(0, 8), 10);
    const expectedLetter = letters[number % 23];
    return clean[8] === expectedLetter;
  }

  const nieRegex = /^[XYZ][0-9]{7}[A-Z]$/;
  if (nieRegex.test(clean)) {
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    let nieNumber = clean.substring(1, 8);
    if (clean[0] === 'X') nieNumber = '0' + nieNumber;
    else if (clean[0] === 'Y') nieNumber = '1' + nieNumber;
    else if (clean[0] === 'Z') nieNumber = '2' + nieNumber;
    const number = parseInt(nieNumber, 10);
    const expectedLetter = letters[number % 23];
    return clean[8] === expectedLetter;
  }

  return false;
};

export const validateCIF = (cif) => {
  if (!cif) return false;
  const clean = cif.toUpperCase().replace(/[\s-]/g, '');

  const cifRegex = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[A-Z0-9]$/;
  if (!cifRegex.test(clean)) return false;

  const letter = clean[0];
  const digits = clean.substring(1, 8);
  const control = clean[8];

  let sumEven = 0;
  let sumOdd = 0;

  for (let i = 0; i < 7; i++) {
    const digit = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sumOdd += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sumEven += digit;
    }
  }

  const totalSum = sumEven + sumOdd;
  const controlDigit = (10 - (totalSum % 10)) % 10;
  const controlLetter = 'JABCDEFGHI'[controlDigit];

  const lettersRequiringLetter = 'PQRSW';
  const lettersRequiringNumber = 'ABEH';

  if (lettersRequiringLetter.includes(letter)) {
    return control === controlLetter;
  } else if (lettersRequiringNumber.includes(letter)) {
    return control === controlDigit.toString();
  }

  return control === controlDigit.toString() || control === controlLetter;
};

export const validateNIFOrCIF = (value) => {
  if (!value) return false;
  return validateNIF(value) || validateCIF(value);
};

export const validateIBAN = (iban) => {
  if (!iban) return false;
  const clean = iban.toUpperCase().replace(/[\s-]/g, '');

  const ibanRegex = /^ES\d{22}$/;
  if (!ibanRegex.test(clean)) return false;

  const rearranged = clean.substring(4) + clean.substring(0, 4);
  const numericIBAN = rearranged.replace(/[A-Z]/g, (char) =>
    (char.charCodeAt(0) - 55).toString()
  );

  let remainder = numericIBAN;
  while (remainder.length > 2) {
    const block = remainder.substring(0, 9);
    remainder = (parseInt(block, 10) % 97).toString() + remainder.substring(9);
  }

  return parseInt(remainder, 10) % 97 === 1;
};

export const formatIBAN = (iban) => {
  if (!iban) return '';
  const clean = iban.toUpperCase().replace(/[\s-]/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
};

// ============================================
// AUTOBACKUP DIARI AMB ROTACIÓ (#2)
// ============================================

const BACKUP_MANIFEST_KEY = 'backup-manifest';
const MAX_BACKUPS = 7;

/**
 * Executa l'autobackup si no s'ha fet avui.
 * Rota automàticament mantenint els últims MAX_BACKUPS dies.
 */
export const runAutoBackup = async () => {
  const state = useStore.getState();
  const today = new Date().toISOString().split('T')[0];

  // Ja s'ha fet backup avui
  if (state.lastBackupDate === today) return { skipped: true };

  const backupKey = `backup-${today}`;
  const backup = {
    version: '1.0',
    date: new Date().toISOString(),
    data: {
      config: state.config,
      clients: state.clients,
      invoices: state.invoices,
      expenses: state.expenses,
      invoiceCounters: state.invoiceCounters || {},
    },
  };

  try {
    // Carregar manifest de backups
    let manifest = [];
    try {
      let raw;
      if (window.__TAURI__) {
        raw = await invoke('load_data', { key: BACKUP_MANIFEST_KEY });
      } else {
        raw = localStorage.getItem(BACKUP_MANIFEST_KEY);
      }
      if (raw) manifest = JSON.parse(raw);
    } catch { /* manifest buit si no existeix */ }

    // Guardar el backup d'avui
    const backupStr = JSON.stringify(backup);
    if (window.__TAURI__) {
      await invoke('save_data', { key: backupKey, value: backupStr });
    } else {
      localStorage.setItem(backupKey, backupStr);
    }

    // Afegir al manifest (evitar duplicats)
    if (!manifest.includes(today)) manifest.push(today);

    // Rotar: eliminar els backups més antics si supera MAX_BACKUPS
    while (manifest.length > MAX_BACKUPS) {
      const oldest = manifest.shift();
      try {
        if (window.__TAURI__) {
          await invoke('delete_data', { key: `backup-${oldest}` });
        } else {
          localStorage.removeItem(`backup-${oldest}`);
        }
      } catch { /* ignorar errors d'eliminació */ }
    }

    // Guardar manifest actualitzat
    const manifestStr = JSON.stringify(manifest);
    if (window.__TAURI__) {
      await invoke('save_data', { key: BACKUP_MANIFEST_KEY, value: manifestStr });
    } else {
      localStorage.setItem(BACKUP_MANIFEST_KEY, manifestStr);
    }

    // Actualitzar data de l'últim backup al store
    state.setLastBackupDate(today);

    return { success: true, key: backupKey, date: backup.date };
  } catch (error) {
    console.error('Error en autobackup:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Restaura dades des d'un backup manual
 */
export const restoreBackup = async (backupKey) => {
  try {
    let data;
    if (window.__TAURI__) {
      data = await invoke('load_data', { key: backupKey });
    } else {
      data = localStorage.getItem(backupKey);
    }

    if (!data) return { success: false, error: 'Backup no trobat' };

    const backup = JSON.parse(data);
    const state = useStore.getState();

    if (backup.data) {
      if (backup.data.config) state.setConfig(backup.data.config);
      if (backup.data.clients) state.setClients(backup.data.clients);
      if (backup.data.invoices) state.setInvoices(backup.data.invoices);
      if (backup.data.expenses) state.setExpenses(backup.data.expenses);
    }

    return { success: true, date: backup.date };
  } catch (error) {
    console.error('Error restoring backup:', error);
    return { success: false, error: error.message };
  }
};

// ============================================
// VALIDACIÓ D'INTEGRITAT DE DADES (#22)
// ============================================

/**
 * Comprova la integritat de les dades al boot.
 * Retorna llista de problemes trobats.
 */
export const validateDataIntegrity = () => {
  const state = useStore.getState();
  const warnings = [];

  const clientIds = new Set((state.clients || []).map(c => c.id));

  // Factures que referencien clients inexistents
  const orphanedInvoices = (state.invoices || []).filter(
    inv => inv.clienteId && !clientIds.has(inv.clienteId)
  );

  if (orphanedInvoices.length > 0) {
    warnings.push({
      type: 'orphaned_invoices',
      count: orphanedInvoices.length,
      message: `${orphanedInvoices.length} factura(s) referencia(n) clientes que ya no existen`,
      ids: orphanedInvoices.map(i => i.id),
    });
  }

  // Factures amb imports incoherents (total negatiu sense ser rectificativa)
  const inconsistentInvoices = (state.invoices || []).filter(
    inv => inv.total < 0 && !inv.numero?.startsWith('R-')
  );

  if (inconsistentInvoices.length > 0) {
    warnings.push({
      type: 'negative_invoices',
      count: inconsistentInvoices.length,
      message: `${inconsistentInvoices.length} factura(s) tienen importe total negativo`,
      ids: inconsistentInvoices.map(i => i.id),
    });
  }

  return warnings;
};

// ============================================
// EXPORT / IMPORT DE DADES (#13)
// ============================================

/**
 * Exporta dades a JSON usant el diàleg natiu de Tauri
 */
export const exportDataToJSON = async () => {
  const state = useStore.getState();
  const exportData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    data: {
      config: state.config,
      clients: state.clients,
      invoices: state.invoices,
      invoiceCounters: state.invoiceCounters || {},
      expenses: state.expenses,
    },
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const filename = `contabilidad-backup-${new Date().toISOString().split('T')[0]}.json`;

  if (window.__TAURI__) {
    // Usar diàleg natiu de Tauri per triar la ubicació
    const savePath = await tauriSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (savePath) {
      const encoder = new TextEncoder();
      await writeBinaryFile(savePath, encoder.encode(jsonStr));
      return { success: true, path: savePath };
    }
    return { success: false, cancelled: true };
  } else {
    // Fallback per navegador
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { success: true };
  }
};

/**
 * Aplica les dades importades al store
 */
const applyImportedData = (data, mode) => {
  const state = useStore.getState();
  const importData = data.data || data;

  if (mode === 'replace') {
    if (importData.config) state.setConfig(importData.config);
    if (importData.clients) state.setClients(importData.clients);
    if (importData.invoices) state.setInvoices(importData.invoices);
    if (importData.expenses) state.setExpenses(importData.expenses);
    if (importData.invoiceCounters) {
      // Actualitzar comptadors manualment
      useStore.setState({ invoiceCounters: importData.invoiceCounters });
    }
  } else if (mode === 'merge') {
    // Afegir nous registres sense duplicar per id
    const existingClientIds = new Set((state.clients || []).map(c => c.id));
    const existingInvoiceIds = new Set((state.invoices || []).map(i => i.id));
    const existingExpenseIds = new Set((state.expenses || []).map(e => e.id));

    if (importData.clients) {
      const newClients = importData.clients.filter(c => !existingClientIds.has(c.id));
      state.setClients([...(state.clients || []), ...newClients]);
    }
    if (importData.invoices) {
      const newInvoices = importData.invoices.filter(i => !existingInvoiceIds.has(i.id));
      state.setInvoices([...(state.invoices || []), ...newInvoices]);
    }
    if (importData.expenses) {
      const newExpenses = importData.expenses.filter(e => !existingExpenseIds.has(e.id));
      state.setExpenses([...(state.expenses || []), ...newExpenses]);
    }
  }
};

/**
 * Importa dades des d'un fitxer JSON usant el diàleg natiu de Tauri
 */
export const importDataFromJSON = async (mode = 'replace') => {
  if (window.__TAURI__) {
    const selected = await tauriOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    });

    if (!selected) return { success: false, cancelled: true };

    const text = await readTextFile(selected);
    const data = JSON.parse(text);
    applyImportedData(data, mode);
    return { success: true };
  } else {
    // Fallback per navegador
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) { resolve({ success: false, cancelled: true }); return; }
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          applyImportedData(data, mode);
          resolve({ success: true });
        } catch (err) {
          reject(err);
        }
      };
      input.click();
    });
  }
};

// ============================================
// GENERACIÓ DE NÚMEROS PER A DOCUMENTS (Pressupostos P-, Rectificatives R-)
// ============================================

export const generateDocumentNumber = (prefix, clients, allDocs, clientId, date, counters = {}) => {
  const year = new Date(date).getFullYear().toString().slice(-2);
  const client = clients.find((c) => c.id === clientId);

  let code = 'XXX';
  if (client?.codigo?.length === 3) code = client.codigo;
  else if (client?.nombre) code = generateClientCode(client.nombre);

  // Sèrie: "P-25_JPG" o "R-25_JPG"
  const series = `${prefix}-${year}_${code}`;
  const persistentMax = counters[series] || 0;

  const existingMax = allDocs.reduce((max, i) => {
    if (!i.numero) return max;
    const parts = i.numero.split('_');
    if (parts.length < 3) return max;
    const invSeries = parts.slice(0, -1).join('_');
    if (invSeries !== series) return max;
    const seq = parseInt(parts[parts.length - 1], 10);
    return isNaN(seq) ? max : Math.max(max, seq);
  }, 0);

  const nextSeq = Math.max(persistentMax, existingMax) + 1;
  return `${series}_${String(nextSeq).padStart(3, '0')}`;
};

// Genera número per a pressupost
export const generatePresupuestoNumber = (clients, allDocs, clientId, date, counters = {}) =>
  generateDocumentNumber('P', clients, allDocs, clientId, date, counters);

// ============================================
// EXPORT CSV DE DOCUMENTS (#12)
// ============================================

/**
 * Genera contingut CSV de factures emeses per a un trimestre/any.
 * Columnes estàndard per a gestors (A3, Sage, etc.)
 */
export const exportDocumentsCSV = (invoices, clients, options = {}) => {
  const { year, quarter, tipoDocumento = 'factura' } = options;

  let docs = invoices.filter(i => {
    const tipo = i.tipoDocumento || 'factura';
    if (tipoDocumento === 'factura') return tipo === 'factura' || tipo === 'rectificativa';
    return tipo === tipoDocumento;
  });

  if (year) docs = docs.filter(i => new Date(i.fecha).getFullYear() === parseInt(year));
  if (quarter) {
    const qStart = (parseInt(quarter) - 1) * 3;
    const qEnd = qStart + 3;
    docs = docs.filter(i => {
      const m = new Date(i.fecha).getMonth();
      return m >= qStart && m < qEnd;
    });
  }

  // Excloure borranys i anulades (excepte rectificatives que sempre s'inclouen)
  docs = docs.filter(i => i.estado !== 'borrador' && i.estado !== 'anulada');

  // Ordenar per data
  docs = docs.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const escapeCSV = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Fecha', 'Número', 'Tipo', 'NIF/CIF Cliente', 'Cliente', 'Concepto',
    'Base Imponible', '% IVA', 'Cuota IVA', '% IRPF', 'Cuota IRPF', 'Total'];

  const rows = docs.map(inv => {
    const client = clients.find(c => c.id === inv.clienteId);
    const tipo = inv.tipoDocumento === 'rectificativa' ? 'Rectificativa' : 'Factura';
    return [
      inv.fecha,
      inv.numero,
      tipo,
      client?.cifNif || '',
      client?.nombre || '',
      inv.concepto,
      (inv.subtotal || 0).toFixed(2),
      (inv.ivaPorcentaje || 0).toFixed(0),
      (inv.iva || 0).toFixed(2),
      (inv.irpfPorcentaje || 0).toFixed(0),
      (inv.irpf || 0).toFixed(2),
      (inv.total || 0).toFixed(2),
    ].map(escapeCSV).join(',');
  });

  return [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
};

/**
 * Desa contingut CSV al disc (Tauri) o descarrega al navegador
 */
export const downloadCSV = async (csvContent, filename) => {
  if (window.__TAURI__) {
    const savePath = await tauriSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (savePath) {
      const encoder = new TextEncoder();
      await writeBinaryFile(savePath, encoder.encode('\uFEFF' + csvContent)); // BOM per Excel
      return { success: true, path: savePath };
    }
    return { success: false, cancelled: true };
  } else {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { success: true };
  }
};

// ============================================
// PLANTILLES RECURRENTS (#8)
// ============================================

/**
 * Retorna les plantilles recurrents que estan pendents de generació (data ≤ avui)
 */
export const getRecurringDue = (invoices) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return invoices.filter(i => {
    if (!i.esPlantilla || !i.periodicidad) return false;
    if (!i.proximaFecha) return true; // Sense data → sempre pendent
    const proxima = new Date(i.proximaFecha);
    proxima.setHours(0, 0, 0, 0);
    return proxima <= today;
  });
};

// ============================================
// PAGAMENTS PARCIALS (#11)
// ============================================

export const calcularPagado = (invoice) => {
  // Si hi ha pagos individuals registrats, usar la seva suma
  if ((invoice.pagos || []).length > 0) {
    return (invoice.pagos || []).reduce((sum, p) => sum + (Number(p.importe) || 0), 0);
  }
  // Retrocompatibilitat: si l'estat és 'pagada' sense pagos registrats, el total és pagat
  if (invoice.estado === 'pagada') return invoice.total || 0;
  return 0;
};

export const calcularPendiente = (invoice) =>
  Math.max(0, (invoice.total || 0) - calcularPagado(invoice));

// ============================================
// DATES LÍMIT D'IMPOSTOS
// ============================================

export const getTaxDeadlines = (year = new Date().getFullYear()) => {
  const today = new Date();
  const currentQuarter = getQuarter(today);

  const deadlines = {
    1: { date: new Date(year, 3, 20), model: '303/130 T1', label: '20 abril' },
    2: { date: new Date(year, 6, 20), model: '303/130 T2', label: '20 julio' },
    3: { date: new Date(year, 9, 20), model: '303/130 T3', label: '20 octubre' },
    4: { date: new Date(year + 1, 0, 30), model: '303/130 T4', label: '30 enero' }
  };

  let nextDeadline = null;
  for (let q = currentQuarter; q <= 4; q++) {
    if (deadlines[q].date > today) {
      nextDeadline = { quarter: q, ...deadlines[q] };
      break;
    }
  }

  if (!nextDeadline) {
    nextDeadline = { quarter: 1, ...getTaxDeadlines(year + 1)[1] };
  }

  const daysUntil = Math.ceil((nextDeadline.date - today) / (1000 * 60 * 60 * 24));

  return {
    all: deadlines,
    next: {
      ...nextDeadline,
      daysUntil,
      urgent: daysUntil <= 7,
      warning: daysUntil <= 15
    }
  };
};
