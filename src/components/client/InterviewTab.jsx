import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { TagInput } from '../UI';
import useStore, { formatDate, localISODate } from '../../stores/store';
import { useT, useLocale } from '../../i18n';
import {
  ENTREVISTA_SECTIONS, GUSTOS_GROUPS, GUSTOS_COLUMNS, RUTINA_DAYS,
  normalizeEntrevista, sectionQuestions, answerOf, entrevistaProgress, entrevistaTotals, entrevistaPatch,
} from '../../services/entrevista';
import { edadDesde } from '../../services/energia';
import { useKeyboardForm, focusSection } from '../../hooks/useKeyboardForm';
import { AutoTextarea, FIELD_CLASS, ShortcutsHint } from './fields';

// First-visit interview (Raquel's data-collection sheet), typed straight into
// the client: every keystroke is saved, Enter jumps to the next answer.

const LABEL_CLASS = 'block text-xs font-medium text-sage-600 mb-1';

const Question = ({ question, client, section, onSet }) => {
  const t = useT();
  const id = `ent-${question.key}`;
  const nav = { 'data-field': '', 'data-section': section };
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{t[question.label]}</label>
      {question.kind === 'tags' ? (
        <TagInput
          value={answerOf(client, question)}
          onChange={v => onSet(question.key, v)}
          placeholder={t.ent_tags_placeholder}
          inputProps={{ id, ...nav }}
        />
      ) : (
        <AutoTextarea id={id} {...nav} value={answerOf(client, question)} onChange={v => onSet(question.key, v)} />
      )}
    </div>
  );
};

const SectionCard = ({ section, index, children }) => {
  const t = useT();
  return (
    <section id={`ent-section-${section.id}`} aria-labelledby={`ent-title-${section.id}`} className="bg-white border border-sage-200 rounded-soft p-4 scroll-mt-4">
      <h3 id={`ent-title-${section.id}`} className="text-sm font-semibold text-sage-800 mb-3">
        <span className="text-wellness-500 tabular-nums">{index + 1}.</span> {t[section.label]}
      </h3>
      {children}
    </section>
  );
};

const GustosTable = ({ gustos, onSet }) => {
  const t = useT();
  return (
    <div>
      <p className={LABEL_CLASS}>{t.ent_gustos}</p>
      <table className="w-full text-sm border-separate border-spacing-y-1">
        <thead>
          <tr className="text-xs text-sage-500">
            <th scope="col" className="text-left font-medium w-[34%]"><span className="sr-only">{t.ent_gustos_group}</span></th>
            <th scope="col" className="text-left font-medium px-1 text-success">{t.ent_g_col_si}</th>
            <th scope="col" className="text-left font-medium px-1 text-danger">{t.ent_g_col_no}</th>
          </tr>
        </thead>
        <tbody>
          {GUSTOS_GROUPS.map(([group, key], row) => (
            <tr key={group}>
              <th scope="row" className="text-left align-top pr-2 pt-1.5">
                <span className="block text-sm font-medium text-sage-800">{t[key]}</span>
                <span className="block text-[11px] font-normal text-sage-500 leading-tight">{t[`${key}_hint`]}</span>
              </th>
              {GUSTOS_COLUMNS.map((column, col) => (
                <td key={column} className="align-top px-1">
                  <AutoTextarea
                    aria-label={`${t[key]} · ${t[`ent_g_col_${column}`]}`}
                    data-field="" data-section="alimentacion" data-grid="gustos" data-row={row} data-col={col}
                    value={gustos[group]?.[column] || ''}
                    onChange={v => onSet(`gustos.${group}.${column}`, v)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const RutinaGrid = ({ rutina, ejercicio, onSet }) => {
  const t = useT();
  return (
    <div className="space-y-3">
      <div>
        <p className={LABEL_CLASS}>{t.ent_rutina}</p>
        <div className="grid grid-cols-7 gap-1">
          {RUTINA_DAYS.map((day, col) => (
            <div key={day}>
              <label htmlFor={`ent-rutina-${day}`} className="block text-[11px] font-semibold text-sage-500 text-center mb-0.5">{t[`ent_day_${day}`]}</label>
              <AutoTextarea
                id={`ent-rutina-${day}`}
                data-field="" data-section="diarios" data-grid="rutina" data-row={0} data-col={col}
                value={rutina[day] || ''}
                onChange={v => onSet(`rutina.${day}`, v)}
                className="!px-1.5 !text-xs"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="ent-ejercicio" className={LABEL_CLASS}>{t.ent_q_ejercicio}</label>
        <AutoTextarea id="ent-ejercicio" data-field="" data-section="diarios" value={ejercicio || ''} onChange={v => onSet('ejercicio', v)} />
      </div>
    </div>
  );
};

export const InterviewTab = ({ client }) => {
  const t = useT();
  const locale = useLocale();
  const updateClient = useStore(s => s.updateClient);
  const { ref, onKeyDown } = useKeyboardForm();
  const e = normalizeEntrevista(client.entrevista);
  const progress = entrevistaProgress(client);
  const totals = entrevistaTotals(client);
  const edad = edadDesde(client.fechaNacimiento);
  const direccion = [client.calle, [client.codigoPostal, client.ciudad].filter(Boolean).join(' '), client.provincia].filter(Boolean).join(', ');

  // Build the patch from the store, not from this render's props: two quick
  // keystrokes must not overwrite each other.
  const onSet = (path, value) => {
    const current = useStore.getState().clients.find(c => c.id === client.id);
    if (current) updateClient(client.id, entrevistaPatch(current, path, value));
  };

  const questionsOf = (section) => sectionQuestions(section, client).map(q => (
    <Question key={q.key} question={q} client={client} section={section.id} onSet={onSet} />
  ));
  const [motivo, medico, alimentacion, diarios] = ENTREVISTA_SECTIONS;

  return (
    <div ref={ref} onKeyDown={onKeyDown} className="grid grid-cols-1 lg:grid-cols-[12rem_minmax(0,1fr)] gap-5">
      {/* Index with progress */}
      <nav aria-label={t.ent_index} className="lg:sticky lg:top-4 self-start bg-white border border-sage-200 rounded-soft p-3 space-y-1">
        <p className="text-xs font-semibold text-sage-700 px-1">{t.tab_interview}</p>
        <p className="text-xs text-sage-500 px-1 mb-2 tabular-nums">
          {t.ent_progress.replace('{done}', totals.done).replace('{total}', totals.total)}
        </p>
        {ENTREVISTA_SECTIONS.map((section, i) => {
          const p = progress[i];
          const complete = p.done === p.total;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => focusSection(ref.current, section.id)}
              className="w-full text-left px-2 py-1.5 rounded-button hover:bg-sage-50 transition-colors"
            >
              <span className="flex items-start justify-between gap-2 text-xs text-sage-700">
                <span className="leading-snug">{i + 1}. {t[section.label]}</span>
                {complete
                  ? <CheckCircle2 size={13} className="text-success shrink-0" aria-label={t.ent_section_complete} />
                  : <span className="tabular-nums text-sage-500 shrink-0">{p.done}/{p.total}</span>}
              </span>
              <span className="block h-1 mt-1 rounded-full bg-sage-100 overflow-hidden" aria-hidden="true">
                <span className="block h-full bg-wellness-400" style={{ width: `${(p.done / p.total) * 100}%` }} />
              </span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-5 min-w-0">
        {/* Header: date and the basics already in the profile */}
        <div className="bg-white border border-sage-200 rounded-soft p-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label htmlFor="ent-fecha" className={LABEL_CLASS}>{t.ent_date}</label>
            <input
              id="ent-fecha" type="date" data-field="" data-section="cabecera"
              value={e.fecha || ''}
              onChange={ev => onSet('fecha', ev.target.value)}
              className={`${FIELD_CLASS} w-auto`}
            />
          </div>
          <div className="text-sm">
            <p className="text-xs text-sage-500">{t.ent_age}</p>
            <p className="text-sage-800 tabular-nums">{edad != null ? t.ent_age_years.replace('{n}', edad) : '—'}</p>
          </div>
          <div className="text-sm min-w-0 flex-1">
            <p className="text-xs text-sage-500">{t.ent_address}</p>
            <p className="text-sage-800 truncate">{direccion || '—'}</p>
          </div>
          {e.updatedAt && (
            <p className="text-xs text-sage-500" aria-live="polite">
              {t.ent_saved_at
                .replace('{date}', formatDate(localISODate(new Date(e.updatedAt))))
                .replace('{time}', new Date(e.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <SectionCard section={motivo} index={0}><div className="space-y-3">{questionsOf(motivo)}</div></SectionCard>
          <SectionCard section={medico} index={1}><div className="space-y-3">{questionsOf(medico)}</div></SectionCard>
        </div>

        <SectionCard section={alimentacion} index={2}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="space-y-3">{questionsOf(alimentacion)}</div>
            <GustosTable gustos={e.gustos} onSet={onSet} />
          </div>
        </SectionCard>

        <SectionCard section={diarios} index={3}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="space-y-3">{questionsOf(diarios)}</div>
            <RutinaGrid rutina={e.rutina} ejercicio={client.ejercicio} onSet={onSet} />
          </div>
        </SectionCard>

        <ShortcutsHint items={[
          [['Enter'], t.kb_next],
          [['⇧', 'Enter'], t.kb_prev],
          [['Alt', 'Enter'], t.kb_newline],
          [['Tab'], t.kb_tab],
          [['←', '→', '↑', '↓'], t.kb_arrows],
          [['Ctrl', '↓'], t.kb_next_section],
          [['Ctrl', '↑'], t.kb_prev_section],
          [[','], t.kb_tag],
        ]} />
      </div>
    </div>
  );
};

export default InterviewTab;
