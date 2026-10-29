// Builds the food catalog from Mercadona's online shop (Hacendado products plus
// unbranded fresh food) and fills in nutrition facts from Open Food Facts by EAN.
//
// What goes in is the hand-picked list in basics.json; --selection imports whole
// shop subcategories instead (selection.json: subcategories + words to leave out).
//
// Usage:
//   node scripts/catalog/import-mercadona.mjs
//   node scripts/catalog/import-mercadona.mjs --selection
//   node scripts/catalog/import-mercadona.mjs --subcategories 118,121   # like --selection, these only
//   node scripts/catalog/import-mercadona.mjs --list           # every food subcategory with its id
//   node scripts/catalog/import-mercadona.mjs --all-brands     # other brands too
//   node scripts/catalog/import-mercadona.mjs --all-formats    # every pack size, not just one
//
// Output: public/catalog/foods.json and the product photos in public/catalog/images/,
// served by Vite and bundled with the app (the Foods view reads them from /catalog/).
// Every response is cached in .cache/ so re-runs don't hit the APIs again.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, '..', '..', 'public', 'catalog');

const MERCADONA_API = 'https://tienda.mercadona.es/api';
const MERCADONA_PARAMS = 'lang=es&wh=vlc1';
const OFF_API = 'https://world.openfoodfacts.org/api/v2/product';
const USER_AGENT = 'NutriPoloCatalogImporter/0.1 (+https://github.com/javipolog/NutriPolo)';

// Top-level categories that aren't food
const NON_FOOD_CATEGORIES = new Set([19, 20, 21, 22, 23, 24, 25, 26]); // drinks w/ alcohol, hygiene, make-up, pharmacy, baby, pets, cleaning
const HOUSE_BRAND = 'Hacendado';
const MERCADONA_DELAY_MS = 300;
const OFF_DELAY_MS = 700; // OFF allows 100 product reads per minute
const MAX_ATTEMPTS = 5;
const RETRY_BASE_S = 30;

const BEDCA_API = 'https://www.bedca.net/bdpub/procquery.php';
const BEDCA_DELAY_MS = 400;
// BEDCA component codes (EuroFIR names); values are per 100 g of edible portion
const BEDCA_COMPONENTS = {
  proteinas: 'PROT',
  hidratos: 'CHO',
  azucares: 'SUGAR',
  grasas: 'FAT',
  grasasSaturadas: 'FASAT',
  fibra: 'FIBT',
};

const OFF_FIELDS = ['product_name', 'brands', 'nutriments', 'nutrition_data_per', 'code'].join(',');
const NUTRIENTS = {
  kcal: 'energy-kcal_100g',
  proteinas: 'proteins_100g',
  hidratos: 'carbohydrates_100g',
  azucares: 'sugars_100g',
  grasas: 'fat_100g',
  grasasSaturadas: 'saturated-fat_100g',
  fibra: 'fiber_100g',
  sal: 'salt_100g',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const onlySubcategories = argValue('--subcategories')?.split(',').map(Number) ?? null;
const listOnly = args.includes('--list');
const useSelection = args.includes('--selection') || onlySubcategories !== null;
const allBrands = args.includes('--all-brands');
const allFormats = args.includes('--all-formats');

// Waits and retries when the API says we're going too fast (429) or is briefly down
async function politeFetch(url, headers) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (![429, 502, 503, 504].includes(res.status) || attempt === MAX_ATTEMPTS) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitS = retryAfter > 0 ? retryAfter : RETRY_BASE_S * attempt;
    process.stdout.write(`\n${res.status}: esperando ${waitS} s… `);
    await sleep(waitS * 1000);
  }
}

async function cachedJson(file, url, delayMs) {
  const p = path.join(CACHE, file);
  if (await exists(p)) return JSON.parse(await readFile(p, 'utf8'));
  await sleep(delayMs);
  const res = await politeFetch(url, { Accept: 'application/json' });
  if (res.status === 404) {
    await writeFile(p, 'null');
    return null;
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const data = await res.json();
  await writeFile(p, JSON.stringify(data));
  return data;
}

async function downloadImage(url, dest) {
  if (await exists(dest)) return;
  await sleep(MERCADONA_DELAY_MS);
  const res = await politeFetch(url, {});
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const bedcaQuery = (id) => '<?xml version="1.0" encoding="utf-8"?><foodquery><type level="2"/>'
  + '<selection><atribute name="f_id"/><atribute name="f_ori_name"/><atribute name="eur_name"/>'
  + '<atribute name="best_location"/><atribute name="v_unit"/></selection>'
  + `<condition><cond1><atribute1 name="f_id"/></cond1><relation type="EQUAL"/><cond3>${id}</cond3></condition>`
  + '<condition><cond1><atribute1 name="publico"/></cond1><relation type="EQUAL"/><cond3>1</cond3></condition>'
  + '<order ordtype="ASC"><atribute3 name="componentgroup_id"/></order></foodquery>';

async function fetchBedca(id) {
  const p = path.join(CACHE, 'bedca', `${id}.xml`);
  let xml;
  if (await exists(p)) {
    xml = await readFile(p, 'utf8');
  } else {
    await sleep(BEDCA_DELAY_MS);
    const res = await fetch(BEDCA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'User-Agent': USER_AGENT },
      body: bedcaQuery(id),
    });
    if (!res.ok) throw new Error(`${res.status} BEDCA ${id}`);
    xml = await res.text();
    await writeFile(p, xml);
  }
  return readBedca(xml);
}

// Returns null for foods BEDCA doesn't publish (the query then has no values)
function readBedca(xml) {
  const values = {};
  for (const [, body] of xml.matchAll(/<foodvalue>([\s\S]*?)<\/foodvalue>/g)) {
    const tag = (t) => body.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1].trim() ?? '';
    // An empty value is a trace amount for macronutrients (fat in fruit) but an
    // unmeasured one for sodium (cheese, tinned tuna), so salt stays unknown
    const empty = tag('best_location') === '';
    const code = tag('eur_name');
    values[code] = { v: empty ? (code === 'NA' ? null : 0) : Number(tag('best_location')), unit: tag('v_unit') };
  }
  if (!Object.keys(values).length) return null;

  const get = (code) => (Number.isFinite(values[code]?.v) ? values[code].v : null);
  const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const per100g = {};
  for (const [key, code] of Object.entries(BEDCA_COMPONENTS)) per100g[key] = round(get(code));
  per100g.sal = get('NA') == null ? null : round(get('NA') * 2.5 / 1000);

  const energy = values.ENERC;
  if (energy && Number.isFinite(energy.v) && energy.v > 0) {
    per100g.kcal = Math.round(energy.unit === 'kJ' ? energy.v / 4.184 : energy.v);
  } else if (per100g.proteinas != null && per100g.hidratos != null) {
    // BEDCA often omits energy: Atwater factors, as Spanish labels do
    per100g.kcal = Math.round(4 * per100g.proteinas + 4 * per100g.hidratos + 9 * (per100g.grasas ?? 0)
      + 2 * (per100g.fibra ?? 0) + 7 * (get('ALC') ?? 0));
  } else {
    per100g.kcal = null;
  }
  return { nombre: xml.match(/<f_ori_name>([\s\S]*?)<\/f_ori_name>/)?.[1].trim() ?? null, per100g };
}

const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;

function readNutrition(offProduct) {
  const n = offProduct?.nutriments;
  if (!n) return null;
  const per100g = {};
  for (const [key, field] of Object.entries(NUTRIENTS)) {
    const v = n[field];
    per100g[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  if (per100g.kcal == null && typeof n['energy-kj_100g'] === 'number') {
    per100g.kcal = Math.round(n['energy-kj_100g'] / 4.184);
  }
  if (per100g.kcal == null && per100g.proteinas == null && per100g.hidratos == null && per100g.grasas == null) return null;
  return per100g;
}

// Flags data errors: declared kcal must roughly match the macros (Atwater factors)
function checkNutrition(per100g) {
  const { kcal, proteinas, hidratos, grasas, fibra } = per100g;
  if ([kcal, proteinas, hidratos, grasas].some(v => v == null)) return 'incompleto';
  const estimated = 4 * proteinas + 4 * hidratos + 9 * grasas + 2 * (fibra ?? 0);
  const diff = Math.abs(estimated - kcal);
  return diff <= Math.max(15, kcal * 0.15) ? 'ok' : 'revisar';
}

function toFood(detail, category, offProduct) {
  const per100g = readNutrition(offProduct);
  const photo = detail.photos?.[0];
  const price = detail.price_instructions || {};
  return {
    id: `merc-${detail.id}`,
    source: 'mercadona',
    sourceId: detail.id,
    ean: detail.ean || null,
    nombre: detail.display_name,
    nombreLegal: detail.details?.legal_name || null,
    marca: detail.brand || detail.details?.brand || null,
    categoria: category.top,
    subcategoria: category.sub,
    formato: {
      envase: detail.packaging || null,
      cantidad: price.unit_size ?? null,
      unidad: price.size_format ?? null,
      pesoEscurrido: price.drained_weight ?? null,
      pack: Boolean(price.is_pack),
    },
    precio: {
      unidad: price.unit_price ? Number(price.unit_price) : null,
      referencia: price.reference_price ? Number(price.reference_price) : null,
      formatoReferencia: price.reference_format ?? null,
    },
    ingredientes: stripHtml(detail.nutrition_information?.ingredients),
    alergenos: stripHtml(detail.nutrition_information?.allergens),
    por100g: per100g,
    nutricion: per100g
      ? { fuente: 'openfoodfacts', url: `https://world.openfoodfacts.org/product/${detail.ean}`, control: checkNutrition(per100g) }
      : { fuente: null, url: null, control: 'sin_datos' },
    // The shop's own 600 px photo: a square studio shot on white, used as is
    imagen: photo ? `${detail.id}.jpg` : null,
    imagenOrigen: photo?.regular ?? null,
    url: detail.share_url,
  };
}

// The same product often comes in several pack sizes with different EANs and
// only some are in Open Food Facts; borrow the facts from a sibling with the same name.
// Only the shop name: legal names are too generic ("Alubia roja" covers dry and cooked).
function fillFromSameProduct(foods) {
  const key = (f) => f.nombre.toLowerCase().trim();
  const withData = new Map();
  for (const f of foods) {
    if (f.nutricion.control === 'ok' && !withData.has(key(f))) withData.set(key(f), f);
  }
  for (const f of foods) {
    if (f.por100g) continue;
    const sibling = withData.get(key(f));
    if (!sibling) continue;
    f.por100g = { ...sibling.por100g };
    f.nutricion = { ...sibling.nutricion, fuente: 'similar', similarA: sibling.id };
  }
}

// For diets the pack size doesn't matter: keep one entry per product, preferring
// a single unit over a multipack, then first-hand nutrition data, then shop order.
function keepOneFormat(foods) {
  const rank = (f) => [f.formato.pack ? 1 : 0, f.nutricion.fuente === 'openfoodfacts' ? 0 : 1];
  const best = new Map();
  for (const f of foods) {
    const key = f.nombre.toLowerCase().trim();
    const current = best.get(key);
    if (!current) { best.set(key, f); continue; }
    const [a, b] = [rank(f), rank(current)];
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best.set(key, f);
  }
  return [...best.values()];
}

const fetchDetail = (id) => cachedJson(`mercadona/product-${id}.json`,
  `${MERCADONA_API}/products/${id}/?${MERCADONA_PARAMS}`, MERCADONA_DELAY_MS);

async function fetchOff(ean) {
  if (!ean) return null;
  const off = await cachedJson(`off/${ean}.json`, `${OFF_API}/${ean}.json?fields=${OFF_FIELDS}`, OFF_DELAY_MS);
  return off?.product ?? null;
}

// Fresh food has no usable barcode and some labels in OFF are wrong: take the
// generic BEDCA food named in basics.json instead
async function useGeneric(food, bedcaId, aprox) {
  const generic = await fetchBedca(bedcaId);
  if (!generic) throw new Error(`BEDCA ${bedcaId} no es público`);
  food.por100g = generic.per100g;
  food.nutricion = {
    fuente: 'bedca',
    bedcaId,
    alimentoGenerico: generic.nombre,
    aproximado: Boolean(aprox),
    url: 'https://www.bedca.net/bdpub/',
    control: checkNutrition(generic.per100g),
  };
}

// Default: the hand-picked list in basics.json, one product per basic food
async function collectFromBasics(skipped) {
  const basics = JSON.parse(await readFile(path.join(ROOT, 'basics.json'), 'utf8'));
  const foods = [];
  for (const { grupo, productos } of basics.grupos) {
    for (const { id, basico, bedca, aprox } of productos) {
      try {
        const detail = await fetchDetail(id);
        const food = toFood(detail, { top: grupo, sub: detail.categories?.[0]?.name ?? null }, await fetchOff(detail.ean));
        if (bedca && food.nutricion.control !== 'ok') await useGeneric(food, bedca, aprox);
        foods.push({ basico, ...food });
        process.stdout.write(`\r${foods.length} productos · ${grupo.padEnd(40)}`);
      } catch (e) {
        skipped.error.push({ id, error: e.message });
      }
    }
  }
  return foods;
}

// --selection: everything in the subcategories of selection.json (Hacendado + fresh)
async function collectFromSelection(tops, skipped) {
  const selection = JSON.parse(await readFile(path.join(ROOT, 'selection.json'), 'utf8'));
  const wanted = new Set(onlySubcategories ?? selection.subcategorias.map(s => s.id));
  const excluded = onlySubcategories ? [] : selection.excluir.map(w => w.toLowerCase());
  const foods = [];
  for (const top of tops) {
    for (const mid of top.categories.filter(m => wanted.has(m.id))) {
      const page = await cachedJson(`mercadona/category-${mid.id}.json`,
        `${MERCADONA_API}/categories/${mid.id}/?${MERCADONA_PARAMS}`, MERCADONA_DELAY_MS);
      for (const sub of page.categories) {
        for (const item of sub.products) {
          if (excluded.some(w => item.display_name.toLowerCase().includes(w))) {
            skipped.excluido++;
            continue;
          }
          try {
            const detail = await fetchDetail(item.id);
            const brand = detail.brand || detail.details?.brand || null;
            if (!allBrands && brand && brand !== HOUSE_BRAND) {
              skipped.otraMarca++;
              continue;
            }
            foods.push(toFood(detail, { top: top.name, sub: `${mid.name} › ${sub.name}` }, await fetchOff(detail.ean)));
            process.stdout.write(`\r${foods.length} productos · ${top.name.padEnd(40)}`);
          } catch (e) {
            skipped.error.push({ id: item.id, error: e.message });
          }
        }
      }
    }
  }
  return foods;
}

async function main() {
  await mkdir(path.join(CACHE, 'mercadona'), { recursive: true });
  await mkdir(path.join(CACHE, 'off'), { recursive: true });
  await mkdir(path.join(CACHE, 'bedca'), { recursive: true });
  await mkdir(path.join(OUT, 'images'), { recursive: true });
  await mkdir(OUT, { recursive: true });

  const tree = await cachedJson('mercadona/categories.json', `${MERCADONA_API}/categories/?${MERCADONA_PARAMS}`, 0);
  const tops = tree.results.filter(c => !NON_FOOD_CATEGORIES.has(c.id));

  if (listOnly) {
    for (const top of tops) {
      console.log(`
${top.name}`);
      for (const mid of top.categories) console.log(`  ${String(mid.id).padStart(4)}  ${mid.name}`);
    }
    return;
  }

  const skipped = { otraMarca: 0, excluido: 0, error: [] };
  const foods = useSelection
    ? await collectFromSelection(tops, skipped)
    : await collectFromBasics(skipped);

  // A product can be listed under more than one subcategory
  const unique = [...new Map(foods.map(f => [f.id, f])).values()];
  fillFromSameProduct(unique);
  // basics.json already names one product per food
  const kept = allFormats || !useSelection ? unique : keepOneFormat(unique);

  for (const food of kept) {
    if (!food.imagenOrigen) continue;
    try {
      await downloadImage(food.imagenOrigen, path.join(OUT, 'images', food.imagen));
    } catch (e) {
      skipped.error.push({ id: food.sourceId, error: e.message });
    }
  }

  const catalog = {
    version: 1,
    generado: new Date().toISOString(),
    fuentes: {
      productos: 'tienda.mercadona.es',
      nutricion: 'Open Food Facts (ODbL) — https://world.openfoodfacts.org',
      nutricionGenerica: 'BEDCA, Base de Datos Española de Composición de Alimentos — https://www.bedca.net',
    },
    alimentos: kept,
  };
  await writeFile(path.join(OUT, 'foods.json'), JSON.stringify(catalog, null, 2));

  const by = (pred) => kept.filter(pred).length;
  console.log(`\n\nProductos: ${kept.length} (de ${unique.length} formatos)`);
  console.log(`  con nutrición OK:      ${by(f => f.nutricion.control === 'ok')} (de un formato similar: ${by(f => f.nutricion.fuente === 'similar')} · genérico BEDCA: ${by(f => f.nutricion.fuente === 'bedca' && f.nutricion.control === 'ok')})`);
  console.log(`  nutrición a revisar:   ${by(f => f.nutricion.control === 'revisar')}`);
  console.log(`  nutrición incompleta:  ${by(f => f.nutricion.control === 'incompleto')}`);
  console.log(`  sin datos nutricionales: ${by(f => f.nutricion.control === 'sin_datos')}`);
  console.log(`Descartados por ser de otra marca: ${skipped.otraMarca} · por selection.json: ${skipped.excluido}`);
  if (skipped.error.length) console.log(`Errores: ${skipped.error.length}`, skipped.error.slice(0, 5));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
