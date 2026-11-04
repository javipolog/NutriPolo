import { describe, it, expect } from 'vitest';
import {
  nextInvoiceNumber, issueProblems, issueFields, invoiceParties, correctiveDraft, cancelsInFull,
  billedConsultationIds, issuedInPeriod, periodTotals, incomeBookCsv, isValidIban, formatIban, quarterOf,
} from './invoicing';

const config = { nombre: 'Nutricionista Ejemplo', nif: '00000000T', direccion: 'C/ Mayor 1', iban: 'ES91 2100 0418 4502 0005 1332' };
const client = { id: 'k1', nombre: 'Ana Ejemplo', nif: '11111111H', calle: 'C/ Sol 2', codigoPostal: '03600', ciudad: 'Elda' };
const issued = (over) => ({ id: over.numero, emitidaAt: '2026-01-01T10:00:00Z', estado: 'pendiente', ...over });

describe('numbering', () => {
  it('counts each series and year on its own', () => {
    const invoices = [issued({ numero: 'NP-2026-001' }), issued({ numero: 'NP-2026-002' }), issued({ numero: 'NP-2025-007' }), issued({ numero: 'R-2026-001' })];
    expect(nextInvoiceNumber(invoices, '2026-03-01')).toBe('NP-2026-003');
    expect(nextInvoiceNumber(invoices, '2025-12-31')).toBe('NP-2025-008');
    expect(nextInvoiceNumber(invoices, '2026-03-01', 'R')).toBe('R-2026-002');
    expect(nextInvoiceNumber([], '2027-01-01', 'R')).toBe('R-2027-001');
  });
});

describe('issuing', () => {
  const draft = { id: 'd1', fecha: '2026-03-10', irpfPct: 0, items: [] };

  it('freezes the issuer and client data and takes the next number', () => {
    const fields = issueFields(draft, client, config, [issued({ numero: 'NP-2026-004', fecha: '2026-03-01' })], '2026-03-10T09:00:00Z');
    expect(fields.numero).toBe('NP-2026-005');
    expect(fields.emisor).toMatchObject({ nombre: 'Nutricionista Ejemplo', nif: '00000000T' });
    expect(fields.destinatario).toMatchObject({ nombre: 'Ana Ejemplo', nif: '11111111H', ciudad: 'Elda' });
  });

  it('prints the frozen data even after the records change', () => {
    const inv = { ...draft, ...issueFields(draft, client, config, [], 'now') };
    const parties = invoiceParties(inv, { ...client, calle: 'Otra calle', nombre: 'Ana Cambiada' }, { ...config, direccion: 'Nueva' });
    expect(parties.destinatario.calle).toBe('C/ Sol 2');
    expect(parties.emisor.direccion).toBe('C/ Mayor 1');
    // A draft shows the current data
    expect(invoiceParties(draft, { ...client, calle: 'Otra calle' }, config).destinatario.calle).toBe('Otra calle');
  });

  it('lists what is missing before issuing', () => {
    expect(issueProblems(draft, client, config, [])).toEqual([]);
    expect(issueProblems(draft, client, { ...config, nif: ' ' }, []).map(p => p.code)).toEqual(['issuer_nif']);
    // With IRPF withholding the client is a company or a professional
    expect(issueProblems({ ...draft, irpfPct: 15 }, { nombre: 'Clínica' }, config, []).map(p => p.code))
      .toEqual(['recipient_nif', 'recipient_address']);
  });

  it('does not issue an invoice dated before the last one of its series', () => {
    const last = issued({ numero: 'NP-2026-003', fecha: '2026-03-20' });
    const [problem] = issueProblems(draft, client, config, [last]);
    expect(problem).toMatchObject({ code: 'date_before_last', last: { numero: 'NP-2026-003' } });
    expect(issueProblems({ ...draft, fecha: '2026-03-20' }, client, config, [last])).toEqual([]);
    // Another year is another series
    expect(issueProblems({ ...draft, fecha: '2025-12-30' }, client, config, [last])).toEqual([]);
  });
});

describe('corrective invoices', () => {
  const original = issued({ numero: 'NP-2026-010', fecha: '2026-02-01', clienteId: 'k1', ivaPct: 0, irpfPct: 15, total: 51,
    items: [{ id: 'a', descripcion: 'Consulta', cantidad: 1, precioUnitario: 60, consultationId: 'c1' }] });

  it('starts as a full cancellation of the original', () => {
    let n = 0;
    const draft = correctiveDraft(original, { fecha: '2026-03-01', generateId: () => `x${++n}` });
    expect(draft).toMatchObject({ tipo: 'rectificativa', rectificaA: original.id, rectificaNumero: 'NP-2026-010', irpfPct: 15 });
    expect(draft.items).toEqual([{ id: 'x1', descripcion: 'Consulta', cantidad: 1, precioUnitario: -60, consultationId: null }]);
    expect(issueProblems(draft, client, config, []).map(p => p.code)).toEqual(['corrective_reason']);
    expect(issueProblems({ ...draft, motivoRectificacion: 'Importe erróneo' }, client, config, [])).toEqual([]);
  });

  it('knows when it cancels the original in full', () => {
    expect(cancelsInFull({ total: -51 }, original)).toBe(true);
    expect(cancelsInFull({ total: -20 }, original)).toBe(false);
  });

  it('frees the consultations of a cancelled invoice', () => {
    expect(billedConsultationIds([original])).toEqual(new Set(['c1']));
    expect(billedConsultationIds([{ ...original, estado: 'anulada' }])).toEqual(new Set());
  });
});

describe('income book', () => {
  const invoices = [
    issued({ numero: 'NP-2026-002', fecha: '2026-04-02', estado: 'pagada', fechaCobro: '2026-04-05', baseImponible: 60, ivaPct: 0, ivaImporte: 0, irpfPct: 15, irpfImporte: 9, total: 51,
      destinatario: { nombre: 'Clínica; "Sol"', nif: 'B00000000' } }),
    issued({ numero: 'NP-2026-001', fecha: '2026-01-15', baseImponible: 40, ivaImporte: 0, irpfImporte: 0, total: 40, estado: 'anulada', rectificadaPor: ['r1'] }),
    issued({ numero: 'R-2026-001', tipo: 'rectificativa', rectificaNumero: 'NP-2026-001', fecha: '2026-01-20', baseImponible: -40, ivaImporte: 0, irpfImporte: 0, total: -40 }),
    issued({ numero: 'NP-2025-009', fecha: '2025-12-30', baseImponible: 100, total: 100 }),
    { id: 'draft', fecha: '2026-02-01', baseImponible: 999, total: 999 },
    // Marked "anulada" by hand before corrective invoices existed: not income
    issued({ numero: 'NP-2026-003', fecha: '2026-05-01', baseImponible: 30, total: 30, estado: 'anulada' }),
  ];

  it('takes issued invoices of the period, oldest first', () => {
    expect(issuedInPeriod(invoices, 2026).map(i => i.numero)).toEqual(['NP-2026-001', 'R-2026-001', 'NP-2026-002', 'NP-2026-003']);
    expect(issuedInPeriod(invoices, 2026, 2).map(i => i.numero)).toEqual(['NP-2026-002', 'NP-2026-003']);
    expect(quarterOf('2026-12-31')).toBe(4);
  });

  it('adds up the period, with corrective invoices cancelling the original', () => {
    expect(periodTotals(issuedInPeriod(invoices, 2026))).toEqual({ base: 60, iva: 0, irpf: 9, total: 51, cobrado: 51 });
  });

  it('exports a CSV that opens right in a Spanish Excel', () => {
    const csv = incomeBookCsv(issuedInPeriod(invoices, 2026, 2));
    expect(csv.startsWith('﻿Fecha;Número;Tipo')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('02/04/2026;NP-2026-002;Ordinaria;;"Clínica; ""Sol""";B00000000;60,00;0,00;0,00;15,00;9,00;51,00;Cobrada;05/04/2026;');
    expect(lines.at(-1)).toBe(';;;;TOTAL;;60,00;;0,00;;9,00;51,00;;;');
  });
});

describe('IBAN', () => {
  it('checks the control digits', () => {
    expect(isValidIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
    expect(isValidIban('ES92 2100 0418 4502 0005 1332')).toBe(false);
    expect(isValidIban('1234')).toBe(false);
    expect(formatIban('es9121000418450200051332')).toBe('ES91 2100 0418 4502 0005 1332');
  });
});
