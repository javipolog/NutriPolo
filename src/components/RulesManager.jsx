/**
 * RulesManager.jsx
 * ================
 * Gestor visual de regles personalitzades (v2 — conditions/actions).
 * Cada regla pot sobreescriure: proveedor, categoria, IVA, CIF, concepte,
 * deducibilitat i estratègia de data.
 */

import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit2, Check, X,
    Tag, Zap, ToggleLeft, ToggleRight, ChevronDown,
    AlertCircle, BookOpen, ArrowUp, ArrowDown, Shield
} from 'lucide-react';
import { Modal, Button, Select } from './UI';
import { useProviderMemory } from '../services/providerMemory';
import { defaultCategories } from '../stores/store';

// ============================================
// CONSTANTS
// ============================================

const MATCH_FIELD_OPTIONS = [
    { value: 'any',       label: 'Qualsevol camp' },
    { value: 'proveedor', label: 'Sol proveidor' },
    { value: 'concepto',  label: 'Sol concepte' },
    { value: 'filename',  label: 'Sol nom fitxer' },
    { value: 'rawText',   label: 'Text complet PDF' },
    { value: 'cif',       label: 'CIF/NIF del PDF' },
];

const MATCH_MODE_OPTIONS = [
    { value: 'any', label: 'Almenys una paraula' },
    { value: 'all', label: 'Totes les paraules' },
];

const IVA_OPTIONS = [
    { value: '',   label: '— Autodetectar —' },
    { value: '21', label: '21%' },
    { value: '10', label: '10%' },
    { value: '4',  label: '4%' },
    { value: '0',  label: '0% (exempt)' },
];

const DATE_STRATEGY_OPTIONS = [
    { value: '',                    label: '— Autodetectar —' },
    { value: 'nearest_to_keyword',  label: 'Mes propera a keyword' },
    { value: 'first',               label: 'Primera data (mes antiga)' },
    { value: 'last',                label: 'Ultima data (mes recent)' },
];

const CATEGORY_COLORS = {
    'Material de oficina':      { bg: 'bg-amber-500/10',   text: 'text-warning',   dot: 'bg-amber-400' },
    'Software y suscripciones': { bg: 'bg-terra-50',    text: 'text-terra-400',    dot: 'bg-info' },
    'Equipos informáticos':     { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
    'Telecomunicaciones':       { bg: 'bg-violet-500/10',  text: 'text-violet-400',  dot: 'bg-violet-400' },
    'Transporte':               { bg: 'bg-success-light', text: 'text-success', dot: 'bg-success' },
    'Formación':                { bg: 'bg-pink-500/10',    text: 'text-pink-400',    dot: 'bg-pink-400' },
    'Seguros':                  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  dot: 'bg-orange-400' },
    'Gestoría y asesoría':      { bg: 'bg-teal-500/10',    text: 'text-teal-400',    dot: 'bg-teal-400' },
    'Marketing y publicidad':   { bg: 'bg-rose-500/10',    text: 'text-rose-400',    dot: 'bg-rose-400' },
    'Suministros':              { bg: 'bg-lime-500/10',    text: 'text-lime-400',    dot: 'bg-lime-400' },
    'Servicios profesionales':  { bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  dot: 'bg-indigo-400' },
    'Otros':                    { bg: 'bg-sand-100',   text: 'text-sand-600',   dot: 'bg-sand-400' },
};

const getCatColor = (cat) => CATEGORY_COLORS[cat] || { bg: 'bg-sand-100', text: 'text-sand-600', dot: 'bg-sand-400' };

// ============================================
// HELPERS per convertir v1↔v2
// ============================================

/** Extrau les dades d'una regla (v1 o v2) a format pla per al formulari */
const ruleToFormData = (rule) => {
    if (!rule) return null;
    const cond = rule.conditions || {};
    const act = rule.actions || {};
    return {
        name: rule.name || '',
        keywords: cond.keywords || rule.keywords || '',
        matchField: cond.matchField || rule.matchField || 'any',
        matchMode: cond.matchMode || rule.matchMode || 'any',
        // Actions
        proveedor: act.proveedor || '',
        categoria: act.categoria || rule.categoria || '',
        cifNif: act.cifNif || '',
        ivaPorcentaje: act.ivaPorcentaje !== null && act.ivaPorcentaje !== undefined ? String(act.ivaPorcentaje) : '',
        concepto: act.concepto || '',
        deducible: act.deducible !== null && act.deducible !== undefined ? act.deducible : true,
        deduciblePct: act.deduciblePct !== null && act.deduciblePct !== undefined ? String(act.deduciblePct) : '',
        // Date strategy
        datePrefer: act.dateStrategy?.prefer || '',
        dateKeyword: act.dateStrategy?.keyword || '',
        dateSkipKeywords: act.dateStrategy?.skipKeywords?.join(', ') || '',
        dateDayOfMonth: act.dateStrategy?.dayOfMonth ? String(act.dateStrategy.dayOfMonth) : '',
    };
};

/** Converteix dades del formulari al format v2 per al store */
const formDataToRule = (form) => {
    const dateStrategy = form.datePrefer ? {
        prefer: form.datePrefer,
        keyword: form.dateKeyword || null,
        skipKeywords: form.dateSkipKeywords ? form.dateSkipKeywords.split(',').map(s => s.trim()).filter(Boolean) : [],
        dayOfMonth: form.dateDayOfMonth ? parseInt(form.dateDayOfMonth) : null,
    } : null;

    return {
        name: form.name,
        conditions: {
            keywords: form.keywords,
            matchField: form.matchField,
            matchMode: form.matchMode,
        },
        actions: {
            proveedor: form.proveedor || null,
            categoria: form.categoria || null,
            ivaPorcentaje: form.ivaPorcentaje !== '' ? parseInt(form.ivaPorcentaje) : null,
            cifNif: form.cifNif || null,
            concepto: form.concepto || null,
            deducible: form.deduciblePct !== '' ? form.deducible : null,
            deduciblePct: form.deduciblePct !== '' ? parseInt(form.deduciblePct) : null,
            dateStrategy,
        },
    };
};

// ============================================
// EXEMPLE RULES V2 (ampliades)
// ============================================

const EXAMPLE_RULES = [
    {
        name: 'Iberdrola',
        conditions: { keywords: 'iberdrola, i-de redes', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Iberdrola S.A.', categoria: 'Suministros', ivaPorcentaje: 21, cifNif: 'A95075578' },
    },
    {
        name: 'Endesa',
        conditions: { keywords: 'endesa, enel', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Endesa Energia S.A.', categoria: 'Suministros', ivaPorcentaje: 21, cifNif: 'A81948077' },
    },
    {
        name: 'Movistar',
        conditions: { keywords: 'movistar, telefonica, telefonica de espana', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Telefonica de Espana S.A.U.', categoria: 'Telecomunicaciones', ivaPorcentaje: 21, cifNif: 'A82018474' },
    },
    {
        name: 'Vodafone',
        conditions: { keywords: 'vodafone', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Vodafone Espana S.A.U.', categoria: 'Telecomunicaciones', ivaPorcentaje: 21, cifNif: 'A80907397' },
    },
    {
        name: 'Adobe',
        conditions: { keywords: 'adobe', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Adobe Systems', categoria: 'Software y suscripciones', ivaPorcentaje: 21 },
    },
    {
        name: 'Amazon (equips)',
        conditions: { keywords: 'amazon', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Amazon EU S.a r.l.', categoria: 'Equipos informaticos', ivaPorcentaje: 21 },
    },
    {
        name: 'Seguretat Social / RETA',
        conditions: { keywords: 'seguridad social, TGSS', matchField: 'any', matchMode: 'any' },
        actions: { proveedor: 'Seguridad Social', categoria: 'Seguros', ivaPorcentaje: 0 },
    },
    {
        name: 'Asseguranca RC',
        conditions: { keywords: 'mapfre, axa, allianz, zurich, seguro profesional', matchField: 'any', matchMode: 'any' },
        actions: { categoria: 'Seguros', ivaPorcentaje: 0 },
    },
    {
        name: 'Gasolinera',
        conditions: { keywords: 'repsol, cepsa, bp, shell, galp, gasolina, combustible', matchField: 'any', matchMode: 'any' },
        actions: { categoria: 'Transporte', ivaPorcentaje: 21 },
    },
    {
        name: 'Gestoria',
        conditions: { keywords: 'gestoria, gestoria, asesoria, asesoria', matchField: 'any', matchMode: 'any' },
        actions: { categoria: 'Gestoria y asesoria', ivaPorcentaje: 21 },
    },
];

// ============================================
// FORM RULE (crear / editar — v2)
// ============================================

const EMPTY_FORM = {
    name: '', keywords: '', matchField: 'any', matchMode: 'any',
    proveedor: '', categoria: '', cifNif: '', ivaPorcentaje: '',
    concepto: '', deducible: true, deduciblePct: '',
    datePrefer: '', dateKeyword: '', dateSkipKeywords: '', dateDayOfMonth: '',
};

const RuleForm = ({ initial, onSave, onCancel }) => {
    const initData = initial ? ruleToFormData(initial) : EMPTY_FORM;
    const [form, setForm] = useState({ ...EMPTY_FORM, ...initData });
    const [error, setError] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Fase 3.2 fix: re-inicialitzar el formulari quan `initial` canvia
    // (useState només corre una vegada al muntar; useEffect detecta canvis posteriors)
    useEffect(() => {
        const newInitData = initial ? ruleToFormData(initial) : EMPTY_FORM;
        setForm({ ...EMPTY_FORM, ...newInitData });
        setError('');
    }, [initial]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.keywords.trim()) return setError('Cal almenys una paraula clau.');
        // Almenys una acció ha d'estar configurada
        const hasAction = form.categoria || form.proveedor || form.cifNif ||
            form.ivaPorcentaje !== '' || form.concepto || form.datePrefer;
        if (!hasAction) return setError('Cal configurar almenys una accio (categoria, proveidor, IVA...).');
        setError('');
        onSave(formDataToRule(form));
    };

    const keywords = form.keywords.split(',').map(k => k.trim()).filter(Boolean);

    // Comptar accions configurades
    const actionCount = [
        form.proveedor, form.categoria, form.cifNif,
        form.ivaPorcentaje !== '' ? 'x' : '', form.concepto,
        form.deduciblePct !== '' ? 'x' : '', form.datePrefer,
    ].filter(Boolean).length;

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nom */}
            <div>
                <label className="text-xs text-sand-600 font-semibold uppercase tracking-wider mb-1.5 block">
                    Nom de la regla <span className="text-sand-400 normal-case font-normal">(opcional)</span>
                </label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                    placeholder="Ex: Iberdrola, Adobe..."
                    className="w-full bg-sand-100 border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400 transition-colors" />
            </div>

            {/* ── QUAN DETECTAR ── */}
            <div className="bg-sand-100 rounded-soft p-3 border border-sand-300/30">
                <h5 className="text-[10px] text-sand-500 uppercase font-bold tracking-widest mb-3">Quan detectar</h5>
                <div>
                    <label className="text-xs text-sand-600 font-semibold uppercase tracking-wider mb-1.5 block">
                        Paraules clau <span className="text-danger">*</span>
                        <span className="text-sand-400 normal-case font-normal ml-1">— separades per comes</span>
                    </label>
                    <input value={form.keywords} onChange={e => set('keywords', e.target.value)}
                        placeholder="Ex: iberdrola, i-de redes"
                        className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400 font-mono"
                        autoFocus />
                    {keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {keywords.map((kw, i) => (
                                <span key={i} className="bg-terra-50 text-terra-500 border border-terra-300 text-xs px-2 py-0.5 rounded-full font-mono">{kw}</span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Cerca en</label>
                        <Select value={form.matchField} onChange={e => set('matchField', e.target.value)}
                            options={MATCH_FIELD_OPTIONS} className="bg-white border-sand-300 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Condicio</label>
                        <Select value={form.matchMode} onChange={e => set('matchMode', e.target.value)}
                            options={MATCH_MODE_OPTIONS} className="bg-white border-sand-300 text-sm" />
                    </div>
                </div>
            </div>

            {/* ── QUE ASSIGNAR ── */}
            <div className="bg-sand-100 rounded-soft p-3 border border-sand-300/30">
                <h5 className="text-[10px] text-sand-500 uppercase font-bold tracking-widest mb-3">
                    Que assignar <span className="text-sand-400 normal-case font-normal">(deixar buit = autodetectar)</span>
                    {actionCount > 0 && <span className="ml-2 text-terra-400">{actionCount} camp{actionCount > 1 ? 's' : ''}</span>}
                </h5>

                <div className="space-y-3">
                    {/* Proveidor */}
                    <div>
                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Proveidor</label>
                        <input value={form.proveedor} onChange={e => set('proveedor', e.target.value)}
                            placeholder="Ex: Iberdrola S.A."
                            className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400" />
                    </div>

                    {/* Categoria */}
                    <div>
                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Categoria</label>
                        <Select value={form.categoria} onChange={e => set('categoria', e.target.value)}
                            options={[{ value: '', label: '— Autodetectar —' }, ...defaultCategories.map(c => ({ value: c, label: c }))]}
                            className="bg-white border-sand-300" />
                        {form.categoria && (
                            <div className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${getCatColor(form.categoria).bg} ${getCatColor(form.categoria).text}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${getCatColor(form.categoria).dot}`} />
                                {form.categoria}
                            </div>
                        )}
                    </div>

                    {/* CIF + IVA en línia */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">CIF/NIF</label>
                            <input value={form.cifNif} onChange={e => set('cifNif', e.target.value.toUpperCase())}
                                placeholder="A12345678"
                                className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400 font-mono" />
                        </div>
                        <div>
                            <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">IVA</label>
                            <Select value={form.ivaPorcentaje} onChange={e => set('ivaPorcentaje', e.target.value)}
                                options={IVA_OPTIONS} className="bg-white border-sand-300" />
                        </div>
                    </div>

                    {/* Concepte */}
                    <div>
                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Concepte</label>
                        <input value={form.concepto} onChange={e => set('concepto', e.target.value)}
                            placeholder="Ex: Subministrament electric"
                            className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400" />
                    </div>
                </div>

                {/* Avançat: Deduible + Data */}
                <details className="mt-3 group" open={showAdvanced}>
                    <summary onClick={e => { e.preventDefault(); setShowAdvanced(v => !v); }}
                        className="flex items-center gap-2 text-xs text-sand-500 hover:text-sand-700 cursor-pointer select-none transition-colors list-none">
                        <ChevronDown size={13} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        Opcions avancades (deduibilitat, data)
                    </summary>
                    {showAdvanced && (
                        <div className="mt-3 space-y-3 pl-3 border-l border-sand-200">
                            {/* Deduible */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Deduible IRPF</label>
                                    <Select value={form.deduciblePct !== '' ? 'custom' : ''}
                                        onChange={e => {
                                            if (e.target.value === '') { set('deduciblePct', ''); set('deducible', true); }
                                            else { set('deduciblePct', '100'); set('deducible', true); }
                                        }}
                                        options={[
                                            { value: '', label: '— Autodetectar —' },
                                            { value: 'custom', label: 'Personalitzat' },
                                        ]}
                                        className="bg-white border-sand-300 text-sm" />
                                </div>
                                {form.deduciblePct !== '' && (
                                    <div>
                                        <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">% Deduible</label>
                                        <input type="number" min="0" max="100" value={form.deduciblePct}
                                            onChange={e => set('deduciblePct', e.target.value)}
                                            className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400 font-mono" />
                                    </div>
                                )}
                            </div>

                            {/* Data strategy */}
                            <div>
                                <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Estrategia de data</label>
                                <Select value={form.datePrefer} onChange={e => set('datePrefer', e.target.value)}
                                    options={DATE_STRATEGY_OPTIONS}
                                    className="bg-white border-sand-300 text-sm" />
                            </div>
                            {form.datePrefer === 'nearest_to_keyword' && (
                                <div>
                                    <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Keyword de data</label>
                                    <input value={form.dateKeyword} onChange={e => set('dateKeyword', e.target.value)}
                                        placeholder="fecha emision, fecha factura..."
                                        className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400" />
                                </div>
                            )}
                            {form.datePrefer && (
                                <div>
                                    <label className="text-xs text-sand-500 uppercase font-semibold mb-1 block">Ignorar dates amb</label>
                                    <input value={form.dateSkipKeywords} onChange={e => set('dateSkipKeywords', e.target.value)}
                                        placeholder="vencimiento, periodo, entrega..."
                                        className="w-full bg-white border border-sand-300 text-sand-900 px-3 py-2 rounded-button text-sm outline-none focus:border-terra-400 font-mono" />
                                </div>
                            )}
                        </div>
                    )}
                </details>
            </div>

            {error && (
                <div className="flex items-center gap-2 bg-danger-light border border-danger/20 text-danger text-xs p-2.5 rounded-button">
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onCancel} size="sm">Cancel-lar</Button>
                <Button type="submit" size="sm" className="bg-terra-400 hover:bg-terra-500 px-5">
                    <Check size={14} className="mr-1.5" /> Guardar regla
                </Button>
            </div>
        </form>
    );
};

// ============================================
// RULE CARD (v2 — mostra accions configurades)
// ============================================

const RuleCard = ({ rule, index, total, onEdit, onDelete, onToggle, onMoveUp, onMoveDown }) => {
    const cond = rule.conditions || {};
    const act = rule.actions || {};
    const cat = act.categoria || rule.categoria || '';
    const colors = getCatColor(cat);
    const keywords = (cond.keywords || rule.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    const matchField = cond.matchField || rule.matchField || 'any';
    const matchMode = cond.matchMode || rule.matchMode || 'any';

    // Resum de les accions configurades
    const actionTags = [];
    if (act.proveedor) actionTags.push({ label: act.proveedor, color: 'text-sand-900' });
    if (act.cifNif) actionTags.push({ label: `CIF: ${act.cifNif}`, color: 'text-sand-600' });
    if (act.ivaPorcentaje !== null && act.ivaPorcentaje !== undefined) actionTags.push({ label: `IVA ${act.ivaPorcentaje}%`, color: 'text-yellow-400' });
    if (act.concepto) actionTags.push({ label: act.concepto, color: 'text-sand-600' });
    if (act.deduciblePct !== null && act.deduciblePct !== undefined) actionTags.push({ label: `Ded. ${act.deduciblePct}%`, color: 'text-green-400' });
    if (act.dateStrategy) actionTags.push({ label: 'Data', color: 'text-purple-400' });

    return (
        <div className={`group flex items-center gap-3 p-3 rounded-soft border transition-all ${
            rule.enabled !== false
                ? 'bg-sand-100 border-sand-200 hover:border-sand-400/50'
                : 'bg-white border-sand-200 opacity-50'
        }`}>
            {/* Priority */}
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <button onClick={onMoveUp} disabled={index === 0}
                    className="text-sand-400 hover:text-sand-700 disabled:opacity-20 transition-colors p-0.5">
                    <ArrowUp size={12} />
                </button>
                <span className="text-[10px] text-sand-400 font-mono font-bold w-4 text-center">{index + 1}</span>
                <button onClick={onMoveDown} disabled={index === total - 1}
                    className="text-sand-400 hover:text-sand-700 disabled:opacity-20 transition-colors p-0.5">
                    <ArrowDown size={12} />
                </button>
            </div>

            {/* Contingut */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {rule.name && <span className="text-sand-900 text-sm font-semibold">{rule.name}</span>}
                    <div className="flex flex-wrap gap-1">
                        {keywords.slice(0, 4).map((kw, i) => (
                            <span key={i} className="bg-sand-200/80 text-sand-700 text-[10px] px-1.5 py-0.5 rounded font-mono border border-sand-400/30">{kw}</span>
                        ))}
                        {keywords.length > 4 && <span className="text-sand-500 text-[10px] px-1">+{keywords.length - 4}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-sand-400 text-xs">-&gt;</span>
                    {cat && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${colors.bg} ${colors.text}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            {cat}
                        </span>
                    )}
                    {actionTags.map((tag, i) => (
                        <span key={i} className={`text-[10px] ${tag.color} bg-sand-100 px-1.5 py-0.5 rounded border border-sand-200`}>
                            {tag.label}
                        </span>
                    ))}
                    {matchField !== 'any' && (
                        <span className="text-sand-400 text-[10px]">
                            en {MATCH_FIELD_OPTIONS.find(o => o.value === matchField)?.label?.toLowerCase()}
                        </span>
                    )}
                    {matchMode === 'all' && (
                        <span className="text-sand-400 text-[10px] border border-sand-300 px-1 rounded">TOTES</span>
                    )}
                </div>
            </div>

            {/* Accions */}
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={onToggle} title={rule.enabled !== false ? 'Desactivar' : 'Activar'}
                    className="p-1.5 rounded-button hover:bg-sand-200 text-sand-500 hover:text-sand-800 transition-colors">
                    {rule.enabled !== false ? <ToggleRight size={16} className="text-success" /> : <ToggleLeft size={16} />}
                </button>
                <button onClick={onEdit}
                    className="p-1.5 rounded-button hover:bg-sand-200 text-sand-500 hover:text-terra-400 transition-colors">
                    <Edit2 size={14} />
                </button>
                <button onClick={onDelete}
                    className="p-1.5 rounded-button hover:bg-danger-light text-sand-500 hover:text-danger transition-colors">
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
};

// ============================================
// MAIN COMPONENT
// ============================================

export const RulesManager = ({ open, onClose, initialRule }) => {
    const {
        customRules,
        addCustomRule,
        updateCustomRule,
        removeCustomRule,
        reorderCustomRules,
    } = useProviderMemory();

    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState(null);
    // Fase 3.2: prefillData per obrir el formulari pre-omplert des del ScanResultModal
    const [prefillData, setPrefillData] = useState(null);
    const [showExamples, setShowExamples] = useState(false);

    // Fase 3.2: quan s'obre el modal amb initialRule, obrir formulari pre-omplert
    useEffect(() => {
        if (open && initialRule) {
            setEditingRule(null);
            setPrefillData(initialRule);
            setShowForm(true);
            setShowExamples(false);
        }
        if (!open) {
            setPrefillData(null);
            setShowForm(false);
            setEditingRule(null);
        }
    }, [open, initialRule]);

    const sortedRules = [...customRules].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    const handleSave = (formData) => {
        if (editingRule) {
            updateCustomRule(editingRule.id, formData);
        } else {
            addCustomRule(formData);
        }
        setShowForm(false);
        setEditingRule(null);
        setPrefillData(null);
    };

    const handleEdit = (rule) => {
        setEditingRule(rule);
        setPrefillData(null);
        setShowForm(true);
    };

    const handleDelete = (id) => removeCustomRule(id);

    const handleToggle = (rule) => {
        updateCustomRule(rule.id, { enabled: rule.enabled === false ? true : false });
    };

    const handleMoveUp = (index) => {
        if (index === 0) return;
        const ids = sortedRules.map(r => r.id);
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
        reorderCustomRules(ids);
    };

    const handleMoveDown = (index) => {
        if (index === sortedRules.length - 1) return;
        const ids = sortedRules.map(r => r.id);
        [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
        reorderCustomRules(ids);
    };

    const handleAddExample = (example) => addCustomRule(example);

    const handleCancelForm = () => {
        setShowForm(false);
        setEditingRule(null);
        setPrefillData(null);
    };

    const activeCount = sortedRules.filter(r => r.enabled !== false).length;

    // Helper per comparar si una regla d'exemple ja existeix
    const isExampleAdded = (ex) => {
        return sortedRules.some(r => {
            const rName = r.name?.toLowerCase();
            const exName = ex.name?.toLowerCase();
            const rKeywords = (r.conditions?.keywords || r.keywords || '').toLowerCase();
            const exKeywords = (ex.conditions?.keywords || '').toLowerCase();
            return rName === exName || rKeywords === exKeywords;
        });
    };

    return (
        <Modal open={open} onClose={onClose} title="Regles de Categoritzacio" size="lg">
            <div className="space-y-4">

                {/* Capcalera */}
                <div className="flex items-start gap-3 bg-terra-50/50 border border-terra-300/30 rounded-soft p-3">
                    <Shield size={16} className="text-terra-400 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm text-sand-700 leading-relaxed">
                            Les regles s'apliquen <strong className="text-sand-900">per ordre de prioritat</strong> i poden forcar
                            <strong className="text-terra-400"> proveidor, categoria, IVA, CIF</strong> i mes.
                            Els camps no configurats es detecten automaticament.
                        </p>
                        {sortedRules.length > 0 && (
                            <p className="text-xs text-sand-500 mt-1">
                                {activeCount} regla{activeCount !== 1 ? 's' : ''} activa{activeCount !== 1 ? 's' : ''} de {sortedRules.length}
                            </p>
                        )}
                    </div>
                </div>

                {/* FORM */}
                {showForm ? (
                    <div className="bg-white border border-sand-200 rounded-soft p-4">
                        <h4 className="text-sm font-bold text-sand-900 mb-4 flex items-center gap-2">
                            {editingRule ? <Edit2 size={14} className="text-terra-400" /> : <Plus size={14} className="text-terra-400" />}
                            {editingRule ? 'Editar regla' : prefillData ? 'Nova regla (pre-omplerta)' : 'Nova regla'}
                        </h4>
                        {/* Fase 3.2: passar prefillData com a initial quan editingRule és null */}
                        <RuleForm initial={editingRule || prefillData} onSave={handleSave} onCancel={handleCancelForm} />
                    </div>
                ) : (
                    <Button
                        onClick={() => { setEditingRule(null); setPrefillData(null); setShowForm(true); }}
                        icon={Plus}
                        className="w-full bg-terra-400/20 hover:bg-terra-400/30 text-terra-400 border border-terra-200 hover:border-terra-200 justify-center"
                        variant="ghost"
                    >
                        Nova regla personalitzada
                    </Button>
                )}

                {/* LLISTA */}
                {sortedRules.length > 0 ? (
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1 custom-scrollbar">
                        {sortedRules.map((rule, idx) => (
                            <RuleCard key={rule.id} rule={rule} index={idx} total={sortedRules.length}
                                onEdit={() => handleEdit(rule)}
                                onDelete={() => handleDelete(rule.id)}
                                onToggle={() => handleToggle(rule)}
                                onMoveUp={() => handleMoveUp(idx)}
                                onMoveDown={() => handleMoveDown(idx)} />
                        ))}
                    </div>
                ) : !showForm && (
                    <div className="text-center py-8 text-sand-400">
                        <Tag size={32} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium text-sand-500">Encara no hi ha regles</p>
                        <p className="text-xs mt-1">Crea la teua primera regla o importa els exemples de sota.</p>
                    </div>
                )}

                {/* EXEMPLES */}
                {!showForm && (
                    <div className="border-t border-sand-300 pt-4">
                        <button onClick={() => setShowExamples(v => !v)}
                            className="flex items-center gap-2 text-xs text-sand-500 hover:text-sand-700 transition-colors w-full">
                            <BookOpen size={13} />
                            <span>Exemples de regles rapides ({EXAMPLE_RULES.length})</span>
                            <ChevronDown size={12} className={`ml-auto transition-transform ${showExamples ? 'rotate-180' : ''}`} />
                        </button>
                        {showExamples && (
                            <div className="mt-3 space-y-1.5 max-h-[30vh] overflow-y-auto pr-1 custom-scrollbar">
                                {EXAMPLE_RULES.map((ex, i) => {
                                    const exCat = ex.actions?.categoria || '';
                                    const exColors = getCatColor(exCat);
                                    const added = isExampleAdded(ex);
                                    const exKeywords = ex.conditions?.keywords || '';
                                    const exActions = [];
                                    if (ex.actions?.proveedor) exActions.push(ex.actions.proveedor);
                                    if (ex.actions?.ivaPorcentaje !== null && ex.actions?.ivaPorcentaje !== undefined) exActions.push(`IVA ${ex.actions.ivaPorcentaje}%`);
                                    if (ex.actions?.cifNif) exActions.push(`CIF: ${ex.actions.cifNif}`);

                                    return (
                                        <div key={i} className="flex items-center gap-3 bg-white border border-sand-300 rounded-button px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-sand-700 font-medium">{ex.name}</span>
                                                    <span className="text-sand-400 text-xs">-&gt;</span>
                                                    {exCat && <span className={`text-xs font-semibold ${exColors.text}`}>{exCat}</span>}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-sand-400 font-mono truncate">{exKeywords}</span>
                                                    {exActions.length > 0 && (
                                                        <span className="text-[10px] text-sand-500">{exActions.join(' | ')}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <button onClick={() => !added && handleAddExample(ex)} disabled={added}
                                                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-button font-semibold transition-all flex-shrink-0 ${
                                                    added
                                                        ? 'text-success bg-success-light border border-success/20 cursor-default'
                                                        : 'text-terra-400 bg-terra-50 border border-terra-200 hover:bg-terra-50'
                                                }`}>
                                                {added ? <><Check size={11} /> Afegida</> : <><Plus size={11} /> Afegir</>}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-end pt-2 border-t border-sand-300">
                    <Button onClick={onClose} className="bg-terra-400 hover:bg-terra-500 px-6">Tancar</Button>
                </div>
            </div>
        </Modal>
    );
};
