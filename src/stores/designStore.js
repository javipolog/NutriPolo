import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';

const defaultDesign = {
  // Logo Excel: 2466975 EMU wide × 476250 EMU tall @ 96dpi = 259×50px, posicionat a x=30px, y=34px
  logo: { type: 'text', text: 'POLO', imageUrl: '', svgContent: '', width: 259, height: 50, align: 'left' },
  fonts: { primary: 'Work Sans', secondary: 'Roboto', mono: 'JetBrains Mono' },
  fontSizes: { header: '10pt', body: '9pt', small: '8pt', total: '11pt' },
  colors: { primary: '#000000', secondary: '#333333', accent: '#000000', background: '#ffffff', divider: '#000000', muted: '#666666', tableHead: 'transparent', highlight: '#000000' },
  layout: { pageMargin: 30, sectionSpacing: 20, borderWidth: 1, borderStyle: 'solid', headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col' },
  blocks: { header: { marginBottom: 60 }, parties: { marginBottom: 60 }, concept: { marginBottom: 80 }, totals: { marginBottom: 40 }, footer: {} },
  table: { style: 'minimal', headerBg: false, showBorderAll: false, rowPadding: 4 },
  sections: { showLogo: true, showFooterContact: true, showBankDetails: true, showPaymentMethod: true, showConceptNote: false },
  labels: {
    es: { invoice: 'FACTURA', invoiceNumber: 'Nº', date: 'FECHA', freelance: 'FREELANCE', client: 'CLIENTE', nif: 'N.I.F', concept: 'CONCEPTO', taxBase: 'BASE IMPONIBLE', days: 'JORNADAS', rate: 'TARIFA', iva: 'IVA', irpf: 'IRPF', total: 'TOTAL', paymentMethod: 'FORMA DE PAGO', bankDetails: 'DATOS BANCARIOS', transfer: 'Transferencia bancaria', paymentConcept: 'CONCEPTO', conceptNote: '' },
    ca: { invoice: 'FACTURA', invoiceNumber: 'Nº', date: 'DATA', freelance: 'FREELANCE', client: 'CLIENT', nif: 'N.I.F', concept: 'CONCEPTE', taxBase: 'BASE IMPOSABLE', days: 'JORNADES', rate: 'TARIFA', iva: 'IVA', irpf: 'IRPF', total: 'TOTAL', paymentMethod: 'FORMA DE PAGAMENT', bankDetails: 'DADES BANCÀRIES', transfer: 'Transferència bancària', paymentConcept: 'CONCEPTE', conceptNote: '' },
    en: { invoice: 'INVOICE', invoiceNumber: 'No.', date: 'DATE', freelance: 'FREELANCE', client: 'CLIENT', nif: 'VAT No.', concept: 'DESCRIPTION', taxBase: 'SUBTOTAL', days: 'DAYS', rate: 'RATE', iva: 'VAT', irpf: 'WHT', total: 'TOTAL', paymentMethod: 'PAYMENT METHOD', bankDetails: 'BANK DETAILS', transfer: 'Bank transfer', paymentConcept: 'REFERENCE', conceptNote: '' },
  },
  // Configuració grid per al layout tipus Excel
  // Columnes calculades a partir del XLSX original (proporcions exactes A-I escalades a 794px A4):
  // A=5.13ch, B=C=D=13.88ch, E=6.38ch, F=G=H=13.88ch → [41,110,110,110,51,110,110,110] + 42px rightPad
  grid: {
    columns: [41, 110, 110, 110, 51, 110, 110, 110],  // 8 cols (A-H), total 752px + ~42px rightPad = 794px
    rows: {
      topPadding: 15,
      invoiceInfoHeight: 20,
      headerImageHeight: 84,   // Excel: logo y=34px + height=50px = 84px total
      headerGap: 15,
      sectionLabelHeight: 22,
      partyGap: 8,
      partyLineHeight: 18,
      conceptGap: 50,
      conceptHeaderHeight: 22,
      conceptRowHeight: 20,
      totalsGap: 35,
      totalRowHeight: 22,
      grandTotalGap: 15,
      grandTotalHeight: 28,
    },
    labelPrefix: ': ',
    footerPadding: 30,
  },
  activePreset: 'excelClassic',
};

// Preset únic — disseny fidel al template Excel
export const designPresets = {
  excelClassic: {
    name: 'Excel Clàssic',
    description: 'Disseny fidel al template Excel original',
    thumb: ['#000000', '#333333', '#ffffff', '#666666'],
    fonts: { primary: 'Work Sans', secondary: 'Roboto', mono: 'JetBrains Mono' },
    colors: { primary: '#000000', secondary: '#333333', accent: '#000000', background: '#ffffff', divider: '#000000', muted: '#666666', tableHead: 'transparent', highlight: '#000000' },
    layout: { headerLayout: 'logo-left', totalsAlign: 'right', partyLayout: 'two-col', pageMargin: 30, borderWidth: 1, borderStyle: 'solid' },
    table: { style: 'minimal', headerBg: false, rowPadding: 4 },
  },
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
// Ara suporta arrays (per grid.columns)
const deepMergeDesign = (persisted, defaults) => {
  const result = { ...defaults };
  if (!persisted || typeof persisted !== 'object') return result;
  for (const key of Object.keys(defaults)) {
    if (persisted[key] === undefined || persisted[key] === null) continue;
    if (Array.isArray(defaults[key])) {
      // Arrays: usar el persistit si també és array amb la mateixa longitud
      result[key] = Array.isArray(persisted[key]) && persisted[key].length === defaults[key].length
        ? persisted[key]
        : defaults[key];
    } else if (typeof defaults[key] === 'object' && defaults[key] !== null) {
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
      // Nova acció per actualitzar la configuració grid
      updateGrid: (v) => set(s => {
        const currentGrid = s.design.grid || defaultDesign.grid;
        return {
          design: {
            ...s.design,
            grid: {
              ...currentGrid,
              ...v,
              ...(v.rows ? { rows: { ...currentGrid.rows, ...v.rows } } : {}),
              ...(v.columns && Array.isArray(v.columns) ? { columns: v.columns } : {}),
            }
          }
        };
      }),
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
