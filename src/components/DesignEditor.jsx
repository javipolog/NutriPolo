import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Palette, Type, Image, Layout, Eye, RotateCcw, Upload, Check,
  ChevronDown, ChevronUp, Sliders, Grid, AlignLeft, AlignCenter,
  AlignRight, Columns, Rows, Table2, Languages, Maximize2, X,
  ToggleLeft, ToggleRight, Minus, Plus
} from 'lucide-react';
import { Button, Card, Modal } from './UI';
import { useDesignStore, designPresets, availableFonts, loadGoogleFonts } from '../stores/designStore';
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
          <div className="text-red-400 text-lg font-semibold">Error al carregar el dissenyador</div>
          <p className="text-slate-400 text-sm text-center max-w-md">
            Pot ser que les dades guardades estiguen corruptes. Prova a restaurar els valors per defecte.
          </p>
          <button onClick={() => {
            try { useDesignStore.getState().resetDesign(); } catch(e) { console.error(e); }
            this.setState({ hasError: false, error: null });
          }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            Restaurar i reintentar
          </button>
          <details className="text-xs text-slate-600 mt-2 max-w-md">
            <summary className="cursor-pointer">Detalls de l'error</summary>
            <pre className="mt-2 p-2 bg-slate-900 rounded text-slate-400 overflow-auto">{this.state.error?.message}</pre>
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
    <label className={`${dim} rounded-lg border-2 border-slate-600 cursor-pointer relative overflow-hidden shrink-0 hover:border-slate-400 transition-colors`}
      style={{ backgroundColor: value }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
    </label>
  );
};

const ColorRow = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3 py-2">
    <ColorSwatch value={value} onChange={onChange} />
    <div className="flex-1 min-w-0">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-white font-mono outline-none focus:border-blue-500 transition-colors" />
    </div>
  </div>
);

const NumberInput = ({ label, value, onChange, min = 0, max = 200, step = 1, unit = 'px' }) => (
  <div>
    {label && <div className="text-xs text-slate-500 mb-1.5 uppercase font-semibold tracking-wider">{label}</div>}
    <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 focus-within:border-blue-500 transition-colors">
      <button onClick={() => onChange(Math.max(min, value - step))} className="text-slate-500 hover:text-white transition-colors p-0.5"><Minus size={12} /></button>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 bg-transparent text-white text-sm text-center outline-none w-0 min-w-0" />
      <button onClick={() => onChange(Math.min(max, value + step))} className="text-slate-500 hover:text-white transition-colors p-0.5"><Plus size={12} /></button>
      {unit && <span className="text-slate-500 text-xs">{unit}</span>}
    </div>
  </div>
);

const FontSelect = ({ label, value, onChange, filter }) => {
  const fonts = filter ? availableFonts.filter(f => f.type === filter) : availableFonts;
  const grouped = fonts.reduce((g, f) => { (g[f.type] = g[f.type] || []).push(f); return g; }, {});
  const designFonts = useDesignStore(s => s.design.fonts);
  return (
    <div>
      {label && <div className="text-xs text-slate-500 mb-1.5 uppercase font-semibold tracking-wider">{label}</div>}
      <select value={value} onChange={e => { onChange(e.target.value); loadGoogleFonts({ ...designFonts, [filter === 'mono' ? 'mono' : label?.includes('Principal') ? 'primary' : 'secondary']: e.target.value }); }}
        className="w-full bg-slate-900 border border-slate-700 text-white text-sm px-3 py-2 rounded-lg outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer">
        {Object.entries(grouped).map(([type, list]) => (
          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} className="bg-slate-800">
            {list.map(f => <option key={f.value} value={f.value} className="bg-slate-800">{f.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer py-1.5 group">
    <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
    <div onClick={() => onChange(!checked)}
      className={`w-9 h-5 rounded-full relative transition-colors duration-200 cursor-pointer shrink-0 ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}>
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
  </label>
);

const RadioGroup = ({ label, value, onChange, options }) => (
  <div>
    {label && <div className="text-xs text-slate-500 mb-2 uppercase font-semibold tracking-wider">{label}</div>}
    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg">
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          title={opt.label}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
            value === opt.value ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
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
    <div className="border border-slate-800/60 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/20 hover:bg-slate-800/40 transition-colors text-left">
        {Icon && <Icon size={15} className="text-blue-400 shrink-0" />}
        <span className="font-semibold text-white text-sm flex-1">{title}</span>
        {badge && <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 rounded">{badge}</span>}
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3 bg-slate-900/20">{children}</div>}
    </div>
  );
};

// Tab nav
const Tabs = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
    {tabs.map(t => (
      <button key={t.id} onClick={() => onChange(t.id)}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
          active === t.id ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'
        }`}>
        {t.icon && <t.icon size={13} />}
        {t.label}
      </button>
    ))}
  </div>
);

// ============================================
// PRESET CARD
// ============================================
const PresetCard = ({ id, preset, active, onClick }) => (
  <button onClick={onClick}
    className={`p-3 rounded-xl border-2 text-left transition-all w-full ${
      active ? 'border-blue-500 bg-blue-500/8' : 'border-slate-700/50 hover:border-slate-600 bg-slate-800/20'
    }`}>
    <div className="flex items-center gap-2 mb-2">
      <div className="flex gap-1">
        {preset.thumb.map((c, i) => (
          <div key={i} className={`rounded ${i === 0 ? 'w-4 h-4' : 'w-3 h-3 mt-0.5'}`} style={{ backgroundColor: c }} />
        ))}
      </div>
      {active && <Check size={12} className="text-blue-400 ml-auto" />}
    </div>
    <div className="text-sm font-bold text-white">{preset.name}</div>
    <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{preset.description}</div>
  </button>
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
          <span className="text-xs text-slate-500 w-32 shrink-0">{f.label}</span>
          <input value={labels[f.key] || ''} onChange={e => onUpdate(lang, f.key, e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500 transition-colors" />
        </div>
      ))}
    </div>
  );
};

// ============================================
// MAIN EDITOR
// ============================================

export const DesignEditorInner = () => {
  const { config, clients, invoices } = useStore();
  const { design, updateLogo, updateFonts, updateColors, updateLayout, updateSections,
          updateFontSizes, updateTable, updateBlocks, updateLabel, applyPreset, resetDesign } = useDesignStore();

  const [tab, setTab]           = useState('style');
  const [langTab, setLangTab]   = useState('es');
  const [showPreview, setShowPreview] = useState(false);
  const [saved, setSaved]       = useState(false);
  const fileInputRef = useRef(null);
  const previewContainerRef = useRef(null);

  // Auto-scale preview to fit container
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;
    const A4_WIDTH_PX = 793.7; // 210mm in px at 96dpi

    const updateScale = () => {
      const availableWidth = container.clientWidth - 24; // padding
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Disseny de Factura</h1>
          <p className="text-slate-400 text-sm mt-0.5">Personalitza l'aspecte i l'estructura de les teues factures</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RotateCcw} onClick={resetDesign} size="sm">Restaurar</Button>
          <Button variant="secondary" icon={Eye} onClick={() => setShowPreview(true)} size="sm">Vista Prèvia</Button>
          <Button icon={saved ? Check : Sliders} onClick={handleSave} size="sm"
            className={saved ? 'bg-emerald-600 hover:bg-emerald-500' : ''}>
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
              {/* Presets */}
              <div>
                <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Plantilles</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(designPresets).map(([id, preset]) => (
                    <PresetCard key={id} id={id} preset={preset}
                      active={design.activePreset === id}
                      onClick={() => applyPreset(id)} />
                  ))}
                </div>
              </div>

              {/* Logo */}
              <PanelSection title="Logo" icon={Image} defaultOpen>
                <div>
                  <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Tipus</div>
                  <div className="flex gap-1 bg-slate-900 p-1 rounded-lg mb-3">
                    {[{v:'text',l:'Text'},{v:'image',l:'Imatge'},{v:'svg',l:'SVG'}].map(o => (
                      <button key={o.v} onClick={() => updateLogo({ type: o.v })}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${design.logo.type === o.v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>

                {design.logo.type === 'text' && (
                  <div>
                    <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1.5">Text del logo</div>
                    <input value={design.logo.text} onChange={e => updateLogo({ text: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500 transition-colors" />
                  </div>
                )}

                {design.logo.type === 'image' && (
                  <div className="space-y-2">
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-lg py-4 text-slate-400 hover:text-blue-400 transition-colors text-sm font-medium">
                      <Upload size={16} /> Pujar imatge
                    </button>
                    {design.logo.imageUrl && (
                      <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-2">
                        <img src={design.logo.imageUrl} alt="Logo preview" className="h-8 object-contain" />
                        <button onClick={() => updateLogo({ imageUrl: '' })} className="ml-auto text-slate-500 hover:text-red-400 transition-colors"><X size={14} /></button>
                      </div>
                    )}
                  </div>
                )}

                {design.logo.type === 'svg' && (
                  <div>
                    <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-1.5">Codi SVG</div>
                    <textarea value={design.logo.svgContent} onChange={e => updateLogo({ svgContent: e.target.value })}
                      rows={5}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-mono outline-none focus:border-blue-500 transition-colors resize-none"
                      placeholder='<svg viewBox="0 0 200 50">...</svg>' />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Ample" value={design.logo.width} onChange={v => updateLogo({ width: v })} min={40} max={400} step={10} />
                  <NumberInput label="Alt" value={design.logo.height} onChange={v => updateLogo({ height: v })} min={20} max={200} step={5} />
                </div>
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
                    { key: 'tableHead',  label: 'Fons capçalera taula' },
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

                <div className="pt-2 border-t border-slate-800">
                  <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-3">Mides de lletra</div>
                  <div className="grid grid-cols-2 gap-3">
                    {[{k:'header',l:'Capçaleres'},{k:'body',l:'Cos'},{k:'small',l:'Petit'},{k:'total',l:'Total'}].map(f => (
                      <div key={f.k}>
                        <div className="text-xs text-slate-500 mb-1">{f.l}</div>
                        <input value={design.fontSizes[f.k]} onChange={e => updateFontSizes({ [f.k]: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono outline-none focus:border-blue-500 transition-colors" />
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
              {/* Header layout */}
              <PanelSection title="Capçalera" icon={Layout} defaultOpen>
                <RadioGroup label="Posició logo" value={design.layout.headerLayout}
                  onChange={v => updateLayout({ headerLayout: v })}
                  options={[
                    { value: 'logo-left',   icon: AlignLeft,   label: 'Esquerra' },
                    { value: 'logo-center', icon: AlignCenter, label: 'Centre'   },
                    { value: 'logo-right',  icon: AlignRight,  label: 'Dreta'    },
                  ]} />
              </PanelSection>

              {/* Parties layout */}
              <PanelSection title="Bloc Autònom / Client" icon={Columns}>
                <RadioGroup label="Distribució" value={design.layout.partyLayout}
                  onChange={v => updateLayout({ partyLayout: v })}
                  options={[
                    { value: 'two-col', icon: Columns, label: '2 Columnes' },
                    { value: 'stacked', icon: Rows,    label: 'Apilat'     },
                  ]} />
              </PanelSection>

              {/* Table style */}
              <PanelSection title="Taula de Conceptes" icon={Table2}>
                <div>
                  <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Estil de taula</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: 'lines',    l: 'Línies',    desc: 'Separadors horitz.' },
                      { v: 'zebra',    l: 'Zebra',     desc: 'Files alternades'   },
                      { v: 'bordered', l: 'Bordes',    desc: 'Tots els marges'    },
                      { v: 'minimal',  l: 'Mínim',     desc: 'Sense línies'       },
                    ].map(o => (
                      <button key={o.v} onClick={() => updateTable({ style: o.v })}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                          design.table.style === o.v ? 'border-blue-500 bg-blue-500/8 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                        }`}>
                        <div className="font-semibold">{o.l}</div>
                        <div className="text-[10px] mt-0.5 opacity-70">{o.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <Toggle label="Fons capçalera taula" checked={design.table.headerBg}
                  onChange={v => updateTable({ headerBg: v })} />
                <NumberInput label="Padding files" value={design.table.rowPadding}
                  onChange={v => updateTable({ rowPadding: v })} min={2} max={30} />
              </PanelSection>

              {/* Totals position */}
              <PanelSection title="Bloc Totals" icon={AlignRight}>
                <RadioGroup label="Alineació dels totals" value={design.layout.totalsAlign}
                  onChange={v => updateLayout({ totalsAlign: v })}
                  options={[
                    { value: 'left',   icon: AlignLeft,   label: 'Esquerra' },
                    { value: 'center', icon: AlignCenter, label: 'Centre'   },
                    { value: 'right',  icon: AlignRight,  label: 'Dreta'    },
                  ]} />
              </PanelSection>

              {/* Spacing */}
              <PanelSection title="Espaiat i Marges">
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Marge pàgina" value={design.layout.pageMargin}
                    onChange={v => updateLayout({ pageMargin: v })} min={10} max={80} />
                  <NumberInput label="Gruix línies" value={design.layout.borderWidth}
                    onChange={v => updateLayout({ borderWidth: v })} min={0} max={5} />
                </div>
                <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mt-2 mb-2">Espai inferior per bloc (px)</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { k: 'header',  l: 'Capçalera' },
                    { k: 'parties', l: 'Parts'     },
                    { k: 'concept', l: 'Concepte'  },
                    { k: 'totals',  l: 'Totals'    },
                  ].map(b => (
                    <NumberInput key={b.k} label={b.l}
                      value={(design.blocks?.[b.k]?.marginBottom) ?? 60}
                      onChange={v => updateBlocks({ [b.k]: { marginBottom: v } })}
                      min={0} max={200} step={5} />
                  ))}
                </div>
              </PanelSection>

              {/* Sections visibility */}
              <PanelSection title="Seccions Visibles">
                <div className="divide-y divide-slate-800/60">
                  {[
                    { k: 'showLogo',           l: 'Mostrar logo'              },
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
              <PanelSection title="Texts i Etiquetes" icon={Languages} defaultOpen
                badge="Multi-idioma">
                <div>
                  <div className="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Idioma a editar</div>
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 shrink-0">
              <span className="text-sm font-semibold text-white">Previsualització en viu</span>
              <button onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                <Maximize2 size={13} /> Ampliar
              </button>
            </div>
            <div ref={previewContainerRef} className="flex-1 min-h-0 overflow-auto p-3 bg-slate-800/30">
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
          <div className="overflow-auto max-h-[75vh] bg-white rounded-xl shadow-lg" style={{ width: '210mm', maxWidth: '100%' }}>
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
