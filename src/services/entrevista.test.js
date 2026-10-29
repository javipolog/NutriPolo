import { describe, it, expect } from 'vitest';
import {
  ENTREVISTA_SECTIONS, GUSTOS_GROUPS, normalizeEntrevista, sectionQuestions, answerOf,
  entrevistaProgress, entrevistaTotals, entrevistaPatch,
} from './entrevista';

const NOW = new Date(2026, 9, 29, 10, 30);
const section = (id) => ENTREVISTA_SECTIONS.find(s => s.id === id);

describe('normalizeEntrevista', () => {
  it('always returns the nested objects', () => {
    expect(normalizeEntrevista(undefined)).toEqual({ gustos: {}, rutina: {} });
    expect(normalizeEntrevista({ motivo: 'x', gustos: null })).toEqual({ motivo: 'x', gustos: {}, rutina: {} });
  });
});

describe('questions per client', () => {
  it('hides pregnancy questions for men only', () => {
    const keys = (c) => sectionQuestions(section('motivo'), c).map(q => q.key);
    expect(keys({ genero: 'M' })).not.toContain('embarazos');
    expect(keys({ genero: 'F' })).toContain('embarazos');
    expect(keys({})).toContain('anticonceptivos');
  });

  it('reads profile fields from the client and the rest from the interview', () => {
    const client = { medicacion: 'Metformina', alergias: ['Kiwi'], entrevista: { motivo: 'Perder peso' } };
    const q = (key) => ENTREVISTA_SECTIONS.flatMap(s => s.questions).find(x => x.key === key);
    expect(answerOf(client, q('medicacion'))).toBe('Metformina');
    expect(answerOf(client, q('alergias'))).toEqual(['Kiwi']);
    expect(answerOf(client, q('motivo'))).toBe('Perder peso');
    expect(answerOf({}, q('intolerancias'))).toEqual([]);
  });
});

describe('entrevistaProgress', () => {
  it('counts answered questions, food-group rows and the exercise routine', () => {
    const client = {
      genero: 'M',
      patologias: ['Diabetes'],
      ejercicio: '',
      entrevista: {
        motivo: 'Perder peso', pesoHabitual: '  ',
        gustos: { fruta: { si: 'Todas' }, carne: { no: 'Cerdo' }, pescado: { si: '' } },
        rutina: { lun: 'Gimnasio' },
      },
    };
    const byId = Object.fromEntries(entrevistaProgress(client).map(p => [p.id, p]));
    expect(byId.motivo).toEqual({ id: 'motivo', done: 1, total: 5 });
    expect(byId.medico.done).toBe(1);
    expect(byId.alimentacion).toEqual({ id: 'alimentacion', done: 2, total: 10 + GUSTOS_GROUPS.length });
    expect(byId.diarios).toEqual({ id: 'diarios', done: 1, total: 7 });
  });

  it('adds up every section', () => {
    expect(entrevistaTotals({ genero: 'F' }).done).toBe(0);
    expect(entrevistaTotals({ genero: 'F' }).total).toBe(7 + 7 + 10 + GUSTOS_GROUPS.length + 7);
  });
});

describe('entrevistaPatch', () => {
  it('stores an answer and dates the interview on the first one', () => {
    const patch = entrevistaPatch({}, 'motivo', 'Perder peso', NOW);
    expect(patch).toEqual({ entrevista: { gustos: {}, rutina: {}, motivo: 'Perder peso', fecha: '2026-10-29', updatedAt: NOW.toISOString() } });
  });

  it('keeps the original interview date', () => {
    const patch = entrevistaPatch({ entrevista: { fecha: '2026-01-10' } }, 'cena', 'Pescado', NOW);
    expect(patch.entrevista.fecha).toBe('2026-01-10');
  });

  it('writes profile fields on the client, not in the interview', () => {
    const patch = entrevistaPatch({ entrevista: { motivo: 'x' } }, 'alergias', ['Kiwi'], NOW);
    expect(patch.alergias).toEqual(['Kiwi']);
    expect(patch.entrevista.alergias).toBeUndefined();
    expect(patch.entrevista.motivo).toBe('x');
    expect(entrevistaPatch({}, 'ejercicio', 'Gimnasio', NOW).ejercicio).toBe('Gimnasio');
  });

  it('writes nested paths without losing siblings', () => {
    const client = { entrevista: { gustos: { fruta: { si: 'Mango' }, carne: { no: 'Cerdo' } }, rutina: { lun: 'Andar' } } };
    const patch = entrevistaPatch(client, 'gustos.fruta.no', 'Higos', NOW);
    expect(patch.entrevista.gustos).toEqual({ fruta: { si: 'Mango', no: 'Higos' }, carne: { no: 'Cerdo' } });
    expect(entrevistaPatch(client, 'rutina.mar', 'Gimnasio', NOW).entrevista.rutina).toEqual({ lun: 'Andar', mar: 'Gimnasio' });
    expect(client.entrevista.gustos.fruta).toEqual({ si: 'Mango' });
  });

  it('lets the interview date be changed', () => {
    expect(entrevistaPatch({ entrevista: { fecha: '2026-01-10' } }, 'fecha', '2026-02-01', NOW).entrevista.fecha).toBe('2026-02-01');
  });
});
