import React, { useState, useRef, useEffect } from 'react';
import {
  Palette, Type, Image, Layout, Eye, RotateCcw, Upload, Check,
  ChevronDown, ChevronUp, Sliders, Grid, AlignLeft, AlignCenter,
  AlignRight, Columns, Rows, Languages, Maximize2, X,
  ToggleLeft, ToggleRight, Minus, Plus
} from 'lucide-react';
import { Button, Card, Modal } from './UI';
import { useDesignStore, availableFonts, loadGoogleFonts } from '../stores/designStore';
import { InvoicePreviewModern } from './InvoicePreview';
import { useStore } from '../stores/store';

// ============================================
// ERROR BOUNDARY per protegir contra crashes
// ============================================
class DesignErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('DesignEditor crash:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <div className="text-danger text-lg font-semibold">Error al carregar el dissenyador</div>
          <p className="text-sand-600 text-sm text-center max-w-md">
            Pot ser que les dades guardades estiguen corruptes. Prova a restaurar els valors per defecte.
          </p>
          <button onClick={() => {
            try { useDesignStore.getState().resetDesign(); } catch(e) { console.error(e); }
            this.setState({ hasError: false, error: null });
          }} className="px-4 py-2 bg-terra-400 hover:bg-terra-500 text-white rounded-button text-sm font-medium transition-colors">
            Restaurar i reintentar
          </button>
          <details className="text-xs text-sand-400 mt-2 max-w-md">
            <summary className="cursor-pointer">Detalls de l'error</summary>
            <pre className="mt-2 p-2 bg-white rounded text-sand-600 overflow-auto">{this.state.error?.message}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================
// MICRO COMPONENTS
// ============================================

const ColorSwatch = ({ value, onChange, size = 'md' }) => {
  const dim = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  return (
    <label className={`${dim} rounded-button border-2 border-sand-400 cursor-pointer relative overflow-hidden shrink-0 hover:border-slate-400 transition-colors`}
      style={{ backgroundColor: value }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
    </label>
  );
};

const ColorRow = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3 py-2">
    <ColorSwatch value={value} onChange={onChange} />
    <div className="flex-1 min-w-0">
      <div className="text-xs text-sand-600 mb-1">{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-white border border-sand-300 rounded-md px-2 py-1 text-xs text-sand-900 font-mono outline-none focus:border-terra-400 transition-colors" />
    </div>
  </div>
);

const NumberInput = ({ label, value, onChange, min = 0, max = 200, step = 1, unit = 'px' }) => (
  <div>
    {label && <div className="text-xs text-sand-500 mb-1.5 uppercase font-semibold tracking-wider">{label}</div>}
    <div className="flex items-center gap-1.5 bg-white border border-sand-300 rounded-button px-2 py-1.5 focus-within:border-terra-400 transition-colors">
      <button onClick={() => onChange(Math.max(min, value - step))} className="text-sand-500 hover:text-sand-700 transition-colors p-0.5"><Minus size={12} /></button>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 bg-transparent text-sand-900 text-sm text-center outline-none w-0 min-w-0" />
      <button onClick={() => onChange(Math.min(max, value + step))} className="text-sand-500 hover:text-sand-700 transition-colors p-0.5"><Plus size={12} /></button>
      {unit && <span className="text-sand-500 text-xs">{unit}</span>}
    </div>
  </div>
);

const FontSelect = ({ label, value, onChange, filter }) => {
  const fonts = filter ? availableFonts.filter(f => f.type === filter) : availableFonts;
  const grouped = fonts.reduce((g, f) => { (g[f.type] = g[f.type] || []).push(f); return g; }, {});
  const designFonts = useDesignStore(s => s.design.fonts);
  return (
    <div>
      {label && <div className="text-xs text-sand-500 mb-1.5 uppercase font-semibold tracking-wider">{label}</div>}
      <select value={value} onChange={e => { onChange(e.target.value); loadGoogleFonts({ ...designFonts, [filter === 'mono' ? 'mono' : label?.includes('Principal') ? 'primary' : 'secondary']: e.target.value }); }}
        className="w-full bg-white border border-sand-300 text-sand-900 text-sm px-3 py-2 rounded-button outline-none focus:border-terra-400 transition-colors appearance-none cursor-pointer">
        {Object.entries(grouped).map(([type, list]) => (
          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} className="bg-sand-100">
            {list.map(f => <option key={f.value} value={f.value} className="bg-sand-100">{f.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer py-1.5 group">
    <span className="text-sm text-sand-700 group-hover:text-sand-800 transition-colors">{label}</span>
    <div onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full relative transition-colors duration-200 cursor-pointer shrink-0 ${checked ? 'bg-terra-400' : 'bg-sand-200'}`}>
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
  </label>
);

const RadioGroup = ({ label, value, onChange, options }) => (
  <div>
    {label && <div className="text-xs text-sand-500 mb-2 uppercase font-semibold tracking-wider">{label}</div>}
    <div className="flex gap-1 bg-white p-1 rounded-button">
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          title={opt.label}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
            value === opt.value ? 'bg-terra-400 text-white shadow' : 'text-sand-600 hover:text-sand-800'
          }`}>
          {opt.icon && <opt.icon size={13} />}
          {!opt.icon && opt.label}
        </button>
      ))}
    </div>
  </div>
);

// Collapsible panel section
const PanelSection = ({ title, icon: Icon, children, defaultOpen = false, badge }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-sand-300/60 rounded-soft overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-sand-50 hover:bg-sand-100 transition-colors text-left">
        {Icon && <Icon size={15} className="text-terra-400 shrink-0" />}
        <span className="font-semibold text-sand-900 text-sm flex-1">{title}</span>
        {badge && <span className="bg-terra-50 text-terra-400 text-[10px] font-bold px-1.5 rounded">{badge}</span>}
        {open ? <ChevronUp size={14} className="text-sand-500" /> : <ChevronDown size={14} className="text-sand-500" />}
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3 bg-sand-50">{children}</div>}
    </div>
  );
};

// Tab nav
const Tabs = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 bg-white p-1 rounded-soft border border-sand-300">
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-button text-xs font-semibold transition-all ${
          active === t.id ? 'bg-sand-200 text-sand-900 shadow' : 'text-sand-500 hover:text-sand-700'
        }`}>
        {t.icon && <t.icon size={13} />}
        {t.label}
      </button>
    ))}
  </div>
);

// ============================================
// LABEL EDITOR
// ============================================
const LabelEditor = ({ labels, lang, onUpdate }) => {
  const fields = [
    { key: 'invoice', label: 'Títol document' },
    { key: 'freelance', label: 'Títol autònom' },
    { key: 'client', label: 'Títol client' },
    { key: 'concept', label: 'Columna concepte' },
    { key: 'taxBase', label: 'Columna base imp.' },
    { key: 'days', label: 'Columna jornades' },
    { key: 'rate', label: 'Columna tarifa' },
    { key: 'iva', label: 'Etiqueta IVA' },
    { key: 'irpf', label: 'Etiqueta IRPF' },
    { key: 'total', label: 'Etiqueta total' },
    { key: 'paymentMethod', label: 'Forma de pagament' },
    { key: 'bankDetails', label: 'Dades bancàries' },
    { key: 'transfer', label: 'Tipus transferència' },
    { key: 'conceptNote', label: 'Nota peu concepte' },
  ];
  return (
    <div className="grid grid-cols-1 gap-2">
      {fields.map(f => (
        <div key={f.key} className="flex items-center gap-2">
          <span className="text-xs text-sand-500 w-32 shrink-0">{f.label}</span>
          <input value={labels[f.key] || ''} onChange={e => onUpdate(lang, f.key, e.target.value)}
            className="flex-1 bg-white border border-sand-300 rounded px-2 py-1 text-xs text-sand-900 outline-none focus:border-terra-400 transition-colors" />
        </div>
      ))}
    </div>
  );
};

// Noms humans per a les files del grid
const ROW_LABELS = {
  topPadding: 'Padding superior',
  invoiceInfoHeight: 'Info factura (Nº/Data)',
  headerImageHeight: 'Àrea header / logo',
  headerGap: 'Gap post-header',
  sectionLabelHeight: 'Etiquetes secció',
  partyGap: 'Gap post-etiqueta',
  partyLineHeight: 'Línia dades (nom/NIF)',
  conceptGap: 'Gap pre-concepte',
  conceptHeaderHeight: 'Capçalera concepte',
  conceptRowHeight: 'Fila concepte',
  totalsGap: 'Gap pre-totals',
  totalRowHeight: 'Fila IVA/IRPF',
  grandTotalGap: 'Gap pre-total final',
  grandTotalHeight: 'Fila TOTAL',
};

const COL_LABELS = ['A (marge)', 'B', 'C', 'D', 'E (sep)', 'F', 'G', 'H'];

// ============================================
// MAIN EDITOR
// ============================================

export const DesignEditorInner = () => {
  const { config, clients, invoices } = useStore();
  const { design, updateLogo, updateFonts, updateColors, updateLayout, updateSections,
          updateFontSizes, updateLabel, updateGrid, resetDesign } = useDesignStore();

  const [tab, setTab]           = useState('style');
  const [langTab, setLangTab]   = useState('es');
  const [showPreview, setShowPreview] = useState(false);
  const [saved, setSaved]       = useState(false);
  const fileInputRef = useRef(null);
  const previewContainerRef = useRef(null);

  const grid = design.grid || {};
  const gridCols = grid.columns || [30, 150, 110, 100, 40, 110, 80, 150];
  const gridRows = grid.rows || {};

  // Auto-scale preview to fit container
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;
    const A4_WIDTH_PX = 793.7;

    const updateScale = () => {
      const availableWidth = container.clientWidth - 24;
      const scale = Math.min(availableWidth / A4_WIDTH_PX, 0.65);
      container.style.setProperty('--preview-scale', String(Math.max(scale, 0.25)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const sampleInvoice = invoices[0] || {
    numero: '26_CLI_001', fecha: new Date().toISOString().split('T')[0],
    tipo: 'classic', idioma: 'es', concepto: 'Serveis de disseny i desenvolupament web',
    subtotal: 2500, ivaPorcentaje: 21, irpfPorcentaje: 15, iva: 525, irpf: 375, total: 2650,
  };
  const sampleClient = clients[0] || {
    nombre: 'EMPRESA EXEMPLE, SL', cifNif: 'B-12345678',
    direccion: 'Carrer Exemple 123\n46001 (VALÈNCIA)',
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => updateLogo({ type: 'image', imageUrl: ev.target.result });
    reader.readAsDataURL(file);
  };

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const handleColChange = (index, value) => {
    const newCols = [...gridCols];
    newCols[index] = value;
    updateGrid({ columns: newCols });
  };

  const handleRowChange = (key, value) => {
    updateGrid({ rows: { [key]: value } });
  };

  const TABS = [
    { id: 'style',   label: 'Estil',    icon: Palette  },
    { id: 'layout',  label: 'Layout',   icon: Layout   },
    { id: 'content', label: 'Contingut', icon: Grid    },
  ];

  const LANG_TABS = [
    { id: 'es', label: 'ES' },
    { id: 'ca', label: 'CA' },
    { id: 'en', label: 'EN' },
  ];

  const colTotal = gridCols.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="font-serif text-2xl font-bold text-sand-900 tracking-tight">Disseny de Factura</h1>
          <p className="text-sand-600 text-sm mt-0.5">Personalitza l'aspecte i l'estructura de les teues factures</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RotateCcw} onClick={resetDesign} size="sm">Restaurar</Button>
          <Button variant="secondary" icon={Eye} onClick={() => setShowPreview(true)} size="sm">Vista Prèvia</Button>
          <Button icon={saved ? Check : Sliders} onClick={handleSave} size="sm"
            className={saved ? 'bg-success hover:bg-success-dark' : ''}>
            {saved ? 'Guardat!' : 'Aplicar'}
          </Button>
        </div>
      </div>

      {/* Main grid: controls + preview */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">

        {/* ── LEFT PANEL: Controls ── */}
        <div className="lg:w-[340px] xl:w-[380px] shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {/* ===== TAB: ESTIL ===== */}
          {tab === 'style' && (
            <>
              {/* Logo */}
              <PanelSection title="Logo / Header" icon={Image} defaultOpen>
                <div>
                  <div className="text-xs text-sand-500 uppercase font-semibold tracking-wider mb-2">Tipus</div>
                  <div className="flex gap-1 bg-white p-1 rounded-button mb-3">
                    {[{v:'text',l:'Text'},{v:'image',l:'Imatge'},{v:'svg',l:'SVG'}].map(o => (
                      <button key={o.v} onClick={() => updateLogo({ type: o.v })}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${design.logo.type === o.v ? 'bg-terra-400 text-white' : 'text-sand-600 hover:text-sand-800'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>

                {design.logo.type === 'text' && (
                  <div>
                    <div className="text-xs text-sand-500 uppercase font-semibold tracking-wider mb-1.5">Text del logo</div>
                    <input value={design.logo.text} onChange={e => updateLogo({ text: e.target.value })}
                      className="w-full bg-white border border-sand-300 rounded-button px-3 py-2 text-sand-900 text-sm outline-none focus:border-terra-400 transition-colors" />
                  </div>
                )}

                {design.logo.type === 'image' && (
                  <div className="space-y-2">
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-sand-300 hover:border-terra-400 rounded-button py-4 text-sand-600 hover:text-terra-400 transition-colors text-sm font-medium">
                      <Upload size={16} /> Pujar imatge
                    </button>
                    {design.logo.imageUrl && (
                      <div className="flex items-center gap-2 bg-white rounded-button p-2">
                        <img src={design.logo.imageUrl} alt="Logo preview" className="h-8 object-contain" />
                        <button onClick={() => updateLogo({ imageUrl: '' })} className="ml-auto text-sand-500 hover:text-danger transition-colors"><X size={14} /></button>
                      </div>
                    )}
                  </div>
                )}

                {design.logo.type === 'svg' && (
                  <div>
                    <div className="text-xs text-sand-500 uppercase font-semibold tracking-wider mb-1.5">Codi SVG</div>
                    <textarea value={design.logo.svgContent} onChange={e => updateLogo({ svgContent: e.target.value })}
                      rows={5}
                      className="w-full bg-white border border-sand-300 rounded-button px-3 py-2 text-sand-900 text-xs font-mono outline-none focus:border-terra-400 transition-colors resize-none"
                      placeholder='<svg viewBox="0 0 200 50">...</svg>' />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Ample" value={design.logo.width} onChange={v => updateLogo({ width: v })} min={40} max={800} step={10} />
                  <NumberInput label="Alt" value={design.logo.height} onChange={v => updateLogo({ height: v })} min={20} max={300} step={5} />
                </div>

                <RadioGroup label="Alineació" value={design.logo.align || 'left'}
                  onChange={v => updateLogo({ align: v })}
                  options={[
                    { value: 'left',   icon: AlignLeft,   label: 'Esquerra' },
                    { value: 'center', icon: AlignCenter, label: 'Centre'   },
                    { value: 'right',  icon: AlignRight,  label: 'Dreta'    },
                  ]} />
              </PanelSection>

              {/* Colors */}
              <PanelSection title="Colors" icon={Palette}>
                <div className="divide-y divide-slate-800">
                  {[
                    { key: 'primary',    label: 'Text principal'   },
                    { key: 'secondary',  label: 'Text secundari'   },
                    { key: 'accent',     label: 'Acents / títols'  },
                    { key: 'background', label: 'Fons de pàgina'   },
                    { key: 'divider',    label: 'Línies divisores' },
                    { key: 'highlight',  label: 'Color total final'},
                    { key: 'muted',      label: 'Text peu de pàgina' },
                  ].map(c => (
                    <ColorRow key={c.key} label={c.label}
                      value={design.colors[c.key] || '#000000'}
                      onChange={v => updateColors({ [c.key]: v })} />
                  ))}
                </div>
              </PanelSection>

              {/* Typography */}
              <PanelSection title="Tipografia" icon={Type}>
                <FontSelect label="Principal (títols)" value={design.fonts.primary}
                  onChange={v => updateFonts({ primary: v })} />
                <FontSelect label="Secundària (cos)" value={design.fonts.secondary}
                  onChange={v => updateFonts({ secondary: v })} />
                <FontSelect label="Monoespaciada (xifres)" value={design.fonts.mono}
                  onChange={v => updateFonts({ mono: v })} filter="mono" />

                <div className="pt-2 border-t border-sand-300">
                  <div className="text-xs text-sand-500 uppercase font-semibold tracking-wider mb-3">Mides de lletra</div>
                  <div className="grid grid-cols-2 gap-3">
                    {[{k:'header',l:'Capçaleres'},{k:'body',l:'Cos'},{k:'small',l:'Petit'},{k:'total',l:'Total'}].map(f => (
                      <div key={f.k}>
                        <div className="text-xs text-sand-500 mb-1">{f.l}</div>
                        <input value={design.fontSizes[f.k]} onChange={e => updateFontSizes({ [f.k]: e.target.value })}
                          className="w-full bg-white border border-sand-300 rounded px-2 py-1.5 text-xs text-sand-900 font-mono outline-none focus:border-terra-400 transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              </PanelSection>
            </>
          )}

          {/* ===== TAB: LAYOUT ===== */}
          {tab === 'layout' && (
            <>
              {/* Amplada de columnes del grid */}
              <PanelSection title="Amplada Columnes (Grid)" icon={Columns} defaultOpen>
                <div className="grid grid-cols-4 gap-2">
                  {COL_LABELS.map((label, i) => (
                    <NumberInput key={i} label={label}
                      value={gridCols[i] || 0}
                      onChange={v => handleColChange(i, v)}
                      min={10} max={300} step={5} />
                  ))}
                </div>
                <div className={`text-xs mt-2 font-mono ${
                  colTotal >= 780 && colTotal <= 800 ? 'text-success' : 'text-warning'
                }`}>
                  Total: {colTotal}px {colTotal >= 780 && colTotal <= 800 ? '✓' : `(objectiu: ~794px)`}
                </div>
              </PanelSection>

              {/* Altures de files / espaiat seccions */}
              <PanelSection title="Espaiat Seccions (Files)" icon={Rows} defaultOpen>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(ROW_LABELS).map(([key, label]) => (
                    <NumberInput key={key} label={label}
                      value={gridRows[key] ?? 20}
                      onChange={v => handleRowChange(key, v)}
                      min={0} max={200} step={2} />
                  ))}
                </div>
              </PanelSection>

              {/* Línies i marges generals */}
              <PanelSection title="Línies i Marges">
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Gruix línies" value={design.layout.borderWidth}
                    onChange={v => updateLayout({ borderWidth: v })} min={0} max={5} />
                  <NumberInput label="Padding footer" value={grid.footerPadding ?? 30}
                    onChange={v => updateGrid({ footerPadding: v })} min={10} max={80} />
                </div>
              </PanelSection>

              {/* Seccions visibles */}
              <PanelSection title="Seccions Visibles">
                <div className="divide-y divide-slate-800/60">
                  {[
                    { k: 'showLogo',           l: 'Mostrar logo / header'     },
                    { k: 'showFooterContact',   l: 'Contacte al peu'          },
                    { k: 'showBankDetails',     l: 'Dades bancàries'          },
                    { k: 'showPaymentMethod',   l: 'Forma de pagament'        },
                    { k: 'showConceptNote',     l: 'Nota al peu del concepte' },
                  ].map(s => (
                    <Toggle key={s.k} label={s.l}
                      checked={design.sections?.[s.k] ?? false}
                      onChange={v => updateSections({ [s.k]: v })} />
                  ))}
                </div>
              </PanelSection>
            </>
          )}

          {/* ===== TAB: CONTINGUT ===== */}
          {tab === 'content' && (
            <>
              {/* Prefix etiquetes */}
              <PanelSection title="Format Etiquetes" icon={Grid} defaultOpen>
                <div>
                  <div className="text-xs text-sand-500 mb-1.5 uppercase font-semibold tracking-wider">Prefix etiquetes seccions</div>
                  <input value={grid.labelPrefix ?? ': '}
                    onChange={e => updateGrid({ labelPrefix: e.target.value })}
                    className="w-full bg-white border border-sand-300 rounded-button px-3 py-2 text-sand-900 text-sm outline-none focus:border-terra-400 transition-colors" />
                  <div className="text-xs text-sand-400 mt-1.5">
                    Resultat: <span className="font-mono text-sand-600">"{(grid.labelPrefix ?? ': ')}{design.labels?.es?.freelance || 'FREELANCE'}"</span>
                  </div>
                </div>
              </PanelSection>

              {/* Labels multi-idioma */}
              <PanelSection title="Texts i Etiquetes" icon={Languages} defaultOpen
                badge="Multi-idioma">
                <div>
                  <div className="text-xs text-sand-500 uppercase font-semibold tracking-wider mb-2">Idioma a editar</div>
                  <Tabs tabs={LANG_TABS.map(t => ({ ...t, id: t.id }))} active={langTab} onChange={setLangTab} />
                </div>
                <LabelEditor
                  labels={design.labels[langTab] || design.labels.es}
                  lang={langTab}
                  onUpdate={updateLabel} />
              </PanelSection>
            </>
          )}
        </div>

        {/* ── RIGHT: LIVE PREVIEW ── */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="bg-white border border-sand-300 rounded-soft overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-sand-300 shrink-0">
              <span className="text-sm font-semibold text-sand-900">Previsualització en viu</span>
              <button onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 text-xs text-sand-600 hover:text-sand-800 transition-colors">
                <Maximize2 size={13} /> Ampliar
              </button>
            </div>
            <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-auto p-3 bg-sand-50">
              <div style={{
                transform: 'scale(var(--preview-scale, 0.5))',
                transformOrigin: 'top left',
                width: '210mm',
                pointerEvents: 'none'
              }}>
                <InvoicePreviewModern invoice={sampleInvoice} client={sampleClient} config={config} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full Preview Modal */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Vista Prèvia de Factura" size="xl">
        <div className="flex justify-center">
          <div className="overflow-auto max-h-[75vh] bg-white rounded-soft shadow-lg" style={{ width: '210mm', maxWidth: '100%' }}>
            <InvoicePreviewModern invoice={sampleInvoice} client={sampleClient} config={config} />
          </div>
        </div>
      </Modal>
    </div>
  );
};

// Wrap amb ErrorBoundary
const DesignEditorSafe = () => (
  <DesignErrorBoundary>
    <DesignEditorInner />
  </DesignErrorBoundary>
);

export { DesignEditorSafe as DesignEditor };
export default DesignEditorSafe;
