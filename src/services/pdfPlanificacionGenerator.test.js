import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { generatePlanificacionPDF } from './pdfPlanificacionGenerator';
import { samplePlanificacion } from './planificacion.fixture';

const loadFont = async (file) => new Uint8Array(readFileSync(join(process.cwd(), 'public', 'fonts', file)));
const client = { id: 'c1', nombre: 'Ana Ejemplo García' };
const config = { nombre: 'NutriPolo', web: 'nutripolo.com', email: 'hola@nutripolo.com' };

// PLAN_PDF_PRODUCTS=<carpeta d'imatges> i PLAN_PDF_OUT=<fitxer> per revisar el disseny a mà.
function sampleProducts() {
  const dir = process.env.PLAN_PDF_PRODUCTS;
  if (!dir) return [];
  return readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f)).map((f, i) => ({
    id: `pr${i}`,
    nombre: basename(f, extname(f)),
    imagen: `data:image/${/png$/i.test(f) ? 'png' : 'jpeg'};base64,${readFileSync(join(dir, f)).toString('base64')}`,
  }));
}

describe('generatePlanificacionPDF', () => {
  it('builds cover, sections, a landscape menu and recipe links', async () => {
    const products = sampleProducts();
    const plan = { ...samplePlanificacion(), productos: products.map(p => p.id) };
    if (products.length) plan.desayunos.productos = products.slice(0, 3).map(p => p.id);
    const bytes = await generatePlanificacionPDF(plan, client, config, { products, loadFont });
    if (process.env.PLAN_PDF_OUT) writeFileSync(process.env.PLAN_PDF_OUT, bytes);

    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    const sizes = pages.map(p => p.getSize());
    expect(sizes[0].height).toBeGreaterThan(sizes[0].width);
    expect(sizes.some(s => s.width > s.height)).toBe(true);

    const menuPage = pages[sizes.findIndex(s => s.width > s.height)];
    const annots = menuPage.node.Annots();
    // 10 dishes with a recipe; a wrapped title gets one link per line
    expect(annots?.size()).toBeGreaterThanOrEqual(10);
  });

  it('falls back to Helvetica when the fonts cannot be loaded', async () => {
    const bytes = await generatePlanificacionPDF(samplePlanificacion(), client, config, {
      loadFont: async () => { throw new Error('offline'); },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
