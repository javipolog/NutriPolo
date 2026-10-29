/**
 * Catàleg d'aliments bàsics (Mercadona + Open Food Facts + BEDCA).
 *
 * El genera `scripts/catalog/import-mercadona.mjs` a `public/catalog/` i va
 * empaquetat amb l'app com a dades de només lectura: no passa pel store ni per
 * les còpies de seguretat. Les funcions de filtre són pures i tenen tests.
 */

export const CATALOG_URL = '/catalog/';

let pending = null;

/** Loads foods.json once per session; null when the catalog hasn't been generated. */
export function loadFoodCatalog() {
  pending ??= fetch(`${CATALOG_URL}foods.json`)
    .then(res => (res.ok ? res.json() : null))
    // A missing file can come back as the app's index.html instead of a 404
    .catch(() => null)
    .then(data => (Array.isArray(data?.alimentos) ? data : null))
    .then(data => {
      if (!data) pending = null;
      return data;
    });
  return pending;
}

export const foodImageUrl = (food) => (food.imagen ? `${CATALOG_URL}images/${food.imagen}` : null);

/** Products whose nutrition is missing or doesn't add up. */
export const needsReview = (food) => food.nutricion?.control !== 'ok';

const normalize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Groups in catalog order (basics.json order), each with its foods. */
export function groupFoods(foods) {
  const groups = new Map();
  for (const food of foods) {
    if (!groups.has(food.categoria)) groups.set(food.categoria, []);
    groups.get(food.categoria).push(food);
  }
  return [...groups].map(([grupo, items]) => ({ grupo, items }));
}

/** Matches the basic name and the shop's product name, ignoring accents. */
export function filterFoods(foods, { query = '', grupo = 'all', onlyReview = false } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return foods.filter(food => {
    if (grupo !== 'all' && food.categoria !== grupo) return false;
    if (onlyReview && !needsReview(food)) return false;
    if (!words.length) return true;
    const text = normalize(`${food.basico || ''} ${food.nombre || ''}`);
    return words.every(w => text.includes(w));
  });
}
