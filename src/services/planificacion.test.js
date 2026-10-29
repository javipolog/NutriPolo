import { describe, it, expect } from 'vitest';
import {
  PLAN_FORMAT, WEEK_DAYS, linesOf, nextPlanNumber, latestPlanificacion, createPlanificacion,
  copyContent, normalizeWeek, visibleSections, planificacionStats, isDishEmpty, safeUrl, buildDishIndex,
  summarizeIngredients, collectOwnRecipes, mergeOwnRecipes, planFoods,
} from './planificacion';
import { samplePlanificacion } from './planificacion.fixture';

const plan = (over) => ({ formato: PLAN_FORMAT, clienteId: 'c1', ...over });

describe('linesOf', () => {
  it('splits lines, trims and drops empty ones and list bullets', () => {
    expect(linesOf('  Pan (60 g) \n\n- Tomate\n• AOVE\r\n')).toEqual(['Pan (60 g)', 'Tomate', 'AOVE']);
    expect(linesOf(undefined)).toEqual([]);
  });

  it('keeps a leading hyphen that is part of the text', () => {
    expect(linesOf('-15 g frutos secos')).toEqual(['-15 g frutos secos']);
  });
});

describe('numbering', () => {
  const plans = [
    plan({ id: 'p1', numero: 1, fechaInicio: '2026-01-01' }),
    plan({ id: 'p3', numero: 3, fechaInicio: '2026-03-01' }),
    plan({ id: 'x', clienteId: 'c2', numero: 7 }),
    { id: 'legacy', clienteId: 'c1', comidas: [] },
  ];

  it('continues from the highest number of the same client', () => {
    expect(nextPlanNumber(plans, 'c1')).toBe(4);
    expect(nextPlanNumber(plans, 'c2')).toBe(8);
    expect(nextPlanNumber(plans, 'c9')).toBe(1);
  });

  it('finds the latest planificación and ignores legacy plans', () => {
    expect(latestPlanificacion(plans, 'c1').id).toBe('p3');
    expect(latestPlanificacion([{ id: 'legacy', clienteId: 'c1' }], 'c1')).toBeNull();
  });
});

describe('createPlanificacion', () => {
  it('starts from the default template when there is no base', () => {
    const p = createPlanificacion({ clienteId: 'c1', plans: [plan({ numero: 1 })], today: '2026-10-29' });
    expect(p).toMatchObject({ formato: PLAN_FORMAT, numero: 2, nombre: 'Planificación 2', estado: 'borrador', fechaInicio: '2026-10-29' });
    expect(p.menu.dias.map(d => d.id)).toEqual(WEEK_DAYS);
    expect(p.cantidades.grupos.length).toBeGreaterThan(0);
    expect(p.supermercado).toBe('Mercadona');
  });

  it('copies the content of the base with fresh ids and its own metadata', () => {
    const base = { ...samplePlanificacion(), id: 'old', numero: 4, estado: 'activo', nombre: 'Planificación 4', productos: ['pr1'] };
    const p = createPlanificacion({ clienteId: 'c1', plans: [base], base, today: '2026-11-01' });
    expect(p.numero).toBe(5);
    expect(p.estado).toBe('borrador');
    expect(p.id).toBeUndefined();
    expect(p.desayunos.opciones.map(o => o.titulo)).toEqual(base.desayunos.opciones.map(o => o.titulo));
    expect(p.desayunos.opciones[0].id).not.toBe(base.desayunos.opciones[0].id);
    expect(p.menu.dias[0].comida.a.titulo).toBe('Rostidera de sepia + ensalada');
    expect(p.productos).toEqual(['pr1']);
    // Editing the copy must not touch the original
    p.menu.dias[0].comida.a.titulo = 'Otro';
    p.productos.push('pr2');
    expect(base.menu.dias[0].comida.a.titulo).toBe('Rostidera de sepia + ensalada');
    expect(base.productos).toEqual(['pr1']);
  });
});

describe('normalizeWeek', () => {
  it('fills missing days and dishes in order', () => {
    const week = normalizeWeek([{ id: 'martes', cena: { b: { titulo: 'Sopa' } } }]);
    expect(week.map(d => d.id)).toEqual(WEEK_DAYS);
    expect(week[1].cena.b).toEqual({ titulo: 'Sopa', alimentos: '', receta: '' });
    expect(isDishEmpty(week[0].comida.a)).toBe(true);
  });
});

describe('visibleSections', () => {
  it('shows only enabled sections that have content', () => {
    const p = samplePlanificacion();
    expect(visibleSections(p)).toEqual(['desayunos', 'mediaManana', 'merienda', 'cantidades', 'menu']);
    expect(visibleSections({ ...p, productos: ['pr1'] }, { pr1: { id: 'pr1' } })).toContain('productos');
    expect(visibleSections({ ...p, productos: ['gone'] }, {})).not.toContain('productos');
    expect(visibleSections({ ...p, secciones: { ...p.secciones, menu: false } })).not.toContain('menu');
  });

  it('hides empty sections of a fresh plan', () => {
    const p = createPlanificacion({ clienteId: 'c1', plans: [] });
    expect(visibleSections(p)).toEqual(['cantidades']);
  });
});

describe('planificacionStats', () => {
  it('counts dishes, options and products', () => {
    const p = copyContent(samplePlanificacion());
    expect(planificacionStats(p)).toEqual({ platos: 28, opciones: 8, productos: 0 });
  });
});

describe('safeUrl', () => {
  it('accepts http(s) links and adds the scheme when missing', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('example.com/receta')).toBe('https://example.com/receta');
    expect(safeUrl('  ')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('file:///C:/x.pdf')).toBeNull();
  });
});

describe('planFoods', () => {
  it('lists each food of the options and the menu once, without quantities or pantry basics', () => {
    const names = planFoods(samplePlanificacion()).map(f => f.nombre);
    expect(names.slice(0, 3)).toEqual(['Café con 150 ml de leche semidesnatada o de avena', 'Yogur griego natural ligero', 'Cereales']);
    expect(names).toContain('Arándanos');         // "Opcional: 1 puñado de arándanos"
    expect(names).toContain('Salteado rústico');  // sense l'asterisc
    expect(names).toContain('Salsa de soja');
    expect(names).toContain('Lomo fresco');
    expect(names.filter(n => n === 'Pollo')).toHaveLength(1);
    expect(names).not.toContain('AOVE');
    expect(names).not.toContain('Canela');
    expect(names.some(n => /que quieras/.test(n))).toBe(false);
  });

  it('is empty for a plan without foods', () => {
    expect(planFoods(createPlanificacion({ clienteId: 'c1', plans: [] }))).toEqual([]);
  });
});

describe('summarizeIngredients', () => {
  // Recepta real de nutripoloraquel.com
  const estofado = [
    '800 g de ternera para guisar, cortada en dados', '2 zanahorias, en rodajas', '1 cebolla grande, picada',
    '2 dientes de ajo, picados', '2 cucharadas de tomate concentrado o 150 g de tomate triturado', '250 ml de caldo de carne',
    '100 ml de vino tinto (opcional)', '2 cucharadas de aceite de oliva virgen extra', '1 cucharada de harina (opcional, para espesar)',
    '1 hoja de laurel', '1 cucharadita de pimentón dulce', '½ cucharadita de tomillo seco', 'Sal y pimienta negra al gusto',
    '600g patatas', '100ml leche semidesnatada caliente',
  ];

  it('keeps only the key ingredients, without quantities, and groups the sofrito', () => {
    expect(summarizeIngredients(estofado)).toEqual(['Ternera', 'Zanahorias, cebolla, tomate concentrado', 'Patatas', 'Leche semidesnatada']);
  });

  it('strips units, approximations and serving notes', () => {
    expect(summarizeIngredients(['15 unidades aprox. de gambas pequeñas peladas', '1/4 bolsa de espinacas', '1 lomo de salmón', '1/2 berenjena por persona']))
      .toEqual(['Gambas', 'Espinacas', 'Salmón', 'Berenjena']);
    expect(summarizeIngredients(['100 gr carne picada de ternera', '100g harina de avena', '1 cucharada cebolla en polvo']))
      .toEqual(['Carne picada de ternera', 'Harina de avena']);
  });

  it('caps the length and falls back to the first lines when everything is pantry', () => {
    expect(summarizeIngredients(['Pollo', 'Arroz', 'Pepino', 'Mango', 'Aguacate', 'Queso feta', 'Canónigos'])).toHaveLength(6);
    expect(summarizeIngredients(['Sal', '1 cucharada de aceite'])).toEqual(['Sal', 'Aceite']);
    expect(summarizeIngredients([])).toEqual([]);
  });
});

describe('buildDishIndex', () => {
  const own = [
    { id: 'r1', titulo: 'Rostidera de sepia + ensalada', alimentos: 'Sepia\nPatata nueva', receta: '', nota: '' },
    { id: 'r2', titulo: 'Pieza de fruta', alimentos: 'Plátano, manzana…', receta: '', nota: 'De temporada' },
    { id: 'r3', titulo: 'Vacía', alimentos: '', receta: '', nota: '' },
  ];

  it('finds own recipes by title, ignoring case and accents', () => {
    const idx = buildDishIndex(own);
    expect(idx.find('rostidera de SEPIA + ensalada').alimentos).toBe('Sepia\nPatata nueva');
    expect(idx.find('pieza de fruta')).toMatchObject({ nota: 'De temporada' });
    expect(idx.find('Nada')).toBeNull();
    expect(idx.titles).not.toContain('Vacía');
  });

  it('adds website recipes, summarised, after the own ones, which keep priority', () => {
    const web = [
      { titulo: 'Tortitas de avena', ingredientes: ['1 huevo', '200 g avena', '1 pizca de sal'], url: 'https://nutripoloraquel.com/receta/tortitas-de-avena/' },
      { titulo: 'Rostidera de sepia + ensalada', ingredientes: ['Sepia de la web'], url: 'https://nutripoloraquel.com/receta/sepia/' },
    ];
    const idx = buildDishIndex(own, web);
    expect(idx.find('tortitas de avena')).toMatchObject({ alimentos: 'Huevo\nAvena', receta: web[0].url, web: true });
    expect(idx.find('Rostidera de sepia + ensalada').alimentos).toBe('Sepia\nPatata nueva');
    expect(idx.titles).toContain('Tortitas de avena');
  });
});

describe('own recipes', () => {
  const web = [{ titulo: 'Estofado de ternera', ingredientes: ['800 g de ternera', '600g patatas'], url: 'https://nutripoloraquel.com/receta/estofado-de-ternera/' }];

  it('collects dishes and options with a title and foods, skipping untouched website recipes', () => {
    const p = samplePlanificacion();
    p.menu.dias[0].comida.a = { titulo: 'Estofado de ternera', alimentos: 'Ternera\nPatatas', receta: web[0].url };
    p.menu.dias[0].comida.b = { titulo: 'Estofado', alimentos: '800 g de ternera\n600g patatas', receta: web[0].url };
    p.menu.dias[1].comida.a = { titulo: 'Estofado de ternera ', alimentos: 'Ternera\nPatatas\nGuisantes', receta: web[0].url };
    const got = collectOwnRecipes(p, web);
    const titles = got.map(r => r.titulo);
    expect(titles).toContain('Ensalada de jamón');
    expect(titles).toContain('Pieza de fruta');
    expect(titles).not.toContain('Estofado');
    expect(titles).not.toContain('LIBRE CON MODERACIÓN (elegir 1 comida)');
    // El resum de la web sense tocar no es desa; el retocat sí
    expect(got.filter(r => r.titulo === 'Estofado de ternera')).toEqual([
      { titulo: 'Estofado de ternera', alimentos: 'Ternera\nPatatas\nGuisantes', receta: web[0].url },
    ]);
    expect(got.find(r => r.titulo === 'Pieza de fruta')).toMatchObject({ nota: '' });
  });

  it('upserts by title and keeps the same list when nothing changes', () => {
    const list = mergeOwnRecipes([], [{ titulo: 'Bowl', alimentos: 'Pollo', receta: '' }], 't1');
    expect(list).toEqual([{ id: expect.any(String), titulo: 'Bowl', alimentos: 'Pollo', receta: '', nota: '', updatedAt: 't1' }]);
    expect(mergeOwnRecipes(list, [{ titulo: 'Bowl', alimentos: 'Pollo', receta: '' }], 't2')).toBe(list);
    const next = mergeOwnRecipes(list, [{ titulo: 'bowl', alimentos: 'Pollo\nBoniato' }], 't3');
    expect(next).toEqual([{ ...list[0], titulo: 'bowl', alimentos: 'Pollo\nBoniato', updatedAt: 't3' }]);
  });
});
