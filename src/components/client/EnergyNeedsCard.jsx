import React from 'react';
import { AlertTriangle } from 'lucide-react';
import useStore from '../../stores/store';
import { useT, useLocale } from '../../i18n';
import { ACTIVITY_LEVELS, optionLabel } from '../../clientOptions';
import { calcularEnergia, FACTORES_ACTIVIDAD, MACROS } from '../../services/energia';
import { useKeyboardForm } from '../../hooks/useKeyboardForm';
import { FIELD_CLASS, formatNumber } from './fields';

// Daily energy needs (the "Necesidades energéticas" sheet): BMR → NEED and
// the macro split for NEED and two target kcal. Values are stored as typed in
// client.energia; empty fields fall back to the profile and the last weigh-in.

const LABEL_CLASS = 'block text-xs text-sage-500 mb-1';
// Placeholders show the value taken from the profile: lighter than typed values
const NUM_CLASS = `${FIELD_CLASS} text-right tabular-nums !placeholder-sage-400`;

const Field = ({ id, label, children }) => (
  <div>
    <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
    {children}
  </div>
);

const Result = ({ label, value, unit, strong }) => (
  <div>
    <p className="text-xs text-sage-500 mb-1">{label}</p>
    <p className={`tabular-nums ${strong ? 'text-xl font-semibold text-wellness-600' : 'text-base font-medium text-sage-800'}`}>
      {value || '—'}{value && unit ? <span className="text-xs font-normal text-sage-500"> {unit}</span> : null}
    </p>
  </div>
);

export const EnergyNeedsCard = ({ client, lastMeasurement }) => {
  const t = useT();
  const locale = useLocale();
  const updateClient = useStore(s => s.updateClient);
  const { ref, onKeyDown } = useKeyboardForm();
  const cfg = client.energia || {};
  const r = calcularEnergia(client, lastMeasurement);
  const fmt = (v, digits = 0) => formatNumber(v, locale, digits);

  const set = (path, value) => {
    const current = useStore.getState().clients.find(c => c.id === client.id);
    const e = current?.energia || {};
    const [head, sub] = path.split('.');
    let next;
    if (sub == null) next = { ...e, [head]: value };
    else if (head === 'objetivos') {
      const list = Array.isArray(e.objetivos) ? [...e.objetivos] : [];
      list[Number(sub)] = value;
      next = { ...e, objetivos: list };
    } else next = { ...e, [head]: { ...e[head], [sub]: value } };
    updateClient(client.id, { energia: next });
  };

  const text = (path) => {
    const [head, sub] = path.split('.');
    const v = sub == null ? cfg[head] : cfg[head]?.[sub];
    return v ?? '';
  };
  const nav = { 'data-field': '', 'data-section': 'energia' };
  const numberField = (id, path, placeholder) => (
    <input
      id={id} type="text" inputMode="decimal" autoComplete="off" {...nav}
      value={text(path)} placeholder={placeholder}
      onChange={e => set(path, e.target.value)}
      className={NUM_CLASS}
    />
  );

  const sexLabel = { M: t.client_gender_m, F: t.client_gender_f };
  const pctOk = Math.abs(r.pctTotal - 100) < 0.05;
  const faLevel = FACTORES_ACTIVIDAD.find(([, f]) => f === r.fa)?.[0];
  const columns = [
    { label: 'NEED', kcal: r.columnas[0].kcal, editable: false },
    { label: `${t.en_target} 1`, path: 'objetivos.0', kcal: r.columnas[1].kcal, editable: true },
    { label: `${t.en_target} 2`, path: 'objetivos.1', kcal: r.columnas[2].kcal, editable: true },
  ];

  return (
    <div ref={ref} onKeyDown={onKeyDown} className="bg-white border border-sage-200 rounded-soft">
      <div className="px-4 py-3 border-b border-sage-100">
        <h3 className="text-sm font-semibold text-sage-800">{t.en_title}</h3>
        <p className="text-xs text-sage-500 mt-0.5">{t.en_hint}</p>
      </div>

      <div className="p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        {/* Data and energy expenditure */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field id="en-sexo" label={t.en_sex}>
              <select id="en-sexo" {...nav} value={cfg.sexo || r.derived.sexo || ''} onChange={e => set('sexo', e.target.value)} className={FIELD_CLASS}>
                <option value="" disabled>—</option>
                <option value="F">{sexLabel.F}</option>
                <option value="M">{sexLabel.M}</option>
              </select>
            </Field>
            <Field id="en-edad" label={t.en_age}>{numberField('en-edad', 'edad', fmt(r.derived.edad))}</Field>
            <Field id="en-talla" label={t.en_height}>{numberField('en-talla', 'talla', fmt(r.derived.talla, 1))}</Field>
            <Field id="en-peso" label={t.en_weight}>{numberField('en-peso', 'peso', fmt(r.derived.peso, 1))}</Field>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <Result label={t.measurement_bmi} value={fmt(r.imc, 1)} />
            <Field id="en-imc-ideal" label={t.en_bmi_ideal}>{numberField('en-imc-ideal', 'imcIdeal', '')}</Field>
            <Result label={t.en_weight_ideal} value={fmt(r.pesoIdeal, 1)} unit="kg" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end pt-3 border-t border-sage-100">
            <Field id="en-formula" label={t.en_formula}>
              <select id="en-formula" {...nav} value={r.formula} onChange={e => set('formula', e.target.value)} className={FIELD_CLASS}>
                <option value="harris">Harris-Benedict</option>
                <option value="mifflin">Mifflin-St Jeor</option>
                <option value="bascula" disabled={r.tmbBascula == null}>{t.en_formula_scale}</option>
              </select>
            </Field>
            <Result label={t.en_bmr} value={fmt(r.tmb)} unit="kcal" />
            <Field id="en-fa" label={t.en_fa}>
              <input
                id="en-fa" type="text" inputMode="decimal" autoComplete="off" list="en-fa-options" {...nav}
                value={text('fa')} placeholder={fmt(r.fa, 3)}
                onChange={e => set('fa', e.target.value)}
                title={faLevel ? optionLabel(ACTIVITY_LEVELS, t, faLevel) : undefined}
                className={NUM_CLASS}
              />
              <datalist id="en-fa-options">
                {FACTORES_ACTIVIDAD.map(([level, f]) => (
                  <option key={level} value={fmt(f, 3)}>{optionLabel(ACTIVITY_LEVELS, t, level)}</option>
                ))}
              </datalist>
            </Field>
            <Field id="en-fe" label={t.en_fe}>{numberField('en-fe', 'fe', '1')}</Field>
          </div>
          {r.tmbBascula != null && r.formula !== 'bascula' && (
            <p className="text-xs text-sage-500">{t.en_scale_bmr.replace('{kcal}', fmt(r.tmbBascula))}</p>
          )}

          <div className="rounded-soft bg-wellness-50 px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-sage-700">{t.en_need}</span>
            <span className="text-xl font-semibold text-wellness-600 tabular-nums">
              {r.need ? `${fmt(r.need)} kcal` : '—'}
            </span>
          </div>
          {r.need == null && <p className="text-xs text-sage-500">{t.en_missing}</p>}
        </div>

        {/* Macro split */}
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-sage-500">
                <th scope="col" className="text-left font-medium pb-2">{t.en_macros}</th>
                <th scope="col" className="text-right font-medium pb-2 px-1 w-16">%</th>
                {columns.map((col, i) => (
                  <th key={col.label} scope="colgroup" colSpan={2} className="text-right font-medium pb-2 pl-4 pr-1 border-l border-sage-100 min-w-[8.5rem]">
                    <span className="block">{col.label}</span>
                    {col.editable ? (
                      <input
                        type="text" inputMode="decimal" autoComplete="off" {...nav}
                        aria-label={`${col.label} (kcal)`}
                        value={text(col.path)} placeholder="kcal"
                        onChange={e => set(col.path, e.target.value)}
                        className={`${NUM_CLASS} mt-1 w-24 ml-auto`}
                      />
                    ) : (
                      <span className="block mt-1 py-1.5 text-sage-800 font-semibold tabular-nums">{columns[i].kcal ? fmt(columns[i].kcal) : '—'}</span>
                    )}
                  </th>
                ))}
              </tr>
              <tr className="text-[11px] text-sage-500 border-b border-sage-100">
                <th colSpan={2} />
                {columns.map(col => (
                  <React.Fragment key={col.label}>
                    <th scope="col" className="text-right font-normal pl-4 pr-1 pb-1 border-l border-sage-100">kcal</th>
                    <th scope="col" className="text-right font-normal px-1 pb-1">{t.en_g_day}</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {MACROS.map(([key], row) => (
                <tr key={key} className="border-b border-sage-50">
                  <th scope="row" className="text-left font-normal text-sage-700 py-1">{t[`en_macro_${key}`]}</th>
                  <td className="px-1 py-1">
                    <input
                      type="text" inputMode="decimal" autoComplete="off" {...nav}
                      data-grid="macros" data-row={row} data-col={0}
                      aria-label={`${t[`en_macro_${key}`]} (%)`}
                      value={text(`macros.${key}`)} placeholder={fmt(r.pct[key])}
                      onChange={e => set(`macros.${key}`, e.target.value)}
                      className={`${NUM_CLASS} w-16`}
                    />
                  </td>
                  {r.columnas.map((c, ci) => (
                    <React.Fragment key={ci}>
                      <td className="text-right tabular-nums pl-4 pr-1 text-sage-700 border-l border-sage-100">{fmt(c.macros[row].kcal)}</td>
                      <td className="text-right tabular-nums px-1 font-medium text-sage-900">{fmt(c.macros[row].g)}</td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="text-left font-medium text-sage-700 pt-2">{t.en_total}</th>
                <td className={`text-right tabular-nums px-1 pt-2 font-medium ${pctOk ? 'text-sage-700' : 'text-danger'}`}>
                  {fmt(r.pctTotal, 1)}%
                </td>
                {r.columnas.map((c, ci) => (
                  <React.Fragment key={ci}>
                    <td className="text-right tabular-nums pl-4 pr-1 pt-2 text-sage-700 border-l border-sage-100">{fmt(c.kcal)}</td>
                    <td />
                  </React.Fragment>
                ))}
              </tr>
            </tbody>
          </table>
          {!pctOk && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle size={12} aria-hidden="true" /> {t.en_pct_warning}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnergyNeedsCard;
