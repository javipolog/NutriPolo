import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFPage } from 'pdf-lib';
import { generateInvoicePDF } from './pdfInvoiceGenerator';
import { computeInvoiceTotals } from '../stores/store';

// fetch('/fonts/…') servit des de public/, com fa Vite a l'app
const serveFromPublic = async (url) => {
  const bytes = readFileSync(join(process.cwd(), 'public', url));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

// Every drawText call: { text, x, y, width }
const drawnCalls = async (invoice, client, config) => {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  await generateInvoicePDF(invoice, client, config);
  const calls = spy.mock.calls.map(([text, opts]) => ({
    text: String(text), x: opts.x, y: opts.y, width: opts.font.widthOfTextAtSize(String(text), opts.size),
  }));
  spy.mockRestore();
  return calls;
};
const drawnTexts = async (...args) => (await drawnCalls(...args)).map(c => c.text);

const A4_WIDTH = 595.28;
const FOOTER_TOP = 54;   // px(72): the footer band is drawn over anything below it

const withLines = (n, extra = {}) => {
  const items = Array.from({ length: n }, (_, i) => ({ descripcion: `Sesión de seguimiento ${i + 1}`, cantidad: 1, precioUnitario: 34 }));
  return { numero: 'NP-2026-002', fecha: '2026-11-04', metodoPago: 'transferencia', items, ivaPct: 0, irpfPct: 15, ...computeInvoiceTotals(items, 0, 15), ...extra };
};

const invoice = {
  numero: 'NP-2026-001', fecha: '2026-11-04', estado: 'emitida',
  items: [{ descripcion: 'Consulta de seguimiento', cantidad: 1, precio: 50 }],
  ivaPct: 0, irpfPct: 15, subtotal: 50, iva: 0, irpf: 7.5, total: 42.5,
};
const config = { nombre: 'Nutricionista Ejemplo', nif: '00000000T' };

describe('generateInvoicePDF', () => {
  beforeEach(() => vi.stubGlobal('fetch', serveFromPublic));
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('prints the client NIF stored on the client record', async () => {
    const texts = await drawnTexts(invoice, { id: 'c1', nombre: 'Clínica Ejemplo SL', nif: 'B00000000' }, config);
    expect(texts).toContain('NIF: B00000000');
    expect(texts).toContain('NIF: 00000000T');
  });

  it('still reads the legacy cifNif field', async () => {
    const texts = await drawnTexts(invoice, { id: 'c1', nombre: 'Ejemplo', cifNif: 'X0000000T' }, config);
    expect(texts).toContain('NIF: X0000000T');
  });

  it('omits the client NIF line when there is none', async () => {
    const texts = await drawnTexts(invoice, { id: 'c1', nombre: 'Ejemplo' }, config);
    expect(texts.filter(t => t.startsWith('NIF:'))).toEqual(['NIF: 00000000T']);
  });

  it('never draws the totals under the footer, however many lines', async () => {
    for (let n = 1; n <= 40; n++) {
      const calls = await drawnCalls(withLines(n, { notas: n % 3 ? '' : 'Pago por transferencia antes del día 10. '.repeat(4) }), { nombre: 'Clínica' }, config);
      const total = calls.find(c => c.text === 'TOTAL');
      expect(total.y, `${n} lines`).toBeGreaterThan(FOOTER_TOP);
    }
  }, 30000);

  it('keeps long names and addresses inside the page', async () => {
    const client = {
      nombre: 'Clínica de Fisioterapia y Nutrición Hermanos Fernández-Martínez S.L.P.',
      calle: 'Avenida de la Constitución Española de 1978, número 145, escalera B, 3º izquierda',
      email: 'administracion.facturacion.proveedores@clinicahermanosfernandezmartinez.es',
    };
    const cfg = { ...config, direccion: 'Calle Doctor Fleming esquina con Avenida de Chapí, número 12, bajo' };
    const calls = await drawnCalls(withLines(2), client, cfg);
    for (const c of calls) expect(c.x + c.width, c.text).toBeLessThanOrEqual(A4_WIDTH - 20);
    // The two columns do not overlap: the issuer's address stays left of the client's column
    const issuerAddress = calls.filter(c => /Fleming|Chapí|bajo/.test(c.text));
    for (const c of issuerAddress) expect(c.x + c.width).toBeLessThan(300);
  });

  it('prints the data frozen on issue, not the current records', async () => {
    const issued = { ...invoice, emitidaAt: '2026-11-04T10:00:00Z',
      emisor: { nombre: 'Nombre al emitir', nif: '00000000T', direccion: 'Dirección al emitir' },
      destinatario: { nombre: 'Clienta al emitir', nif: '11111111H', calle: 'Calle al emitir' } };
    const texts = await drawnTexts(issued, { nombre: 'Clienta cambiada', calle: 'Otra calle' }, { ...config, nombre: 'Otro nombre' });
    expect(texts).toEqual(expect.arrayContaining(['Nombre al emitir', 'Clienta al emitir', 'Calle al emitir', 'NIF: 11111111H']));
    expect(texts).not.toContain('Clienta cambiada');
  });

  it('marks a corrective invoice and what it corrects', async () => {
    const corrective = withLines(1, { numero: 'R-2026-001', tipo: 'rectificativa', rectificaNumero: 'NP-2026-001', rectificaFecha: '2026-10-01',
      motivoRectificacion: 'Importe erróneo', items: [{ descripcion: 'Consulta', cantidad: 1, precioUnitario: -40 }], ...computeInvoiceTotals([{ cantidad: 1, precioUnitario: -40 }], 0, 0), irpfPct: 0 });
    const texts = await drawnTexts(corrective, { nombre: 'Ana' }, config);
    expect(texts).toContain('Nº RECTIFICATIVA');
    expect(texts).toContain('Factura rectificativa de NP-2026-001 (01/10/2026).');
    expect(texts).toContain('Motivo: Importe erróneo');
    expect(texts.some(t => /^-40,00\s?€$/.test(t))).toBe(true);
  });

  it('states the VAT exemption, with the wording from Settings if there is one', async () => {
    const texts = await drawnTexts(withLines(1), { nombre: 'Ana' }, config);
    expect(texts.join(' ')).toContain('artículo 20.Uno.3º de la Ley 37/1992');
    const custom = await drawnTexts(withLines(1), { nombre: 'Ana' }, { ...config, textoExencionIva: 'Exento según el art. 20.Uno.3º LIVA.' });
    expect(custom).toContain('Exento según el art. 20.Uno.3º LIVA.');
  });

  it('prints the IBAN for bank transfers', async () => {
    const texts = await drawnTexts(withLines(1), { nombre: 'Ana' }, { ...config, iban: 'ES9121000418450200051332' });
    expect(texts).toContain('ES91 2100 0418 4502 0005 1332');
  });
});
