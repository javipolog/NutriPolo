import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';

const defaultDesign = {
  logo: { type: 'text', text: 'POLO', imageUrl: '', svgContent: '', width: 200, height: 50, align: 'left' },
  fonts: { primary: 'Work Sans', secondary: 'Roboto', mono: 'JetBrains Mono' },
  fontSizes: { header: '10pt', body: '9pt', small: '8pt', total: '11pt' },
  colors: { primary: '#434343', secondary: '#666666', accent: '#000000', background: '#ffffff', divider: '#000000', muted: '#999999', tableHead: '#f5f5f5', highlight: '#000000' },
  layout: { pageMargin: 30, sectionSpacing: 20, borderWidth: 1, borderStyle: 'solid', headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' },
  blocks: { header: { marginBottom: 60 }, parties: { marginBottom: 60 }, concept: { marginBottom: 80 }, totals: { marginBottom: 40 }, footer: {} },
  table: { style: 'lines', headerBg: true, showBorderAll: false, rowPadding: 8 },
  sections: { showLogo: true, showFooterContact: true, showBankDetails: true, showPaymentMethod: true, showConceptNote: false },
  labels: {
    es: { invoice: 'FACTURA', invoiceNumber: 'Nº', date: 'FECHA', freelance: 'FREELANCE', client: 'CLIENTE', nif: 'N.I.F', concept: 'CONCEPTO', taxBase: 'BASE IMPONIBLE', days: 'JORNADAS', rate: 'TARIFA', iva: 'IVA', irpf: 'IRPF', total: 'TOTAL', paymentMethod: 'FORMA DE PAGO', bankDetails: 'DATOS BANCARIOS', transfer: 'Transferencia bancaria', paymentConcept: 'CONCEPTO', conceptNote: '' },
    ca: { invoice: 'FACTURA', invoiceNumber: 'Nº', date: 'DATA', freelance: 'FREELANCE', client: 'CLIENT', nif: 'N.I.F', concept: 'CONCEPTE', taxBase: 'BASE IMPOSABLE', days: 'JORNADES', rate: 'TARIFA', iva: 'IVA', irpf: 'IRPF', total: 'TOTAL', paymentMethod: 'FORMA DE PAGAMENT', bankDetails: 'DADES BANCÀRIES', transfer: 'Transferència bancària', paymentConcept: 'CONCEPTE', conceptNote: '' },
    en: { invoice: 'INVOICE', invoiceNumber: 'No.', date: 'DATE', freelance: 'FREELANCE', client: 'CLIENT', nif: 'VAT No.', concept: 'DESCRIPTION', taxBase: 'SUBTOTAL', days: 'DAYS', rate: 'RATE', iva: 'VAT', irpf: 'WHT', total: 'TOTAL', paymentMethod: 'PAYMENT METHOD', bankDetails: 'BANK DETAILS', transfer: 'Bank transfer', paymentConcept: 'REFERENCE', conceptNote: '' },
  },
  activePreset: 'classic',
};

export const designPresets = {
  classic: { name: 'Clásico', description: 'Limpio y profesional, estilo Excel original', thumb: ['#434343','#000000','#ffffff','#666666'], fonts: { primary: 'Work Sans', secondary: 'Roboto', mono: 'JetBrains Mono' }, colors: { primary: '#434343', secondary: '#666666', accent: '#000000', background: '#ffffff', divider: '#000000', muted: '#999999', tableHead: '#f5f5f5', highlight: '#000000' }, layout: { headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' }, table: { style: 'lines', headerBg: true, rowPadding: 8 } },
  modern:  { name: 'Moderno',  description: 'Contemporani amb accents blaus', thumb: ['#1a1a2e','#0066cc','#ffffff','#4a4a6a'], fonts: { primary: 'Inter', secondary: 'Inter', mono: 'Fira Code' }, colors: { primary: '#1a1a2e', secondary: '#4a4a6a', accent: '#0066cc', background: '#ffffff', divider: '#0066cc', muted: '#8888aa', tableHead: '#e8f0fe', highlight: '#0066cc' }, layout: { headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' }, table: { style: 'zebra', headerBg: true, rowPadding: 10 } },
  minimal: { name: 'Minimalista', description: 'Ultra net, sols l\'essencial', thumb: ['#222222','#dddddd','#ffffff','#555555'], fonts: { primary: 'Helvetica Neue', secondary: 'Helvetica Neue', mono: 'Monaco' }, colors: { primary: '#222222', secondary: '#555555', accent: '#222222', background: '#ffffff', divider: '#dddddd', muted: '#888888', tableHead: '#fafafa', highlight: '#222222' }, layout: { headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' }, table: { style: 'minimal', headerBg: false, rowPadding: 12 } },
  elegant: { name: 'Elegante', description: 'Sofisticat amb sèrifes', thumb: ['#2c2c2c','#8b7355','#fffef9','#5a5a5a'], fonts: { primary: 'Playfair Display', secondary: 'Lora', mono: 'Courier Prime' }, colors: { primary: '#2c2c2c', secondary: '#5a5a5a', accent: '#8b7355', background: '#fffef9', divider: '#8b7355', muted: '#9a9a9a', tableHead: '#f5f0e8', highlight: '#8b7355' }, layout: { headerLayout: 'logo-center', totalsAlign: 'right', partyLayout: 'two-col' }, table: { style: 'bordered', headerBg: true, rowPadding: 10 } },
  dark:    { name: 'Dark Pro', description: 'Modern fosc per a sectors creatius', thumb: ['#f0f0f0','#6366f1','#1a1a2e','#a0a0c0'], fonts: { primary: 'Inter', secondary: 'Inter', mono: 'JetBrains Mono' }, colors: { primary: '#f0f0f0', secondary: '#a0a0c0', accent: '#6366f1', background: '#1a1a2e', divider: '#6366f1', muted: '#606080', tableHead: '#252540', highlight: '#6366f1' }, layout: { headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' }, table: { style: 'zebra', headerBg: true, rowPadding: 10 } },
};

export const availableFonts = [
  { value: 'Work Sans', label: 'Work Sans', type: 'sans-serif' },
  { value: 'Roboto', label: 'Roboto', type: 'sans-serif' },
  { value: 'Inter', label: 'Inter', type: 'sans-serif' },
  { value: 'Open Sans', label: 'Open Sans', type: 'sans-serif' },
  { value: 'Lato', label: 'Lato', type: 'sans-serif' },
  { value: 'Montserrat', label: 'Montserrat', type: 'sans-serif' },
  { value: 'Poppins', label: 'Poppins', type: 'sans-serif' },
  { value: 'Nunito', label: 'Nunito', type: 'sans-serif' },
  { value: 'Raleway', label: 'Raleway', type: 'sans-serif' },
  { value: 'DM Sans', label: 'DM Sans', type: 'sans-serif' },
  { value: 'Playfair Display', label: 'Playfair Display', type: 'serif' },
  { value: 'Merriweather', label: 'Merriweather', type: 'serif' },
  { value: 'Lora', label: 'Lora', type: 'serif' },
  { value: 'PT Serif', label: 'PT Serif', type: 'serif' },
  { value: 'Libre Baskerville', label: 'Libre Baskerville', type: 'serif' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', type: 'mono' },
  { value: 'Fira Code', label: 'Fira Code', type: 'mono' },
  { value: 'Source Code Pro', label: 'Source Code Pro', type: 'mono' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono', type: 'mono' },
  { value: 'Courier Prime', label: 'Courier Prime', type: 'mono' },
];

const tauriStorage = {
  getItem:    async (n) => { try { return await invoke('load_data', { key: n }); } catch { return null; } },
  setItem:    async (n, v) => { try { await invoke('save_data', { key: n, value: v }); } catch (e) { console.error('Design save:', e); } },
  removeItem: async (n) => { try { await invoke('delete_data', { key: n }); } catch (e) { console.error('Design delete:', e); } },
};

const storage = window.__TAURI__ ? createJSONStorage(() => tauriStorage) : createJSONStorage(() => localStorage);

// Deep merge: garanteix que el state persistit sempre tinga totes les claus del defaultDesign
const deepMergeDesign = (persisted, defaults) => {
  const result = { ...defaults };
  if (!persisted || typeof persisted !== 'object') return result;
  for (const key of Object.keys(defaults)) {
    if (persisted[key] === undefined || persisted[key] === null) continue;
    if (typeof defaults[key] === 'object' && !Array.isArray(defaults[key]) && defaults[key] !== null) {
      result[key] = deepMergeDesign(persisted[key], defaults[key]);
    } else {
      result[key] = persisted[key];
    }
  }
  return result;
};

export const useDesignStore = create(
  persist(
    (set, get) => ({
      design: defaultDesign,
      setDesign:       (d)  => set({ design: d }),
      updateLogo:      (v)  => set(s => ({ design: { ...s.design, logo:      { ...s.design.logo,      ...v } } })),
      updateFonts:     (v)  => set(s => ({ design: { ...s.design, fonts:     { ...s.design.fonts,     ...v } } })),
      updateColors:    (v)  => set(s => ({ design: { ...s.design, colors:    { ...s.design.colors,    ...v } } })),
      updateLayout:    (v)  => set(s => ({ design: { ...s.design, layout:    { ...s.design.layout,    ...v } } })),
      updateSections:  (v)  => set(s => ({ design: { ...s.design, sections:  { ...s.design.sections,  ...v } } })),
      updateFontSizes: (v)  => set(s => ({ design: { ...s.design, fontSizes: { ...s.design.fontSizes, ...v } } })),
      updateTable:     (v)  => set(s => ({ design: { ...s.design, table:     { ...s.design.table,     ...v } } })),
      updateBlocks:    (v)  => set(s => {
        const merged = { ...s.design.blocks };
        Object.keys(v).forEach(k => { merged[k] = { ...(merged[k] || {}), ...v[k] }; });
        return { design: { ...s.design, blocks: merged } };
      }),
      updateLabel: (lang, key, value) => set(s => ({
        design: { ...s.design, labels: { ...s.design.labels, [lang]: { ...(s.design.labels[lang] || {}), [key]: value } } }
      })),
      applyPreset: (id) => {
        const p = designPresets[id];
        if (!p) return;
        set(s => ({ design: { ...s.design, fonts: { ...s.design.fonts, ...p.fonts }, colors: { ...s.design.colors, ...p.colors }, layout: { ...s.design.layout, ...p.layout }, table: { ...s.design.table, ...p.table }, activePreset: id } }));
      },
      resetDesign: () => set({ design: defaultDesign }),
      getLabels: (lang = 'es') => { const d = get().design; return { ...(d.labels.es || {}), ...(d.labels[lang] || {}) }; },
    }),
    {
      name: 'invoice-design-storage',
      storage,
      merge: (persistedState, currentState) => {
        if (!persistedState) return currentState;
        return {
          ...currentState,
          ...persistedState,
          design: deepMergeDesign(persistedState.design, defaultDesign),
        };
      },
    }
  )
);

export const loadGoogleFonts = (fonts) => {
  const unique = [...new Set(Object.values(fonts).filter(Boolean))];
  const query  = unique.map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700`).join('&');
  const ex = document.getElementById('google-fonts-invoice');
  if (ex) ex.remove();
  const link = document.createElement('link');
  link.id = 'google-fonts-invoice'; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
};
