import React from 'react';

// Peces compartides pels editors de la planificació (general i esportiva)
export const FIELD = 'w-full text-sm text-sage-800 bg-white border border-sage-300 rounded-button px-3 py-2 placeholder-sage-400 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10 transition-colors';
export const LABEL = 'block text-xs font-medium text-sage-600 mb-1';
export const CARD = 'bg-white border border-sage-200 rounded-soft p-4 space-y-3 shadow-card';

export const IconBtn = ({ icon: Icon, label, onClick, disabled, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`p-1.5 rounded-button text-sage-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${danger ? 'hover:text-danger hover:bg-danger-light' : 'hover:text-sage-700 hover:bg-sage-100'}`}
  >
    <Icon size={14} />
  </button>
);

export const move = (arr, i, d) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};

export const rowsFor = (text, min = 3) => Math.max(min, String(text || '').split('\n').length + 1);
