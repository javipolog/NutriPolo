/**
 * energia.js — NutriPolo
 * =================================
 * Necessitats energètiques (la pestanya "Necesidades energéticas" del full de
 * la Raquel): IMC i pes ideal, taxa metabòlica basal (Harris-Benedict o
 * Mifflin-St Jeor, o la de la bàscula), NEED = TMB × FA × FE i repartiment de
 * macronutrients en kcal i g/dia.
 *
 * Configuració a `client.energia`: els valors es desen tal com s'escriuen
 * (text, amb coma decimal o no) i es llegeixen amb `parseDecimal`. Els camps
 * buits agafen el valor del perfil (edat, sexe, alçada) o de l'últim pesatge.
 *
 * Tot és pur (sense store ni Tauri).
 */

export const FORMULAS = ['harris', 'mifflin', 'bascula'];

// Factor d'activitat per nivell d'activitat del client (src/clientOptions.js)
export const FACTORES_ACTIVIDAD = [
  ['sedentario', 1.2],
  ['ligero', 1.375],
  ['moderado', 1.55],
  ['activo', 1.725],
  ['muy_activo', 1.9],
];

export const MACROS = [
  ['hc', 4],
  ['prot', 4],
  ['lip', 9],
];
export const DEFAULT_MACROS = { hc: 45, prot: 25, lip: 30 };

/** Número escrit a mà ("99,9", " 1.55 ") o null si no n'és cap. */
export function parseDecimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

/** Anys complerts a partir d'una data ISO (AAAA-MM-DD). */
export function edadDesde(fechaNacimiento, hoy = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaNacimiento || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let edad = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < mo || (hoy.getMonth() + 1 === mo && hoy.getDate() < d)) edad--;
  return edad >= 0 ? edad : null;
}

export function imc(peso, tallaCm) {
  if (!peso || !tallaCm) return null;
  const m = tallaCm / 100;
  return peso / (m * m);
}

export function pesoIdeal(imcIdeal, tallaCm) {
  if (!imcIdeal || !tallaCm) return null;
  const m = tallaCm / 100;
  return imcIdeal * m * m;
}

/** TMB en kcal/dia. sexo: 'M' home, 'F' dona. */
export function tmb({ sexo, peso, tallaCm, edad, formula = 'harris' }) {
  if (!peso || !tallaCm || edad == null || (sexo !== 'M' && sexo !== 'F')) return null;
  if (formula === 'mifflin') {
    return 10 * peso + 6.25 * tallaCm - 5 * edad + (sexo === 'M' ? 5 : -161);
  }
  return sexo === 'M'
    ? 66.473 + 13.7516 * peso + 5.0033 * tallaCm - 6.755 * edad
    : 655.0955 + 9.5634 * peso + 1.8496 * tallaCm - 4.6756 * edad;
}

export const factorActividad = (nivel) => FACTORES_ACTIVIDAD.find(([id]) => id === nivel)?.[1] ?? null;

/** Repartiment d'unes kcal segons percentatges: [{ key, pct, kcal, g }]. */
export function macros(kcal, pct = DEFAULT_MACROS) {
  return MACROS.map(([key, kcalPerG]) => {
    const p = pct[key] ?? 0;
    const k = kcal ? (kcal * p) / 100 : null;
    return { key, pct: p, kcal: k, g: k == null ? null : k / kcalPerG };
  });
}

/**
 * Tot el càlcul per a un client i el seu últim pesatge.
 * @returns {{ inputs, derived, imc, pesoIdeal, tmb, tmbBascula, fa, fe, need, pct, pctTotal, columnas }}
 */
export function calcularEnergia(client, lastMeasurement) {
  const cfg = client?.energia || {};
  const derived = {
    sexo: client?.genero === 'M' || client?.genero === 'F' ? client.genero : '',
    edad: edadDesde(client?.fechaNacimiento),
    talla: parseDecimal(client?.altura),
    peso: parseDecimal(lastMeasurement?.peso),
  };
  const inputs = {
    sexo: cfg.sexo || derived.sexo,
    edad: parseDecimal(cfg.edad) ?? derived.edad,
    talla: parseDecimal(cfg.talla) ?? derived.talla,
    peso: parseDecimal(cfg.peso) ?? derived.peso,
  };
  const tmbBascula = parseDecimal(lastMeasurement?.tasaMetabolica);
  const formula = cfg.formula || 'harris';
  const tmbValue = formula === 'bascula'
    ? tmbBascula
    : tmb({ sexo: inputs.sexo, peso: inputs.peso, tallaCm: inputs.talla, edad: inputs.edad, formula });
  const fa = parseDecimal(cfg.fa) ?? factorActividad(client?.nivelActividad) ?? 1.2;
  const fe = parseDecimal(cfg.fe) ?? 1;
  const need = tmbValue ? tmbValue * fa * fe : null;
  const pct = {
    hc: parseDecimal(cfg.macros?.hc) ?? DEFAULT_MACROS.hc,
    prot: parseDecimal(cfg.macros?.prot) ?? DEFAULT_MACROS.prot,
    lip: parseDecimal(cfg.macros?.lip) ?? DEFAULT_MACROS.lip,
  };
  const objetivos = Array.isArray(cfg.objetivos) ? cfg.objetivos : [];
  const columnas = [need, parseDecimal(objetivos[0]), parseDecimal(objetivos[1])]
    .map(kcal => ({ kcal, macros: macros(kcal, pct) }));
  return {
    inputs,
    derived,
    formula,
    imc: imc(inputs.peso, inputs.talla),
    pesoIdeal: pesoIdeal(parseDecimal(cfg.imcIdeal), inputs.talla),
    tmb: tmbValue,
    tmbBascula,
    fa,
    fe,
    need,
    pct,
    pctTotal: pct.hc + pct.prot + pct.lip,
    columnas,
  };
}
