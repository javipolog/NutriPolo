import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { GENERIC_FOODS, genericFoodImage } from './genericFoods';

describe('GENERIC_FOODS', () => {
  it('té una foto a public/ per a cada aliment, amb ids únics', () => {
    const ids = GENERIC_FOODS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const food of GENERIC_FOODS) {
      expect(existsSync(`public${genericFoodImage(food)}`), food.id).toBe(true);
    }
  });

  it('fa servir les categories del catàleg de Mercadona', () => {
    const CATEGORIES = [
      'Cereales, pan y tubérculos', 'Legumbres y derivados', 'Verduras y hortalizas', 'Frutas',
      'Frutos secos y semillas', 'Carne', 'Pescado y marisco', 'Huevos', 'Leche y bebidas vegetales',
      'Yogures y quesos', 'Aceites y grasas', 'Otros',
    ];
    for (const food of GENERIC_FOODS) expect(CATEGORIES, food.id).toContain(food.categoria);
  });
});
