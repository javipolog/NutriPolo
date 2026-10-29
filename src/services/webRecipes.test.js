import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({ invoke: vi.fn() }));

const {
  decodeEntities, recipePath, parseRecipeList, parseRecipePage, filterWebRecipes,
  isStale, isDetailPending, syncWebRecipes, dishFromWebRecipe, WEB_RECIPES_TTL_MS,
} = await import('./webRecipes');

// Extracte real (simplificat) d'una recepta de nutripoloraquel.com
const PAGE = `<html><body><header><h2>Menú</h2></header>
<main id="content"><div data-elementor-type="single-post">
<div class="elementor-widget-heading"><h1 class="elementor-heading-title">Huevos rotos con coliflor</h1></div>
<div class="elementor-widget-text-editor">
15&#8242; min</div>
<div class="elementor-widget-text-editor"><p>Una manera original de incluir m&aacute;s coliflor.</p><p>Ideal para una cena.</p></div>
<div class="elementor-widget-heading"><h2 class="elementor-heading-title">Ingredientes</h2></div>
<div class="elementor-widget-text-editor"><ul><li>150g migas de coliflor</li><li>2 huevos</li><li>1 loncha de jam&oacute;n</li></ul></div>
<div class="elementor-widget-heading"><h2 class="elementor-heading-title">Preparación</h2></div>
<div class="elementor-widget-text-editor"><ol><li>Precalienta una sartén.</li><li>Emplata.</li></ol></div>
<ul class="elementor-post-info"><li><span class="elementor-icon-list-text elementor-post-info__item elementor-post-info__item--type-custom">
Sin gluten, Sin lactosa					</span></li></ul>
<h2>¿Aún con hambre? Más por aquí</h2>
</div></main></body></html>`;

const row = (id, over = {}) => ({
  id,
  link: `https://nutripoloraquel.com/receta/receta-${id}/`,
  title: { rendered: `Receta ${id}` },
  modified: '2026-10-01T10:00:00',
  _embedded: { 'wp:featuredmedia': [{ source_url: 'https://nutripoloraquel.com/full.jpg', media_details: { sizes: { thumbnail: { source_url: `https://nutripoloraquel.com/${id}-150x150.jpg` } } } }] },
  ...over,
});

describe('decodeEntities', () => {
  it('decodes numeric, hex and common named entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &#8242; &#x2019;&nbsp;&quot;x&quot; jam&oacute;n &Ntilde; &frac12; &bogus;')).toBe('Tom & Jerry ′ ’ "x" jamón Ñ ½ &bogus;');
  });
});

describe('recipePath', () => {
  it('accepts only recipe pages of the website', () => {
    expect(recipePath('https://nutripoloraquel.com/receta/tacos/')).toBe('/receta/tacos/');
    expect(recipePath('https://evil.example/receta/tacos/')).toBeNull();
    expect(recipePath('https://nutripoloraquel.com/contacto/')).toBeNull();
    expect(recipePath('nope')).toBeNull();
  });
});

describe('parseRecipeList', () => {
  it('maps the REST rows and keeps the thumbnail', () => {
    const [r] = parseRecipeList(JSON.stringify([row(7, { title: { rendered: 'Pasta &#038; salm&oacute;n' } })]));
    expect(r).toEqual({
      id: 7,
      titulo: 'Pasta & salmón',
      url: 'https://nutripoloraquel.com/receta/receta-7/',
      modified: '2026-10-01T10:00:00',
      imagen: 'https://nutripoloraquel.com/7-150x150.jpg',
    });
  });

  it('drops rows without title or pointing elsewhere', () => {
    expect(parseRecipeList([row(1, { title: { rendered: '' } }), row(2, { link: 'https://otra.web/receta/x/' })])).toEqual([]);
    expect(parseRecipeList({ code: 'error' })).toEqual([]);
  });
});

describe('parseRecipePage', () => {
  it('reads ingredients, steps, minutes, description and tags', () => {
    expect(parseRecipePage(PAGE)).toEqual({
      ingredientes: ['150g migas de coliflor', '2 huevos', '1 loncha de jamón'],
      preparacion: ['Precalienta una sartén.', 'Emplata.'],
      minutos: 15,
      descripcion: 'Una manera original de incluir más coliflor. Ideal para una cena.',
      etiquetas: ['Sin gluten', 'Sin lactosa'],
    });
  });

  it('accepts other quote marks before "min" and paragraph ingredients', () => {
    const html = '<main><h1>X</h1><div>160 &#8216; min</div><h2>Ingredientes:</h2><p>Arroz<br>Pollo</p><h2>Preparación</h2></main>';
    const p = parseRecipePage(html);
    expect(p.minutos).toBe(160);
    expect(p.ingredientes).toEqual(['Arroz', 'Pollo']);
  });

  it('returns empty data for an unknown layout', () => {
    expect(parseRecipePage('<main><p>Hola</p></main>')).toEqual({ ingredientes: [], preparacion: [], minutos: null, descripcion: '', etiquetas: [] });
  });
});

describe('filterWebRecipes', () => {
  const items = [
    { titulo: 'Tortitas de avena', ingredientes: ['1 huevo'], etiquetas: ['Sin gluten'] },
    { titulo: 'Salmón al horno', ingredientes: ['1 lomo salmón'], etiquetas: [] },
  ];
  it('matches every word in title, ingredients or tags, ignoring accents', () => {
    expect(filterWebRecipes(items, 'SALMON')).toEqual([items[1]]);
    expect(filterWebRecipes(items, 'huevo gluten')).toEqual([items[0]]);
    expect(filterWebRecipes(items, '  ')).toBe(items);
  });
});

describe('isStale', () => {
  it('is stale without a sync or after the TTL', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(isStale(null, now)).toBe(true);
    expect(isStale({ syncedAt: new Date(now - 1000).toISOString() }, now)).toBe(false);
    expect(isStale({ syncedAt: new Date(now - WEB_RECIPES_TTL_MS - 1).toISOString() }, now)).toBe(true);
  });

  it('is stale while some recipe has no ingredients yet', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    const syncedAt = new Date(now - 1000).toISOString();
    expect(isStale({ syncedAt, items: [{ ingredientes: ['x'] }, { ingredientes: [] }] }, now)).toBe(true);
    expect(isStale({ syncedAt, items: [{ ingredientes: ['x'] }] }, now)).toBe(false);
  });
});

describe('syncWebRecipes', () => {
  const now = () => new Date('2026-10-29T12:00:00Z');

  it('downloads the list and only the pages that changed', async () => {
    const cached = { items: [{ id: 1, titulo: 'Receta 1', modified: '2026-10-01T10:00:00', ingredientes: ['viejo'] }] };
    const fetch = vi.fn(async (path) => (path.startsWith('/wp-json') ? JSON.stringify([row(1), row(2)]) : PAGE));
    const res = await syncWebRecipes(cached, { fetch, now });
    expect(fetch.mock.calls.map(c => c[0])).toEqual([expect.stringContaining('page=1'), '/receta/receta-2/']);
    expect(res.items.map(r => r.ingredientes[0])).toEqual(['viejo', '150g migas de coliflor']);
    expect(res.items[1]).toMatchObject({ id: 2, minutos: 15, imagen: 'https://nutripoloraquel.com/2-150x150.jpg' });
    expect(res).toMatchObject({ syncedAt: '2026-10-29T12:00:00.000Z', failed: 0 });
  });

  it('keeps the cached version when a page fails, so it is retried next time', async () => {
    const cached = { items: [{ id: 1, titulo: 'Receta 1', modified: '2026-09-01T00:00:00', ingredientes: ['viejo'] }] };
    const fetch = vi.fn(async (path) => {
      if (path.startsWith('/wp-json')) return JSON.stringify([row(1), row(2)]);
      throw new Error('recipes_network_error');
    });
    const res = await syncWebRecipes(cached, { fetch, now });
    expect(res.failed).toBe(2);
    expect(res.items[0]).toMatchObject({ ingredientes: ['viejo'], modified: '2026-09-01T00:00:00' });
    expect(res.items[1]).toMatchObject({ id: 2, ingredientes: null, modified: '2026-10-01T10:00:00' });
    expect(isDetailPending(res.items[1])).toBe(true);
  });

  it('reports the list first and then each finished recipe', async () => {
    const fetch = async () => JSON.stringify([row(1), row(2)]);
    const loadDetail = vi.fn(async (r) => ({ ...r, ingredientes: [`ing ${r.id}`] }));
    const steps = [];
    await syncWebRecipes(null, { fetch, loadDetail, now, onProgress: (p) => steps.push(p) });
    expect(steps[0]).toMatchObject({ done: 0, total: 2 });
    expect(steps[0].items.map(r => r.ingredientes)).toEqual([null, null]);
    expect(steps.at(-1)).toMatchObject({ done: 2, total: 2 });
    expect(steps.at(-1).items.map(r => r.ingredientes)).toEqual([['ing 1'], ['ing 2']]);
  });

  it('refetches recipes left pending by an interrupted sync', async () => {
    const cached = { items: [{ ...row(1), ingredientes: null }] };
    const loadDetail = vi.fn(async (r) => ({ ...r, ingredientes: ['x'] }));
    await syncWebRecipes(cached, { fetch: async () => JSON.stringify([row(1)]), loadDetail, now });
    expect(loadDetail).toHaveBeenCalledTimes(1);
  });

  it('follows pagination and stops at WordPress "page out of range"', async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const fetch = vi.fn(async (path) => {
      if (path.includes('page=1&')) return JSON.stringify(full);
      if (path.includes('page=2&')) throw 'recipes_http_400: {"code":"rest_post_invalid_page_number"}';
      return PAGE;
    });
    const res = await syncWebRecipes(null, { fetch, now });
    expect(res.items).toHaveLength(100);
  });

  it('fails when the list cannot be downloaded', async () => {
    await expect(syncWebRecipes(null, { fetch: async () => { throw new Error('offline'); }, now })).rejects.toThrow('offline');
  });
});

describe('dishFromWebRecipe', () => {
  it('builds a menu dish linked to the recipe', () => {
    expect(dishFromWebRecipe({ titulo: 'Tacos', ingredientes: ['Maíz', 'Pollo'], url: 'https://nutripoloraquel.com/receta/tacos/' }))
      .toEqual({ titulo: 'Tacos', alimentos: 'Maíz\nPollo', receta: 'https://nutripoloraquel.com/receta/tacos/' });
  });
});
