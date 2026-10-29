import { describe, it, expect } from 'vitest';
import {
  PLAN_FORMAT, WEEK_DAYS, linesOf, nextPlanNumber, latestPlanificacion, createPlanificacion,
  copyContent, normalizeWeek, visibleSections, planificacionStats, isDishEmpty, safeUrl, buildDishIndex,
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

describe('buildDishIndex', () => {
  const older = { ...samplePlanificacion(), id: 'old', fechaInicio: '2026-01-01' };
  const newer = { ...samplePlanificacion(), id: 'new', fechaInicio: '2026-06-01' };
  newer.menu.dias[0].comida.a = { titulo: 'Rostidera de sepia + ensalada', alimentos: 'Sepia\nPatata nueva', receta: '' };

  it('finds dishes and options by title, ignoring case and accents, newest first', () => {
    const idx = buildDishIndex([older, newer]);
    expect(idx.find('rostidera de SEPIA + ensalada').alimentos).toBe('Sepia\nPatata nueva');
    expect(idx.find('Lentejas con jamon y verduras').alimentos).toContain('Lentejas');
    expect(idx.find('Pieza de fruta').alimentos).toContain('plátano');
    expect(idx.find('Nada')).toBeNull();
  });

  it('skips the plan being edited, legacy plans and dishes without ingredients', () => {
    const idx = buildDishIndex([newer, { id: 'legacy', comidas: [] }], 'new');
    expect(idx.titles).toEqual([]);
    expect(buildDishIndex([older]).titles).not.toContain('LIBRE CON MODERACIÓN (elegir 1 comida)');
  });

  it('adds website recipes after the plans, which keep priority', () => {
    const web = [
      { titulo: 'Tortitas de avena', ingredientes: ['1 huevo', '200 g avena'], url: 'https://nutripoloraquel.com/receta/tortitas-de-avena/' },
      { titulo: 'Rostidera de sepia + ensalada', ingredientes: ['Sepia de la web'], url: 'https://nutripoloraquel.com/receta/sepia/' },
    ];
    const idx = buildDishIndex([newer], undefined, web);
    expect(idx.find('tortitas de avena')).toMatchObject({ alimentos: '1 huevo\n200 g avena', receta: web[0].url, web: true });
    expect(idx.find('Rostidera de sepia + ensalada').alimentos).toBe('Sepia\nPatata nueva');
    expect(idx.titles).toContain('Tortitas de avena');
  });
});
