import { describe, it, expect } from 'vitest';
import { parseDecimal, edadDesde, imc, pesoIdeal, tmb, macros, factorActividad, calcularEnergia } from './energia';

describe('parseDecimal', () => {
  it('accepts a decimal comma or point and rejects text', () => {
    expect(parseDecimal('99,9')).toBe(99.9);
    expect(parseDecimal(' 1.55 ')).toBe(1.55);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal(70)).toBe(70);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('70 kg')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });
});

describe('edadDesde', () => {
  const today = new Date(2026, 9, 29);
  it('counts full years', () => {
    expect(edadDesde('1997-10-29', today)).toBe(29);
    expect(edadDesde('1997-10-30', today)).toBe(28);
    expect(edadDesde('1997-11-01', today)).toBe(28);
  });
  it('returns null without a valid date', () => {
    expect(edadDesde('', today)).toBeNull();
    expect(edadDesde('2030-01-01', today)).toBeNull();
  });
});

describe('IMC and ideal weight', () => {
  it('uses the height in cm', () => {
    expect(imc(80, 200)).toBe(20);
    expect(pesoIdeal(22, 160)).toBeCloseTo(56.32, 2);
    expect(imc(80, null)).toBeNull();
  });
});

describe('tmb', () => {
  it('Harris-Benedict for men and women', () => {
    expect(tmb({ sexo: 'M', peso: 80, tallaCm: 180, edad: 30 })).toBeCloseTo(1864.545, 3);
    expect(tmb({ sexo: 'F', peso: 60, tallaCm: 165, edad: 30 })).toBeCloseTo(1393.8155, 3);
  });
  it('Mifflin-St Jeor for men and women', () => {
    expect(tmb({ sexo: 'M', peso: 80, tallaCm: 180, edad: 30, formula: 'mifflin' })).toBe(1780);
    expect(tmb({ sexo: 'F', peso: 60, tallaCm: 165, edad: 30, formula: 'mifflin' })).toBe(1320.25);
  });
  it('needs every value', () => {
    expect(tmb({ sexo: 'otro', peso: 80, tallaCm: 180, edad: 30 })).toBeNull();
    expect(tmb({ sexo: 'M', peso: 80, tallaCm: 180 })).toBeNull();
  });
});

describe('macros', () => {
  it('splits kcal into kcal and grams (4/4/9)', () => {
    const [hc, prot, lip] = macros(2000);
    expect(hc).toEqual({ key: 'hc', pct: 45, kcal: 900, g: 225 });
    expect(prot).toEqual({ key: 'prot', pct: 25, kcal: 500, g: 125 });
    expect(lip.kcal).toBe(600);
    expect(lip.g).toBeCloseTo(66.67, 2);
  });
  it('leaves empty columns empty', () => {
    expect(macros(null)[0]).toEqual({ key: 'hc', pct: 45, kcal: null, g: null });
  });
});

describe('calcularEnergia', () => {
  const client = { genero: 'M', fechaNacimiento: '1996-01-01', altura: 180, nivelActividad: 'moderado' };
  const last = { peso: 80, tasaMetabolica: 1900 };

  it('takes the profile and the last weigh-in by default', () => {
    const r = calcularEnergia(client, last);
    expect(r.inputs).toEqual({ sexo: 'M', edad: r.derived.edad, talla: 180, peso: 80 });
    expect(r.fa).toBe(factorActividad('moderado'));
    expect(r.fe).toBe(1);
    expect(r.need).toBeCloseTo(r.tmb * 1.55, 6);
    expect(r.columnas[0].kcal).toBe(r.need);
    expect(r.pctTotal).toBe(100);
  });

  it('applies the overrides typed in the card', () => {
    const r = calcularEnergia({
      ...client,
      energia: { sexo: 'F', edad: '30', peso: '60', talla: '165', formula: 'mifflin', fa: '1,2', fe: '1,1', imcIdeal: '22', objetivos: ['2000', ''], macros: { hc: '50' } },
    }, last);
    expect(r.tmb).toBe(1320.25);
    expect(r.need).toBeCloseTo(1320.25 * 1.2 * 1.1, 6);
    expect(r.pesoIdeal).toBeCloseTo(59.895, 3);
    expect(r.columnas[1].macros[0].kcal).toBe(1000);
    expect(r.columnas[2].kcal).toBeNull();
    expect(r.pctTotal).toBe(105);
  });

  it('can use the scale basal metabolic rate', () => {
    const r = calcularEnergia({ ...client, energia: { formula: 'bascula' } }, last);
    expect(r.tmb).toBe(1900);
    expect(r.tmbBascula).toBe(1900);
  });

  it('works with no weigh-in', () => {
    const r = calcularEnergia({ genero: 'otro' }, undefined);
    expect(r.tmb).toBeNull();
    expect(r.need).toBeNull();
    expect(r.fa).toBe(1.2);
  });
});
