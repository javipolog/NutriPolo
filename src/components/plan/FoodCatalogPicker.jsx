import React, { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Modal, SegmentedControl, Spinner } from '../UI';
import { useT } from '../../i18n';
import { dishKey } from '../../services/planificacion';
import { filterFoods, groupFoods, foodImageUrl, isGeneric, productName } from '../../services/foodCatalog';
import { useFoodLibrary } from '../../hooks/useFoodLibrary';

/**
 * Tria aliments de la biblioteca (genèrics + Mercadona). `onPick(food)` el
 * copia a la biblioteca de productes i el marca a la planificació; els que ja
 * hi són surten marcats. Es poden triar diversos sense tancar.
 */
export const FoodCatalogPicker = ({ open, onClose, products, selected, onPick }) => {
  const t = useT();
  const { alimentos, mercadona } = useFoodLibrary();
  const [query, setQuery] = useState('');
  const [grupo, setGrupo] = useState('all');
  const [source, setSource] = useState('all');
  const [loadingId, setLoadingId] = useState(null);

  const productByKey = useMemo(() => new Map(products.map(pr => [dishKey(pr.nombre), pr])), [products]);
  const groups = useMemo(() => groupFoods(alimentos).map(g => g.grupo), [alimentos]);
  const shown = useMemo(() => filterFoods(alimentos, { query, grupo, source }), [alimentos, query, grupo, source]);

  const pick = async (food) => {
    setLoadingId(food.id);
    try { await onPick(food); } finally { setLoadingId(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.pf_food_catalog} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-sage-600">{t.pf_food_catalog_hint}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.foods_search}
              aria-label={t.foods_search}
              className="w-full text-sm text-sage-800 bg-white border border-sage-300 rounded-button pl-9 pr-3 py-2 placeholder-sage-400 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10"
              autoFocus
            />
          </div>
          <select
            value={grupo}
            onChange={e => setGrupo(e.target.value)}
            aria-label={t.foods_group}
            className="px-3 py-2 text-sm bg-white border border-sage-300 rounded-button text-sage-700 focus:outline-none focus:border-wellness-400"
          >
            <option value="all">{t.foods_all_groups}</option>
            {groups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          {mercadona && (
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
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-sage-500 py-10 text-center">{t.foods_no_results}</p>
        ) : (
          <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {shown.map(food => {
              const product = productByKey.get(dishKey(productName(food)));
              const on = !!product && selected.includes(product.id);
              const src = foodImageUrl(food);
              return (
                <li key={food.id}>
                  <button
                    type="button"
                    onClick={() => pick(food)}
                    disabled={loadingId !== null || on || !src}
                    aria-pressed={on}
                    aria-busy={loadingId === food.id || undefined}
                    title={isGeneric(food) ? food.basico : food.nombre}
                    className={`relative w-full h-full bg-white rounded-soft p-2 border text-center transition-colors focus:outline-none focus:ring-2 focus:ring-wellness-400/25 disabled:cursor-default ${on ? 'border-wellness-400 ring-2 ring-wellness-400/20' : 'border-sage-200 hover:border-wellness-400'}`}
                  >
                    {src
                      ? <img src={src} alt="" loading="lazy" className="w-full aspect-square object-contain" />
                      : <span className="block w-full aspect-square bg-sage-100 rounded-button" />}
                    <span className="block mt-1 text-xs text-sage-800 leading-tight">{food.basico}</span>
                    {!isGeneric(food) && <span className="block text-[11px] text-sage-500 leading-tight truncate">{food.nombre}</span>}
                    {on && (
                      <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-wellness-400 text-white flex items-center justify-center" title={t.pf_in_plan}>
                        <Check size={13} aria-hidden="true" />
                      </span>
                    )}
                    {loadingId === food.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-sage-50/70 rounded-soft"><Spinner size="sm" /></span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};
