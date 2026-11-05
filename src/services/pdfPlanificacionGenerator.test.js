import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { generatePlanificacionPDF, splitQuantity, glueUnits } from './pdfPlanificacionGenerator';
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
// Només el menú porta enllaços
const linkCount = (pages) => pages.reduce((n, p) => n + (p.node.Annots()?.size() || 0), 0);
const menuPages = async (plan) => {
  const withMenu = await load(await generatePlanificacionPDF(plan, client, config, { loadFont }));
  const noMenu = { ...plan, secciones: { ...plan.secciones, menu: false } };
  const without = await load(await generatePlanificacionPDF(noMenu, client, config, { loadFont }));
  return withMenu.pages.length - without.pages.length;
};
const dish = (titulo, alimentos) => ({ titulo, alimentos: alimentos.join('\n'), receta: '' });

describe('generatePlanificacionPDF', () => {
  it('builds cover, sections, a portrait menu and recipe links', async () => {
    const products = sampleProducts();
    const plan = { ...samplePlanificacion(), productos: products.map(p => p.id) };
    if (products.length) plan.desayunos.productos = products.slice(0, 3).map(p => p.id);
    const bytes = await generatePlanificacionPDF(plan, client, config, { products, loadFont });
    if (process.env.PLAN_PDF_OUT) writeFileSync(process.env.PLAN_PDF_OUT, bytes);

    const { pages, sizes } = await load(bytes);
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(sizes.some(isLandscape)).toBe(false);
    // 10 dishes with a recipe; a wrapped title gets one link per line
    expect(linkCount(pages)).toBeGreaterThanOrEqual(10);
  });

  it('splits a very full menu into lunch and dinner pages to keep the text legible', async () => {
    expect(await menuPages(samplePlanificacion())).toBe(2);
  });

  it('keeps a typical week with full ingredient lists on a single page', async () => {
    const plan = samplePlanificacion();
    plan.menu.dias = plan.menu.dias.map(d => ({
      ...d,
      comida: {
        a: dish('Pizza a la sartén con base de avena', ['Harina de avena o avena molida', 'Tomate triturado', 'Queso mozzarella', 'Jamón cocido']),
        b: dish('Cuscús con pollo y verduras', ['Cuscús', 'Contramuslo de pollo', 'Cebolla, zanahoria, pimiento rojo', 'Salsa de soja']),
      },
      cena: {
        a: dish('Lasaña de calabaza', ['Calabaza tipo cacahuete', 'Carne picada', 'Cebolla, tomate triturado natural', 'Mozzarella rallada', 'Nata ligera']),
        b: dish('Poké bowl de salmón', ['Arroz basmati', 'Salmón fresco', 'Pepino', 'Mango', 'Tomates cherry', 'Salsa de soja']),
      },
    }));
    expect(await menuPages(plan)).toBe(1);
  });

  it('splits each meal into two halves of the week when even a meal per page is too long', async () => {
    const plan = samplePlanificacion();
    const long = dish('Plato con muchos ingredientes', Array.from({ length: 11 }, (_, i) => `Ingrediente número ${i + 1}`));
    plan.menu.dias = plan.menu.dias.map(d => ({ ...d, comida: { a: long, b: long }, cena: { a: long, b: long } }));
    expect(await menuPages(plan)).toBe(4);
  });

  it('keeps a light menu on a single page', async () => {
    const plan = samplePlanificacion();
    plan.menu.dias = plan.menu.dias.map(d => ({
      ...d,
      comida: { a: { titulo: 'Ensalada', alimentos: 'Lechuga', receta: '' }, b: { titulo: 'Pasta', alimentos: '', receta: '' } },
      cena: { a: { titulo: 'Tortilla', alimentos: '2 huevos', receta: '' }, b: { titulo: '', alimentos: '', receta: '' } },
    }));
    const { pages } = await load(await generatePlanificacionPDF(plan, client, config, { loadFont }));
    expect(await menuPages(plan)).toBe(1);
    expect(linkCount(pages)).toBe(0);
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

describe('glueUnits', () => {
  it('keeps a number and its unit on the same line', () => {
    expect(glueUnits('Taquitos de jamón (40 g)'.split(' '))).toEqual(['Taquitos', 'de', 'jamón', '(40 g)']);
    expect(glueUnits('150 ml de leche, 72-85 %'.split(' '))).toEqual(['150 ml', 'de', 'leche,', '72-85 %']);
  });

  it('leaves words that only look like units alone', () => {
    expect(glueUnits('2 lonchas de pavo'.split(' '))).toEqual(['2', 'lonchas', 'de', 'pavo']);
  });
});
