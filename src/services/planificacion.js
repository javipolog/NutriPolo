/**
 * planificacion.js — NutriPolo
 * =================================
 * Model de la "planificació" setmanal (el format que abans es feia a Canva):
 * opcions d'esmorzar / mig matí / berenar, guia de quantitats, menú de
 * dilluns a diumenge amb dues opcions (A/B) per dinar i sopar, i productes.
 *
 * Tot és pur (sense store ni Tauri) perquè es pugui provar i reutilitzar
 * des de l'editor i el generador de PDF.
 */

export const PLAN_FORMAT = 'planificacion';

// Seccions d'opcions (taula títol + aliments)
export const OPTION_SECTIONS = ['desayunos', 'mediaManana', 'merienda'];

// Ordre de les seccions al PDF i a l'índex de la portada
export const SECTION_ORDER = ['desayunos', 'mediaManana', 'merienda', 'cantidades', 'menu', 'productos'];

export const WEEK_DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
export const MENU_SLOTS = ['comida', 'cena'];
export const MENU_VARIANTS = ['a', 'b'];

const uid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** Línies no buides d'un text multilínia ("un aliment per línia"). */
export function linesOf(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*[-•·*]\s+/, '').trim())
    .filter(Boolean);
}

export const emptyDish = () => ({ titulo: '', alimentos: '', receta: '' });
export const emptyOption = () => ({ id: uid(), titulo: '', alimentos: '', nota: '' });

export const isDishEmpty = (d) => !d || (!String(d.titulo || '').trim() && !linesOf(d.alimentos).length);

export function emptyWeek() {
  return WEEK_DAYS.map(id => ({
    id,
    comida: { a: emptyDish(), b: emptyDish() },
    cena:   { a: emptyDish(), b: emptyDish() },
  }));
}

// Guia de quantitats per defecte: és la que es feia servir a Canva.
export const DEFAULT_CANTIDADES = [
  { titulo: 'Cereales, legumbres y tubérculos', texto: 'Pan: 60 g\nPasta o arroz: 55 g en seco\nQuinoa: 40 g en seco o 180 g cocida\nPatata/boniato: 200 g crudo (mediodía) o 100 g (noche)\nAvena (u otros cereales): 35 g\nLegumbres: 50 g en seco o 180 g cocidas' },
  { titulo: 'Carne', texto: 'Carne roja: ternera 120 g, carne picada 80 g\nCarne blanca (pollo, pavo, conejo): 130 g crudo o 100 g cocinado\nJamón serrano: 2 lonchas\nJamón cocido/pavo: 2 lonchas grandes' },
  { titulo: 'Pescado', texto: 'Pescado azul (atún, salmón): 130 g crudo\nPescado blanco (merluza, dorada): 170 g crudo o 150 g cocido\nAtún enlatado: 1-2 latas\nMarisco (mejillones, gambas…): 150 g crudo' },
  { titulo: 'Frutas, verduras y hortalizas', texto: 'Toma la cantidad que te apetezca\nLas raciones son de 100-200 g\nAsegura medio plato de verduras' },
  { titulo: 'Lácteos y derivados', texto: 'Leche: 150 ml\nYogur: 125-170 g\nQuesos frescos: 30-40 g\nQuesos curados/semi: 20 g' },
  { titulo: 'Huevos', texto: '1-2 huevos' },
  { titulo: 'Grasas', texto: 'Aceite de oliva: 1 cucharada sopera\nMantequilla: 1 cucharada de postre\nFrutos secos: 1 puñado (15 g)\nAguacate: 1/4\nCremas de frutos secos: 1 cucharada sopera (15-20 g)' },
  { titulo: 'Salsas', texto: 'Mayonesa (ocasional), salsa de soja, salsa césar…: 1 o 2 cucharadas' },
];

export const DEFAULT_CANTIDADES_NOTA =
  'Esta es la cantidad aproximada de una ración para ti. No es el total diario, sino la cantidad que tienes que poner más o menos cada vez que tomes ese alimento.';

export const DEFAULT_MENU_NOTAS = [
  'Utiliza UNA cucharada (10 ml) de aceite de oliva virgen extra aprox. para todas las comidas',
  'Especias al gusto (ajo en polvo, orégano, cebolla, pimentón…)',
  'Postre opcional: pieza de fruta',
  'Prioriza beber agua con las comidas',
].join('\n');

export const DEFAULT_SECCIONES = {
  desayunos: true, mediaManana: true, merienda: true, cantidades: true, menu: true, productos: true,
};

/** Número de la següent planificació del client (1, 2, 3…). */
export function nextPlanNumber(plans, clienteId) {
  const nums = (plans || [])
    .filter(p => p.formato === PLAN_FORMAT && p.clienteId === clienteId)
    .map(p => Number(p.numero) || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/** Última planificació del client (la de número més alt). */
export function latestPlanificacion(plans, clienteId) {
  return (plans || [])
    .filter(p => p.formato === PLAN_FORMAT && p.clienteId === clienteId)
    .sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0)
      || (b.fechaInicio || '').localeCompare(a.fechaInicio || ''))[0] || null;
}

const cloneOptions = (sec) => ({
  ...sec,
  opciones: (sec?.opciones || []).map(o => ({ ...o, id: uid() })),
  productos: [...(sec?.productos || [])],
});

/** Contingut (sense metadades) d'una planificació, copiat amb ids nous. */
export function copyContent(src) {
  return {
    supermercado: src.supermercado || '',
    secciones: { ...DEFAULT_SECCIONES, ...(src.secciones || {}) },
    desayunos: cloneOptions(src.desayunos),
    mediaManana: cloneOptions(src.mediaManana),
    merienda: cloneOptions(src.merienda),
    cantidades: {
      nota: src.cantidades?.nota ?? DEFAULT_CANTIDADES_NOTA,
      grupos: (src.cantidades?.grupos || []).map(g => ({ ...g, id: uid() })),
    },
    menu: {
      notas: src.menu?.notas ?? DEFAULT_MENU_NOTAS,
      dias: normalizeWeek(src.menu?.dias),
    },
    productos: [...(src.productos || [])],
  };
}

/** Garanteix els 7 dies amb A/B per dinar i sopar, conservant el que hi hagi. */
export function normalizeWeek(dias) {
  const byId = Object.fromEntries((dias || []).map(d => [d.id, d]));
  return WEEK_DAYS.map(id => {
    const d = byId[id] || {};
    const slot = (s) => ({
      a: { ...emptyDish(), ...(d[s]?.a || {}) },
      b: { ...emptyDish(), ...(d[s]?.b || {}) },
    });
    return { id, comida: slot('comida'), cena: slot('cena') };
  });
}

export function defaultContent() {
  return {
    supermercado: 'Mercadona',
    secciones: { ...DEFAULT_SECCIONES },
    desayunos: { opciones: [emptyOption()], nota: '', productos: [] },
    mediaManana: { opciones: [emptyOption()], nota: '', productos: [] },
    merienda: { opciones: [emptyOption()], nota: '', productos: [] },
    cantidades: {
      nota: DEFAULT_CANTIDADES_NOTA,
      grupos: DEFAULT_CANTIDADES.map(g => ({ ...g, id: uid() })),
    },
    menu: { notas: DEFAULT_MENU_NOTAS, dias: emptyWeek() },
    productos: [],
  };
}

/**
 * Nova planificació per a un client. Si hi ha `base` (normalment l'última
 * del client) se'n copia el contingut, perquè només calgui retocar-lo.
 */
export function createPlanificacion({ clienteId, plans, base, today }) {
  const numero = nextPlanNumber(plans, clienteId);
  return {
    formato: PLAN_FORMAT,
    clienteId,
    numero,
    nombre: `Planificación ${numero}`,
    fechaInicio: today || '',
    fechaFin: '',
    estado: 'borrador',
    objetivos: '',
    observaciones: '',
    ...(base ? copyContent(base) : defaultContent()),
  };
}

/** Planificació llegible pel generador encara que li faltin camps. */
export function normalizePlanificacion(plan) {
  const base = defaultContent();
  const sec = (k) => ({ ...base[k], ...(plan?.[k] || {}), opciones: plan?.[k]?.opciones || [] });
  return {
    ...plan,
    secciones: { ...DEFAULT_SECCIONES, ...(plan?.secciones || {}) },
    desayunos: sec('desayunos'),
    mediaManana: sec('mediaManana'),
    merienda: sec('merienda'),
    cantidades: { ...base.cantidades, ...(plan?.cantidades || {}), grupos: plan?.cantidades?.grupos || [] },
    menu: { notas: plan?.menu?.notas ?? '', dias: normalizeWeek(plan?.menu?.dias) },
    productos: plan?.productos || [],
  };
}

const hasOptions = (sec) => (sec?.opciones || []).some(o => o.titulo?.trim() || linesOf(o.alimentos).length);

export function menuHasContent(menu) {
  return (menu?.dias || []).some(d => MENU_SLOTS.some(s => MENU_VARIANTS.some(v => !isDishEmpty(d[s]?.[v]))));
}

/** Seccions que surten al PDF: activades i amb contingut. */
export function visibleSections(plan, productsById = {}) {
  const p = normalizePlanificacion(plan);
  return SECTION_ORDER.filter(k => {
    if (!p.secciones[k]) return false;
    if (OPTION_SECTIONS.includes(k)) return hasOptions(p[k]);
    if (k === 'cantidades') return p.cantidades.grupos.some(g => g.titulo?.trim() || linesOf(g.texto).length);
    if (k === 'menu') return menuHasContent(p.menu);
    if (k === 'productos') return p.productos.some(id => productsById[id]);
    return false;
  });
}

/** Enllaç de recepta segur (només http/https); afegeix https:// si falta. */
export function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const dishKey = (title) => String(title || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/**
 * Plats i opcions ja fets servir, per títol, per autocompletar-ne els
 * ingredients. Mana la planificació més recent.
 * @returns {{ titles: string[], find(title): { alimentos, receta? } | null }}
 */
export function buildDishIndex(plans, excludeId) {
  const map = new Map();
  const add = (titulo, entry) => {
    const k = dishKey(titulo);
    if (k && linesOf(entry.alimentos).length && !map.has(k)) map.set(k, { titulo: titulo.trim(), ...entry });
  };
  const sorted = (plans || [])
    .filter(p => p.formato === PLAN_FORMAT && p.id !== excludeId)
    .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || '') || (Number(b.numero) || 0) - (Number(a.numero) || 0));
  for (const p of sorted) {
    for (const d of p.menu?.dias || []) {
      for (const s of MENU_SLOTS) for (const v of MENU_VARIANTS) {
        const dish = d[s]?.[v];
        if (dish?.titulo) add(dish.titulo, { alimentos: dish.alimentos || '', receta: dish.receta || '' });
      }
    }
    for (const k of OPTION_SECTIONS) {
      for (const o of p[k]?.opciones || []) if (o.titulo) add(o.titulo, { alimentos: o.alimentos || '', nota: o.nota || '' });
    }
  }
  return {
    titles: [...map.values()].map(e => e.titulo).sort((a, b) => a.localeCompare(b)),
    find: (title) => map.get(dishKey(title)) || null,
  };
}

/** Comptadors per a la llista de plans. */
export function planificacionStats(plan) {
  const p = normalizePlanificacion(plan);
  let platos = 0;
  p.menu.dias.forEach(d => MENU_SLOTS.forEach(s => MENU_VARIANTS.forEach(v => { if (!isDishEmpty(d[s][v])) platos++; })));
  const opciones = OPTION_SECTIONS.reduce((n, k) => n + p[k].opciones.filter(o => o.titulo?.trim()).length, 0);
  return { platos, opciones, productos: p.productos.length };
}
