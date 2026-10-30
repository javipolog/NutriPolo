/**
 * entrevista.js — NutriPolo
 * =================================
 * Entrevista de la primera visita (la plantilla de recollida de dades de la
 * Raquel): motiu de consulta, historial mèdic, hàbits alimentaris (amb els
 * gustos per grups) i hàbits diaris (amb la rutina d'exercici setmanal).
 *
 * Una sola entrevista per client, a `client.entrevista` (respostes en text
 * lliure). Les preguntes que ja tenen camp al perfil (`patologias`,
 * `medicacion`, `alergias`, `intolerancias`, `ejercicio`) l'editen
 * directament: l'entrevista i el perfil no poden divergir.
 *
 * Tot és pur (sense store ni Tauri).
 */

// kind: 'text' (resposta a client.entrevista), 'client' (camp de text del
// client), 'tags' (llista d'etiquetes del client). soloMujer: s'amaga si el
// client és un home.
export const ENTREVISTA_SECTIONS = [
  {
    id: 'motivo',
    label: 'ent_s_motivo',
    questions: [
      { key: 'motivo', label: 'ent_q_motivo' },
      { key: 'dietasPrevias', label: 'ent_q_dietas_previas' },
      { key: 'pesoHabitual', label: 'ent_q_peso_habitual' },
      { key: 'gananciaPeso', label: 'ent_q_ganancia_peso' },
      { key: 'embarazos', label: 'ent_q_embarazos', soloMujer: true },
      { key: 'anticonceptivos', label: 'ent_q_anticonceptivos', soloMujer: true },
      { key: 'notasMotivo', label: 'ent_q_notas' },
    ],
  },
  {
    id: 'medico',
    label: 'ent_s_medico',
    questions: [
      { key: 'patologias', label: 'ent_q_enfermedades', kind: 'tags' },
      { key: 'enfermedadesDesde', label: 'ent_q_enfermedades_desde' },
      { key: 'analisis', label: 'ent_q_analisis' },
      { key: 'digestivo', label: 'ent_q_digestivo' },
      { key: 'medicacion', label: 'ent_q_medicacion', kind: 'client' },
      { key: 'alergias', label: 'ent_q_alergias', kind: 'tags' },
      { key: 'intolerancias', label: 'ent_q_intolerancias', kind: 'tags' },
    ],
  },
  {
    id: 'alimentacion',
    label: 'ent_s_alimentacion',
    questions: [
      { key: 'desayuno', label: 'ent_q_desayuno' },
      { key: 'mediaManana', label: 'ent_q_media_manana' },
      { key: 'comida', label: 'ent_q_comida' },
      { key: 'merienda', label: 'ent_q_merienda' },
      { key: 'cena', label: 'ent_q_cena' },
      { key: 'findes', label: 'ent_q_findes' },
      { key: 'picoteo', label: 'ent_q_picoteo' },
      { key: 'alcohol', label: 'ent_q_alcohol' },
      { key: 'refrescos', label: 'ent_q_refrescos' },
      { key: 'salsas', label: 'ent_q_salsas' },
    ],
    extra: 'gustos',
  },
  {
    id: 'diarios',
    label: 'ent_s_diarios',
    questions: [
      { key: 'fuma', label: 'ent_q_fuma' },
      { key: 'sueno', label: 'ent_q_sueno' },
      { key: 'actividadDiaria', label: 'ent_q_actividad' },
      { key: 'quienCocina', label: 'ent_q_quien_cocina' },
      { key: 'utensilios', label: 'ent_q_utensilios' },
      { key: 'recetasSencillas', label: 'ent_q_recetas_sencillas' },
    ],
    extra: 'rutina',
  },
];

// Grups de la taula de gustos: clau i etiqueta (+ `_hint` amb exemples)
export const GUSTOS_GROUPS = [
  ['cereales', 'ent_g_cereales'],
  ['tuberculos', 'ent_g_tuberculos'],
  ['otrosCereales', 'ent_g_otros_cereales'],
  ['fruta', 'ent_g_fruta'],
  ['verdura', 'ent_g_verdura'],
  ['carne', 'ent_g_carne'],
  ['pescado', 'ent_g_pescado'],
  ['marisco', 'ent_g_marisco'],
  ['lacteos', 'ent_g_lacteos'],
  ['legumbres', 'ent_g_legumbres'],
  ['huevo', 'ent_g_huevo'],
];
export const GUSTOS_COLUMNS = ['si', 'no'];

export const RUTINA_DAYS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

// Camps del perfil que l'entrevista edita directament (la nota d'exercici va
// sota la rutina setmanal, sense pregunta pròpia).
export const CLIENT_FIELDS = [
  ...ENTREVISTA_SECTIONS.flatMap(s => s.questions).filter(q => q.kind).map(q => q.key),
  'ejercicio',
];

/** Entrevista amb les subestructures que espera la UI (sense tocar l'original). */
export function normalizeEntrevista(e) {
  const src = e && typeof e === 'object' ? e : {};
  return {
    ...src,
    gustos: src.gustos && typeof src.gustos === 'object' ? src.gustos : {},
    rutina: src.rutina && typeof src.rutina === 'object' ? src.rutina : {},
  };
}

export const appliesTo = (question, client) => !question.soloMujer || client?.genero !== 'M';

/** Preguntes d'una secció que toquen a aquest client. */
export const sectionQuestions = (section, client) => section.questions.filter(q => appliesTo(q, client));

const filled = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');

/** Resposta d'una pregunta: del client o de l'entrevista. */
export function answerOf(client, question) {
  if (question.kind === 'tags') return client?.[question.key] || [];
  if (question.kind === 'client') return client?.[question.key] || '';
  return normalizeEntrevista(client?.entrevista)[question.key] || '';
}

/**
 * Progrés per secció: { id, done, total }. Cada grup de gustos compta com una
 * pregunta; la rutina d'exercici (dies o nota) com una altra.
 */
export function entrevistaProgress(client) {
  const e = normalizeEntrevista(client?.entrevista);
  return ENTREVISTA_SECTIONS.map(section => {
    const qs = sectionQuestions(section, client);
    let done = qs.filter(q => filled(answerOf(client, q))).length;
    let total = qs.length;
    if (section.extra === 'gustos') {
      total += GUSTOS_GROUPS.length;
      done += GUSTOS_GROUPS.filter(([g]) => GUSTOS_COLUMNS.some(c => filled(e.gustos[g]?.[c]))).length;
    }
    if (section.extra === 'rutina') {
      total += 1;
      if (RUTINA_DAYS.some(d => filled(e.rutina[d])) || filled(client?.ejercicio)) done += 1;
    }
    return { id: section.id, done, total };
  });
}

export function entrevistaTotals(client) {
  return entrevistaProgress(client).reduce(
    (acc, s) => ({ done: acc.done + s.done, total: acc.total + s.total }),
    { done: 0, total: 0 },
  );
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Canvi per a `updateClient` en respondre una pregunta. `path` és la clau de
 * la pregunta o un camí dins de l'entrevista ('gustos.fruta.si', 'rutina.lun',
 * 'fecha'). La primera resposta posa la data de l'entrevista.
 */
export function entrevistaPatch(client, path, value, now = new Date()) {
  const e = normalizeEntrevista(client?.entrevista);
  const stamp = { fecha: e.fecha || isoDate(now), updatedAt: now.toISOString() };
  if (CLIENT_FIELDS.includes(path)) {
    return { [path]: value, entrevista: { ...e, ...stamp } };
  }
  const [head, ...rest] = path.split('.');
  let next;
  if (rest.length === 0) {
    next = { ...e, [head]: value };
  } else if (rest.length === 1) {
    next = { ...e, [head]: { ...e[head], [rest[0]]: value } };
  } else {
    const [mid, leaf] = rest;
    next = { ...e, [head]: { ...e[head], [mid]: { ...(e[head]?.[mid] || {}), [leaf]: value } } };
  }
  return { entrevista: { ...next, fecha: next.fecha || stamp.fecha, updatedAt: stamp.updatedAt } };
}
