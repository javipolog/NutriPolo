import React, { useId, useState } from 'react';
import {
  Plus, Trash2, Copy, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Info, Trophy, Sparkles,
} from 'lucide-react';
import { Button, SegmentedControl, useConfirm } from '../UI';
import { generateId } from '../../stores/store';
import { useT } from '../../i18n';
import {
  SESSION_PRESETS, sessionFromPreset, emptySession, perKg, defaultCompeticion, normalizeCompeticion,
  duringRecommendation, formatDuration, COMPETICION_BLOCKS,
} from '../../services/deportiva';
import { FIELD, LABEL, CARD, IconBtn, move, rowsFor } from './editorParts';

const MEALS = ['Desayuno', 'Almuerzo', 'Comida', 'Merienda', 'Cena'];

// ─────────────────────────────────────────────────────────────
// Rang per kg (mín-màx) amb el càlcul per al pes de la planificació
// ─────────────────────────────────────────────────────────────
const KgRange = ({ label, value, onChange, peso, unit = 'g', step = 5 }) => {
  const t = useT();
  const id = useId();
  const v = value || { min: '', max: '' };
  const calc = perKg(v, peso, { unit, step });
  const input = 'w-16 text-sm text-center tabular-nums text-sage-800 bg-white border border-sage-300 rounded-button px-2 py-2 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10';
  return (
    <div>
      <label className={LABEL} htmlFor={`${id}-min`}>{label}</label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input id={`${id}-min`} inputMode="decimal" value={v.min} onChange={e => onChange({ ...v, min: e.target.value })} className={input} aria-label={`${label} · min`} />
        <span className="text-sage-400" aria-hidden="true">–</span>
        <input inputMode="decimal" value={v.max} onChange={e => onChange({ ...v, max: e.target.value })} className={input} aria-label={`${label} · max`} />
        <span className="text-xs text-sage-600">{unit}/kg</span>
        {calc
          ? <span className="ml-1 text-xs font-semibold text-terra-700 tabular-nums">{t.sp_in_your_case.replace('{value}', calc)}</span>
          : (v.min || v.max) && !peso ? <span className="ml-1 text-xs text-sage-500">{t.sp_needs_weight}</span> : null}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Llista de files de dues columnes (ingesta | aliments, quan | què…)
// ─────────────────────────────────────────────────────────────
const PairList = ({ rows, onChange, fields: [ka, kb], labels: [la, lb], placeholders = [], addLabel }) => {
  const t = useT();
  const update = (id, data) => onChange(rows.map(r => (r.id === id ? { ...r, ...data } : r)));
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_84px] gap-2 text-[11px] font-medium text-sage-500" aria-hidden="true">
          <span>{la}</span><span>{lb}</span><span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_84px] gap-2 items-start">
          <input value={r[ka] || ''} onChange={e => update(r.id, { [ka]: e.target.value })} aria-label={la} placeholder={placeholders[0]} className={`${FIELD} font-medium`} />
          <textarea value={r[kb] || ''} onChange={e => update(r.id, { [kb]: e.target.value })} aria-label={lb} placeholder={placeholders[1]} rows={rowsFor(r[kb], 1)} className={`${FIELD} resize-y`} />
          <div className="flex pt-1">
            <IconBtn icon={ChevronUp} label={t.pf_move_up} disabled={i === 0} onClick={() => onChange(move(rows, i, -1))} />
            <IconBtn icon={ChevronDown} label={t.pf_move_down} disabled={i === rows.length - 1} onClick={() => onChange(move(rows, i, 1))} />
            <IconBtn icon={Trash2} label={t.pf_remove} danger onClick={() => onChange(rows.filter(x => x.id !== r.id))} />
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange([...rows, { id: generateId(), [ka]: '', [kb]: '' }])}>{addLabel || t.sp_add_row}</Button>
    </div>
  );
};

const Lines = ({ label, value, onChange, placeholder, min = 2 }) => {
  const id = useId();
  return (
    <div>
      <label className={LABEL} htmlFor={id}>{label}</label>
      <textarea id={id} value={value || ''} onChange={e => onChange(e.target.value)} rows={rowsFor(value, min)} placeholder={placeholder} className={`${FIELD} resize-y`} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Dades generals: tipus de planificació, pes i esport
// ─────────────────────────────────────────────────────────────
/**
 * @param lastWeight  { peso, fecha } de l'últim pesatge del client (o null)
 * @param onTipo      canvia el tipus (l'editor prepara pes i guia en passar a esportiva)
 */
export const SportGeneralFields = ({ form, patch, onTipo, lastWeight }) => {
  const t = useT();
  const sport = form.tipo === 'deportiva';
  const deporte = form.deporte || {};
  const setDeporte = (data) => patch('deporte', { ...deporte, ...data });
  const lastDiffers = lastWeight && String(lastWeight.peso) !== String(deporte.peso || '');
  return (
    <div className="space-y-3">
      <div>
        <p className={LABEL}>{t.sp_type}</p>
        <SegmentedControl
          ariaLabel={t.sp_type}
          value={sport ? 'deportiva' : 'general'}
          onChange={onTipo}
          options={[{ value: 'general', label: t.sp_type_general }, { value: 'deportiva', label: t.sp_type_sport }]}
        />
      </div>
      {sport && (
        <div className="bg-terra-50 border border-terra-100 rounded-soft p-4 space-y-3">
          <p className="text-sm text-sage-700 flex gap-2"><Info size={15} className="shrink-0 mt-0.5 text-terra-600" />{t.sp_type_hint}</p>
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
            <div>
              <label className={LABEL} htmlFor="sp-peso">{t.sp_weight}</label>
              <input id="sp-peso" inputMode="decimal" value={deporte.peso || ''} onChange={e => setDeporte({ peso: e.target.value })} className={`${FIELD} tabular-nums`} />
            </div>
            <div>
              <label className={LABEL} htmlFor="sp-disc">{t.sp_discipline}</label>
              <input id="sp-disc" value={deporte.disciplina || ''} onChange={e => setDeporte({ disciplina: e.target.value })} className={FIELD} placeholder={t.sp_discipline_ph} />
            </div>
          </div>
          <p className="text-xs text-sage-600 flex flex-wrap items-center gap-2">
            {lastWeight
              ? <>
                  <span>{t.sp_weight_last.replace('{kg}', lastWeight.peso).replace('{date}', lastWeight.fecha)}</span>
                  {lastDiffers && <Button variant="ghost" size="sm" onClick={() => setDeporte({ peso: String(lastWeight.peso) })}>{t.sp_weight_use_last}</Button>}
                </>
              : <span>{t.sp_weight_none}</span>}
          </p>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Preses d'entrenament
// ─────────────────────────────────────────────────────────────
const PAUTA_TEXT = ['grasas', 'fibra', 'volumen', 'tiempo'];

const PautaEditor = ({ value, onChange, peso }) => {
  const t = useT();
  const id = useId();
  const set = (k, v) => onChange({ ...value, [k]: v });
  const field = (k, extra = '') => (
    <div className={extra}>
      <label className={LABEL} htmlFor={`${id}-${k}`}>{t[`sp_pauta_${k}`]}</label>
      <input id={`${id}-${k}`} value={value[k] || ''} onChange={e => set(k, e.target.value)} className={FIELD} />
    </div>
  );
  return (
    <div className={CARD}>
      <h4 className="text-sm font-semibold text-sage-800">{t.sp_guidance}</h4>
      {field('objetivo')}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {field('hidratos')}
          <KgRange label={t.sp_per_kg} value={value.hc} onChange={v => set('hc', v)} peso={peso} />
        </div>
        <div className="space-y-2">
          {field('proteina')}
          <KgRange label={t.sp_per_kg} value={value.prot} onChange={v => set('prot', v)} peso={peso} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PAUTA_TEXT.map(k => <React.Fragment key={k}>{field(k)}</React.Fragment>)}
      </div>
    </div>
  );
};

/**
 * @param renderOptions (session, onChange) → editor d'opcions (el mateix que esmorzars)
 */
export const EntrenosEditor = ({ value, onChange, peso, renderOptions }) => {
  const t = useT();
  const { confirm, ConfirmDialog } = useConfirm();
  const listId = useId();
  const [selId, setSelId] = useState(value[0]?.id || null);
  const sel = value.find(s => s.id === selId) || value[0] || null;
  const i = sel ? value.indexOf(sel) : -1;
  const update = (data) => onChange(value.map(s => (s.id === sel.id ? { ...s, ...data } : s)));
  const add = (s) => { onChange([...value, s]); setSelId(s.id); };
  const nameOf = (s) => s.nombre?.trim() || t.sp_session_untitled;

  const remove = async () => {
    if (!(await confirm({ message: t.sp_session_delete_confirm.replace('{name}', nameOf(sel)), danger: true, confirmText: t.delete }))) return;
    const rest = value.filter(s => s.id !== sel.id);
    onChange(rest);
    setSelId(rest[Math.max(0, i - 1)]?.id || null);
  };
  const duplicate = () => {
    const copy = { ...sel, id: generateId(), nombre: `${sel.nombre} (2)`, opciones: sel.opciones.map(o => ({ ...o, id: generateId() })) };
    onChange([...value.slice(0, i + 1), copy, ...value.slice(i + 1)]);
    setSelId(copy.id);
  };

  const presets = (
    <div className="flex flex-wrap items-center gap-2">
      {Object.keys(SESSION_PRESETS).map(k => (
        <Button key={k} variant="secondary" size="sm" icon={Plus} onClick={() => add(sessionFromPreset(k))}>{t[`sp_preset_${k}`]}</Button>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => add(emptySession())}>{t.sp_preset_blank}</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-sage-600 flex gap-2"><Info size={15} className="shrink-0 mt-0.5 text-sage-500" />{t.sp_sessions_hint}</p>
      {!sel ? (
        <div className="py-6 px-4 border border-dashed border-sage-300 rounded-soft space-y-3 text-center">
          <p className="text-sm text-sage-600">{t.sp_sessions_empty}</p>
          <div className="flex justify-center">{presets}</div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label={t.pf_section_entrenos} className="flex flex-wrap gap-2">
            {value.map(s => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === sel.id}
                onClick={() => setSelId(s.id)}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${s.id === sel.id ? 'border-wellness-400 bg-wellness-50 text-sage-900' : 'border-sage-200 bg-white text-sage-600 hover:border-sage-300'}`}
              >
                {s.toma ? `${s.toma} · ` : ''}{nameOf(s)}
                <span className="ml-1.5 text-sage-500">{s.momento === 'post' ? 'post' : 'pre'}</span>
              </button>
            ))}
          </div>

          <div className={CARD}>
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <label className={LABEL} htmlFor="sp-ses-name">{t.sp_session_name}</label>
                <input id="sp-ses-name" value={sel.nombre} onChange={e => update({ nombre: e.target.value })} className={`${FIELD} font-medium`} placeholder={t.sp_session_name_ph} />
              </div>
              <div className="w-40">
                <label className={LABEL} htmlFor="sp-ses-meal">{t.sp_session_meal}</label>
                <input id="sp-ses-meal" list={listId} value={sel.toma} onChange={e => update({ toma: e.target.value })} className={FIELD} />
                <datalist id={listId}>{MEALS.map(m => <option key={m} value={m} />)}</datalist>
              </div>
              <div>
                <p className={LABEL}>{t.sp_session_moment}</p>
                <SegmentedControl
                  ariaLabel={t.sp_session_moment}
                  value={sel.momento}
                  onChange={v => update({ momento: v })}
                  options={[{ value: 'pre', label: t.sp_pre }, { value: 'post', label: t.sp_post }]}
                />
              </div>
              <div className="flex gap-0.5 self-end pb-1">
                <IconBtn icon={ChevronLeft} label={t.pf_move_up} disabled={i === 0} onClick={() => onChange(move(value, i, -1))} />
                <IconBtn icon={ChevronRight} label={t.pf_move_down} disabled={i === value.length - 1} onClick={() => onChange(move(value, i, 1))} />
                <IconBtn icon={Copy} label={t.pf_duplicate} onClick={duplicate} />
                <IconBtn icon={Trash2} label={t.pf_remove} danger onClick={remove} />
              </div>
            </div>
          </div>

          <PautaEditor value={sel.pauta} onChange={pauta => update({ pauta })} peso={peso} />

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-sage-800">{t.sp_options}</h4>
            {renderOptions(sel, (v) => update(v))}
          </div>

          <div className="pt-3 border-t border-sage-200 space-y-2">
            <p className={LABEL}>{t.sp_add_session}</p>
            {presets}
          </div>
        </>
      )}
      {ConfirmDialog}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Pla de competició
// ─────────────────────────────────────────────────────────────
const Block = ({ id, title, value, onChange, children }) => {
  const t = useT();
  return (
    <section className={CARD} aria-labelledby={`sp-block-${id}`}>
      <div className="flex items-center gap-3">
        <h4 id={`sp-block-${id}`} className={`text-sm font-semibold ${value.activo ? 'text-sage-800' : 'text-sage-400'}`}>{title}</h4>
        <label className="ml-auto flex items-center gap-2 text-xs text-sage-600">
          <input type="checkbox" checked={!!value.activo} onChange={e => onChange({ ...value, activo: e.target.checked })} className="w-4 h-4 accent-wellness-400" />
          {t.sp_block_include}
        </label>
      </div>
      {value.activo && <div className="space-y-3">{children}</div>}
    </section>
  );
};

export const CompeticionEditor = ({ value, onChange, peso }) => {
  const t = useT();
  const { confirm, ConfirmDialog } = useConfirm();

  if (!value) {
    return (
      <div className="py-8 px-6 border border-dashed border-sage-300 rounded-soft text-center space-y-3">
        <Trophy size={22} className="mx-auto text-terra-600" aria-hidden="true" />
        <p className="text-sm text-sage-600 max-w-md mx-auto">{t.sp_comp_empty}</p>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => onChange(defaultCompeticion())}>{t.sp_comp_add}</Button>
      </div>
    );
  }

  const c = normalizeCompeticion(value);
  const set = (data) => onChange({ ...c, ...data });
  const setBlock = (k, data) => onChange({ ...c, [k]: { ...c[k], ...data } });
  const blockProps = (k) => ({ id: k, title: t[`sp_block_${k}`], value: c[k], onChange: (b) => onChange({ ...c, [k]: b }) });
  const rec = duringRecommendation(c.duracion);
  const dur = formatDuration(c.duracion);

  const remove = async () => {
    if (!(await confirm({ message: t.sp_comp_delete_confirm, danger: true, confirmText: t.delete }))) return;
    onChange(null);
  };

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_150px]">
          <div>
            <label className={LABEL} htmlFor="sp-comp-name">{t.sp_comp_name}</label>
            <input id="sp-comp-name" value={c.nombre} onChange={e => set({ nombre: e.target.value })} className={`${FIELD} font-medium`} placeholder={t.sp_comp_name_ph} />
          </div>
          <div>
            <label className={LABEL} htmlFor="sp-comp-date">{t.sp_comp_date}</label>
            <input id="sp-comp-date" type="date" value={c.fecha} onChange={e => set({ fecha: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="sp-comp-dur">{t.sp_comp_duration}</label>
            <input id="sp-comp-dur" inputMode="numeric" value={c.duracion} onChange={e => set({ duracion: e.target.value })} className={`${FIELD} tabular-nums`} />
            {dur && <p className="text-xs text-sage-500 mt-1 tabular-nums">{dur}</p>}
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={Trash2} onClick={remove}>{t.sp_comp_delete}</Button>
        </div>
      </div>

      <Block {...blockProps('previa')}>
        <Lines label={t.sp_objective} value={c.previa.objetivo} onChange={v => setBlock('previa', { objetivo: v })} />
        <KgRange label={t.sp_day_carbs} value={c.previa.hc} onChange={v => setBlock('previa', { hc: v })} peso={peso} />
        <div>
          <p className={LABEL}>{t.sp_menu_example}</p>
          <PairList rows={c.previa.menu} onChange={menu => setBlock('previa', { menu })} fields={['ingesta', 'texto']} labels={[t.sp_intake, t.sp_foods_amounts]} />
        </div>
        <Lines label={t.sp_hydration} value={c.previa.hidratacion} onChange={v => setBlock('previa', { hidratacion: v })} min={1} />
      </Block>

      <Block {...blockProps('desayuno')}>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div>
            <label className={LABEL} htmlFor="sp-bk-hours">{t.sp_hours_before}</label>
            <input id="sp-bk-hours" inputMode="decimal" value={c.desayuno.horas} onChange={e => setBlock('desayuno', { horas: e.target.value })} className={`${FIELD} tabular-nums`} />
          </div>
          <KgRange label={t.sp_breakfast_carbs} value={c.desayuno.hc} onChange={v => setBlock('desayuno', { hc: v })} peso={peso} />
        </div>
        <Lines label={t.sp_guidelines} value={c.desayuno.pautas} onChange={v => setBlock('desayuno', { pautas: v })} />
        <div>
          <p className={LABEL}>{t.sp_examples}</p>
          <PairList rows={c.desayuno.opciones} onChange={opciones => setBlock('desayuno', { opciones })} fields={['titulo', 'cantidad']} labels={[t.sp_example, t.sp_amounts]} />
        </div>
      </Block>

      <Block {...blockProps('cafeina')}>
        <KgRange label={t.sp_caffeine_dose} value={c.cafeina.mg} onChange={v => setBlock('cafeina', { mg: v })} peso={peso} unit="mg" step={10} />
        <Lines label={t.sp_intro} value={c.cafeina.intro} onChange={v => setBlock('cafeina', { intro: v })} />
        <div className="space-y-3">
          <p className={LABEL}>{t.sp_protocols}</p>
          {c.cafeina.protocolos.map((pr, j) => {
            const setPr = (data) => setBlock('cafeina', { protocolos: c.cafeina.protocolos.map(x => (x.id === pr.id ? { ...x, ...data } : x)) });
            return (
              <div key={pr.id} className="border border-sage-200 rounded-soft p-3 space-y-2 bg-sage-50">
                <div className="flex items-center gap-1">
                  <input value={pr.titulo} onChange={e => setPr({ titulo: e.target.value })} aria-label={t.sp_protocol_title} placeholder={`${t.pf_option.replace('{n}', j + 1)}`} className={`${FIELD} font-medium`} />
                  <IconBtn icon={Trash2} label={t.pf_remove} danger onClick={() => setBlock('cafeina', { protocolos: c.cafeina.protocolos.filter(x => x.id !== pr.id) })} />
                </div>
                <PairList rows={pr.pasos} onChange={pasos => setPr({ pasos })} fields={['cuando', 'que']} labels={[t.sp_when, t.sp_what]} />
              </div>
            );
          })}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setBlock('cafeina', { protocolos: [...c.cafeina.protocolos, { id: generateId(), titulo: '', pasos: [{ id: generateId(), cuando: '', que: '' }] }] })}>{t.sp_protocol_add}</Button>
        </div>
      </Block>

      <Block {...blockProps('durante')}>
        <div className="text-sm text-sage-700 bg-wellness-50 border border-wellness-100 rounded-soft px-4 py-3 space-y-2">
          {rec ? (
            <>
              <p className="font-medium flex gap-2"><Sparkles size={15} className="shrink-0 mt-0.5 text-wellness-500" />{t.sp_during_suggestion.replace('{duration}', dur)}{rec.hcHora ? ` ${rec.hcHora}/h` : ''}</p>
              <p className="whitespace-pre-line text-sage-600">{rec.texto}</p>
              <Button variant="ghost" size="sm" onClick={() => setBlock('durante', { hcHora: rec.hcHora, texto: rec.texto })}>{t.sp_during_use}</Button>
            </>
          ) : (
            <p className="flex gap-2"><Info size={15} className="shrink-0 mt-0.5 text-wellness-500" />{t.sp_during_no_duration}</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div>
            <label className={LABEL} htmlFor="sp-dur-hc">{t.sp_carbs_hour}</label>
            <input id="sp-dur-hc" value={c.durante.hcHora} onChange={e => setBlock('durante', { hcHora: e.target.value })} placeholder={rec?.hcHora || ''} className={FIELD} />
          </div>
          <Lines label={t.sp_during_text} value={c.durante.texto} onChange={v => setBlock('durante', { texto: v })} placeholder={rec?.texto || ''} />
        </div>
        <Lines label={t.sp_hydration} value={c.durante.hidratacion} onChange={v => setBlock('durante', { hidratacion: v })} />
      </Block>

      <Block {...blockProps('recuperacion')}>
        <div className="grid gap-3 md:grid-cols-2">
          <KgRange label={t.sp_rec_carbs} value={c.recuperacion.hc} onChange={v => setBlock('recuperacion', { hc: v })} peso={peso} />
          <KgRange label={t.sp_rec_protein} value={c.recuperacion.prot} onChange={v => setBlock('recuperacion', { prot: v })} peso={peso} />
        </div>
        <Lines label={t.sp_guidelines} value={c.recuperacion.texto} onChange={v => setBlock('recuperacion', { texto: v })} />
        <div>
          <p className={LABEL}>{t.sp_examples}</p>
          <PairList rows={c.recuperacion.opciones} onChange={opciones => setBlock('recuperacion', { opciones })} fields={['titulo', 'cantidad']} labels={[t.sp_example, t.sp_amounts]} />
        </div>
      </Block>
      {ConfirmDialog}
    </div>
  );
};

export const competicionCount = (c) => (c ? COMPETICION_BLOCKS.filter(k => normalizeCompeticion(c)[k].activo).length : 0);
