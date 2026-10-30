/**
 * fuzzyMatcher.js — NutriPolo
 * ============================
 * Pure patient matching for events imported from Google Calendar (every
 * consultation calendar: Raquel's own and the external clinics).
 * Zero external dependencies. ~5000 comparisons (50 events × 100 clients) ≈ 15ms.
 *
 * matchPatient() decides, in this order:
 *   1. Email / phone of the event (guests, description) = a client's → assign
 *   2. Exact normalized name, unique among clients                  → assign
 *   3. Same name for several clients, or a shared phone / email      → ask
 *   4. Fuzzy score ≥ autoThreshold                                   → propose (never silent)
 *   5. Fuzzy score ≥ suggestThreshold                                → ask
 *   6. Nothing                                                       → offer a new client
 *
 * Scoring model (0–1):
 *   0.6 — Jaccard similarity on token sets   (handles word-order differences;
 *         tokens of 4+ letters one typo apart count as the same word)
 *   0.3 — Levenshtein similarity on full str (handles typos, accent swaps)
 *   0.1 — Bonus if longest token of A appears in B (Lev ≤ 1)
 *   Cap to 0.85 if longest token of A doesn't appear in B even approximately
 *         (Lev ≤ 2) — prevents "Ana Ruiz" from auto-matching "Ana Pérez".
 */

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .trim();
}

// ── Patient name extraction from Google Calendar event summary ────────────────

/**
 * Strip clinic boilerplate from an event summary to extract a raw patient name.
 *
 * Handles common Spanish-receptionist formats:
 *   "Consulta - María García"           → "María García"
 *   "María García (seguimiento)"        → "María García"
 *   "María García 11:00 sala 3"         → "María García"
 *   "Cita: Juan López - 1ª visita"      → "Juan López"
 *   "Revisión - Ana Ruiz"               → "Ana Ruiz"
 */
export function extractPatientName(summary) {
  if (!summary) return '';
  let s = summary;

  // Strip leading appointment-type prefix (e.g. "Consulta -", "Cita:", "Seguimiento Ana")
  s = s.replace(/^(consulta|cita|revisión|revision|seguimiento|urgencia|primera\s*visita)(\s*(?:-|–|:)\s*|\s+)/i, '');

  // Strip parenthetical notes (e.g. "(seguimiento)", "(sala 3)")
  s = s.replace(/\([^)]*\)/g, '');

  // Strip time patterns (10:00, 10:30h, 10h)
  s = s.replace(/\b\d{1,2}[:h]\d{0,2}h?\b/gi, '');

  // Strip " - <trailing note>" suffix that remains after the prefix was removed
  // (a dash with a space on one side, so "García-López" stays whole)
  s = s.replace(/(\s+[-–]\s*|\s*[-–]\s+).*$/, '');

  // Strip room / box references
  s = s.replace(/\b(sala|box|room|consulta)\s*\d+\b/gi, '');

  // Strip price tokens — common in receptionist summaries (prefix or suffix)
  // Handles: "35€", "40 €", "35.50€", "35,00 €", "$25", "€25", "María Plaza €"
  const CURRENCY = '[€$£¥₽₩₹]';
  s = s.replace(new RegExp(`\\s*\\d+(?:[.,]\\d+)?\\s*${CURRENCY}\\s*$`, 'u'), '');
  s = s.replace(new RegExp(`\\s*${CURRENCY}\\s*\\d+(?:[.,]\\d+)?\\s*$`, 'u'), '');
  s = s.replace(new RegExp(`^\\s*\\d+(?:[.,]\\d+)?\\s*${CURRENCY}\\s*`, 'u'), '');
  s = s.replace(new RegExp(`^\\s*${CURRENCY}\\s*\\d+(?:[.,]\\d+)?\\s*`, 'u'), '');
  s = s.replace(new RegExp(`\\s*${CURRENCY}\\s*$`, 'u'), '');  // bare trailing symbol

  // Strip trailing digits and punctuation (cleans up residue after currency strip)
  s = s.replace(/[\d.,:;!?]+$/g, '');

  return s.replace(/\s+/g, ' ').trim();
}

// ── Levenshtein distance (single-row DP, O(n×m) time, O(n) space) ─────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = temp;
    }
  }
  return row[n];
}

function levenshteinScore(a, b) {
  const maxLen = Math.max(a.length, b.length);
  return maxLen ? 1 - levenshtein(a, b) / maxLen : 1;
}

// ── Jaccard similarity on token multisets ──────────────────────────────────────

function tokenize(s) {
  return s.split(/\s+/).filter(t => t.length >= 2);
}

function jaccardScore(tA, tB) {
  if (!tA.length && !tB.length) return 1;
  if (!tA.length || !tB.length) return 0;
  const setA = new Set(tA);
  const unused = new Set(tB);
  const sizeB = unused.size;
  let intersection = 0;
  for (const t of setA) {
    // Exact word first, else one typo away ("Ferer" / "Ferrer"); each word of B counts once.
    const hit = unused.has(t) ? t
      : t.length >= 4 ? [...unused].find(u => u.length >= 4 && levenshtein(t, u) <= 1) : undefined;
    if (hit !== undefined) { intersection++; unused.delete(hit); }
  }
  return intersection / (setA.size + sizeB - intersection);
}

// ── Main scoring function ──────────────────────────────────────────────────────

/**
 * Compute a 0–1 similarity score between two patient name strings.
 * Normalizes both inputs before comparison.
 */
export function fuzzyScore(nameA, nameB) {
  const nA = normalize(nameA);
  const nB = normalize(nameB);
  if (!nA || !nB) return 0;
  if (nA === nB) return 1;

  const tA = tokenize(nA);
  const tB = tokenize(nB);
  const jacc = jaccardScore(tA, tB);
  const lev  = levenshteinScore(nA, nB);

  // Longest token of A — heuristic for "most distinctive" word (surname)
  const longestA = tA.reduce((best, t) => t.length > best.length ? t : best, '');
  let longestBonus = 0;
  let foundApprox = false;

  if (longestA.length >= 3) {
    for (const t of tB) {
      const d = levenshtein(t, longestA);
      if (d <= 1) { longestBonus = 0.1; foundApprox = true; break; }
      if (d <= 2) foundApprox = true;
    }
    // Cap score if the key token is missing entirely from B
    if (!foundApprox) {
      return Math.min(jacc * 0.6 + lev * 0.3, 0.85);
    }
  }

  return Math.min(1, jacc * 0.6 + lev * 0.3 + longestBonus);
}

// ── Multi-candidate search ─────────────────────────────────────────────────────

/**
 * Find the best client matches for an extracted patient name.
 *
 * @param {string} extractedName             Name from Google event (raw, not yet normalized)
 * @param {Array}  clients                   Array of { id, nombre } store entries
 * @param {object} [opts]
 * @param {number} [opts.autoThreshold=0.92] Score ≥ this → auto-link silently
 * @param {number} [opts.suggestThreshold=0.75] Score ≥ this → show in inbox
 * @returns {{ auto: object|null, candidates: Array<{clienteId, nombre, score}> }}
 *   `auto` is the best candidate if its score ≥ autoThreshold; null otherwise.
 *   `candidates` are all results with score ≥ suggestThreshold, sorted desc.
 */
export function findBestMatches(extractedName, clients, { autoThreshold = 0.92, suggestThreshold = 0.75 } = {}) {
  if (!extractedName || !clients?.length) return { auto: null, candidates: [] };

  const scored = clients
    .filter(c => c.nombre)
    .map(c => ({ clienteId: c.id, nombre: c.nombre, score: fuzzyScore(extractedName, c.nombre) }))
    .filter(r => r.score >= suggestThreshold)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const auto = (best && best.score >= autoThreshold) ? best : null;
  return { auto, candidates: scored };
}

// ── Contacts (email / phone) ───────────────────────────────────────────────────

/** Name key used for exact matches: normalized, single spaces. */
export function nameKey(s) {
  return normalize(s).replace(/\s+/g, ' ');
}

export function normalizeEmail(s) {
  const e = String(s || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/**
 * Digits of a phone number without spaces, symbols or the Spanish prefix
 * (+34 / 0034), so "+34 600 11 22 33" and "600112233" compare equal.
 * Shorter than 9 digits is not a phone (dates, times, prices).
 */
export function normalizePhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('34')) d = d.slice(2);
  return d.length >= 9 && d.length <= 15 ? d : '';
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+|\b00)?\d[\d\s.()-]{7,}\d/g;

/** Emails and phones written in an event description (plain text or HTML). */
export function extractContacts(text) {
  const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const emails = [...new Set((plain.match(EMAIL_RE) || []).map(normalizeEmail).filter(Boolean))];
  // Emails first, so the digits inside one are never read as a phone.
  const rest = plain.replace(EMAIL_RE, ' ');
  const phones = [...new Set((rest.match(PHONE_RE) || []).map(normalizePhone).filter(Boolean))];
  return { emails, phones };
}

// ── Events that are not appointments ─────────────────────────────────────────

/**
 * Titles that block time instead of naming a patient. Matched against the
 * first word(s) of the title, so "Comida con Laura" is noise too. Keep it
 * short: a word here can never become a patient suggestion.
 */
const NOISE_TITLES = [
  'bloqueo', 'bloqueado', 'bloquear', 'no disponible', 'ocupado', 'ocupada', 'busy', 'blocked',
  'comida', 'almuerzo', 'desayuno', 'cena', 'descanso', 'pausa', 'break', 'lunch',
  'personal', 'privado', 'vacaciones', 'festivo', 'libre', 'fuera de la oficina', 'out of office',
  'reunion', 'formacion', 'gestiones', 'administracion',
];

/** Appointment words with no patient name in them. */
const GENERIC_TITLES = new Set([
  'consulta', 'cita', 'revision', 'seguimiento', 'urgencia', 'primera visita', 'visita', 'paciente', 'nuevo paciente',
]);

/** True for events that block time instead of naming a patient: no title or a NOISE_TITLES one. */
export function isNoiseEvent(summary) {
  const words = nameKey(summary).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return true;
  return NOISE_TITLES.some(n => words === n || words.startsWith(n + ' '));
}

// ── Patient resolution ───────────────────────────────────────────────────────

/**
 * Lookup maps over the clients, built once per sync: by exact name key, by
 * email and by phone (telefono and whatsapp). Each maps to client ids.
 */
export function buildClientIndex(clients) {
  const byName = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  const add = (map, key, id) => {
    if (!key) return;
    const ids = map.get(key) || [];
    if (!ids.includes(id)) map.set(key, [...ids, id]);
  };
  for (const c of clients || []) {
    if (!c?.id) continue;
    add(byName, nameKey(c.nombre), c.id);
    add(byEmail, normalizeEmail(c.email), c.id);
    add(byPhone, normalizePhone(c.telefono), c.id);
    add(byPhone, normalizePhone(c.whatsapp), c.id);
  }
  return { clients: clients || [], byId: new Map((clients || []).map(c => [c.id, c])), byName, byEmail, byPhone };
}

const candidate = (index, id, rawName) => {
  const c = index.byId.get(id);
  return { clienteId: id, nombre: c?.nombre || '', score: rawName ? fuzzyScore(rawName, c?.nombre) : 1 };
};

/**
 * Decide which client a Google event belongs to.
 *
 * @param {object} event   { summary, description, attendees?: string[], allDay? }
 * @param {object} index   buildClientIndex(clients)
 * @param {object} [opts]  { autoThreshold, suggestThreshold, ignoreEmails?: Set }
 * @returns {{
 *   result: 'assign' | 'confirm' | 'review' | 'new' | 'noise',
 *   clienteId?, via?: 'email'|'phone'|'name', score?, candidates: Array,
 *   rawName, normalizedName, contact: { email, phone }
 * }}
 *   assign  → link now (contact or unique exact name)
 *   confirm → one strong fuzzy candidate, shown for a 1-click confirmation
 *   review  → several candidates (same name, shared phone, fuzzy)
 *   new     → no candidate: offer to create a client
 *   noise   → not an appointment (or no name to look up): nothing to suggest
 */
export function matchPatient(event, index, { autoThreshold = 0.92, suggestThreshold = 0.75, ignoreEmails } = {}) {
  const rawName = extractPatientName(event?.summary || '');
  const normalizedName = nameKey(rawName);
  const fromText = extractContacts(event?.description);
  const emails = [...new Set([...(event?.attendees || []).map(normalizeEmail), ...fromText.emails])]
    .filter(e => e && !ignoreEmails?.has(e));
  const phones = fromText.phones;
  const contact = { email: emails[0] || '', phone: phones[0] || '' };
  const hasName = !!normalizedName && !GENERIC_TITLES.has(normalizedName);
  // What groups several events of one patient into one suggestion.
  const key = hasName ? normalizedName : (contact.email || contact.phone);
  const base = { rawName: hasName ? rawName : '', normalizedName: key, contact, candidates: [] };

  if (isNoiseEvent(event?.summary)) return { ...base, result: 'noise' };

  const byName = index.byName.get(normalizedName) || [];
  const viaOf = new Map();
  for (const e of emails) for (const id of index.byEmail.get(e) || []) if (!viaOf.has(id)) viaOf.set(id, 'email');
  for (const p of phones) for (const id of index.byPhone.get(p) || []) if (!viaOf.has(id)) viaOf.set(id, 'phone');
  const byContact = [...viaOf.keys()];

  if (byContact.length) {
    // A family may share a phone or an email: the name settles it.
    const both = byContact.filter(id => byName.includes(id));
    if (byContact.length === 1 && (!byName.length || both.length)) {
      return { ...base, result: 'assign', clienteId: byContact[0], via: viaOf.get(byContact[0]), score: 1 };
    }
    if (both.length === 1) return { ...base, result: 'assign', clienteId: both[0], via: viaOf.get(both[0]), score: 1 };
    // Contact and name point to different clients, or several share it.
    const ids = [...new Set([...byContact, ...byName])];
    return { ...base, result: 'review', candidates: ids.map(id => candidate(index, id, base.rawName)).sort((a, b) => b.score - a.score) };
  }

  // "Consulta" / "Cita" alone: an appointment, but nothing to look up.
  if (!hasName) return { ...base, result: 'noise' };
  if (byName.length === 1) return { ...base, result: 'assign', clienteId: byName[0], via: 'name', score: 1 };
  if (byName.length > 1) {
    return { ...base, result: 'review', candidates: byName.map(id => candidate(index, id, base.rawName)) };
  }
  // All-day events are rarely appointments (birthdays, trips): only a sure
  // match counts, they never propose a patient or a new client.
  if (event?.allDay) return { ...base, result: 'noise' };

  const { auto, candidates } = findBestMatches(rawName, index.clients, { autoThreshold, suggestThreshold });
  if (auto) return { ...base, result: 'confirm', clienteId: auto.clienteId, score: auto.score, candidates };
  if (candidates.length) return { ...base, result: 'review', score: candidates[0].score, candidates };
  return { ...base, result: 'new' };
}
