import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFPage } from 'pdf-lib';
import { generateInvoicePDF } from './pdfInvoiceGenerator';

// fetch('/fonts/…') servit des de public/, com fa Vite a l'app
const serveFromPublic = async (url) => {
  const bytes = readFileSync(join(process.cwd(), 'public', url));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const drawnTexts = async (invoice, client, config) => {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  await generateInvoicePDF(invoice, client, config);
  return spy.mock.calls.map(([text]) => String(text));
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
});
