import React from 'react';
import { Input } from '../UI';

/** Checkbox with a label and an optional hint underneath. */
export const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-2.5 cursor-pointer">
    <input type="checkbox" className="mt-0.5" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span>
      <span className="block text-sm text-sage-800">{label}</span>
      {hint && <span className="block text-xs text-sage-500 mt-0.5">{hint}</span>}
    </span>
  </label>
);

/** Integer input clamped to [min, max]. */
export const NumberField = ({ label, value, onChange, min = 0, max = 168, suffix }) => (
  <label className="block">
    <span className="block text-xs font-medium text-sage-600 mb-1">{label}</span>
    <span className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-24"
      />
      {suffix && <span className="text-xs text-sage-500">{suffix}</span>}
    </span>
  </label>
);
