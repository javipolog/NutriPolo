/**
 * fuzzyMatcher.js — NutriPolo
 * ============================
 * Pure fuzzy patient-name matching utilities for external-clinic sync.
 * Zero external dependencies. ~5000 comparisons (50 events × 100 clients) ≈ 15ms.
 *
 * Scoring model (0–1):
 *   0.6 — Jaccard similarity on token sets   (handles word-order differences)
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

  // Strip leading appointment-type prefix (e.g. "Consulta -", "Cita:")
  s = s.replace(/^(consulta|cita|revisión|revision|seguimiento|urgencia|primera\s*visita)\s*[-:]\s*/i, '');

  // Strip parenthetical notes (e.g. "(seguimiento)", "(sala 3)")
  s = s.replace(/\([^)]*\)/g, '');

  // Strip time patterns (10:00, 10:30h, 10h)
  s = s.replace(/\b\d{1,2}[:h]\d{0,2}h?\b/gi, '');

  // Strip " - <trailing note>" suffix that remains after the prefix was removed
  s = s.replace(/\s*-\s*.*$/, '');

  // Strip room / box references
  s = s.replace(/\b(sala|box|room|consulta)\s*\d+\b/gi, '');

  // Strip trailing digits and punctuation
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
  const setB = new Set(tB);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
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
