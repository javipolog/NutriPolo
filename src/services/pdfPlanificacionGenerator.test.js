import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { generatePlanificacionPDF, splitQuantity } from './pdfPlanificacionGenerator';
import { samplePlanificacion } from './planificacion.fixture';

const loadFont = async (file) => new Uint8Array(readFileSync(join(process.cwd(), 'public', 'fonts', file)));
const client = { id: 'c1', nombre: 'Ana Ejemplo García' };
const config = { nombre: 'NutriPolo', web: 'nutripolo.com', email: 'hola@nutripolo.com' };

// JPEG blanc de 2×2, per provar productes sense fitxers externs
const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wgARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAX8f/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';
const fakeProducts = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `Producto ${i + 1}`, imagen: PIXEL }));

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

const load = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  return { pages, sizes: pages.map(p => p.getSize()) };
};
const isLandscape = (s) => s.width > s.height;
const linkCount = (pages, sizes) => pages
  .filter((_, i) => isLandscape(sizes[i]))
  .reduce((n, p) => n + (p.node.Annots()?.size() || 0), 0);

describe('generatePlanificacionPDF', () => {
  it('builds cover, sections, a landscape menu and recipe links', async () => {
    const products = sampleProducts();
    const plan = { ...samplePlanificacion(), productos: products.map(p => p.id) };
    if (products.length) plan.desayunos.productos = products.slice(0, 3).map(p => p.id);
    const bytes = await generatePlanificacionPDF(plan, client, config, { products, loadFont });
    if (process.env.PLAN_PDF_OUT) writeFileSync(process.env.PLAN_PDF_OUT, bytes);

    const { pages, sizes } = await load(bytes);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(isLandscape(sizes[0])).toBe(false);
    expect(sizes.some(isLandscape)).toBe(true);
    // 10 dishes with a recipe; a wrapped title gets one link per line
    expect(linkCount(pages, sizes)).toBeGreaterThanOrEqual(10);
  });

  it('splits a full menu into lunch and dinner pages to keep the text legible', async () => {
    const { sizes } = await load(await generatePlanificacionPDF(samplePlanificacion(), client, config, { loadFont }));
    expect(sizes.filter(isLandscape)).toHaveLength(2);
  });

  it('keeps a light menu on a single page', async () => {
    const plan = samplePlanificacion();
    plan.menu.dias = plan.menu.dias.map(d => ({
      ...d,
      comida: { a: { titulo: 'Ensalada', alimentos: 'Lechuga', receta: '' }, b: { titulo: 'Pasta', alimentos: '', receta: '' } },
      cena: { a: { titulo: 'Tortilla', alimentos: '2 huevos', receta: '' }, b: { titulo: '', alimentos: '', receta: '' } },
    }));
    const { pages, sizes } = await load(await generatePlanificacionPDF(plan, client, config, { loadFont }));
    expect(sizes.filter(isLandscape)).toHaveLength(1);
    expect(linkCount(pages, sizes)).toBe(0);
  });

  it('adds continuation pages for long content and a long patient name', async () => {
    const plan = samplePlanificacion();
    const long = 'Pan de masa madre integral de centeno con semillas de lino, chía y sésamo tostado (60 g)';
    plan.desayunos.opciones = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`, titulo: `Opción con un título bastante largo número ${i + 1}`, nota: i % 2 ? 'Prepáralo la noche anterior ⟶ listo' : '',
      alimentos: [long, 'https://example.com/una/url/larguisima/sin/espacios/que/no/cabe/en/la/linea', 'Fruta (1 pieza)'].join('\n'),
    }));
    const products = fakeProducts(14);
    plan.desayunos.productos = products.map(p => p.id);
    plan.productos = products.map(p => p.id);
    const bytes = await generatePlanificacionPDF(plan, { nombre: 'María de los Ángeles Fernández-Villaverde de la Concepción Rodríguez' }, config, { products, loadFont });
    const { pages } = await load(bytes);
    const short = await load(await generatePlanificacionPDF(samplePlanificacion(), client, config, { loadFont }));
    expect(pages.length).toBeGreaterThan(short.pages.length + 2);
  });

  it('leaves out hidden and empty sections', async () => {
    const plan = { ...samplePlanificacion(), productos: [] };
    plan.secciones = { ...plan.secciones, menu: false, cantidades: false, mediaManana: false, merienda: false };
    const { sizes } = await load(await generatePlanificacionPDF(plan, client, {}, { products: [], loadFont }));
    expect(sizes.some(isLandscape)).toBe(false);
    expect(sizes).toHaveLength(2); // portada + desayunos
  });

  it('falls back to Helvetica when the fonts cannot be loaded', async () => {
    const bytes = await generatePlanificacionPDF(samplePlanificacion(), client, config, {
      loadFont: async () => { throw new Error('offline'); },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

describe('splitQuantity', () => {
  it('takes a short trailing quantity out of the ingredient', () => {
    expect(splitQuantity('Yogur griego natural ligero (170 g)')).toEqual({ name: 'Yogur griego natural ligero', qty: '170 g' });
    expect(splitQuantity('Aguacate (1/4)')).toEqual({ name: 'Aguacate', qty: '1/4' });
    expect(splitQuantity('Jamón serrano (2 lonchas grandes)')).toEqual({ name: 'Jamón serrano', qty: '2 lonchas grandes' });
  });

  it('leaves descriptive parentheses alone', () => {
    for (const s of ['Café con leche (sin azúcar)', 'Pollo, pechuga (plancha)', '1 onza de chocolate negro (72-85 %)', 'Frutos secos (15 g, ej.: nueces)', 'Canela']) {
      expect(splitQuantity(s)).toEqual({ name: s, qty: '' });
    }
  });
});
