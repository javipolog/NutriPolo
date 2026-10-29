import { describe, it, expect } from 'vitest';
import { filterFoods, groupFoods, needsReview, foodImageUrl } from './foodCatalog';

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
