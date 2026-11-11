/**
 * deportiva.js — NutriPolo
 * =================================
 * Planificació de nutrició esportiva (el format que la Raquel feia a Canva
 * per a esportistes), dins del mateix model de planificació:
 *
 *  - Opcions d'esmorzar / mig matí / berenar amb el seu ajust de "dia
 *    d'entrenament" (`opcion.entreno`, "Cornflakes: 60 g → 90 g").
 *  - Preses d'entrenament (`sesiones`): opcions per a un tipus de sessió
 *    (crossfit, carrera…) abans o després d'entrenar, amb una pauta
 *    (objectiu, hidrats en g/kg, proteïna, greixos, fibra, volum, moment).
 *  - Guia de quantitats amb la ració de descans → entrenament ("Pan: 80 g → 120 g").
 *  - Pla de competició (`competicion`): 24 h prèvies, esmorzar, cafeïna,
 *    durant la prova i recuperació.
 *
 * Les xifres per kg es calculen amb `deporte.peso` (el pes amb què es va fer
 * la planificació). Tot és pur, sense store ni Tauri.
 */

import { parseDecimal } from './energia';

export const TIPO_GENERAL = 'general';
export const TIPO_DEPORTIVA = 'deportiva';
export const isDeportiva = (plan) => plan?.tipo === TIPO_DEPORTIVA;

const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const lines = (text) => String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*[-•·*]\s+/, '').trim()).filter(Boolean);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Pes i xifres per kg ────────────────────────────────────────────────────

/** Pes en kg de la planificació (número) o null si no n'hi ha o no té sentit. */
export function pesoKg(plan) {
  const n = parseDecimal(plan?.deporte?.peso);
  return n && n >= 25 && n <= 250 ? n : null;
}

/** 0.7 → "0,7"; 1 → "1". */
export const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Rang {min, max} (tal com s'escriu) → [lo, hi] o null. Un sol extrem val per tots dos. */
export function parseRange(range) {
  const a = parseDecimal(range?.min);
  const b = parseDecimal(range?.max);
  if (a == null && b == null) return null;
  const lo = a ?? b;
  const hi = b ?? a;
  if (lo < 0 || hi < 0) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** {min: '0,7', max: '1'} → "0,7-1 g/kg" (buit si no hi ha rang). */
export function rangeLabel(range, unit = 'g/kg') {
  const r = parseRange(range);
  if (!r) return '';
  return `${r[0] === r[1] ? fmtNum(r[0]) : `${fmtNum(r[0])}-${fmtNum(r[1])}`} ${unit}`;
}

/**
 * Rang per kg × pes, arrodonit (de 5 en 5 g, de 10 en 10 mg): és el que
 * es posa a "en tu caso". Buit si falta el pes o el rang.
 */
export function perKg(range, peso, { unit = 'g', step = 5 } = {}) {
  const r = parseRange(range);
  if (!r || !peso) return '';
  const round = (v) => Math.max(step, Math.round((v * peso) / step) * step);
  const lo = round(r[0]);
  const hi = round(r[1]);
  return lo === hi ? `${lo} ${unit}` : `${lo}-${hi} ${unit}`;
}

// ── Ració de descans → entrenament ─────────────────────────────────────────

const ARROW_RE = /\s*(?:⟶|→|->|=>)\s*/;

/** "80 g → 120 g en seco" → { descanso: '80 g', entreno: '120 g en seco' }; sense fletxa, entreno buit. */
export function splitTraining(value) {
  const s = String(value ?? '');
  const m = s.match(ARROW_RE);
  if (!m) return { descanso: s.trim(), entreno: '' };
  const descanso = s.slice(0, m.index).trim();
  const entreno = s.slice(m.index + m[0].length).trim();
  return entreno ? { descanso, entreno } : { descanso: s.trim(), entreno: '' };
}

export const hasTrainingValue = (text) => lines(text).some(l => splitTraining(l).entreno);

// ── Preses d'entrenament ───────────────────────────────────────────────────

export const MOMENTOS = ['pre', 'post'];

// Files de la pauta, en l'ordre en què surten al PDF
export const PAUTA_FIELDS = ['objetivo', 'hidratos', 'proteina', 'grasas', 'fibra', 'volumen', 'tiempo'];

const emptyPauta = () => ({
  objetivo: '', hidratos: '', hc: { min: '', max: '' }, proteina: '', prot: { min: '', max: '' },
  grasas: '', fibra: '', volumen: '', tiempo: '',
});

// Pautes de partida (les de la Raquel): s'ajusten per a cada esportista
export const SESSION_PRESETS = {
  fuerza: {
    nombre: 'Crossfit', toma: 'Merienda', momento: 'pre',
    pauta: {
      objetivo: 'Energía + algo de proteína',
      hidratos: 'Altos', hc: { min: '0,7', max: '1' },
      proteina: 'Puede ser moderada',
      grasas: 'Moderadas-bajas',
      fibra: 'Moderada',
      volumen: 'Puedes tolerar más que antes de correr',
      tiempo: 'Al menos 1-2 h antes',
    },
  },
  resistencia: {
    nombre: 'Carrera', toma: 'Merienda', momento: 'pre',
    pauta: {
      objetivo: 'Priorizar energía fácil de digerir',
      hidratos: 'Altos, sobre todo en series intensas', hc: { min: '0,7', max: '1' },
      proteina: 'Menos importante',
      grasas: 'Bajas',
      fibra: 'Mejor baja',
      volumen: 'Mejor una toma ligera y simple',
      tiempo: 'Al menos 1-2 h antes',
    },
    nota: 'Puedes reducir las cantidades si la distancia o la intensidad es menor.',
  },
  recuperacion: {
    nombre: 'Después de entrenar', toma: 'Merienda', momento: 'post',
    pauta: {
      objetivo: 'Reponer energía y ayudar a la recuperación muscular',
      hidratos: 'Altos', hc: { min: '1', max: '1,2' },
      proteina: 'De calidad', prot: { min: '0,25', max: '0,4' },
      grasas: 'Moderadas',
      fibra: 'Puede ser normal',
      volumen: 'Según el apetito',
      tiempo: 'En las 2 h siguientes',
    },
  },
};

export const emptySession = () => ({
  id: uid(), nombre: '', toma: 'Merienda', momento: 'pre',
  opciones: [{ id: uid(), titulo: '', alimentos: '', nota: '', entreno: '' }],
  nota: '', productos: [], pauta: emptyPauta(),
});

/** Presa nova a partir d'una pauta de partida (`fuerza`, `resistencia`, `recuperacion`). */
export function sessionFromPreset(key) {
  const p = SESSION_PRESETS[key];
  const s = emptySession();
  if (!p) return s;
  return {
    ...s, nombre: p.nombre, toma: p.toma, momento: p.momento, nota: p.nota || '',
    pauta: { ...emptyPauta(), ...p.pauta, hc: { ...p.pauta.hc }, prot: { ...emptyPauta().prot, ...(p.pauta.prot || {}) } },
  };
}

export function normalizeSession(s) {
  const base = emptyPauta();
  const pauta = { ...base, ...(s?.pauta || {}) };
  return {
    ...emptySession(),
    ...s,
    id: s?.id || uid(),
    opciones: s?.opciones || [],
    productos: s?.productos || [],
    pauta: { ...pauta, hc: { ...base.hc, ...(pauta.hc || {}) }, prot: { ...base.prot, ...(pauta.prot || {}) } },
  };
}

const optionHasContent = (o) => !!(String(o?.titulo || '').trim() || lines(o?.alimentos).length);
export const pautaHasContent = (p) => PAUTA_FIELDS.some(k => String(p?.[k] || '').trim()) || !!parseRange(p?.hc) || !!parseRange(p?.prot);
export const sessionHasContent = (s) => (s?.opciones || []).some(optionHasContent) || pautaHasContent(s?.pauta);

/**
 * Files de la pauta amb contingut, amb el rang per kg i el càlcul per al pes.
 * @returns {{ key, value, kg, calc }[]}
 */
export function pautaRows(pauta, peso) {
  const p = pauta || {};
  return PAUTA_FIELDS.map(key => {
    const value = String(p[key] || '').trim();
    const range = key === 'hidratos' ? p.hc : key === 'proteina' ? p.prot : null;
    const kg = range ? rangeLabel(range) : '';
    const calc = range ? perKg(range, peso) : '';
    return { key, value, kg, calc };
  }).filter(r => r.value || r.kg);
}

/** Secció d'opcions a la qual correspon la presa ("Merienda" → merienda), si n'hi ha. */
export function sessionOptionSection(toma) {
  const t = fold(toma);
  if (/desayun/.test(t)) return 'desayunos';
  if (/almuerz|media manana|mig mati/.test(t)) return 'mediaManana';
  if (/merienda|berenar/.test(t)) return 'merienda';
  return null;
}

/** Seccions d'opcions que, amb preses d'entrenament, són les dels dies de descans. */
export function restSections(plan) {
  if (!isDeportiva(plan)) return [];
  return [...new Set((plan.sesiones || []).filter(sessionHasContent).map(s => sessionOptionSection(s.toma)).filter(Boolean))];
}

// ── Pla de competició ──────────────────────────────────────────────────────

export const COMPETICION_BLOCKS = ['previa', 'desayuno', 'cafeina', 'durante', 'recuperacion'];

const EMPTY_BLOCKS = {
  previa: { activo: false, objetivo: '', hc: { min: '', max: '' }, menu: [], hidratacion: '' },
  desayuno: { activo: false, horas: '', hc: { min: '', max: '' }, pautas: '', opciones: [] },
  cafeina: { activo: false, mg: { min: '', max: '' }, intro: '', protocolos: [] },
  durante: { activo: false, hcHora: '', texto: '', hidratacion: '' },
  recuperacion: { activo: false, hc: { min: '', max: '' }, prot: { min: '', max: '' }, texto: '', opciones: [] },
};

const row = (a, b) => ({ id: uid(), ...a, ...b });

/** Pla de competició de partida (l'estructura i les pautes de la Raquel). */
export function defaultCompeticion() {
  return {
    nombre: '',
    fecha: '',
    duracion: '',
    previa: {
      activo: true,
      objetivo: 'Llegar a la salida con las reservas de glucógeno llenas, bien hidratado y sin molestias digestivas.\nEn pruebas de menos de 90 minutos no hace falta una carga extrema de hidratos los días antes, pero sí asegurar una ingesta suficiente.\nEste es un ejemplo de menú para el día de antes adaptado a ti.',
      hc: { min: '5', max: '7' },
      menu: ['Desayuno', 'Almuerzo', 'Comida', 'Merienda', 'Cena'].map(ingesta => row({ ingesta }, { texto: '' })),
      hidratacion: 'Bebe agua de manera regular durante el día, con las comidas y según la sed.',
    },
    desayuno: {
      activo: true,
      horas: '2',
      hc: { min: '1', max: '1,4' },
      pautas: 'Mantén alimentos que ya conozcas y que te sienten bien\nEvita los cereales ricos en fibra (como la avena)\nEvita las grasas: frutos secos, aceite, crema de cacahuete\nPrueba el desayuno en un entreno largo antes de la competición',
      opciones: [row({ titulo: '' }, { cantidad: '' })],
    },
    cafeina: {
      activo: true,
      mg: { min: '2', max: '3' },
      intro: 'La cafeína puede mejorar el rendimiento en pruebas de resistencia\nCómo tomarla depende de la hora del desayuno y del café que ya tomas\nPruébala antes en un entreno: el día de la prueba, nada nuevo',
      protocolos: [
        { id: uid(), titulo: 'Con tu café habitual', pasos: [row({ cuando: '2-3 h antes' }, { que: 'Desayuno con tu café con leche habitual' }), row({ cuando: '40-60 min antes de salir' }, { que: 'Cafeína en pastilla para completar la dosis (un café con leche aporta unos 60-80 mg)' })] },
        { id: uid(), titulo: 'Sin café en el desayuno', pasos: [row({ cuando: '2-3 h antes' }, { que: 'Desayuno sin café' }), row({ cuando: '40-60 min antes de salir' }, { que: 'Toda la dosis en cafeína en pastilla' })] },
      ],
    },
    durante: {
      activo: true,
      hcHora: '',
      texto: '',
      hidratacion: 'La cantidad depende de la temperatura del día y de lo que sudas\nBebe según la sed y las condiciones ambientales\nNo bebas en exceso antes de salir ni salgas deshidratado',
    },
    recuperacion: {
      activo: true,
      hc: { min: '1', max: '1,2' },
      prot: { min: '0,25', max: '0,4' },
      texto: 'Nada más cruzar la meta, repón líquidos y electrolitos: 300-500 ml de agua o bebida isotónica, a pequeños sorbos\nSi faltan más de 2-3 h para la siguiente comida, toma algo de recuperación',
      opciones: [row({ titulo: '' }, { cantidad: '' })],
    },
  };
}

/** Pla de competició llegible encara que li faltin camps (null si no n'hi ha). */
export function normalizeCompeticion(c) {
  if (!c) return null;
  const out = { nombre: c.nombre || '', fecha: c.fecha || '', duracion: c.duracion ?? '' };
  for (const k of COMPETICION_BLOCKS) {
    const e = EMPTY_BLOCKS[k];
    const b = { ...e, ...(c[k] || {}) };
    for (const [f, v] of Object.entries(e)) {
      if (Array.isArray(v)) b[f] = Array.isArray(b[f]) ? b[f] : [];
      else if (v && typeof v === 'object') b[f] = { ...v, ...(b[f] || {}) };
    }
    if (k === 'cafeina') b.protocolos = b.protocolos.map(p => ({ id: p.id || uid(), titulo: p.titulo || '', pasos: Array.isArray(p.pasos) ? p.pasos : [] }));
    out[k] = b;
  }
  return out;
}

const filled = (rows, keys) => (rows || []).filter(r => keys.some(k => String(r?.[k] || '').trim()));

/** Contingut per imprimir de cada bloc actiu (els buits no surten). */
export function competicionBlocks(c) {
  const comp = normalizeCompeticion(c);
  if (!comp) return [];
  const has = {
    previa: (b) => lines(b.objetivo).length || parseRange(b.hc) || filled(b.menu, ['texto']).length || lines(b.hidratacion).length,
    desayuno: (b) => parseRange(b.hc) || lines(b.pautas).length || filled(b.opciones, ['titulo', 'cantidad']).length || String(b.horas).trim(),
    cafeina: (b) => parseRange(b.mg) || lines(b.intro).length || b.protocolos.some(p => filled(p.pasos, ['cuando', 'que']).length),
    durante: () => { const d = duringContent(comp); return d.texto.length || d.hcHora || d.hidratacion.length; },
    recuperacion: (b) => parseRange(b.hc) || parseRange(b.prot) || lines(b.texto).length || filled(b.opciones, ['titulo', 'cantidad']).length,
  };
  return COMPETICION_BLOCKS.filter(k => comp[k].activo && has[k](comp[k]));
}

/**
 * Hidrats durant la prova segons la durada prevista (minuts), segons les
 * guies de resistència (ACSM/COI): fins a ~75 min no cal menjar res, 1-2,5 h
 * 30-60 g/h i més de 2,5 h fins a 60-90 g/h (glucosa + fructosa).
 * @returns {{ hcHora: string, texto: string } | null}
 */
export function duringRecommendation(minutes) {
  const m = parseDecimal(minutes);
  if (!m || m <= 0) return null;
  if (m < 45) {
    return { hcHora: '', texto: 'En una prueba de menos de 45 minutos no necesitas tomar hidratos durante la carrera: basta con llegar bien preparado.' };
  }
  if (m <= 75) {
    return { hcHora: '', texto: 'Al no llegar a los 75-90 minutos, con una buena preparación previa no hace falta tomar hidratos durante la prueba.\nPuedes llevar un gel (unos 25 g de hidratos) por si el esfuerzo es muy intenso, siempre probado antes en un entreno.' };
  }
  if (m <= 150) {
    return { hcHora: '30-60 g', texto: 'Toma 30-60 g de hidratos por hora (geles, bebida isotónica, gominolas, dátiles…)\nEmpieza a los 30-45 minutos y reparte en pequeñas tomas cada 15-20 minutos\nUsa solo productos que ya hayas probado en entrenos' };
  }
  return { hcHora: '60-90 g', texto: 'Toma 60-90 g de hidratos por hora, combinando glucosa y fructosa (geles o bebidas preparados para ello)\nReparte en pequeñas tomas cada 15-20 minutos desde el principio\nEntrena el intestino en las tiradas largas: el día de la prueba, nada nuevo' };
}

/** Texte i hidrats/hora de "durant la prova": el que s'ha escrit o, si és buit, la recomanació. */
export function duringContent(c) {
  const b = c?.durante || {};
  const rec = duringRecommendation(c?.duracion);
  const texto = lines(b.texto).length ? lines(b.texto) : lines(rec?.texto);
  const hcHora = String(b.hcHora || '').trim() || rec?.hcHora || '';
  return { texto, hcHora, hidratacion: lines(b.hidratacion) };
}

/** Minuts → "1 h 15 min". */
export function formatDuration(minutes) {
  const m = Math.round(parseDecimal(minutes) || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}

// ── Contingut esportiu de la planificació ─────────────────────────────────

export const emptyDeporte = () => ({ peso: '', disciplina: '' });

/** Camps esportius normalitzats (per a normalizePlanificacion). */
export function normalizeSport(plan) {
  return {
    tipo: isDeportiva(plan) ? TIPO_DEPORTIVA : TIPO_GENERAL,
    deporte: { ...emptyDeporte(), ...(plan?.deporte || {}) },
    sesiones: (plan?.sesiones || []).map(normalizeSession),
    competicion: normalizeCompeticion(plan?.competicion),
  };
}

const cloneRows = (rs) => (rs || []).map(r => ({ ...r, id: uid() }));

/** Camps esportius copiats d'una altra planificació, amb ids nous. El pes no: és de cada dia. */
export function copySport(src) {
  const s = normalizeSport(src);
  const comp = s.competicion;
  return {
    tipo: s.tipo,
    deporte: { ...s.deporte, peso: '' },
    sesiones: s.sesiones.map(x => ({
      ...x,
      id: uid(),
      opciones: x.opciones.map(o => ({ ...o, id: uid() })),
      productos: [...x.productos],
      pauta: { ...x.pauta, hc: { ...x.pauta.hc }, prot: { ...x.pauta.prot } },
    })),
    competicion: comp && {
      ...comp,
      previa: { ...comp.previa, hc: { ...comp.previa.hc }, menu: cloneRows(comp.previa.menu) },
      desayuno: { ...comp.desayuno, hc: { ...comp.desayuno.hc }, opciones: cloneRows(comp.desayuno.opciones) },
      cafeina: { ...comp.cafeina, mg: { ...comp.cafeina.mg }, protocolos: comp.cafeina.protocolos.map(p => ({ ...p, id: uid(), pasos: cloneRows(p.pasos) })) },
      durante: { ...comp.durante },
      recuperacion: { ...comp.recuperacion, hc: { ...comp.recuperacion.hc }, prot: { ...comp.recuperacion.prot }, opciones: cloneRows(comp.recuperacion.opciones) },
    },
  };
}

// Guia de quantitats per a esportistes: després de la fletxa, la ració dels dies d'entrenament
export const DEFAULT_CANTIDADES_DEPORTE = [
  { titulo: 'Cereales, legumbres y tubérculos', texto: 'Pan: 80 g → 120 g\nPasta: 80 g → 100 g en seco\nArroz/cuscús: 80 g → 100 g en seco\nQuinoa: 70 g → 100 g en seco\nPatata/boniato: 250 g → 350 g\nÑoquis: 200 g → 250 g\nAvena (u otros cereales): 60 g → 90 g\nLegumbres: 80 g → 100 g en seco (250 g cocidas)\nFajitas: 2 grandes' },
  { titulo: 'Carne', texto: 'Carne roja: ternera 150 g, hamburguesa 80 g\nCarne blanca (pollo, pavo, conejo): 160 g crudo o 130 g cocinado\nJamón serrano: 50-60 g\nJamón cocido/pavo: 80 g' },
  { titulo: 'Pescado', texto: 'Pescado azul (atún, salmón): 150 g crudo\nPescado blanco (merluza, dorada): 200 g crudo o 170 g cocido\nAtún enlatado: 1-2 latas' },
  { titulo: 'Frutas, verduras y hortalizas', texto: 'Toma la cantidad que te apetezca\nLas raciones son de 100-200 g\nAsegura medio plato de verduras' },
  { titulo: 'Lácteos y derivados', texto: 'Leche: 150 ml\nYogur: 125 g\nQuesos frescos: 30-40 g\nQuesos curados/semi: 20 g' },
  { titulo: 'Huevos', texto: '1-2 huevos' },
  { titulo: 'Grasas', texto: 'Aceite de oliva: 1 cucharada sopera\nMantequilla: 1 cucharada de postre\nFrutos secos: 1 puñado (15 g)\nAguacate: 40 g\nCremas de frutos secos: 1 cucharada sopera (15-20 g)' },
  { titulo: 'Salsas', texto: 'Mayonesa (ocasional), salsa de soja, salsa césar…: 1 o 2 cucharadas' },
];

export const DEFAULT_CANTIDADES_DEPORTE_NOTA =
  'Esta es la cantidad aproximada de una ración para ti, no el total del día. La primera es para los días de descanso; la de después de la flecha, en naranja, para los días de entreno.';
