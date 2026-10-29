import { describe, it, expect } from 'vitest';
import { filterFoods, groupFoods, needsReview, foodImageUrl, buildFoodLibrary, foodMatcher, isGeneric } from './foodCatalog';
import { GENERIC_FOODS } from './genericFoods';

const food = (basico, nombre, categoria, control = 'ok', imagen = null) =>
  ({ basico, nombre, categoria, imagen, nutricion: { control } });

const FOODS = [
  food('Plátano', 'Plátano de Canarias IGP', 'Frutas', 'ok', '3819.jpg'),
  food('Pera', 'Pera Conferencia', 'Frutas'),
  food('Brócoli', 'Brócoli', 'Verduras y hortalizas', 'sin_datos'),
  food('Dorada (filetes)', 'Filetes de dorada', 'Pescado y marisco', 'revisar'),
];

describe('filterFoods', () => {
  it('returns everything without filters', () => {
    expect(filterFoods(FOODS)).toHaveLength(4);
  });

  it('matches the basic and the product name, ignoring accents and case', () => {
    expect(filterFoods(FOODS, { query: 'platano' }).map(f => f.basico)).toEqual(['Plátano']);
    expect(filterFoods(FOODS, { query: 'CONFERENCIA' }).map(f => f.basico)).toEqual(['Pera']);
  });

  it('needs every word to match', () => {
    expect(filterFoods(FOODS, { query: 'filetes dorada' })).toHaveLength(1);
    expect(filterFoods(FOODS, { query: 'filetes pera' })).toHaveLength(0);
  });

  it('filters by group and by review status', () => {
    expect(filterFoods(FOODS, { grupo: 'Frutas' })).toHaveLength(2);
    expect(filterFoods(FOODS, { onlyReview: true }).map(f => f.basico)).toEqual(['Brócoli', 'Dorada (filetes)']);
  });
});

describe('groupFoods', () => {
  it('keeps the catalog order of groups and foods', () => {
    expect(groupFoods(FOODS).map(g => [g.grupo, g.items.length])).toEqual([
      ['Frutas', 2], ['Verduras y hortalizas', 1], ['Pescado y marisco', 1],
    ]);
  });
});

describe('helpers', () => {
  it('flags anything that is not ok for review', () => {
    expect(FOODS.map(needsReview)).toEqual([false, false, true, true]);
  });

  it('builds image urls only when there is a photo', () => {
    expect(foodImageUrl(FOODS[0])).toBe('/catalog/images/3819.jpg');
    expect(foodImageUrl(FOODS[1])).toBeNull();
  });
});

describe('buildFoodLibrary', () => {
  const MERCADONA = [
    { id: 'merc-87204', source: 'mercadona', sourceId: '87204', basico: 'Salmón', nombre: 'Porción de salmón', categoria: 'Pescado y marisco', imagen: '87204.jpg', por100g: { kcal: 208 }, nutricion: { fuente: 'bedca', control: 'ok' } },
    { id: 'merc-2787', source: 'mercadona', sourceId: '2787', basico: 'Pechuga de pollo (filetes)', nombre: 'Filetes pechuga de pollo', categoria: 'Carne', imagen: '2787.jpg', nutricion: { control: 'ok' } },
  ];

  it('works with only the generic foods when Mercadona is missing', () => {
    const lib = buildFoodLibrary();
    expect(lib).toHaveLength(GENERIC_FOODS.length);
    expect(lib.every(isGeneric)).toBe(true);
    expect(foodImageUrl(lib[0])).toMatch(/^\/alimentos\/.+\.jpg$/);
  });

  it('puts both together by category, generic first, with the twin product nutrition', () => {
    const lib = buildFoodLibrary(MERCADONA);
    expect(lib).toHaveLength(GENERIC_FOODS.length + 2);
    const fish = lib.filter(f => f.categoria === 'Pescado y marisco').map(f => f.id);
    expect(fish.indexOf('gen-salmon')).toBeLessThan(fish.indexOf('merc-87204'));
    const salmon = lib.find(f => f.id === 'gen-salmon');
    expect(salmon.por100g).toEqual({ kcal: 208 });
    expect(salmon.nutricion).toMatchObject({ fuente: 'bedca', control: 'ok', equivalente: 'Porción de salmón' });
    expect(needsReview(lib.find(f => f.id === 'gen-chocolate'))).toBe(true);
  });

  it('filters by source', () => {
    const lib = buildFoodLibrary(MERCADONA);
    expect(filterFoods(lib, { source: 'mercadona' }).map(f => f.id)).toEqual(['merc-87204', 'merc-2787']);
    expect(filterFoods(lib, { source: 'generico', query: 'langostino' }).map(f => f.id)).toEqual(['gen-gambas']);
  });
});

describe('foodMatcher', () => {
  const match = foodMatcher(buildFoodLibrary([
    { id: 'merc-87204', sourceId: '87204', basico: 'Salmón', nombre: 'Porción de salmón', categoria: 'Pescado y marisco', nutricion: {} },
    { id: 'merc-2787', sourceId: '2787', basico: 'Pechuga de pollo (filetes)', nombre: 'Filetes pechuga de pollo', categoria: 'Carne', nutricion: {} },
  ]));

  it('prefers the generic photo, ignoring case, accents and plural', () => {
    expect(match('salmon')?.id).toBe('gen-salmon');
    expect(match('Lomo de salmón')?.id).toBe('gen-salmon');
    expect(match('Huevo')?.id).toBe('gen-huevos');
    expect(match('Batata')?.id).toBe('gen-boniato');
  });

  it('falls back to the Mercadona basic without the parenthesis', () => {
    expect(match('Pechuga de pollo')?.id).toBe('merc-2787');
  });

  it('only takes exact matches', () => {
    expect(match('Tomate frito')).toBeNull();
    expect(match('')).toBeNull();
  });
});
