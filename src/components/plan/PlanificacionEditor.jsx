import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  X, Save, Eye, EyeOff, Download, Plus, Trash2, Copy, ChevronUp, ChevronDown,
  ArrowLeftRight, ClipboardPaste, Eraser, Link2, ImagePlus, RotateCcw, Info, Coffee,
  Apple, Cookie, Scale, CalendarDays, ShoppingBasket, Settings2, BookOpen,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { Button, SegmentedControl, Combobox, useToast, useConfirm, useDialogA11y } from '../UI';
import useStore, { todayISO, generateId, errMsg } from '../../stores/store';
import { useT } from '../../i18n';
import {
  createPlanificacion, latestPlanificacion, normalizePlanificacion, copyContent, buildDishIndex, collectOwnRecipes,
  emptyOption, emptyDish, isDishEmpty, linesOf, safeUrl, planificacionStats, planFoods, dishKey,
  DEFAULT_CANTIDADES, DEFAULT_CANTIDADES_NOTA, WEEK_DAYS, MENU_SLOTS, MENU_VARIANTS, PLAN_FORMAT,
} from '../../services/planificacion';
import { imageFileToDataUrl, planPdfFileName } from '../../services/planPdf';
import { PdfPreview } from './PdfPreview';
import { WebRecipePicker } from './WebRecipePicker';
import { useWebRecipes } from '../../hooks/useWebRecipes';

const FIELD = 'w-full text-sm text-sage-800 bg-white border border-sage-300 rounded-button px-3 py-2 placeholder-sage-400 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 transition-colors';
const LABEL = 'block text-xs font-medium text-sage-600 mb-1';
const NO_RECIPES = [];

const SECTIONS = [
  { id: 'general',     icon: Settings2 },
  { id: 'desayunos',   icon: Coffee },
  { id: 'mediaManana', icon: Apple },
  { id: 'merienda',    icon: Cookie },
  { id: 'cantidades',  icon: Scale },
  { id: 'menu',        icon: CalendarDays },
  { id: 'productos',   icon: ShoppingBasket },
];

const IconBtn = ({ icon: Icon, label, onClick, disabled, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`p-1.5 rounded-button text-sage-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${danger ? 'hover:text-danger hover:bg-danger-light' : 'hover:text-sage-700 hover:bg-sage-100'}`}
  >
    <Icon size={14} />
  </button>
);

const move = (arr, i, d) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};

const rowsFor = (text, min = 3) => Math.max(min, String(text || '').split('\n').length + 1);

// ─────────────────────────────────────────────────────────────
// Productes de la biblioteca com a xips seleccionables
// ─────────────────────────────────────────────────────────────
const ProductChips = ({ selected = [], onChange }) => {
  const products = useStore(s => s.planLibrary.productos);
  if (!products.length) return null;
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div className="flex flex-wrap gap-2">
      {products.map(pr => {
        const on = selected.includes(pr.id);
        return (
          <button
            key={pr.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(pr.id)}
            className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-xs transition-colors ${on ? 'border-wellness-400 bg-wellness-50 text-sage-800' : 'border-sage-200 bg-white text-sage-500 hover:border-sage-300'}`}
          >
            <img src={pr.imagen} alt="" className="w-6 h-6 rounded-full object-contain bg-white" />
            {pr.nombre}
          </button>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Esmorzars / mig matí / berenar
// ─────────────────────────────────────────────────────────────
const OptionSectionEditor = ({ value, onChange, dishIndex }) => {
  const t = useT();
  const toast = useToast();
  const listId = useId();
  const [picking, setPicking] = useState(false);
  const opts = value.opciones || [];
  const setOpts = (o) => onChange({ ...value, opciones: o });
  const updateOpt = (id, data) => setOpts(opts.map(o => (o.id === id ? { ...o, ...data } : o)));

  // Un títol ja conegut omple els aliments buits
  const autofill = (o) => {
    if (linesOf(o.alimentos).length) return;
    const hit = dishIndex.find(o.titulo);
    if (!hit) return;
    updateOpt(o.id, { titulo: hit.titulo, alimentos: hit.alimentos, nota: o.nota || hit.nota || '' });
    toast.info((hit.web ? t.pf_web_filled : t.pf_autofilled).replace('{name}', hit.titulo));
  };

  return (
    <div className="space-y-4">
      <datalist id={listId}>{dishIndex.titles.map(x => <option key={x} value={x} />)}</datalist>
      {opts.map((o, i) => (
        <div key={o.id} className="bg-white border border-sage-200 rounded-soft p-4 space-y-3 shadow-card">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sage-500">{t.pf_option.replace('{n}', i + 1)}</span>
            <div className="ml-auto flex gap-0.5">
              <IconBtn icon={ChevronUp} label={t.pf_move_up} disabled={i === 0} onClick={() => setOpts(move(opts, i, -1))} />
              <IconBtn icon={ChevronDown} label={t.pf_move_down} disabled={i === opts.length - 1} onClick={() => setOpts(move(opts, i, 1))} />
              <IconBtn icon={Copy} label={t.pf_duplicate} onClick={() => setOpts([...opts.slice(0, i + 1), { ...o, id: generateId() }, ...opts.slice(i + 1)])} />
              <IconBtn icon={Trash2} label={t.pf_remove} danger onClick={() => setOpts(opts.filter(x => x.id !== o.id))} />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor={`${o.id}-t`}>{t.pf_option_title}</label>
            <input
              id={`${o.id}-t`}
              list={listId}
              value={o.titulo}
              onChange={e => updateOpt(o.id, { titulo: e.target.value })}
              onBlur={() => autofill(o)}
              className={`${FIELD} font-medium`}
              placeholder={t.pf_option_title_ph}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${o.id}-a`}>{t.pf_option_foods}</label>
            <textarea
              id={`${o.id}-a`}
              value={o.alimentos}
              onChange={e => updateOpt(o.id, { alimentos: e.target.value })}
              rows={rowsFor(o.alimentos)}
              className={`${FIELD} resize-y`}
              placeholder={t.pf_option_foods_ph}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${o.id}-n`}>{t.pf_option_note}</label>
            <input
              id={`${o.id}-n`}
              value={o.nota || ''}
              onChange={e => updateOpt(o.id, { nota: e.target.value })}
              className={FIELD}
              placeholder={t.pf_option_note_ph}
            />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setOpts([...opts, emptyOption()])}>{t.pf_add_option}</Button>
        <Button variant="ghost" size="sm" icon={BookOpen} onClick={() => setPicking(true)}>{t.pf_web_pick}</Button>
      </div>
      <WebRecipePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={d => {
          setOpts([...opts, { ...emptyOption(), titulo: d.titulo, alimentos: d.alimentos, nota: d.nota || '' }]);
          setPicking(false);
          toast.info((d.source === 'own' ? t.pf_own_filled : t.pf_web_filled).replace('{name}', d.titulo));
        }}
      />

      <div className="pt-2 space-y-3">
        <div>
          <label className={LABEL} htmlFor={`${listId}-note`}>{t.pf_section_note}</label>
          <textarea
            id={`${listId}-note`}
            value={value.nota || ''}
            onChange={e => onChange({ ...value, nota: e.target.value })}
            rows={2}
            className={`${FIELD} resize-y`}
            placeholder={t.pf_section_note_ph}
          />
        </div>
        <div>
          <p className={LABEL}>{t.pf_section_products}</p>
          <ProductChips selected={value.productos || []} onChange={ids => onChange({ ...value, productos: ids })} />
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Guia de quantitats
// ─────────────────────────────────────────────────────────────
const CantidadesEditor = ({ value, onChange }) => {
  const t = useT();
  const { confirm, ConfirmDialog } = useConfirm();
  const grupos = value.grupos || [];
  const setGrupos = (g) => onChange({ ...value, grupos: g });
  const update = (id, data) => setGrupos(grupos.map(g => (g.id === id ? { ...g, ...data } : g)));

  const restore = async () => {
    if (!(await confirm(t.pf_restore_confirm))) return;
    onChange({ nota: DEFAULT_CANTIDADES_NOTA, grupos: DEFAULT_CANTIDADES.map(g => ({ ...g, id: generateId() })) });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {grupos.map((g, i) => (
          <div key={g.id} className="bg-white border border-sage-200 rounded-soft p-4 space-y-3 shadow-card">
            <div className="flex items-center gap-1">
              <input
                value={g.titulo}
                onChange={e => update(g.id, { titulo: e.target.value })}
                aria-label={t.pf_group_title}
                placeholder={t.pf_group_title}
                className={`${FIELD} font-medium`}
              />
              <IconBtn icon={ChevronUp} label={t.pf_move_up} disabled={i === 0} onClick={() => setGrupos(move(grupos, i, -1))} />
              <IconBtn icon={ChevronDown} label={t.pf_move_down} disabled={i === grupos.length - 1} onClick={() => setGrupos(move(grupos, i, 1))} />
              <IconBtn icon={Trash2} label={t.pf_remove} danger onClick={() => setGrupos(grupos.filter(x => x.id !== g.id))} />
            </div>
            <textarea
              value={g.texto}
              onChange={e => update(g.id, { texto: e.target.value })}
              aria-label={t.pf_group_lines}
              placeholder={t.pf_group_lines}
              rows={rowsFor(g.texto)}
              className={`${FIELD} resize-y`}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setGrupos([...grupos, { id: generateId(), titulo: '', texto: '' }])}>{t.pf_add_group}</Button>
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={restore}>{t.pf_restore_default}</Button>
      </div>
      <div>
        <label className={LABEL} htmlFor="pf-cant-nota">{t.pf_note_bottom}</label>
        <textarea id="pf-cant-nota" value={value.nota || ''} onChange={e => onChange({ ...value, nota: e.target.value })} rows={3} className={`${FIELD} resize-y`} />
      </div>
      {ConfirmDialog}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Menú setmanal: graella 7 × 4 + editor de la casella triada
// ─────────────────────────────────────────────────────────────
const MenuEditor = ({ value, onChange, dishIndex }) => {
  const t = useT();
  const toast = useToast();
  const listId = useId();
  const { confirm, ConfirmDialog } = useConfirm();
  const [sel, setSel] = useState({ day: 'lunes', slot: 'comida', variant: 'a' });
  const [clip, setClip] = useState(null);
  const [picking, setPicking] = useState(false);
  const dias = value.dias;
  const day = dias.find(d => d.id === sel.day);
  const dish = day[sel.slot][sel.variant];

  const setDish = (dayId, slot, variant, data) => onChange({
    ...value,
    dias: dias.map(d => (d.id !== dayId ? d : { ...d, [slot]: { ...d[slot], [variant]: { ...d[slot][variant], ...data } } })),
  });
  const setSelected = (data) => setDish(sel.day, sel.slot, sel.variant, data);

  const swap = () => onChange({
    ...value,
    dias: dias.map(d => (d.id !== sel.day ? d : { ...d, [sel.slot]: { a: d[sel.slot].b, b: d[sel.slot].a } })),
  });

  const autofill = () => {
    if (linesOf(dish.alimentos).length) return;
    const hit = dishIndex.find(dish.titulo);
    if (!hit) return;
    setSelected({ titulo: hit.titulo, alimentos: hit.alimentos, receta: dish.receta || hit.receta || '' });
    toast.info((hit.web ? t.pf_web_filled : t.pf_autofilled).replace('{name}', hit.titulo));
  };

  const pickRecipe = async (d) => {
    setPicking(false);
    if (!isDishEmpty(dish) && dish.titulo !== d.titulo
      && !(await confirm(t.pf_web_replace_confirm.replace('{name}', dish.titulo || linesOf(dish.alimentos)[0])))) return;
    setSelected({ titulo: d.titulo, alimentos: d.alimentos, receta: d.receta || '' });
    toast.info((d.source === 'own' ? t.pf_own_filled : t.pf_web_filled).replace('{name}', d.titulo));
  };

  const slotLabel = (s) => (s === 'comida' ? t.pf_lunch : t.pf_dinner);
  const recipeInvalid = dish.receta?.trim() && !safeUrl(dish.receta);

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full table-fixed border-separate border-spacing-1 min-w-[600px]">
          <thead>
            <tr>
              <th className="w-20" />
              {WEEK_DAYS.map(d => (
                <th key={d} scope="col" className="text-[11px] font-semibold uppercase tracking-wide text-sage-600 py-1">{t[`pf_day_${d}`]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MENU_SLOTS.flatMap(s => MENU_VARIANTS.map(v => (
              <tr key={`${s}-${v}`}>
                <th scope="row" className={`text-left text-[11px] font-semibold text-sage-600 pr-1 ${v === 'b' ? 'pb-2' : ''}`}>
                  {slotLabel(s)} <span className="text-terra-600">{v.toUpperCase()}</span>
                </th>
                {dias.map(d => {
                  const x = d[s][v];
                  const active = sel.day === d.id && sel.slot === s && sel.variant === v;
                  const empty = isDishEmpty(x);
                  return (
                    <td key={d.id} className={`align-top ${v === 'b' ? 'pb-2' : ''}`}>
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={`${t[`pf_day_${d.id}`]} · ${slotLabel(s)} ${v.toUpperCase()}: ${x.titulo || '—'}`}
                        onClick={() => setSel({ day: d.id, slot: s, variant: v })}
                        className={`w-full h-[72px] p-1.5 rounded-button border text-left text-[11px] leading-tight transition-colors overflow-hidden ${active ? 'border-wellness-400 ring-2 ring-wellness-400/25 bg-white' : v === 'a' ? 'border-sage-200 bg-white hover:border-sage-300' : 'border-sage-200 bg-sage-100 hover:border-sage-300'}`}
                      >
                        {empty ? (
                          <span className="text-sage-400">—</span>
                        ) : (
                          <span className="line-clamp-4 text-sage-800 font-medium">
                            {x.receta?.trim() && <Link2 size={10} className="inline mr-0.5 -mt-0.5 text-terra-600" aria-hidden="true" />}
                            {x.titulo || linesOf(x.alimentos)[0]}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-sage-200 rounded-soft p-4 space-y-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-sage-800">
            {t[`pf_day_${sel.day}`]} · {slotLabel(sel.slot)} {sel.variant.toUpperCase()}
          </h3>
          <div className="ml-auto flex flex-wrap gap-0.5">
            <Button variant="ghost" size="sm" icon={BookOpen} onClick={() => setPicking(true)}>{t.pf_web_pick}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected({ titulo: t.pf_dish_free_text, alimentos: '', receta: '' })}>{t.pf_dish_free}</Button>
            <IconBtn icon={ArrowLeftRight} label={t.pf_dish_swap} onClick={swap} />
            <IconBtn icon={Copy} label={t.pf_dish_copy} disabled={isDishEmpty(dish)} onClick={() => { setClip({ ...dish }); toast.info(t.pf_dish_copied); }} />
            <IconBtn icon={ClipboardPaste} label={t.pf_dish_paste} disabled={!clip} onClick={() => setSelected(clip)} />
            <IconBtn icon={Eraser} label={t.pf_dish_clear} danger disabled={isDishEmpty(dish) && !dish.receta} onClick={() => setSelected(emptyDish())} />
          </div>
        </div>
        <datalist id={listId}>{dishIndex.titles.map(x => <option key={x} value={x} />)}</datalist>
        <div>
          <label className={LABEL} htmlFor="pf-dish-title">{t.pf_dish_title}</label>
          <input
            id="pf-dish-title"
            list={listId}
            value={dish.titulo}
            onChange={e => setSelected({ titulo: e.target.value })}
            onBlur={autofill}
            className={`${FIELD} font-medium`}
            placeholder={t.pf_dish_title_ph}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-dish-foods">{t.pf_dish_foods}</label>
          <textarea
            id="pf-dish-foods"
            value={dish.alimentos}
            onChange={e => setSelected({ alimentos: e.target.value })}
            rows={rowsFor(dish.alimentos, 4)}
            className={`${FIELD} resize-y`}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-dish-recipe">{t.pf_dish_recipe}</label>
          <input
            id="pf-dish-recipe"
            value={dish.receta || ''}
            onChange={e => setSelected({ receta: e.target.value })}
            className={`${FIELD} ${recipeInvalid ? 'border-danger' : ''}`}
            placeholder={t.pf_dish_recipe_ph}
            aria-invalid={recipeInvalid || undefined}
            aria-describedby={recipeInvalid ? 'pf-dish-recipe-err' : undefined}
          />
          {recipeInvalid && <p id="pf-dish-recipe-err" className="text-xs text-danger mt-1">{t.pf_dish_recipe_invalid}</p>}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="pf-menu-notas">{t.pf_menu_notes}</label>
        <textarea id="pf-menu-notas" value={value.notas || ''} onChange={e => onChange({ ...value, notas: e.target.value })} rows={rowsFor(value.notas)} className={`${FIELD} resize-y`} />
      </div>
      <WebRecipePicker open={picking} onClose={() => setPicking(false)} onPick={pickRecipe} />
      {ConfirmDialog}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Aliments de la planificació + biblioteca de productes
// ─────────────────────────────────────────────────────────────
const ProductsEditor = ({ selected, onChange, foods }) => {
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const products = useStore(s => s.planLibrary.productos);
  const addPlanProduct = useStore(s => s.addPlanProduct);
  const updatePlanProduct = useStore(s => s.updatePlanProduct);
  const deletePlanProduct = useStore(s => s.deletePlanProduct);
  const fileRef = useRef(null);
  const foodFileRef = useRef(null);
  const [photoFor, setPhotoFor] = useState(null);

  // Cada aliment amb la foto de la biblioteca que es diu igual (si n'hi ha)
  const productByKey = useMemo(() => new Map(products.map(pr => [dishKey(pr.nombre), pr])), [products]);
  const foodRows = foods.map(f => ({ ...f, product: productByKey.get(f.key) || null }));
  const unmarked = foodRows.filter(f => f.product && !selected.includes(f.product.id)).map(f => f.product.id);
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const onFiles = async (files) => {
    const added = [];
    for (const file of files) {
      try {
        const imagen = await imageFileToDataUrl(file);
        added.push(addPlanProduct({ nombre: file.name.replace(/\.[^.]+$/, ''), imagen }).id);
      } catch {
        toast.error(t.pf_image_error.replace('{name}', file.name));
      }
    }
    if (added.length) onChange([...selected, ...added]);
  };

  // La foto d'un aliment crea el producte amb el seu nom i el marca
  const onFoodFile = async (file) => {
    if (!file || !photoFor) return;
    try {
      const imagen = await imageFileToDataUrl(file);
      onChange([...selected, addPlanProduct({ nombre: photoFor.nombre, imagen }).id]);
    } catch {
      toast.error(t.pf_image_error.replace('{name}', file.name));
    }
    setPhotoFor(null);
  };

  const remove = async (pr) => {
    if (!(await confirm(t.pf_product_delete_confirm.replace('{name}', pr.nombre)))) return;
    deletePlanProduct(pr.id);
    onChange(selected.filter(id => id !== pr.id));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-sage-800">{t.pf_plan_foods}</h4>
          {unmarked.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onChange([...selected, ...unmarked])}>{t.pf_plan_foods_mark_all}</Button>
          )}
        </div>
        {foodRows.length === 0 ? (
          <p className="text-sm text-sage-500 py-6 px-4 text-center border border-dashed border-sage-300 rounded-soft">{t.pf_plan_foods_empty}</p>
        ) : (
          <>
            <p className="text-sm text-sage-600 flex gap-2"><Info size={15} className="shrink-0 mt-0.5 text-sage-500" />{t.pf_plan_foods_hint}</p>
            <input
              ref={foodFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={e => { onFoodFile(e.target.files[0]); e.target.value = ''; }}
            />
            <div className="flex flex-wrap gap-2">
              {foodRows.map(f => {
                if (!f.product) {
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => { setPhotoFor(f); foodFileRef.current?.click(); }}
                      aria-label={t.pf_food_add_photo.replace('{name}', f.nombre)}
                      title={t.pf_food_add_photo.replace('{name}', f.nombre)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-sage-300 bg-white text-xs text-sage-600 hover:border-wellness-400 hover:text-sage-800 transition-colors"
                    >
                      <ImagePlus size={13} className="text-sage-400" aria-hidden="true" />
                      {f.nombre}
                    </button>
                  );
                }
                const on = selected.includes(f.product.id);
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(f.product.id)}
                    title={`${t.pf_in_plan}: ${f.nombre}`}
                    className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border text-xs transition-colors ${on ? 'border-wellness-400 bg-wellness-50 text-sage-800' : 'border-sage-200 bg-white text-sage-500 hover:border-sage-300'}`}
                  >
                    <img src={f.product.imagen} alt="" className="w-6 h-6 rounded-full object-contain bg-white" />
                    {f.nombre}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <h4 className="text-sm font-semibold text-sage-800 pt-4 border-t border-sage-200">{t.pf_products_library}</h4>
      <p className="text-sm text-sage-600 flex gap-2"><Info size={15} className="shrink-0 mt-0.5 text-sage-500" />{t.pf_products_hint}</p>
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={e => { onFiles([...e.target.files]); e.target.value = ''; }}
        />
        <Button variant="secondary" size="sm" icon={ImagePlus} onClick={() => fileRef.current?.click()}>{t.pf_add_products}</Button>
      </div>
      {products.length === 0 ? (
        <p className="text-sm text-sage-500 py-8 text-center border border-dashed border-sage-300 rounded-soft">{t.pf_no_products}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {products.map(pr => {
            const on = selected.includes(pr.id);
            return (
              <div key={pr.id} className={`relative bg-white rounded-soft p-2 border transition-colors ${on ? 'border-wellness-400 ring-2 ring-wellness-400/20' : 'border-sage-200'}`}>
                <label className="absolute top-2 left-2 flex items-center">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onChange(on ? selected.filter(id => id !== pr.id) : [...selected, pr.id])}
                    aria-label={`${t.pf_in_plan}: ${pr.nombre}`}
                    className="w-4 h-4 accent-wellness-400"
                  />
                </label>
                <div className="absolute top-1 right-1">
                  <IconBtn icon={Trash2} label={`${t.pf_remove}: ${pr.nombre}`} danger onClick={() => remove(pr)} />
                </div>
                <img src={pr.imagen} alt="" className="h-28 w-full object-contain mt-5" />
                <input
                  value={pr.nombre}
                  onChange={e => updatePlanProduct(pr.id, { nombre: e.target.value })}
                  aria-label={t.pf_product_name}
                  className="mt-2 w-full text-xs text-center text-sage-800 bg-transparent border border-transparent rounded-button px-1 py-1 hover:border-sage-200 focus:outline-none focus:border-wellness-400"
                />
              </div>
            );
          })}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Dades generals
// ─────────────────────────────────────────────────────────────
const GeneralEditor = ({ form, patch, client, origin, onCopyFrom, otherPlans }) => {
  const t = useT();
  const [copyId, setCopyId] = useState('');
  return (
    <div className="space-y-5">
      <p className="text-sm text-sage-600 bg-wellness-50 border border-wellness-100 rounded-soft px-4 py-3 flex gap-2">
        <Info size={15} className="shrink-0 mt-0.5 text-wellness-500" />
        <span>{origin ? t.pf_based_on.replace('{name}', origin) : t.pf_blank} {t.pf_autofill_hint}</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className={LABEL}>{t.plan_client}</p>
          <p className="text-sm font-medium text-sage-800 py-2">{client?.nombre || '—'}</p>
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-3">
          <div>
            <label className={LABEL} htmlFor="pf-name">{t.plan_name}</label>
            <input id="pf-name" value={form.nombre} onChange={e => patch('nombre', e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className={LABEL} htmlFor="pf-num">{t.pf_number}</label>
            <input id="pf-num" type="number" min="1" value={form.numero ?? ''} onChange={e => patch('numero', e.target.value === '' ? '' : Number(e.target.value))} className={`${FIELD} tabular-nums`} />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-start">{t.plan_start}</label>
          <input id="pf-start" type="date" value={form.fechaInicio || ''} onChange={e => patch('fechaInicio', e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-end">{t.plan_end}</label>
          <input id="pf-end" type="date" value={form.fechaFin || ''} onChange={e => patch('fechaFin', e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="pf-super">{t.pf_supermarket}</label>
          <input id="pf-super" value={form.supermercado || ''} onChange={e => patch('supermercado', e.target.value)} className={FIELD} placeholder={t.pf_supermarket_ph} />
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor="pf-obj">{t.plan_objectives}</label>
        <textarea id="pf-obj" value={form.objetivos || ''} onChange={e => patch('objetivos', e.target.value)} rows={2} className={`${FIELD} resize-y`} placeholder={t.plan_objectives_placeholder} />
      </div>
      <div>
        <label className={LABEL} htmlFor="pf-obs">{t.pf_internal_notes}</label>
        <textarea id="pf-obs" value={form.observaciones || ''} onChange={e => patch('observaciones', e.target.value)} rows={2} className={`${FIELD} resize-y`} placeholder={t.only_you_placeholder} />
      </div>
      {otherPlans.length > 0 && (
        <div className="border-t border-sage-200 pt-5">
          <p className={LABEL}>{t.pf_copy_from}</p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <Combobox options={otherPlans} value={copyId} onChange={setCopyId} placeholder={t.pf_copy_from} />
            </div>
            <Button variant="secondary" icon={Copy} disabled={!copyId} onClick={() => onCopyFrom(copyId)}>{t.pf_copy_apply}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Editor a pantalla completa
// ─────────────────────────────────────────────────────────────
/**
 * @param plan            planificació existent (editar) o null (nova)
 * @param defaultClientId client per a una nova planificació
 * @param basePlan        planificació de la qual copiar el contingut (opcional)
 */
export const PlanificacionEditor = ({ plan, defaultClientId, basePlan, onClose }) => {
  const t = useT();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const clients = useStore(s => s.clients);
  const plans = useStore(s => s.nutritionPlans);
  const config = useStore(s => s.config);
  const products = useStore(s => s.planLibrary.productos);
  const ownRecipes = useStore(s => s.planLibrary.recetas) || NO_RECIPES;
  const rememberRecipes = useStore(s => s.rememberRecipes);
  const addNutritionPlan = useStore(s => s.addNutritionPlan);
  const updateNutritionPlan = useStore(s => s.updateNutritionPlan);

  const fresh = (clienteId) => {
    const base = basePlan || latestPlanificacion(plans, clienteId);
    return {
      form: createPlanificacion({ clienteId, plans, base, today: todayISO() }),
      origin: base?.nombre || null,
    };
  };

  const [{ form, origin }, setState] = useState(() => {
    if (plan) return { form: normalizePlanificacion(plan), origin: null };
    const clienteId = defaultClientId || basePlan?.clienteId;
    return clienteId ? fresh(clienteId) : { form: null, origin: null };
  });
  const [savedId, setSavedId] = useState(plan?.id || null);
  // Contingut en obrir (o en l'últim desat): el que no canvia no torna a "Mis recetas"
  const baselineRef = useRef(form);
  const [dirty, setDirty] = useState(!plan);
  const [section, setSection] = useState(plan ? 'menu' : 'general');
  const [showPreview, setShowPreview] = useState(true);
  const dialogRef = useRef(null);
  const titleId = useId();

  const client = clients.find(c => c.id === form?.clienteId);
  const { items: webRecipes } = useWebRecipes();
  const dishIndex = useMemo(() => buildDishIndex(ownRecipes, webRecipes), [ownRecipes, webRecipes]);
  const otherPlans = useMemo(() => plans
    .filter(p => p.formato === PLAN_FORMAT && p.id !== savedId)
    .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''))
    .map(p => ({
      value: p.id,
      label: `${clients.find(c => c.id === p.clienteId)?.nombre || '—'} · ${p.nombre}`,
      hint: p.fechaInicio || '',
    })), [plans, clients, savedId]);

  const update = (fn) => { setState(s => ({ ...s, form: fn(s.form) })); setDirty(true); };
  const patch = (k, v) => update(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form?.clienteId) return;
    const data = { ...form, nombre: form.nombre?.trim() || `Planificación ${form.numero || ''}`.trim() };
    if (savedId) {
      updateNutritionPlan(savedId, data);
      toast.success(t.pf_saved);
    } else {
      setSavedId(addNutritionPlan(data).id);
      toast.success(t.pf_created);
    }
    // Els plats escrits o retocats a mà queden a "Mis recetas"; els que no
    // han canviat no, perquè una recepta esborrada de la llista no hi torni
    const before = new Set(collectOwnRecipes(baselineRef.current, webRecipes).map(r => JSON.stringify(r)));
    rememberRecipes(collectOwnRecipes(data, webRecipes).filter(r => !before.has(JSON.stringify(r))));
    baselineRef.current = data;
    setDirty(false);
  };

  const close = async () => {
    if (dirty && form && !(await confirm(t.pf_discard_confirm))) return;
    onClose();
  };

  useDialogA11y(true, close, dialogRef);

  // Ctrl+S desa sense tancar
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const copyFrom = async (id) => {
    const src = plans.find(p => p.id === id);
    if (!src || !(await confirm(t.pf_copy_confirm.replace('{name}', src.nombre)))) return;
    update(f => ({ ...f, ...copyContent(src) }));
    setState(s => ({ ...s, origin: src.nombre }));
    toast.success(t.pf_copy_done);
  };

  const generate = async () => {
    const { generatePlanificacionPDF } = await import('../../services/pdfPlanificacionGenerator');
    return generatePlanificacionPDF(form, client, config, { products });
  };

  const download = async () => {
    try {
      const bytes = await generate();
      const { save: saveDialog } = await import('@tauri-apps/api/dialog');
      const { writeBinaryFile } = await import('@tauri-apps/api/fs');
      const filePath = await saveDialog({ defaultPath: planPdfFileName(form, client), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!filePath) return;
      await writeBinaryFile(filePath, bytes);
      invoke('open_file', { path: filePath }).catch(() => {});
      toast.success(t.pdf_saved);
    } catch (e) {
      toast.error(t.pdf_error.replace('{error}', errMsg(e)));
    }
  };

  const sectionLabel = (id) => t[`pf_section_${id}`];
  const stats = form ? planificacionStats(form) : null;
  const countFor = (id) => {
    if (!form) return null;
    if (id === 'menu') return stats.platos || null;
    if (id === 'productos') return form.productos.length || null;
    if (id === 'cantidades') return form.cantidades.grupos.length || null;
    if (form[id]?.opciones) return form[id].opciones.filter(o => o.titulo?.trim()).length || null;
    return null;
  };

  const clientOptions = useMemo(() => [...clients]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(c => ({ value: c.id, label: c.nombre, hint: c.email || c.telefono || '' })), [clients]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-sage-50 animate-fadeIn focus:outline-none"
    >
      <header className="flex items-center gap-3 px-4 h-16 bg-white border-b border-sage-300 shrink-0">
        <button type="button" onClick={close} aria-label={t.close} className="p-2 rounded-button hover:bg-sage-100 transition-colors">
          <X size={18} className="text-sage-500" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-serif text-heading text-sage-900 truncate leading-tight">
            {form?.nombre || (plan ? t.pf_edit_title : t.pf_new_title)}
          </h2>
          {client && <p className="text-xs text-sage-500 truncate">{client.nombre}</p>}
        </div>
        {form && (
          <>
            <SegmentedControl
              ariaLabel={t.plan_status}
              value={form.estado}
              onChange={v => patch('estado', v)}
              className="hidden md:inline-flex"
              options={[
                { value: 'borrador', label: t.plan_status_draft },
                { value: 'activo', label: t.plan_status_active },
                { value: 'completado', label: t.plan_status_completed },
              ]}
            />
            <Button variant="ghost" icon={showPreview ? EyeOff : Eye} onClick={() => setShowPreview(v => !v)} className="hidden lg:inline-flex" aria-pressed={showPreview}>
              {t.pf_preview}
            </Button>
            <Button variant="secondary" icon={Download} onClick={download}>{t.download_pdf}</Button>
            <Button variant="primary" icon={Save} onClick={save} disabled={!dirty && !!savedId}>{t.save}</Button>
          </>
        )}
      </header>

      {!form ? (
        <div className="flex-1 flex items-start justify-center p-10">
          <div className="w-full max-w-md bg-white border border-sage-300 rounded-soft shadow-card p-6 space-y-3">
            <p className="text-sm text-sage-700">{t.pf_choose_client}</p>
            <Combobox
              options={clientOptions}
              value=""
              onChange={id => id && setState(fresh(id))}
              placeholder={t.select_client_placeholder}
              autoFocus
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <nav aria-label={t.pf_edit_title} className="w-56 shrink-0 bg-white border-r border-sage-300 overflow-y-auto py-3">
            <ul className="space-y-0.5 px-2">
              {SECTIONS.map(({ id, icon: Icon }) => {
                const toggleable = id !== 'general';
                const on = !toggleable || form.secciones[id];
                const n = countFor(id);
                return (
                  <li key={id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSection(id)}
                      aria-current={section === id ? 'page' : undefined}
                      className={`flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-button text-sm text-left transition-colors ${section === id ? 'bg-wellness-50 text-sage-900 font-medium' : 'text-sage-600 hover:bg-sage-100'}`}
                    >
                      <Icon size={15} className={section === id ? 'text-wellness-500' : 'text-sage-400'} />
                      <span className={`truncate ${on ? '' : 'line-through text-sage-400'}`}>{sectionLabel(id)}</span>
                      {n ? <span className="ml-auto text-[11px] text-sage-500 tabular-nums">{n}</span> : null}
                    </button>
                    {toggleable && (
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={e => patch('secciones', { ...form.secciones, [id]: e.target.checked })}
                        aria-label={t.pf_show_in_pdf.replace('{name}', sectionLabel(id))}
                        title={on ? t.pf_show_in_pdf.replace('{name}', sectionLabel(id)) : t.pf_hidden}
                        className="w-4 h-4 mr-1 accent-wellness-400 shrink-0"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
              <h3 className="font-serif text-title text-sage-900">{sectionLabel(section)}</h3>
              {section === 'general' && (
                <GeneralEditor form={form} patch={patch} client={client} origin={origin} onCopyFrom={copyFrom} otherPlans={otherPlans} />
              )}
              {['desayunos', 'mediaManana', 'merienda'].includes(section) && (
                <OptionSectionEditor key={section} value={form[section]} onChange={v => patch(section, v)} dishIndex={dishIndex} />
              )}
              {section === 'cantidades' && <CantidadesEditor value={form.cantidades} onChange={v => patch('cantidades', v)} />}
              {section === 'menu' && <MenuEditor value={form.menu} onChange={v => patch('menu', v)} dishIndex={dishIndex} />}
              {section === 'productos' && <ProductsEditor selected={form.productos} onChange={ids => patch('productos', ids)} foods={planFoods(form)} />}
            </div>
          </main>

          {showPreview && (
            <aside aria-label={t.pf_preview} className="hidden lg:block w-[40%] max-w-[600px] shrink-0 border-l border-sage-300 bg-sage-100 overflow-y-auto">
              <PdfPreview
                generate={generate}
                deps={[form, client?.nombre, config?.nombre, config?.web, config?.email, config?.telefono, config?.numColegiada, products]}
              />
            </aside>
          )}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
};

export default PlanificacionEditor;
