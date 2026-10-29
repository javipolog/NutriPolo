import React, { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Modal, SegmentedControl, Spinner } from '../UI';
import { useT } from '../../i18n';
import { dishKey } from '../../services/planificacion';
import { FOOD_CATALOG, FOOD_GROUPS, filterFoodCatalog, foodCatalogImage } from '../../services/genericFoods';

/**
 * Tria aliments del catàleg (fotos genèriques sobre blanc). `onPick(food)`
 * el copia a la biblioteca i el marca a la planificació; els que ja hi són
 * surten marcats. Es poden triar diversos sense tancar.
 */
export const FoodCatalogPicker = ({ open, onClose, products, selected, onPick }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [loadingId, setLoadingId] = useState(null);

  const productByKey = useMemo(() => new Map(products.map(pr => [dishKey(pr.nombre), pr])), [products]);
  const shown = useMemo(
    () => filterFoodCatalog(query, group === 'all' ? FOOD_CATALOG : FOOD_CATALOG.filter(f => f.grupo === group)),
    [query, group],
  );

  const pick = async (food) => {
    setLoadingId(food.id);
    try { await onPick(food); } finally { setLoadingId(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.pf_food_catalog} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-sage-600">{t.pf_food_catalog_hint}</p>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sage-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.pf_food_catalog_search}
            aria-label={t.pf_food_catalog_search}
            className="w-full text-sm text-sage-800 bg-white border border-sage-300 rounded-button pl-9 pr-3 py-2 placeholder-sage-400 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10"
            autoFocus
          />
        </div>
        <div className="overflow-x-auto">
          <SegmentedControl
            ariaLabel={t.pf_food_catalog}
            value={group}
            onChange={setGroup}
            options={[{ value: 'all', label: t.pf_food_group_all }, ...FOOD_GROUPS.map(g => ({ value: g, label: t[`pf_food_group_${g}`] }))]}
          />
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-sage-500 py-10 text-center">{t.pf_food_catalog_empty}</p>
        ) : (
          <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {shown.map(food => {
              const product = productByKey.get(dishKey(food.nombre));
              const on = !!product && selected.includes(product.id);
              return (
                <li key={food.id}>
                  <button
                    type="button"
                    onClick={() => pick(food)}
                    disabled={loadingId !== null || on}
                    aria-pressed={on}
                    aria-busy={loadingId === food.id || undefined}
                    className={`relative w-full bg-white rounded-soft p-2 border text-center transition-colors focus:outline-none focus:ring-2 focus:ring-wellness-400/25 disabled:cursor-default ${on ? 'border-wellness-400 ring-2 ring-wellness-400/20' : 'border-sage-200 hover:border-wellness-400'}`}
                  >
                    <img src={foodCatalogImage(food)} alt="" loading="lazy" className="w-full aspect-square object-contain" />
                    <span className="block mt-1 text-xs text-sage-800 leading-tight">{food.nombre}</span>
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
