import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';

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
  expensesFolder: ''
};

// Custom storage adapter for Tauri
const tauriStorage = {
  getItem: async (name) => {
    try {
      const data = await invoke('load_data', { key: name });
      return data;
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await invoke('save_data', { key: name, value });
    } catch (e) {
      console.error('Failed to save:', e);
    }
  },
  removeItem: async (name) => {
    try {
      await invoke('delete_data', { key: name });
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  },
};

// Fallback to localStorage if Tauri is not available
const storage = window.__TAURI__ ? createJSONStorage(() => tauriStorage) : createJSONStorage(() => localStorage);

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
      deleteClient: (id) => set((state) => ({
        clients: state.clients.filter((c) => c.id !== id)
      })),

      // Invoices
      invoices: [],
      setInvoices: (invoices) => set({ invoices }),
      addInvoice: (invoice) => set((state) => ({ invoices: [...state.invoices, invoice] })),
      updateInvoice: (id, data) => set((state) => ({
        invoices: state.invoices.map((i) => (i.id === id ? { ...i, ...data } : i))
      })),
      deleteInvoice: (id) => set((state) => ({
        invoices: state.invoices.filter((i) => i.id !== id)
      })),

      // Expenses
      expenses: [],
      setExpenses: (expenses) => set({ expenses }),
      addExpense: (expense) => set((state) => ({ expenses: [...state.expenses, expense] })),
      updateExpense: (id, data) => set((state) => ({
        expenses: state.expenses.map((e) => (e.id === id ? { ...e, ...data } : e))
      })),
      deleteExpense: (id) => set((state) => ({
        expenses: state.expenses.filter((e) => e.id !== id)
      })),
      deleteExpenses: (ids) => set((state) => ({
        expenses: state.expenses.filter((e) => !ids.includes(e.id))
      })),

      // UI State
      currentView: 'dashboard',
      setCurrentView: (view) => set({ currentView: view }),

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
        // Suport tant a objecte directe com a funció updater (prev => newState)
        const next = typeof updater === 'function'
          ? updater(state.dashboardConfig)
          : updater;
        // Merge amb defaults per garantir que mai falten claus (robustesa davant migracions)
        return { dashboardConfig: { ...defaultDashboardConfig, ...next } };
      }),

      // Loading state
      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'contabilidad-storage',
      storage,
      partialize: (state) => ({
        config: state.config,
        clients: state.clients,
        invoices: state.invoices,
        expenses: state.expenses,
        invoiceSearch: state.invoiceSearch,
        invoiceFilters: state.invoiceFilters,
        expenseSearch: state.expenseSearch,
        expenseFilters: state.expenseFilters,
        dashboardFilters: state.dashboardFilters,
        dashboardConfig: state.dashboardConfig,
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

export const generateInvoiceNumber = (clients, invoices, clientId, date) => {
  const year = new Date(date).getFullYear().toString().slice(-2);
  const client = clients.find((c) => c.id === clientId);

  // Determine Acronym
  let code = 'XXX';
  if (client) {
    if (client.codigo && client.codigo.length === 3) {
      code = client.codigo;
    } else if (client.nombre) {
      code = generateClientCode(client.nombre);
    }
  }

  const yearInvoices = invoices.filter((i) => {
    const invYear = new Date(i.fecha).getFullYear().toString().slice(-2);
    return i.clienteId === clientId && invYear === year;
  });
  const seq = String(yearInvoices.length + 1).padStart(3, '0');
  return `${year}_${code}_${seq}`;
};

export const calcularFactura = (tipo, data, ivaPct = 21, irpfPct = 15) => {
  const subtotal = tipo === 'classic' ? (data.baseImponible || 0) : (data.jornadas || 0) * (data.tarifaDia || 0);
  const iva = subtotal * (ivaPct / 100);
  const irpf = subtotal * (irpfPct / 100);
  const total = subtotal + iva - irpf;
  return { subtotal, iva, irpf, total };
};

export const getQuarter = (date) => Math.ceil((new Date(date).getMonth() + 1) / 3);

/**
 * Distribueix l'import d'una factura proporcionalment entre els mesos del projecte.
 * 
 * Si la factura té fechaFin, distribueix el subtotal segons els dies naturals
 * que cada mes cobreix dins del rang [fecha, fechaFin].
 * Si no té fechaFin, tot l'import va al mes de fecha (comportament original).
 * 
 * @returns {Object} Map de monthIndex (0-11) -> import proporcional
 *   Exemple: { 6: 1500, 7: 1000 } (juliol: 1500€, agost: 1000€)
 */
export const distributeInvoiceByMonth = (invoice, field = 'subtotal') => {
  const amount = invoice[field] || 0;
  const start = new Date(invoice.fecha);
  const distribution = {};

  // Si no hi ha fechaFin o és igual a fecha → tot al mes d'inici
  if (!invoice.fechaFin || invoice.fechaFin === invoice.fecha) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  const end = new Date(invoice.fechaFin);
  
  // Validació: si fechaFin < fecha, tractem com data única
  if (end < start) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  // Calcular dies totals del projecte (inclusiu)
  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (totalDays <= 0) {
    const key = `${start.getFullYear()}-${start.getMonth()}`;
    distribution[key] = amount;
    return distribution;
  }

  // Iterar mes a mes dins del rang
  let cursor = new Date(start);
  let daysAssigned = 0;

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const key = `${year}-${month}`;

    // Primer dia d'aquest mes dins del rang
    const monthStart = (cursor.getFullYear() === start.getFullYear() && cursor.getMonth() === start.getMonth())
      ? start.getDate()
      : 1;

    // Últim dia d'aquest mes dins del rang
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const monthEnd = (year === end.getFullYear() && month === end.getMonth())
      ? end.getDate()
      : lastDayOfMonth;

    const daysInThisMonth = monthEnd - monthStart + 1;
    daysAssigned += daysInThisMonth;

    // Proporcional: dies_aquest_mes / dies_totals * import
    distribution[key] = (daysInThisMonth / totalDays) * amount;

    // Avançar al primer dia del mes següent
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

/**
 * Valida un NIF espanyol (8 números + lletra)
 */
export const validateNIF = (nif) => {
  if (!nif) return false;
  const clean = nif.toUpperCase().replace(/[\s-]/g, '');
  
  // NIF: 8 números + lletra
  const nifRegex = /^[0-9]{8}[A-Z]$/;
  if (nifRegex.test(clean)) {
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    const number = parseInt(clean.substring(0, 8), 10);
    const expectedLetter = letters[number % 23];
    return clean[8] === expectedLetter;
  }
  
  // NIE: X/Y/Z + 7 números + lletra
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

/**
 * Valida un CIF espanyol
 */
export const validateCIF = (cif) => {
  if (!cif) return false;
  const clean = cif.toUpperCase().replace(/[\s-]/g, '');
  
  // CIF: Lletra + 7 números + dígit/lletra control
  const cifRegex = /^[ABCDEFGHJNPQRSUVW][0-9]{7}[A-Z0-9]$/;
  if (!cifRegex.test(clean)) return false;
  
  const letter = clean[0];
  const digits = clean.substring(1, 8);
  const control = clean[8];
  
  // Càlcul del dígit de control
  let sumEven = 0;
  let sumOdd = 0;
  
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      // Posicions senars (0, 2, 4, 6) - multiplica per 2
      const doubled = digit * 2;
      sumOdd += doubled > 9 ? doubled - 9 : doubled;
    } else {
      // Posicions parells (1, 3, 5)
      sumEven += digit;
    }
  }
  
  const totalSum = sumEven + sumOdd;
  const controlDigit = (10 - (totalSum % 10)) % 10;
  const controlLetter = 'JABCDEFGHI'[controlDigit];
  
  // Algunes lletres requereixen lletra de control, altres número
  const lettersRequiringLetter = 'PQRSW';
  const lettersRequiringNumber = 'ABEH';
  
  if (lettersRequiringLetter.includes(letter)) {
    return control === controlLetter;
  } else if (lettersRequiringNumber.includes(letter)) {
    return control === controlDigit.toString();
  }
  
  // Per la resta, pot ser qualsevol
  return control === controlDigit.toString() || control === controlLetter;
};

/**
 * Valida NIF o CIF
 */
export const validateNIFOrCIF = (value) => {
  if (!value) return false;
  return validateNIF(value) || validateCIF(value);
};

/**
 * Valida un IBAN espanyol
 */
export const validateIBAN = (iban) => {
  if (!iban) return false;
  const clean = iban.toUpperCase().replace(/[\s-]/g, '');
  
  // IBAN espanyol: ES + 2 dígits control + 20 dígits
  const ibanRegex = /^ES\d{22}$/;
  if (!ibanRegex.test(clean)) return false;
  
  // Algoritme de validació IBAN (mod 97)
  const rearranged = clean.substring(4) + clean.substring(0, 4);
  const numericIBAN = rearranged.replace(/[A-Z]/g, (char) => 
    (char.charCodeAt(0) - 55).toString()
  );
  
  // Mod 97 amb números grans
  let remainder = numericIBAN;
  while (remainder.length > 2) {
    const block = remainder.substring(0, 9);
    remainder = (parseInt(block, 10) % 97).toString() + remainder.substring(9);
  }
  
  return parseInt(remainder, 10) % 97 === 1;
};

/**
 * Format IBAN amb espais
 */
export const formatIBAN = (iban) => {
  if (!iban) return '';
  const clean = iban.toUpperCase().replace(/[\s-]/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
};

// ============================================
// SISTEMA DE BACKUP
// ============================================

/**
 * Crea un backup de totes les dades
 */
export const createBackup = async () => {
  const state = useStore.getState();
  const backup = {
    version: '1.0',
    date: new Date().toISOString(),
    data: {
      config: state.config,
      clients: state.clients,
      invoices: state.invoices,
      expenses: state.expenses
    }
  };
  
  const backupKey = `backup-${new Date().toISOString().split('T')[0]}`;
  
  try {
    if (window.__TAURI__) {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('save_data', { key: backupKey, value: JSON.stringify(backup) });
    } else {
      localStorage.setItem(backupKey, JSON.stringify(backup));
    }
    return { success: true, key: backupKey, date: backup.date };
  } catch (error) {
    console.error('Error creating backup:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Restaura dades des d'un backup
 */
export const restoreBackup = async (backupKey) => {
  try {
    let data;
    if (window.__TAURI__) {
      const { invoke } = await import('@tauri-apps/api/tauri');
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

/**
 * Exporta dades a JSON per descarregar
 */
export const exportDataToJSON = () => {
  const state = useStore.getState();
  const exportData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    data: {
      config: state.config,
      clients: state.clients,
      invoices: state.invoices,
      expenses: state.expenses
    }
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contabilidad-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ============================================
// DATES LÍMIT D'IMPOSTOS
// ============================================

/**
 * Obté les dates límit de presentació d'impostos
 */
export const getTaxDeadlines = (year = new Date().getFullYear()) => {
  const today = new Date();
  const currentQuarter = getQuarter(today);
  
  const deadlines = {
    1: { date: new Date(year, 3, 20), model: '303/130 T1', label: '20 abril' },
    2: { date: new Date(year, 6, 20), model: '303/130 T2', label: '20 julio' },
    3: { date: new Date(year, 9, 20), model: '303/130 T3', label: '20 octubre' },
    4: { date: new Date(year + 1, 0, 30), model: '303/130 T4', label: '30 enero' }
  };
  
  // Trobar el proper deadline
  let nextDeadline = null;
  for (let q = currentQuarter; q <= 4; q++) {
    if (deadlines[q].date > today) {
      nextDeadline = { quarter: q, ...deadlines[q] };
      break;
    }
  }
  
  // Si no hi ha deadline aquest any, el primer de l'any vinent
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
