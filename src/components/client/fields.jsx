import React, { useLayoutEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { parseDecimal } from '../../services/energia';
import { useT } from '../../i18n';

// Compact fields shared by the interview, the weigh-in table and the energy
// needs card. All are module-level so inputs keep their identity (and focus)
// across renders.

export const FIELD_CLASS = 'w-full px-2.5 py-1.5 text-sm border border-sage-300 rounded-button bg-white text-sage-800 placeholder-sage-500 focus:outline-none focus:border-wellness-400 focus:ring-2 focus:ring-wellness-400/10';

/** One-row textarea that grows with its content (no inner scroll bar). */
export const AutoTextarea = ({ value, onChange, className = '', ...props }) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`${FIELD_CLASS} resize-none overflow-hidden leading-snug ${className}`}
      {...props}
    />
  );
};

export const formatNumber = (value, locale, digits = 2) => (
  value == null || value === '' || !Number.isFinite(Number(value))
    ? ''
    : Number(value).toLocaleString(locale, { maximumFractionDigits: digits, useGrouping: false })
);

/**
 * Number typed by hand (decimal comma or point). The text is kept while the
 * field has the focus, so "99," does not jump back to "99"; every valid value
 * is committed as a number, an empty field as null.
 */
export const NumberInput = ({ value, onCommit, locale, digits = 3, className = '', ...props }) => {
  const [draft, setDraft] = useState(null);
  const invalid = draft != null && draft.trim() !== '' && parseDecimal(draft) == null;
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft ?? formatNumber(value, locale, digits)}
      onChange={e => {
        const v = e.target.value;
        setDraft(v);
        if (!v.trim()) onCommit(null);
        else if (parseDecimal(v) != null) onCommit(parseDecimal(v));
      }}
      onBlur={() => setDraft(null)}
      aria-invalid={invalid || undefined}
      className={`${className} ${invalid ? '!border-danger' : ''}`}
      {...props}
    />
  );
};

/** Collapsible list of the keyboard shortcuts of a keyboard form. */
export const ShortcutsHint = ({ items }) => {
  const t = useT();
  return (
    <details className="text-xs text-sage-500">
      <summary className="inline-flex items-center gap-1.5 cursor-pointer select-none hover:text-sage-700">
        <Keyboard size={13} aria-hidden="true" /> {t.kb_title}
      </summary>
      <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
        {items.map(([keys, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span className="flex gap-1">
              {keys.map(k => (
                <kbd key={k} className="px-1.5 py-0.5 rounded border border-sage-200 bg-sage-50 font-mono text-[11px] text-sage-700">{k}</kbd>
              ))}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
};
