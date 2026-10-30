import { describe, it, expect } from 'vitest';
import { nextTarget, caretEdges, ALL_EDGES } from './keyboardGrid';

const MIDDLE = { atStart: false, atEnd: false, firstLine: false, lastLine: false };

// Two sections; the second one holds a 2×2 grid (rows 0-1, cols 0-1) in row-major order.
const fields = [
  { section: 'a' },
  { section: 'a', multiline: true },
  { section: 'b', grid: 'g', row: 0, col: 0 },
  { section: 'b', grid: 'g', row: 0, col: 1 },
  { section: 'b', grid: 'g', row: 1, col: 0 },
  { section: 'b', grid: 'g', row: 1, col: 1 },
];

describe('nextTarget: Enter', () => {
  it('moves to the next and previous field', () => {
    expect(nextTarget(fields, 0, 'Enter')).toEqual({ index: 1 });
    expect(nextTarget(fields, 1, 'Enter', { shift: true })).toEqual({ index: 0 });
  });

  it('stays on the first and last field', () => {
    expect(nextTarget(fields, 0, 'Enter', { shift: true })).toEqual({ index: 0 });
    expect(nextTarget(fields, 5, 'Enter')).toEqual({ index: 5 });
  });

  it('Alt+Enter and Ctrl+Enter add a line break only in multi-line fields', () => {
    expect(nextTarget(fields, 1, 'Enter', { alt: true })).toEqual({ newline: true });
    expect(nextTarget(fields, 1, 'Enter', { ctrl: true })).toEqual({ newline: true });
    expect(nextTarget(fields, 0, 'Enter', { alt: true })).toEqual({ index: 0 });
  });

  it('goes down the column when the field asks for it, and on past the last row', () => {
    const down = fields.map(f => (f.grid ? { ...f, enter: 'down' } : f));
    expect(nextTarget(down, 2, 'Enter')).toEqual({ index: 4 });
    expect(nextTarget(down, 4, 'Enter', { shift: true })).toEqual({ index: 2 });
    expect(nextTarget(down, 4, 'Enter')).toEqual({ index: 5 });
  });
});

describe('nextTarget: arrows in a grid', () => {
  it('moves between cells when the caret is at the edge', () => {
    expect(nextTarget(fields, 2, 'ArrowRight', {}, ALL_EDGES)).toEqual({ index: 3 });
    expect(nextTarget(fields, 3, 'ArrowLeft', {}, ALL_EDGES)).toEqual({ index: 2 });
    expect(nextTarget(fields, 2, 'ArrowDown', {}, ALL_EDGES)).toEqual({ index: 4 });
    expect(nextTarget(fields, 5, 'ArrowUp', {}, ALL_EDGES)).toEqual({ index: 3 });
  });

  it('leaves the key to the browser inside the text or at the grid border', () => {
    expect(nextTarget(fields, 2, 'ArrowRight', {}, MIDDLE)).toBeNull();
    expect(nextTarget(fields, 2, 'ArrowLeft', {}, ALL_EDGES)).toBeNull();
    expect(nextTarget(fields, 2, 'ArrowUp', {}, ALL_EDGES)).toBeNull();
  });

  it('ignores arrows outside grids', () => {
    expect(nextTarget(fields, 0, 'ArrowDown', {}, ALL_EDGES)).toBeNull();
  });

  it('skips missing cells to the nearest one', () => {
    const sparse = [
      { grid: 'g', row: 0, col: 0 },
      { grid: 'g', row: 0, col: 3 },
      { grid: 'h', row: 0, col: 1 },
    ];
    expect(nextTarget(sparse, 0, 'ArrowRight', {}, ALL_EDGES)).toEqual({ index: 1 });
  });
});

describe('nextTarget: Ctrl+arrows between sections', () => {
  it('jumps to the first field of the next section', () => {
    expect(nextTarget(fields, 0, 'ArrowDown', { ctrl: true })).toEqual({ index: 2 });
    expect(nextTarget(fields, 3, 'ArrowDown', { ctrl: true })).toEqual({ index: 3 });
  });

  it('goes to the start of the section, then to the previous one', () => {
    expect(nextTarget(fields, 4, 'ArrowUp', { ctrl: true })).toEqual({ index: 2 });
    expect(nextTarget(fields, 2, 'ArrowUp', { ctrl: true })).toEqual({ index: 0 });
  });
});

it('leaves Tab and other keys to the browser', () => {
  expect(nextTarget(fields, 0, 'Tab')).toBeNull();
  expect(nextTarget(fields, 0, 'a')).toBeNull();
});

describe('caretEdges', () => {
  it('detects the start, the end and the first and last lines', () => {
    expect(caretEdges('', 0)).toEqual(ALL_EDGES);
    expect(caretEdges('ab\ncd', 0)).toEqual({ atStart: true, atEnd: false, firstLine: true, lastLine: false });
    expect(caretEdges('ab\ncd', 5)).toEqual({ atStart: false, atEnd: true, firstLine: false, lastLine: true });
    expect(caretEdges('ab\ncd', 1, 4)).toEqual({ atStart: false, atEnd: false, firstLine: true, lastLine: true });
  });
});
