import { describe, it, expect } from 'vitest';
import {
  isDeportiva, pesoKg, parseRange, rangeLabel, perKg, splitTraining, hasTrainingValue, pautaRows,
  sessionFromPreset, sessionHasContent, sessionOptionSection, restSections, defaultCompeticion,
  normalizeCompeticion, competicionBlocks, duringRecommendation, duringContent, formatDuration, copySport,
} from './deportiva';
import {
  createPlanificacion, copyContent, normalizePlanificacion, visibleSections, planificacionStats,
  collectOwnRecipes, planFoods, normalizeOrder, moveSection, moveSectionTo, isDefaultOrder, SECTION_ORDER,
} from './planificacion';
import { sampleDeportiva, samplePlanificacion } from './planificacion.fixture';

describe('weight and per-kg figures', () => {
  it('reads the plan weight as written and ignores nonsense', () => {
    expect(pesoKg({ deporte: { peso: '71,5' } })).toBe(71.5);
    expect(pesoKg({ deporte: { peso: '' } })).toBeNull();
    expect(pesoKg({ deporte: { peso: '7' } })).toBeNull();
    expect(pesoKg({})).toBeNull();
  });

  it('formats g/kg ranges with a decimal comma', () => {
    expect(rangeLabel({ min: '0,7', max: '1' })).toBe('0,7-1 g/kg');
    expect(rangeLabel({ min: '5', max: '' })).toBe('5 g/kg');
    expect(rangeLabel({ min: '3', max: '2' }, 'mg/kg')).toBe('2-3 mg/kg');
    expect(rangeLabel({ min: '', max: '' })).toBe('');
    expect(parseRange({ min: 'abc', max: '' })).toBeNull();
  });

  it('multiplies by the weight and rounds to 5 g / 10 mg', () => {
    expect(perKg({ min: '0,7', max: '1' }, 71)).toBe('50-70 g');
    expect(perKg({ min: '5', max: '7' }, 71)).toBe('355-495 g');
    expect(perKg({ min: '1', max: '1' }, 71)).toBe('70 g');
    expect(perKg({ min: '2', max: '3' }, 71, { unit: 'mg', step: 10 })).toBe('140-210 mg');
    expect(perKg({ min: '0,7', max: '1' }, null)).toBe('');
  });
});

describe('rest → training portions', () => {
  it('splits on an arrow', () => {
    expect(splitTraining('80 g → 120 g')).toEqual({ descanso: '80 g', entreno: '120 g' });
    expect(splitTraining('80 g ⟶ 100 g en seco')).toEqual({ descanso: '80 g', entreno: '100 g en seco' });
    expect(splitTraining('60 g -> 90 g')).toEqual({ descanso: '60 g', entreno: '90 g' });
  });

  it('leaves values without a training portion alone', () => {
    expect(splitTraining('1-2 huevos')).toEqual({ descanso: '1-2 huevos', entreno: '' });
    expect(splitTraining('80 g →')).toEqual({ descanso: '80 g →', entreno: '' });
    expect(hasTrainingValue('Leche: 150 ml\nPan: 80 g → 120 g')).toBe(true);
    expect(hasTrainingValue('Leche: 150 ml')).toBe(false);
  });
});

describe('training sessions', () => {
  it('builds a session from a preset with its guidance', () => {
    const s = sessionFromPreset('fuerza');
    expect(s.momento).toBe('pre');
    expect(s.pauta.hc).toEqual({ min: '0,7', max: '1' });
    expect(sessionHasContent(s)).toBe(true);
    expect(sessionFromPreset('recuperacion').pauta.prot).toEqual({ min: '0,25', max: '0,4' });
  });

  it('lists guidance rows with the figure for the athlete', () => {
    const rows = pautaRows(sessionFromPreset('fuerza').pauta, 70);
    expect(rows.map(r => r.key)).toEqual(['objetivo', 'hidratos', 'proteina', 'grasas', 'fibra', 'volumen', 'tiempo']);
    expect(rows[1]).toMatchObject({ value: 'Altos', kg: '0,7-1 g/kg', calc: '50-70 g' });
    const post = pautaRows(sessionFromPreset('recuperacion').pauta, 70).find(r => r.key === 'proteina');
    expect(post).toMatchObject({ kg: '0,25-0,4 g/kg', calc: '20-30 g' });
  });

  it('maps the meal of a session to its option section', () => {
    expect(sessionOptionSection('Merienda')).toBe('merienda');
    expect(sessionOptionSection('Almuerzo')).toBe('mediaManana');
    expect(sessionOptionSection('Desayuno')).toBe('desayunos');
    expect(sessionOptionSection('Cena')).toBeNull();
    expect(restSections(sampleDeportiva())).toEqual(['merienda']);
    expect(restSections(samplePlanificacion())).toEqual([]);
  });
});

describe('competition plan', () => {
  it('starts with every block and normalizes missing fields', () => {
    expect(competicionBlocks(defaultCompeticion())).toEqual(['previa', 'desayuno', 'cafeina', 'durante', 'recuperacion']);
    const c = normalizeCompeticion({ nombre: 'Media maratón', cafeina: { activo: true } });
    expect(c.cafeina.protocolos).toEqual([]);
    expect(c.previa.menu).toEqual([]);
    expect(normalizeCompeticion(null)).toBeNull();
  });

  it('recommends carbohydrates during the race by duration', () => {
    expect(duringRecommendation('30').hcHora).toBe('');
    expect(duringRecommendation('75').texto).toMatch(/no hace falta/);
    expect(duringRecommendation('120').hcHora).toBe('30-60 g');
    expect(duringRecommendation('240').hcHora).toBe('60-90 g');
    expect(duringRecommendation('')).toBeNull();
  });

  it('prints what was written during the race, or the recommendation', () => {
    const c = defaultCompeticion();
    c.duracion = '180';
    expect(duringContent(c).hcHora).toBe('60-90 g');
    expect(competicionBlocks(c)).toContain('durante');
    c.durante.texto = 'Un gel cada 30 minutos';
    c.durante.hcHora = '50 g';
    expect(duringContent(c)).toMatchObject({ texto: ['Un gel cada 30 minutos'], hcHora: '50 g' });
  });

  it('leaves out switched-off and empty blocks', () => {
    const c = defaultCompeticion();
    c.cafeina.activo = false;
    c.durante.hidratacion = '';
    c.recuperacion = { activo: true, hc: { min: '', max: '' }, prot: { min: '', max: '' }, texto: '', opciones: [] };
    expect(competicionBlocks(c)).toEqual(['previa', 'desayuno']);
  });

  it('formats the expected duration', () => {
    expect(formatDuration('75')).toBe('1 h 15 min');
    expect(formatDuration('120')).toBe('2 h');
    expect(formatDuration('40')).toBe('40 min');
    expect(formatDuration('')).toBe('');
  });
});

describe('sports planificación', () => {
  it('is a general plan unless marked as sports', () => {
    const p = normalizePlanificacion(samplePlanificacion());
    expect(isDeportiva(p)).toBe(false);
    expect(p.sesiones).toEqual([]);
    expect(p.competicion).toBeNull();
  });

  it('shows sessions and the competition only in sports plans', () => {
    const sport = sampleDeportiva();
    expect(visibleSections(sport)).toEqual(['desayunos', 'mediaManana', 'merienda', 'entrenos', 'cantidades', 'menu', 'competicion']);
    expect(visibleSections({ ...sport, tipo: 'general' })).not.toContain('entrenos');
    expect(visibleSections({ ...sport, secciones: { ...sport.secciones, competicion: false } })).not.toContain('competicion');
  });

  it('copies sessions and the competition with new ids, but not the weight', () => {
    const src = sampleDeportiva();
    const copy = copyContent(src);
    expect(copy.tipo).toBe('deportiva');
    expect(copy.deporte).toEqual({ peso: '', disciplina: 'Trail running y crossfit' });
    expect(copy.sesiones[0].id).not.toBe('s1');
    expect(copy.sesiones[0].opciones[0].id).not.toBe('c1');
    expect(copy.sesiones[0].opciones[0].titulo).toBe(src.sesiones[0].opciones[0].titulo);
    expect(copy.competicion.cafeina.protocolos[0].pasos[0].id).not.toBe('x1');
    copy.competicion.previa.menu[0].texto = 'cambiado';
    expect(src.competicion.previa.menu[0].texto).not.toBe('cambiado');
    expect(copySport(samplePlanificacion()).competicion).toBeNull();
  });

  it('takes the latest weight for a new plan based on a sports one', () => {
    const p = createPlanificacion({ clienteId: 'c1', plans: [], base: sampleDeportiva(), today: '2026-11-11', peso: 72.4 });
    expect(p.deporte.peso).toBe('72.4');
    expect(createPlanificacion({ clienteId: 'c1', plans: [], today: '2026-11-11', peso: 72 }).deporte.peso).toBe('');
  });

  it('counts session options, remembers them and lists their foods', () => {
    const p = sampleDeportiva();
    expect(planificacionStats(p).opciones).toBe(3 + 5 + 3);
    expect(collectOwnRecipes(p).map(r => r.titulo)).toContain('Batido de plátano con yogur');
    expect(planFoods(p).map(f => f.key)).toContain('tortitas de arroz');
    expect(collectOwnRecipes({ ...p, tipo: 'general' }).map(r => r.titulo)).not.toContain('Batido de plátano con yogur');
  });
});

describe('section order', () => {
  it('keeps known sections once and puts missing ones after their default neighbour', () => {
    expect(normalizeOrder(undefined)).toEqual(SECTION_ORDER);
    expect(normalizeOrder(['menu', 'desayunos', 'menu', 'nope']))
      .toEqual(['menu', 'productos', 'competicion', 'desayunos', 'mediaManana', 'merienda', 'entrenos', 'cantidades']);
    expect(isDefaultOrder(undefined)).toBe(true);
    expect(isDefaultOrder(['menu', 'desayunos'])).toBe(false);
  });

  it('moves a section past the hidden ones', () => {
    const general = SECTION_ORDER.filter(k => k !== 'entrenos' && k !== 'competicion');
    // In a general plan "entrenos" is hidden: moving "cantidades" up swaps it with "merienda"
    const o = moveSection(undefined, 'cantidades', -1, general);
    expect(o.filter(k => general.includes(k))).toEqual(['desayunos', 'mediaManana', 'cantidades', 'merienda', 'menu', 'productos']);
    expect(moveSection(undefined, 'desayunos', -1)).toEqual(SECTION_ORDER);
    expect(moveSection(undefined, 'competicion', 1)).toEqual(SECTION_ORDER);
  });

  it('drags a section to the place of another one', () => {
    expect(moveSectionTo(undefined, 'menu', 'desayunos').slice(0, 3)).toEqual(['menu', 'desayunos', 'mediaManana']);
    expect(moveSectionTo(undefined, 'desayunos', 'cantidades').slice(0, 5)).toEqual(['mediaManana', 'merienda', 'entrenos', 'cantidades', 'desayunos']);
    expect(moveSectionTo(undefined, 'menu', 'menu')).toEqual(SECTION_ORDER);
    expect(moveSectionTo(undefined, 'menu', 'nope')).toEqual(SECTION_ORDER);
  });

  it('lists the visible sections in the chosen order and copies it', () => {
    const p = { ...sampleDeportiva(), orden: ['menu', 'competicion', 'desayunos'] };
    expect(visibleSections(p)).toEqual(['menu', 'competicion', 'desayunos', 'mediaManana', 'merienda', 'entrenos', 'cantidades']);
    expect(copyContent(p).orden).toEqual(normalizeOrder(p.orden));
  });
});
