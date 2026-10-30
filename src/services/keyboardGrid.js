/**
 * keyboardGrid.js — NutriPolo
 * =================================
 * Navegació amb teclat entre caselles, com en un full de càlcul (entrevista,
 * seguiments i necessitats energètiques). El hook `useKeyboardForm` llegeix
 * les caselles del DOM i el cursor de la que té el focus; aquí només es
 * decideix on anar, perquè es pugui provar sense DOM.
 *
 * Tecles:
 *  - Enter / Maj+Enter → casella següent / anterior (o la de sota / sobre si
 *    la casella té `enter: 'down'`, com a la taula de pesatges)
 *  - Alt+Enter o Ctrl+Enter → salt de línia dins de la casella
 *  - Fletxes dins d'una graella → casella del costat, quan el cursor és a la
 *    vora del text (← a l'inici, → al final, ↑/↓ a la primera/última línia)
 *  - Ctrl+↓ / Ctrl+↑ → primera casella de la secció següent / anterior
 */

/** Cursor a totes les vores: caselles sense text (caselles de selecció, botons). */
export const ALL_EDGES = { atStart: true, atEnd: true, firstLine: true, lastLine: true };

const isGridMove = (key) => key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

/**
 * Casella de la mateixa graella més propera en una direcció.
 * Esquerra/dreta: mateixa fila; amunt/avall: mateixa columna.
 */
function neighbour(fields, index, key) {
  const cur = fields[index];
  let best = -1;
  fields.forEach((f, i) => {
    if (i === index || f.grid !== cur.grid) return;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    if (horizontal ? f.row !== cur.row : f.col !== cur.col) return;
    const pos = horizontal ? f.col : f.row;
    const here = horizontal ? cur.col : cur.row;
    const forward = key === 'ArrowRight' || key === 'ArrowDown';
    if (forward ? pos <= here : pos >= here) return;
    const bestPos = best < 0 ? null : (horizontal ? fields[best].col : fields[best].row);
    if (best < 0 || (forward ? pos < bestPos : pos > bestPos)) best = i;
  });
  return best < 0 ? null : best;
}

function sectionStart(fields, index) {
  let i = index;
  while (i > 0 && fields[i - 1].section === fields[index].section) i--;
  return i;
}

/**
 * @param {Array<{section?, grid?, row?, col?, enter?, multiline?}>} fields caselles en l'ordre del DOM
 * @param {number} index casella amb el focus
 * @param {string} key KeyboardEvent.key
 * @param {{shift?, alt?, ctrl?}} mods
 * @param {{atStart, atEnd, firstLine, lastLine}} caret on és el cursor dins del text
 * @returns {null | {newline: true} | {index: number}} null = que ho gestioni el navegador
 */
export function nextTarget(fields, index, key, mods = {}, caret = ALL_EDGES) {
  const cur = fields[index];
  if (!cur) return null;
  const { shift, alt, ctrl } = mods;

  if (key === 'Enter') {
    if (alt || ctrl) return cur.multiline ? { newline: true } : { index };
    const dir = shift ? -1 : 1;
    if (cur.enter === 'down' && cur.grid != null) {
      const vertical = neighbour(fields, index, dir > 0 ? 'ArrowDown' : 'ArrowUp');
      if (vertical != null) return { index: vertical };
    }
    return { index: Math.min(fields.length - 1, Math.max(0, index + dir)) };
  }

  if (ctrl && !alt && !shift && (key === 'ArrowDown' || key === 'ArrowUp')) {
    const start = sectionStart(fields, index);
    if (key === 'ArrowUp') {
      if (start !== index) return { index: start };
      return start > 0 ? { index: sectionStart(fields, start - 1) } : { index };
    }
    const next = fields.findIndex((f, i) => i > index && f.section !== cur.section);
    return { index: next < 0 ? index : next };
  }

  if (isGridMove(key) && !ctrl && !alt && !shift && cur.grid != null) {
    const atEdge = {
      ArrowLeft: caret.atStart,
      ArrowRight: caret.atEnd,
      ArrowUp: caret.firstLine,
      ArrowDown: caret.lastLine,
    }[key];
    if (!atEdge) return null;
    const target = neighbour(fields, index, key);
    return target == null ? null : { index: target };
  }

  return null;
}

/** On és el cursor dins d'un text (per a les fletxes). */
export function caretEdges(value, selectionStart, selectionEnd = selectionStart) {
  const text = String(value ?? '');
  return {
    atStart: selectionStart === 0 && selectionEnd === 0,
    atEnd: selectionStart === text.length && selectionEnd === text.length,
    firstLine: text.lastIndexOf('\n', selectionStart - 1) === -1,
    lastLine: text.indexOf('\n', selectionEnd) === -1,
  };
}
