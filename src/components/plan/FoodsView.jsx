import React, { useMemo, useRef, useState } from 'react';
import { Apple, Search, AlertTriangle, ImagePlus, RotateCcw, Pencil, Save } from 'lucide-react';
import { Button, Input, Modal, Badge, EmptyState, Spinner, SegmentedControl, clickableProps, useToast } from '../UI';
import { foodImageUrl, filterFoods, groupFoods, needsReview, isGeneric } from '../../services/foodCatalog';
import { imageFileToDataUrl } from '../../services/planPdf';
import { useFoodLibrary } from '../../hooks/useFoodLibrary';
import useStore, { formatCurrency } from '../../stores/store';
import { useT, useLocale, plural } from '../../i18n';

const NUTRIENT_ROWS = [
  ['kcal', 'foods_kcal', 'kcal'],
  ['proteinas', 'foods_protein', 'g'],
  ['hidratos', 'foods_carbs', 'g'],
  ['azucares', 'foods_sugars', 'g'],
  ['grasas', 'foods_fat', 'g'],
  ['grasasSaturadas', 'foods_saturated', 'g'],
  ['fibra', 'foods_fiber', 'g'],
  ['sal', 'foods_salt', 'g'],
];

const useNumber = () => {
  const locale = useLocale();
  return useMemo(() => {
    const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    return v => (v == null ? '—' : fmt.format(v));
  }, [locale]);
};

const SourceBadge = ({ food }) => {
  const t = useT();
  const { fuente, aproximado } = food.nutricion || {};
  return (
    <>
      {isGeneric(food) && <Badge tone="success">{t.foods_generic_badge}</Badge>}
      {food.editado && <Badge tone="accent" icon={Pencil}>{t.foods_edited}</Badge>}
      {fuente === 'openfoodfacts' && <Badge tone="neutral">{t.foods_source_label}</Badge>}
      {fuente === 'bedca' && <Badge tone="info">{aproximado ? t.foods_source_bedca_approx : t.foods_source_bedca}</Badge>}
    </>
  );
};

const ReviewBadge = ({ food }) => {
  const t = useT();
  const control = food.nutricion?.control;
  if (control === 'sin_datos') return <Badge tone="danger" icon={AlertTriangle}>{t.foods_no_data}</Badge>;
  if (needsReview(food)) return <Badge tone="warning" icon={AlertTriangle}>{t.foods_check}</Badge>;
  return null;
};

const FoodPhoto = ({ food, className }) => {
  const src = foodImageUrl(food);
  return src
    ? <img src={src} alt="" loading="lazy" className={`aspect-square w-full object-contain rounded-button ${className}`} />
    : <div className={`aspect-square w-full rounded-button bg-sage-100 flex items-center justify-center ${className}`}><Apple size={28} className="text-sage-300" /></div>;
};

const FoodCard = ({ food, onOpen }) => {
  const t = useT();
  const num = useNumber();
  const p = food.por100g;
  return (
    <div
      {...clickableProps(onOpen)}
      aria-label={food.basico}
      className="bg-white border border-sage-200 rounded-soft shadow-card p-3 flex flex-col gap-2 cursor-pointer hover:border-sage-300 transition-colors"
    >
      <FoodPhoto food={food} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-sage-900 leading-snug">{food.basico}</p>
        <p className="text-xs text-sage-500 truncate" title={food.nombre}>{isGeneric(food) ? t.foods_generic_photo : food.nombre}</p>
      </div>
      {p ? (
        <p className="text-xs text-sage-600 tabular-nums">
          <span className="font-semibold text-sage-800">{num(p.kcal)}</span> kcal
          {' · '}{t.foods_protein_short} {num(p.proteinas)}
          {' · '}{t.foods_carbs_short} {num(p.hidratos)}
          {' · '}{t.foods_fat_short} {num(p.grasas)}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1">
        <ReviewBadge food={food} />
        <SourceBadge food={food} />
      </div>
    </div>
  );
};

// "12,5" o "12.5" → 12.5; buit → null; text que no és un número → NaN
const parseAmount = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  return s === '' ? null : Number(s);
};

const FoodDetail = ({ food, onClose }) => {
  const t = useT();
  const num = useNumber();
  const toast = useToast();
  const setFoodEdit = useStore(s => s.setFoodEdit);
  const clearFoodEdit = useStore(s => s.clearFoodEdit);
  const fileRef = useRef(null);
  const [draft, setDraft] = useState(null); // valors en edició, com a text
  const p = food.por100g || {};
  const { formato = {}, precio = {}, nutricion = {}, editado = {} } = food;

  const changePhoto = async (file) => {
    if (!file) return;
    try {
      setFoodEdit(food.id, { imagen: await imageFileToDataUrl(file) });
    } catch {
      toast.error(t.pf_image_error.replace('{name}', file.name));
    }
  };

  const startEditing = () => setDraft(Object.fromEntries(NUTRIENT_ROWS.map(([key]) => [key, p[key] == null ? '' : String(p[key]).replace('.', ',')])));
  const parsed = draft && Object.fromEntries(NUTRIENT_ROWS.map(([key]) => [key, parseAmount(draft[key])]));
  const invalid = parsed && Object.values(parsed).some(v => Number.isNaN(v) || v < 0);
  const saveValues = () => {
    setFoodEdit(food.id, { por100g: parsed });
    setDraft(null);
  };

  return (
    <Modal open onClose={onClose} title={food.basico}>
      <div className="grid sm:grid-cols-[200px_1fr] gap-6">
        <div className="space-y-2">
          <FoodPhoto food={food} className="border border-sage-200" />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={e => { changePhoto(e.target.files[0]); e.target.value = ''; }}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" icon={ImagePlus} onClick={() => fileRef.current?.click()}>{t.foods_change_photo}</Button>
            {editado.imagen && (
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => clearFoodEdit(food.id, 'imagen')}>{t.foods_restore_photo}</Button>
            )}
          </div>
          <p className="text-sm text-sage-700">{isGeneric(food) ? t.foods_generic_photo : food.nombre}</p>
          <p className="text-xs text-sage-500 tabular-nums">
            {[formato.envase, formato.cantidad != null && `${num(formato.cantidad)} ${formato.unidad || ''}`].filter(Boolean).join(' · ')}
            {precio.unidad != null && <> · {formatCurrency(precio.unidad)}</>}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold text-sage-700">{t.foods_per_100}</h3>
              {!draft && (
                <div className="ml-auto flex gap-1">
                  {editado.por100g && (
                    <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => clearFoodEdit(food.id, 'por100g')}>{t.foods_restore_values}</Button>
                  )}
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={startEditing}>{t.foods_edit_values}</Button>
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {NUTRIENT_ROWS.map(([key, label, unit]) => (
                  <tr key={key} className="border-b border-sage-100 last:border-0">
                    <td className={`py-1.5 ${key === 'azucares' || key === 'grasasSaturadas' ? 'pl-4 text-sage-500' : 'text-sage-700'}`}>
                      {draft ? <label htmlFor={`food-${key}`}>{t[label]}</label> : t[label]}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-sage-900">
                      {draft ? (
                        <span className="inline-flex items-center gap-1.5">
                          <input
                            id={`food-${key}`}
                            inputMode="decimal"
                            value={draft[key]}
                            onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                            aria-invalid={Number.isNaN(parsed[key]) || parsed[key] < 0 || undefined}
                            className={`w-20 text-right tabular-nums text-sm text-sage-800 bg-white border rounded-button px-2 py-1 focus:outline-none focus:border-wellness-400 ${Number.isNaN(parsed[key]) || parsed[key] < 0 ? 'border-danger' : 'border-sage-300'}`}
                          />
                          <span className="w-7 text-left text-sage-500">{unit}</span>
                        </span>
                      ) : (
                        <>{num(p[key])}{p[key] != null && <span className="text-sage-500"> {unit}</span>}</>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {draft ? (
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>{t.cancel}</Button>
                <Button variant="primary" size="sm" icon={Save} onClick={saveValues} disabled={invalid}>{t.save}</Button>
              </div>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ReviewBadge food={food} />
                  <SourceBadge food={food} />
                </div>
                <p className="text-xs text-sage-500 mt-2">
                  {nutricion.fuente === 'manual' ? t.foods_source_manual_desc : (
                    <>
                      {nutricion.equivalente && <>{t.foods_generic_equivalent.replace('{name}', nutricion.equivalente)} </>}
                      {nutricion.fuente === 'bedca'
                        ? t.foods_source_bedca_desc.replace('{name}', nutricion.alimentoGenerico || '')
                        : nutricion.fuente === 'openfoodfacts' ? t.foods_source_label_desc : t.foods_no_data_desc}
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          {food.ingredientes && (
            <div>
              <h3 className="text-xs font-semibold text-sage-700 mb-1">{t.foods_ingredients}</h3>
              <p className="text-sm text-sage-600">{food.ingredientes}</p>
            </div>
          )}
          {food.alergenos && (
            <div>
              <h3 className="text-xs font-semibold text-sage-700 mb-1">{t.foods_allergens}</h3>
              <p className="text-sm text-sage-600">{food.alergenos}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const FoodsView = () => {
  const t = useT();
  const library = useFoodLibrary();
  const [query, setQuery] = useState('');
  const [grupo, setGrupo] = useState('all');
  const [show, setShow] = useState('all');
  const [source, setSource] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const foods = library.alimentos;
  // Per id, perquè el detall es refresqui quan s'hi canvia la foto o els valors
  const selected = selectedId && foods.find(f => f.id === selectedId);
  const groups = useMemo(() => groupFoods(foods).map(g => g.grupo), [foods]);
  const reviewCount = useMemo(() => foods.filter(needsReview).length, [foods]);
  const visible = useMemo(
    () => groupFoods(filterFoods(foods, { query, grupo, source, onlyReview: show === 'review' })),
    [foods, query, grupo, source, show],
  );
  const visibleCount = visible.reduce((n, g) => n + g.items.length, 0);

  if (library.loading) {
    return <div className="flex justify-center py-24"><Spinner /></div>;
  }

  return (
    <div className="space-y-5">
      {!library.mercadona && (
        <p className="text-xs text-warning bg-warning-light rounded-button px-3 py-2 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
          <span><strong className="font-semibold">{t.foods_missing_title}.</strong> {t.foods_missing_desc}</span>
        </p>
      )}
      <>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            icon={Search}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.foods_search}
            aria-label={t.foods_search}
            className="flex-1 min-w-48"
          />
          <select
            value={grupo}
            onChange={e => setGrupo(e.target.value)}
            aria-label={t.foods_group}
            className="px-3 py-2 text-sm bg-white border border-sage-300 rounded-button text-sage-700 focus:outline-none focus:border-wellness-400"
          >
            <option value="all">{t.foods_all_groups}</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          {library.mercadona && (
            <SegmentedControl
              ariaLabel={t.foods_source}
              value={source}
              onChange={setSource}
              options={[
                { value: 'all', label: t.foods_show_all },
                { value: 'generico', label: t.foods_source_generic },
                { value: 'mercadona', label: t.foods_source_mercadona },
              ]}
            />
          )}
          <SegmentedControl
            ariaLabel={t.foods_show}
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: t.foods_show_all },
              { value: 'review', label: `${t.foods_show_review} (${reviewCount})` },
            ]}
          />
        </div>

        <p className="text-xs text-sage-500 tabular-nums">
          {visibleCount === foods.length
            ? plural(t, 'foods_count', foods.length)
            : t.foods_count_filtered.replace('{n}', visibleCount).replace('{total}', foods.length)}
        </p>

        {visibleCount === 0 ? (
          <EmptyState icon={Search} title={t.foods_no_results} />
        ) : (
          visible.map(({ grupo: name, items }) => (
            <section key={name} className="space-y-3">
              <h2 className="text-sm font-semibold text-sage-700">
                {name} <span className="font-normal text-sage-500 tabular-nums">{items.length}</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {items.map(food => <FoodCard key={food.id} food={food} onOpen={() => setSelectedId(food.id)} />)}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-sage-500">{t.foods_sources_note}</p>
      </>

      {selected && <FoodDetail food={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
};

export default FoodsView;
