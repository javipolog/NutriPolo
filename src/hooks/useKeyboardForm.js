import { useCallback, useRef } from 'react';
import { nextTarget, caretEdges, ALL_EDGES } from '../services/keyboardGrid';

// Spreadsheet-style keyboard navigation for a block of fields (see
// services/keyboardGrid.js for the keys). Fields opt in with data attributes:
//   data-field             any value; marks a navigable field
//   data-section="id"      Ctrl+↑/↓ jump between sections
//   data-grid / data-row / data-col   arrow keys move inside the grid
//   data-enter="down"      Enter moves down the column instead of to the next field
//   data-select="all"      select the whole value on arrival (number cells)
// A field that already handled the key (e.preventDefault()) is left alone.

const NO_EDGES = { atStart: false, atEnd: false, firstLine: false, lastLine: false };

function describe(el) {
  const d = el.dataset;
  return {
    section: d.section,
    grid: d.grid,
    row: d.row != null ? Number(d.row) : undefined,
    col: d.col != null ? Number(d.col) : undefined,
    enter: d.enter,
    multiline: el.tagName === 'TEXTAREA',
  };
}

function caretOf(el) {
  if (el.tagName === 'SELECT' || el.type === 'date') return NO_EDGES;
  if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.selectionStart != null)) {
    return caretEdges(el.value, el.selectionStart, el.selectionEnd);
  }
  return ALL_EDGES;
}

function focusField(el) {
  el.focus();
  if (el.selectionStart == null || typeof el.setSelectionRange !== 'function') return;
  if (el.dataset.select === 'all') el.select();
  else el.setSelectionRange(el.value.length, el.value.length);
}

export function useKeyboardForm() {
  const ref = useRef(null);
  const onKeyDown = useCallback((e) => {
    if (e.defaultPrevented || e.nativeEvent?.isComposing) return;
    const container = ref.current;
    if (!container || !e.target.matches?.('[data-field]')) return;
    const els = [...container.querySelectorAll('[data-field]')]
      .filter(el => !el.disabled && el.getClientRects().length > 0);
    const index = els.indexOf(e.target);
    if (index < 0) return;
    const result = nextTarget(
      els.map(describe), index, e.key,
      { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey },
      caretOf(e.target),
    );
    if (!result) return;
    e.preventDefault();
    if (result.newline) {
      // insertText goes through the browser's undo stack and fires React's onChange
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (result.index !== index) focusField(els[result.index]);
  }, []);
  return { ref, onKeyDown };
}

/** First field of a section, for the index links. */
export function focusSection(container, sectionId) {
  const el = container?.querySelector(`[data-field][data-section="${sectionId}"]`);
  if (el) focusField(el);
}
