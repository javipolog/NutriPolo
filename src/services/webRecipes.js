/**
 * Receptari de la web (WordPress, tipus de contingut `receta`).
 *
 * La llista surt de l'API REST; els ingredients, de l'HTML de cada recepta
 * (són camps ACF que l'API no exposa). Es guarda en memòria cau a
 * `planLibrary.recetasWeb` i només es tornen a baixar les receptes que han
 * canviat (`modified`). Les funcions de parseig són pures i tenen tests.
 */
import { invoke } from '@tauri-apps/api/tauri';
import { dishKey, webRecipeFoods } from './planificacion';

export const RECIPES_SITE = 'https://nutripoloraquel.com';
export const RECIPES_PAGE_URL = `${RECIPES_SITE}/recetario/`;
export const EMPTY_WEB_RECIPES = { items: [], syncedAt: null };
export const WEB_RECIPES_TTL_MS = 6 * 60 * 60 * 1000;

const PER_PAGE = 100;
const listPath = (page) => `/wp-json/wp/v2/receta?per_page=${PER_PAGE}&page=${page}&_embed=wp:featuredmedia&_fields=id,link,title,modified,_links,_embedded`;

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', middot: '·', deg: '°',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', prime: '′',
  iexcl: '¡', iquest: '¿', ordm: 'º', ordf: 'ª', frac12: '½', frac14: '¼', frac34: '¾',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ', ccedil: 'ç',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ', Ccedil: 'Ç',
  agrave: 'à', egrave: 'è', ograve: 'ò',
};

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e] ?? m;
  });
}

const textOf = (html) => decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Camí relatiu d'una URL del receptari, o null si és d'un altre lloc. */
export function recipePath(url) {
  try {
    const u = new URL(url);
    return u.origin === RECIPES_SITE && u.pathname.startsWith('/receta/') ? u.pathname : null;
  } catch {
    return null;
  }
}

/** Resposta de `/wp-json/wp/v2/receta` → receptes bàsiques. */
export function parseRecipeList(json) {
  const rows = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(r => {
      const media = r._embedded?.['wp:featuredmedia']?.[0];
      const sizes = media?.media_details?.sizes || {};
      return {
        id: r.id,
        titulo: textOf(r.title?.rendered),
        url: r.link,
        modified: r.modified || '',
        imagen: sizes.thumbnail?.source_url || sizes.medium?.source_url || media?.source_url || '',
      };
    })
    .filter(r => r.id && r.titulo && recipePath(r.url));
}

/** Text de cada <li> d'un tros d'HTML. */
const listItems = (html) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => textOf(m[1])).filter(Boolean);

/** Bloc d'HTML des de l'encapçalament `name` fins al següent encapçalament. */
function sectionAfter(html, name) {
  const re = new RegExp(`<h[1-6][^>]*>\\s*${name}\\s*:?\\s*</h[1-6]>`, 'i');
  const m = re.exec(html);
  if (!m) return '';
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<h[1-6][^>]*>/i);
  // Les etiquetes (llista d'icones d'Elementor) no són part de la secció
  return (next < 0 ? rest : rest.slice(0, next))
    .replace(/<ul[^>]*elementor-(?:icon-list-items|post-info)[^>]*>[\s\S]*?<\/ul>/gi, '');
}

/** Pàgina d'una recepta → ingredients, minuts, descripció i etiquetes. */
export function parseRecipePage(html) {
  const s = String(html || '');
  const main = s.match(/<main[\s\S]*?<\/main>/i)?.[0] || s;

  const ingBlock = sectionAfter(main, 'Ingredientes');
  let ingredientes = listItems(ingBlock);
  if (!ingredientes.length) {
    ingredientes = [...ingBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .flatMap(m => m[1].split(/<br\s*\/?>/i)).map(textOf).filter(Boolean);
  }
  const preparacion = listItems(sectionAfter(main, 'Preparaci(?:ó|&oacute;|o)n'));

  const h1 = main.search(/<\/h1>/i);
  const head = h1 < 0 ? '' : main.slice(h1, main.search(/<h2[^>]*>/i) >>> 0);
  const minutos = Number(textOf(head).match(/(\d+)\s*[^\d\sa-z]?\s*min/i)?.[1]) || null;
  const descripcion = [...head.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => textOf(m[1])).filter(Boolean).join(' ');

  const tagsRaw = main.match(/elementor-post-info__item--type-custom[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const etiquetas = tagsRaw ? textOf(tagsRaw).split(',').map(x => x.trim()).filter(Boolean) : [];

  return { ingredientes, preparacion, minutos, descripcion, etiquetas };
}

const searchKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Filtra per títol, ingredients o etiquetes (sense accents ni majúscules). Serveix també per a "Mis recetas" (`alimentos`). */
export function filterWebRecipes(items, query) {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter(r => {
    const hay = searchKey([r.titulo, r.alimentos, ...(r.ingredientes || []), ...(r.etiquetas || [])].join(' '));
    return words.every(w => hay.includes(w));
  });
}

/** Cal sincronitzar: mai s'ha fet, és vella o alguna recepta va quedar a mitges. */
export const isStale = (cache, now = Date.now()) => !cache?.syncedAt
  || now - Date.parse(cache.syncedAt) > WEB_RECIPES_TTL_MS
  || (cache.items || []).some(r => isDetailPending(r));

const fetchText = (path) => invoke('recipes_fetch', { path });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Baixa i llegeix la pàgina d'una recepta de la llista. */
export async function fetchWebRecipeDetail(r, { fetch = fetchText } = {}) {
  return { ...r, ...parseRecipePage(await fetch(recipePath(r.url))) };
}

/** Recepta de la llista amb els ingredients encara per baixar (o que va fallar). */
export const isDetailPending = (r) => !r.ingredientes?.length;

/**
 * Sincronitza amb la web. Reaprofita les receptes de `cache` que no han
 * canviat. La web és lenta (~6 s per pàgina), així que `onProgress` rep la
 * llista tan bon punt arriba i després cada recepta que es completa; les
 * pendents tenen `ingredientes: null`. Si una pàgina falla es queda la versió
 * anterior amb el `modified` vell, perquè es torni a provar la propera vegada.
 * @returns {Promise<{ items, syncedAt, failed: number }>}
 */
export async function syncWebRecipes(cache, {
  fetch = fetchText,
  loadDetail = (r) => fetchWebRecipeDetail(r, { fetch }),
  onProgress,
  now = () => new Date(),
} = {}) {
  const list = [];
  for (let page = 1; ; page++) {
    let rows;
    try {
      rows = parseRecipeList(await fetch(listPath(page)));
    } catch (e) {
      // WordPress respon 400 si es demana una pàgina de més
      if (page > 1 && String(e).includes('rest_post_invalid_page_number')) break;
      throw e;
    }
    list.push(...rows);
    if (rows.length < PER_PAGE) break;
  }

  const prev = new Map((cache?.items || []).map(r => [r.id, r]));
  const todo = [];
  const items = list.map((r, i) => {
    const old = prev.get(r.id);
    if (old && !isDetailPending(old) && old.modified === r.modified) return { ...old, ...r };
    todo.push(i);
    return old && !isDetailPending(old) ? { ...old, ...r, modified: old.modified } : { ...r, ingredientes: null };
  });

  let done = 0;
  let failed = 0;
  onProgress?.({ items: [...items], done, total: todo.length });
  // D'una en una: el servidor les atén en sèrie (~6 s cadascuna) i en
  // paral·lel només s'acumulen a la cua fins a esgotar el temps d'espera
  await mapLimit(todo, 1, async (i) => {
    try {
      items[i] = await loadDetail(list[i]);
    } catch {
      failed++;
    }
    done++;
    onProgress?.({ items: [...items], done, total: todo.length });
  });
  return { items, syncedAt: now().toISOString(), failed };
}

/**
 * Plat del menú a partir d'una recepta de la web: els ingredients clau
 * (`summarizeIngredients`) o, si ja se n'havia retocat una versió a
 * "Mis recetas" (mateix enllaç o títol), aquesta.
 */
export function dishFromWebRecipe(r, ownRecipes = []) {
  const own = ownRecipes.find(x => (x.receta && x.receta === r.url) || dishKey(x.titulo) === dishKey(r.titulo));
  return { titulo: r.titulo, alimentos: own?.alimentos || webRecipeFoods(r), receta: r.url };
}
