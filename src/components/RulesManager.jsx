/**
 * RulesManager.jsx
 * ================
 * Gestor visual de regles personalitzades de categorització.
 * Permet crear, editar, reordenar i desactivar regles que
 * detecten paraules clau i assignen categories automàticament.
 */

import React, { useState, useRef } from 'react';
import {
    Plus, Trash2, Edit2, Check, X, GripVertical,
    Tag, Zap, ToggleLeft, ToggleRight, ChevronDown,
    AlertCircle, BookOpen, ArrowUp, ArrowDown, Copy
} from 'lucide-react';
import { Modal, Button, Select } from './UI';
import { useProviderMemory } from '../services/providerMemory';
import { defaultCategories } from '../stores/store';

// ============================================
// CONSTANTS
// ============================================

const MATCH_FIELD_OPTIONS = [
    { value: 'any',       label: 'Qualsevol camp' },
    { value: 'proveedor', label: 'Sol proveïdor' },
    { value: 'concepto',  label: 'Sol concepte' },
    { value: 'filename',  label: 'Sol nom fitxer' },
];

const MATCH_MODE_OPTIONS = [
    { value: 'any', label: 'Almenys una paraula' },
    { value: 'all', label: 'Totes les paraules' },
];

const CATEGORY_COLORS = {
    'Material de oficina':      { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    'Software y suscripciones': { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400' },
    'Equipos informáticos':     { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
    'Telecomunicaciones':       { bg: 'bg-violet-500/10',  text: 'text-violet-400',  dot: 'bg-violet-400' },
    'Transporte':               { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    'Formación':                { bg: 'bg-pink-500/10',    text: 'text-pink-400',    dot: 'bg-pink-400' },
    'Seguros':                  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  dot: 'bg-orange-400' },
    'Gestoría y asesoría':      { bg: 'bg-teal-500/10',    text: 'text-teal-400',    dot: 'bg-teal-400' },
    'Marketing y publicidad':   { bg: 'bg-rose-500/10',    text: 'text-rose-400',    dot: 'bg-rose-400' },
    'Suministros':              { bg: 'bg-lime-500/10',    text: 'text-lime-400',    dot: 'bg-lime-400' },
    'Servicios profesionales':  { bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  dot: 'bg-indigo-400' },
    'Otros':                    { bg: 'bg-slate-500/10',   text: 'text-slate-400',   dot: 'bg-slate-400' },
};

const getCatColor = (cat) => CATEGORY_COLORS[cat] || { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-400' };

// ============================================
// EXEMPLE RULES PER ONBOARDING
// ============================================

const EXAMPLE_RULES = [
    { name: 'Amazon', keywords: 'amazon', categoria: 'Material de oficina', matchField: 'any', matchMode: 'any' },
    { name: 'Iberdrola / Endesa', keywords: 'iberdrola, endesa, naturgy, enel', categoria: 'Suministros', matchField: 'any', matchMode: 'any' },
    { name: 'Telefónica / Movistar', keywords: 'telefonica, movistar', categoria: 'Telecomunicaciones', matchField: 'proveedor', matchMode: 'any' },
    { name: 'Adobe', keywords: 'adobe', categoria: 'Software y suscripciones', matchField: 'proveedor', matchMode: 'any' },
    { name: 'Google Workspace', keywords: 'google, workspace', categoria: 'Software y suscripciones', matchField: 'any', matchMode: 'all' },
    { name: 'Renfe / Ave', keywords: 'renfe, ave, iryo', categoria: 'Transporte', matchField: 'any', matchMode: 'any' },
];

// ============================================
// FORM RULE (crear / editar)
// ============================================

const EMPTY_RULE = {
    name: '',
    keywords: '',
    categoria: defaultCategories[0],
    matchField: 'any',
    matchMode: 'any',
    enabled: true,
};

const RuleForm = ({ initial = EMPTY_RULE, onSave, onCancel }) => {
    const [form, setForm] = useState({ ...EMPTY_RULE, ...initial });
    const [error, setError] = useState('');

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.keywords.trim()) return setError('Cal almenys una paraula clau.');
        if (!form.categoria) return setError('Selecciona una categoria.');
        setError('');
        onSave(form);
    };

    const keywords = form.keywords.split(',').map(k => k.trim()).filter(Boolean);

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nom de la regla */}
            <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1.5 block">
                    Nom de la regla <span className="text-slate-600 normal-case font-normal">(opcional, per identificar-la)</span>
                </label>
                <input
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Ex: Amazon, Iberdrola, Adobe..."
                    className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm outline-none focus:border-blue-500 transition-colors"
                />
            </div>

            {/* Paraules clau */}
            <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1.5 block">
                    Paraules clau <span className="text-red-400">*</span>
                    <span className="text-slate-600 normal-case font-normal ml-1">— separades per comes</span>
                </label>
                <input
                    value={form.keywords}
                    onChange={e => set('keywords', e.target.value)}
                    placeholder="Ex: amazon, aws, amazon web services"
                    className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm outline-none focus:border-blue-500 transition-colors font-mono"
                    autoFocus
                />
                {/* Preview de tags */}
                {keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {keywords.map((kw, i) => (
                            <span key={i} className="bg-blue-500/15 text-blue-400 border border-blue-500/25 text-xs px-2 py-0.5 rounded-full font-mono">
                                {kw}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Categoria */}
            <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1.5 block">
                    Categoria assignada <span className="text-red-400">*</span>
                </label>
                <Select
                    value={form.categoria}
                    onChange={e => set('categoria', e.target.value)}
                    options={defaultCategories.map(c => ({ value: c, label: c }))}
                    className="bg-slate-800 border-slate-700"
                />
                {form.categoria && (
                    <div className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${getCatColor(form.categoria).bg} ${getCatColor(form.categoria).text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${getCatColor(form.categoria).dot}`} />
                        {form.categoria}
                    </div>
                )}
            </div>

            {/* Opcions avançades */}
            <details className="group">
                <summary className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 cursor-pointer select-none transition-colors list-none">
                    <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
                    Opcions avançades
                </summary>
                <div className="mt-3 space-y-3 pl-4 border-l border-slate-800">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-semibold mb-1 block">Cerca en</label>
                            <Select
                                value={form.matchField}
                                onChange={e => set('matchField', e.target.value)}
                                options={MATCH_FIELD_OPTIONS}
                                className="bg-slate-800 border-slate-700 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 uppercase font-semibold mb-1 block">Condició</label>
                            <Select
                                value={form.matchMode}
                                onChange={e => set('matchMode', e.target.value)}
                                options={MATCH_MODE_OPTIONS}
                                className="bg-slate-800 border-slate-700 text-sm"
                            />
                        </div>
                    </div>
                    <p className="text-xs text-slate-600">
                        {form.matchMode === 'all'
                            ? '⚡ Totes les paraules clau han d\'aparèixer en el text.'
                            : '⚡ N\'hi ha prou amb que aparega qualsevol de les paraules clau.'}
                    </p>
                </div>
            </details>

            {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg">
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onCancel} size="sm">Cancel·lar</Button>
                <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-500 px-5">
                    <Check size={14} className="mr-1.5" /> Guardar regla
                </Button>
            </div>
        </form>
    );
};

// ============================================
// RULE CARD (llista)
// ============================================

const RuleCard = ({ rule, index, total, onEdit, onDelete, onToggle, onMoveUp, onMoveDown }) => {
    const colors = getCatColor(rule.categoria);
    const keywords = (rule.keywords || '').split(',').map(k => k.trim()).filter(Boolean);

    return (
        <div className={`group flex items-center gap-3 p-3 rounded-xl border transition-all ${
            rule.enabled !== false
                ? 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50'
                : 'bg-slate-900/40 border-slate-800/50 opacity-50'
        }`}>
            {/* Drag handle + priority */}
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                <button onClick={onMoveUp} disabled={index === 0}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors p-0.5">
                    <ArrowUp size={12} />
                </button>
                <span className="text-[10px] text-slate-600 font-mono font-bold w-4 text-center">{index + 1}</span>
                <button onClick={onMoveDown} disabled={index === total - 1}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 transition-colors p-0.5">
                    <ArrowDown size={12} />
                </button>
            </div>

            {/* Contingut */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Nom */}
                    {rule.name && (
                        <span className="text-white text-sm font-semibold">{rule.name}</span>
                    )}
                    {/* Keywords */}
                    <div className="flex flex-wrap gap-1">
                        {keywords.slice(0, 4).map((kw, i) => (
                            <span key={i} className="bg-slate-700/80 text-slate-300 text-[10px] px-1.5 py-0.5 rounded font-mono border border-slate-600/30">
                                {kw}
                            </span>
                        ))}
                        {keywords.length > 4 && (
                            <span className="text-slate-500 text-[10px] px-1">+{keywords.length - 4}</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                    {/* Fletxa → categoria */}
                    <span className="text-slate-600 text-xs">→</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${colors.bg} ${colors.text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                        {rule.categoria}
                    </span>
                    {/* Metadades opcionals */}
                    {(rule.matchField && rule.matchField !== 'any') && (
                        <span className="text-slate-600 text-[10px]">
                            en {MATCH_FIELD_OPTIONS.find(o => o.value === rule.matchField)?.label?.toLowerCase()}
                        </span>
                    )}
                    {rule.matchMode === 'all' && (
                        <span className="text-slate-600 text-[10px] border border-slate-700 px-1 rounded">TOTES</span>
                    )}
                </div>
            </div>

            {/* Accions */}
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={onToggle}
                    title={rule.enabled !== false ? 'Desactivar' : 'Activar'}
                    className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-200 transition-colors">
                    {rule.enabled !== false ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} />}
                </button>
                <button onClick={onEdit}
                    className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-blue-400 transition-colors">
                    <Edit2 size={14} />
                </button>
                <button onClick={onDelete}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
};

// ============================================
// MAIN COMPONENT
// ============================================

export const RulesManager = ({ open, onClose }) => {
    const {
        customRules,
        addCustomRule,
        updateCustomRule,
        removeCustomRule,
        reorderCustomRules,
    } = useProviderMemory();

    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState(null); // null = nou, object = editar
    const [showExamples, setShowExamples] = useState(false);

    const sortedRules = [...customRules].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    const handleSave = (formData) => {
        if (editingRule) {
            updateCustomRule(editingRule.id, formData);
        } else {
            addCustomRule(formData);
        }
        setShowForm(false);
        setEditingRule(null);
    };

    const handleEdit = (rule) => {
        setEditingRule(rule);
        setShowForm(true);
    };

    const handleDelete = (id) => {
        removeCustomRule(id);
    };

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

    const handleAddExample = (example) => {
        addCustomRule(example);
    };

    const handleCancelForm = () => {
        setShowForm(false);
        setEditingRule(null);
    };

    const activeCount = sortedRules.filter(r => r.enabled !== false).length;

    return (
        <Modal open={open} onClose={onClose} title="Regles de Categorització" size="md">
            <div className="space-y-4">

                {/* Capçalera informativa */}
                <div className="flex items-start gap-3 bg-blue-500/8 border border-blue-500/15 rounded-xl p-3">
                    <Zap size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                            Les regles s'apliquen <strong className="text-white">per ordre de prioritat</strong> quan es detecta un PDF. Si el text del document conté les paraules clau, s'assigna automàticament la categoria corresponent.
                        </p>
                        {sortedRules.length > 0 && (
                            <p className="text-xs text-slate-500 mt-1">
                                {activeCount} regla{activeCount !== 1 ? 's' : ''} activa{activeCount !== 1 ? 's' : ''} · {sortedRules.length} en total
                            </p>
                        )}
                    </div>
                </div>

                {/* FORM (crear / editar) */}
                {showForm ? (
                    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4">
                        <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                            {editingRule ? <Edit2 size={14} className="text-blue-400" /> : <Plus size={14} className="text-blue-400" />}
                            {editingRule ? 'Editar regla' : 'Nova regla'}
                        </h4>
                        <RuleForm
                            initial={editingRule || EMPTY_RULE}
                            onSave={handleSave}
                            onCancel={handleCancelForm}
                        />
                    </div>
                ) : (
                    <Button
                        onClick={() => { setEditingRule(null); setShowForm(true); }}
                        icon={Plus}
                        className="w-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 hover:border-blue-500/40 justify-center"
                        variant="ghost"
                    >
                        Nova regla personalitzada
                    </Button>
                )}

                {/* LLISTA DE REGLES */}
                {sortedRules.length > 0 ? (
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1 custom-scrollbar">
                        {sortedRules.map((rule, idx) => (
                            <RuleCard
                                key={rule.id}
                                rule={rule}
                                index={idx}
                                total={sortedRules.length}
                                onEdit={() => handleEdit(rule)}
                                onDelete={() => handleDelete(rule.id)}
                                onToggle={() => handleToggle(rule)}
                                onMoveUp={() => handleMoveUp(idx)}
                                onMoveDown={() => handleMoveDown(idx)}
                            />
                        ))}
                    </div>
                ) : !showForm && (
                    <div className="text-center py-8 text-slate-600">
                        <Tag size={32} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium text-slate-500">Encara no hi ha regles</p>
                        <p className="text-xs mt-1">Crea la teua primera regla o importa els exemples de sota.</p>
                    </div>
                )}

                {/* EXEMPLES */}
                {!showForm && (
                    <div className="border-t border-slate-800 pt-4">
                        <button
                            onClick={() => setShowExamples(v => !v)}
                            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full"
                        >
                            <BookOpen size={13} />
                            <span>Exemples de regles ràpides</span>
                            <ChevronDown size={12} className={`ml-auto transition-transform ${showExamples ? 'rotate-180' : ''}`} />
                        </button>
                        {showExamples && (
                            <div className="mt-3 space-y-1.5">
                                {EXAMPLE_RULES.map((ex, i) => {
                                    const colors = getCatColor(ex.categoria);
                                    const alreadyAdded = sortedRules.some(r =>
                                        r.name?.toLowerCase() === ex.name?.toLowerCase() ||
                                        r.keywords?.toLowerCase() === ex.keywords?.toLowerCase()
                                    );
                                    return (
                                        <div key={i} className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm text-slate-300 font-medium">{ex.name}</span>
                                                <span className="text-slate-600 text-xs mx-2">→</span>
                                                <span className={`text-xs font-semibold ${colors.text}`}>{ex.categoria}</span>
                                                <div className="text-[10px] text-slate-600 font-mono mt-0.5 truncate">{ex.keywords}</div>
                                            </div>
                                            <button
                                                onClick={() => !alreadyAdded && handleAddExample(ex)}
                                                disabled={alreadyAdded}
                                                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-semibold transition-all flex-shrink-0 ${
                                                    alreadyAdded
                                                        ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 cursor-default'
                                                        : 'text-blue-400 bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20'
                                                }`}
                                            >
                                                {alreadyAdded ? <><Check size={11} /> Afegida</> : <><Plus size={11} /> Afegir</>}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-end pt-2 border-t border-slate-800">
                    <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-500 px-6">Tancar</Button>
                </div>
            </div>
        </Modal>
    );
};
