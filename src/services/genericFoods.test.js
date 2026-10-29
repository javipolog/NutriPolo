import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { FOOD_CATALOG, FOOD_GROUPS, findCatalogFood, filterFoodCatalog, foodCatalogImage } from './genericFoods';

describe('FOOD_CATALOG', () => {
  it('té una foto a public/ per a cada aliment, amb ids únics i grups coneguts', () => {
    const ids = FOOD_CATALOG.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const food of FOOD_CATALOG) {
      expect(FOOD_GROUPS).toContain(food.grupo);
      expect(existsSync(`public${foodCatalogImage(food)}`), food.id).toBe(true);
    }
  });
});

describe('findCatalogFood', () => {
  it('troba un aliment pel nom o l\'àlies, sense majúscules, accents ni plural', () => {
    expect(findCatalogFood('Salmón')?.id).toBe('salmon');
    expect(findCatalogFood('lomo de salmon')?.id).toBe('salmon');
    expect(findCatalogFood('Huevo')?.id).toBe('huevos');
    expect(findCatalogFood('Tomates')?.id).toBe('tomate');
    expect(findCatalogFood('  Pan  integral ')?.id).toBe('pan');
    expect(findCatalogFood('Batata')?.id).toBe('boniato');
  });

  it('només accepta coincidències exactes', () => {
    expect(findCatalogFood('Tomate frito')).toBeNull();
    expect(findCatalogFood('Atún al natural')).toBeNull();
    expect(findCatalogFood('')).toBeNull();
  });
});

describe('filterFoodCatalog', () => {
  it('filtra per text dins del nom o els àlies', () => {
    expect(filterFoodCatalog('manzana').map(f => f.id)).toEqual(['manzana', 'manzana-verde']);
    expect(filterFoodCatalog('langost').map(f => f.id)).toEqual(['gambas']);
    expect(filterFoodCatalog('')).toBe(FOOD_CATALOG);
  });
});
