import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, useConfirm, useToast } from '../UI';
import useStore, { calcIMC, todayISO } from '../../stores/store';
import { useT, useLocale } from '../../i18n';
import { useKeyboardForm } from '../../hooks/useKeyboardForm';
import { NumberInput, formatNumber, ShortcutsHint } from './fields';

// Weigh-in follow-ups laid out like Raquel's sheet: one row per metric, one
// column per date, and an empty column on the right for today's weigh-in.
// Typing in that column creates the measurement; Enter goes down the column,
// as when copying the values off the scale.

const ROWS = [
  { key: 'peso', label: 'measurement_weight' },
  { key: 'masaMuscular', label: 'measurement_muscle' },
  { key: 'masaMuscularPct', label: 'seg_muscle_pct', suggest: m => (m?.masaMuscular && m?.peso ? (m.masaMuscular / m.peso) * 100 : null) },
  { key: 'masaGrasa', label: 'seg_fat_kg', suggest: m => (m?.grasaCorporal && m?.peso ? (m.peso * m.grasaCorporal) / 100 : null) },
  { key: 'grasaCorporal', label: 'measurement_body_fat' },
  { key: 'agua', label: 'measurement_water' },
  { key: 'masaOsea', label: 'seg_bone' },
  { key: 'grasaVisceral', label: 'measurement_visceral_fat' },
  { key: 'imc', label: 'measurement_bmi', kind: 'computed' },
  { key: 'tasaMetabolica', label: 'seg_bmr' },
  { key: 'edadMetabolica', label: 'seg_metabolic_age' },
  { group: 'measurement_perimeters' },
  { key: 'cintura', label: 'measurement_waist' },
  { key: 'pecho', label: 'measurement_chest' },
  { key: 'cadera', label: 'measurement_hip' },
  { key: 'brazo', label: 'measurement_arm' },
  { key: 'muslo', label: 'measurement_thigh' },
  { group: 'seg_other' },
  { key: 'regla', label: 'seg_period', kind: 'check', soloMujer: true },
  { key: 'notas', label: 'seg_notes', kind: 'text' },
];

const CELL_CLASS = 'w-full min-w-[4.5rem] px-2 py-1 text-sm text-right tabular-nums bg-transparent border border-transparent rounded-button text-sage-800 placeholder-sage-400 hover:border-sage-200 focus:outline-none focus:border-wellness-400 focus:bg-white';
const STICKY = 'sticky left-0 z-10 bg-white';

export const FollowUpTable = ({ client, measurements }) => {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const addMeasurement = useStore(s => s.addMeasurement);
  const updateMeasurement = useStore(s => s.updateMeasurement);
  const deleteMeasurement = useStore(s => s.deleteMeasurement);
  const updateClient = useStore(s => s.updateClient);
  const { ref, onKeyDown } = useKeyboardForm();
  const scrollRef = useRef(null);

  // The new-weigh-in column: until something is typed it has no measurement
  // (draftId null); then it shows that measurement and keeps its React key so
  // the focused cell is not remounted.
  const [draftId, setDraftId] = useState(null);
  const [draftSeq, setDraftSeq] = useState(0);
  const [draftDate, setDraftDate] = useState(todayISO);
  const focusDraft = useRef(false);

  const draft = draftId ? measurements.find(m => m.id === draftId) : null;
  const columns = [
    ...measurements.filter(m => m.id !== draftId).map(m => ({ key: m.id, m })),
    { key: `draft-${draftSeq}`, m: draft, isDraft: true },
  ];
  const rows = ROWS.filter(r => !r.soloMujer || client.genero !== 'M');

  // Latest weigh-ins are on the right: start scrolled there.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [measurements.length]);

  useEffect(() => {
    if (!focusDraft.current) return;
    focusDraft.current = false;
    ref.current?.querySelector(`[data-grid="seg"][data-row="0"][data-col="${columns.length - 1}"]`)?.focus();
  });

  const commit = (col, key, value) => {
    if (col.m) {
      updateMeasurement(col.m.id, { [key]: value });
    } else if (value != null && value !== '' && value !== false) {
      const created = addMeasurement({ clienteId: client.id, fecha: draftDate, [key]: value });
      setDraftId(created.id);
    }
  };

  const startNewWeighIn = () => {
    setDraftId(null);
    setDraftSeq(n => n + 1);
    setDraftDate(todayISO());
    focusDraft.current = true;
  };

  const handleDelete = async (col) => {
    if (!col.m) return;
    if (!(await confirm(t.measurement_confirm_delete))) return;
    deleteMeasurement(col.m.id);
    if (col.m.id === draftId) setDraftId(null);
    toast.success(t.measurement_deleted);
  };

  const nav = (row, col) => ({
    'data-field': '', 'data-section': 'seg', 'data-grid': 'seg', 'data-row': row, 'data-col': col, 'data-enter': 'down',
  });

  const renderCell = (row, ri, col, ci) => {
    const m = col.m;
    const label = `${t[row.label]} · ${col.isDraft ? t.seg_new : (m?.fecha || '')}`;
    if (row.kind === 'computed') {
      const value = m?.imc ?? calcIMC(m?.peso, client.altura);
      return <span className="block px-2 py-1 text-right tabular-nums text-sage-500">{formatNumber(value, locale, 1)}</span>;
    }
    if (row.kind === 'check') {
      return (
        <div className="flex justify-center py-1">
          <input type="checkbox" aria-label={label} {...nav(ri, ci)} checked={!!m?.regla}
            onChange={e => commit(col, 'regla', e.target.checked)}
            className="w-4 h-4 accent-wellness-400" />
        </div>
      );
    }
    if (row.kind === 'text') {
      return (
        <input type="text" aria-label={label} {...nav(ri, ci)} value={m?.notas || ''}
          onChange={e => commit(col, 'notas', e.target.value)}
          className={`${CELL_CLASS} !text-left min-w-[8rem]`} />
      );
    }
    const suggestion = row.suggest?.(m);
    return (
      <NumberInput
        aria-label={label}
        {...nav(ri, ci)}
        data-select="all"
        value={m?.[row.key]}
        locale={locale}
        placeholder={suggestion != null ? formatNumber(suggestion, locale, 1) : ''}
        title={suggestion != null ? t.seg_suggestion : undefined}
        onCommit={v => commit(col, row.key, v)}
        className={CELL_CLASS}
      />
    );
  };

  let fieldRow = 0;
  return (
    <div className="bg-white border border-sage-200 rounded-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-sage-100">
        <h3 className="text-sm font-semibold text-sage-800">{t.seg_title}</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-sage-600">
            {t.client_height}
            <NumberInput
              value={client.altura}
              locale={locale}
              onCommit={v => updateClient(client.id, { altura: v })}
              className="w-20 px-2 py-1 text-sm text-right tabular-nums border border-sage-300 rounded-button bg-white focus:outline-none focus:border-wellness-400"
            />
          </label>
          <Button size="sm" variant="secondary" icon={Plus} onClick={startNewWeighIn} disabled={!draftId}>{t.seg_new_weigh_in}</Button>
        </div>
      </div>

      <div ref={ref} onKeyDown={onKeyDown}>
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="border-b border-sage-100">
                <th scope="col" className={`${STICKY} text-left text-xs font-medium text-sage-500 px-4 py-2 min-w-[11rem]`}>{t.measurement_date}</th>
                {columns.map((col, ci) => (
                  <th key={col.key} scope="col" className={`px-1 py-1.5 align-bottom ${col.isDraft ? 'bg-wellness-50' : ''}`}>
                    {col.isDraft && <span className="block text-[11px] font-semibold text-wellness-600 text-center mb-0.5">{t.seg_new}</span>}
                    <div className="flex items-center gap-0.5">
                      <input
                        type="date"
                        aria-label={`${t.measurement_date} · ${col.isDraft ? t.seg_new : col.m.fecha}`}
                        {...nav(-1, ci)}
                        value={col.m?.fecha || draftDate}
                        onChange={e => {
                          if (!e.target.value) return;
                          if (col.m) updateMeasurement(col.m.id, { fecha: e.target.value });
                          else setDraftDate(e.target.value);
                        }}
                        className="w-[8.5rem] px-1.5 py-1 text-xs font-medium text-sage-700 bg-transparent border border-transparent rounded-button hover:border-sage-200 focus:outline-none focus:border-wellness-400 focus:bg-white"
                      />
                      {col.m && (
                        <button type="button" onClick={() => handleDelete(col)} aria-label={t.delete} title={t.delete}
                          className="p-1 text-sage-400 hover:text-danger transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                if (row.group) {
                  return (
                    <tr key={row.group}>
                      <th scope="colgroup" colSpan={columns.length + 1} className={`${STICKY} text-left text-xs font-semibold text-sage-600 px-4 pt-3 pb-1`}>
                        {t[row.group]}
                      </th>
                    </tr>
                  );
                }
                const ri = row.kind === 'computed' ? null : fieldRow++;
                return (
                  <tr key={row.key} className="border-b border-sage-50 last:border-0">
                    <th scope="row" className={`${STICKY} text-left text-sm font-normal text-sage-700 px-4 py-0.5 whitespace-nowrap`}>{t[row.label]}</th>
                    {columns.map((col, ci) => (
                      <td key={col.key} className={`px-1 py-0.5 ${col.isDraft ? 'bg-wellness-50' : ''}`}>
                        {renderCell(row, ri, col, ci)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-sage-100">
          <ShortcutsHint items={[
            [['Enter'], t.kb_down],
            [['⇧', 'Enter'], t.kb_up],
            [['Tab'], t.kb_tab_right],
            [['←', '→', '↑', '↓'], t.kb_arrows],
          ]} />
        </div>
      </div>
      {ConfirmDialog}
    </div>
  );
};

export default FollowUpTable;
