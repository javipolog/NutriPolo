/**
 * Biblioteca d'aliments: els genèrics amb foto (genericFoods.js, sempre
 * presents) i els bàsics de Mercadona (Mercadona + Open Food Facts + BEDCA).
 *
 * Mercadona el genera `scripts/catalog/import-mercadona.mjs` a `public/catalog/`
 * i va empaquetat amb l'app com a dades de només lectura: no passa pel store ni
 * per les còpies de seguretat. Si no s'ha generat, la biblioteca només té els
 * genèrics. Les funcions de filtre són pures i tenen tests.
 */

import { GENERIC_FOODS, genericFoodImage } from './genericFoods';
import { dishKey } from './planificacion';

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

/**
 * Genèrics + Mercadona en una sola llista, amb el format dels de Mercadona.
 * Un genèric pren els valors nutricionals del producte equivalent
 * (`nutricion.equivalente` = nom del producte).
 */
export function buildFoodLibrary(mercadona = []) {
  const bySourceId = new Map(mercadona.map(f => [f.sourceId, f]));
  const generic = GENERIC_FOODS.map(g => {
    const twin = g.mercadona ? bySourceId.get(g.mercadona) : null;
    return {
      id: `gen-${g.id}`,
      source: 'generico',
      basico: g.nombre,
      nombre: g.nombre,
      alias: g.alias || [],
      categoria: g.categoria,
      imagenUrl: genericFoodImage(g),
      por100g: twin?.por100g ?? null,
      nutricion: twin ? { ...twin.nutricion, equivalente: twin.nombre } : { control: 'sin_datos' },
    };
  });
  // Mateix ordre de categories que Mercadona; dins de cada una, primer els genèrics
  const order = [...new Set([...mercadona.map(f => f.categoria), ...generic.map(f => f.categoria)])];
  const all = [...generic, ...mercadona];
  return order.flatMap(cat => all.filter(f => f.categoria === cat));
}

/**
 * Aplica els canvis propis (planLibrary.alimentos) sobre la biblioteca: una
 * foto pròpia (data URL) i/o uns valors per 100 g escrits a mà. L'aliment
 * guarda `editado` per poder tornar a l'original.
 */
export function applyFoodEdits(foods, edits = {}) {
  return foods.map(food => {
    const edit = edits[food.id];
    if (!edit?.imagen && !edit?.por100g) return food;
    return {
      ...food,
      ...(edit.imagen && { imagenUrl: edit.imagen }),
      ...(edit.por100g && { por100g: edit.por100g, nutricion: { ...food.nutricion, fuente: 'manual', control: 'ok' } }),
      editado: { imagen: !!edit.imagen, por100g: !!edit.por100g },
    };
  });
}

/** La biblioteca completa; `mercadona` diu si el catàleg de la botiga hi és. */
export async function loadFoodLibrary() {
  const data = await loadFoodCatalog();
  return { alimentos: buildFoodLibrary(data?.alimentos || []), mercadona: !!data };
}

export const foodImageUrl = (food) =>
  food.imagenUrl || (food.imagen ? `${CATALOG_URL}images/${food.imagen}` : null);

export const isGeneric = (food) => food.source === 'generico';

/** Nom del producte a la biblioteca de la planificació: el concret de Mercadona. */
export const productName = (food) => (isGeneric(food) ? food.basico : food.nombre);

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

/** Matches the basic name, the shop's product name and the aliases, ignoring accents. */
export function filterFoods(foods, { query = '', grupo = 'all', source = 'all', onlyReview = false } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return foods.filter(food => {
    if (grupo !== 'all' && food.categoria !== grupo) return false;
    if (source !== 'all' && (source === 'generico') !== isGeneric(food)) return false;
    if (onlyReview && !needsReview(food)) return false;
    if (!words.length) return true;
    const text = normalize([food.basico, food.nombre, ...(food.alias || [])].join(' '));
    return words.every(w => text.includes(w));
  });
}

// Plural simple: "huevos" i "huevo" són el mateix aliment
const singular = (key) => key.replace(/(?<=[aeiou])s$/, '');

/**
 * Busca un aliment de la planificació a la biblioteca pel nom: primer els
 * genèrics (nom o àlies) i, si no n'hi ha, el bàsic de Mercadona sense el que
 * va entre parèntesis ("Pechuga de pollo (filetes)"). Sense majúscules,
 * accents ni plural, i només coincidència exacta: "Tomate frito" no és tomate.
 * @returns {(name: string) => object | null}
 */
export function foodMatcher(foods) {
  const index = new Map();
  const add = (name, food) => {
    const key = dishKey(String(name).replace(/\([^)]*\)/g, ' '));
    if (!key) return;
    if (!index.has(key)) index.set(key, food);
    if (!index.has(singular(key))) index.set(singular(key), food);
  };
  for (const food of foods.filter(isGeneric)) [food.basico, ...food.alias].forEach(n => add(n, food));
  for (const food of foods.filter(f => !isGeneric(f))) add(food.basico, food);
  return (name) => {
    const key = dishKey(name);
    return key ? index.get(key) || index.get(singular(key)) || null : null;
  };
}
