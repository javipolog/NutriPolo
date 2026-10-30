/**
 * pdfPlanificacionGenerator.js — NutriPolo
 * =================================
 * PDF de la planificació setmanal (substitueix el disseny de Canva):
 * portada amb índex, opcions d'esmorzar / mig matí / berenar, guia de
 * quantitats, menú setmanal (amb enllaços a receptes) i
 * productes. Vectorial amb pdf-lib + fontkit (Onest via pdfFonts.js,
 * icones de Lucide, ISC).
 */

import { PDFDocument, PDFString, StandardFonts, LineCapStyle, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  normalizePlanificacion, visibleSections, linesOf, isDishEmpty, safeUrl,
  MENU_SLOTS, MENU_VARIANTS, OPTION_SECTIONS,
} from './planificacion';
import { ONEST_FILES, fetchFont } from './pdfFonts';

// ── Pàgina ─────────────────────────────────────────────────────────────────
const PORTRAIT = [595.28, 841.89];
const MARGIN = 48;
const BOTTOM = 58;

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// Salvia i taronja del logo com a protagonistes; el text va sempre en
// ink / soft / olive / orangeInk (AA sobre paper, surface i sagePale).
const C = Object.fromEntries(Object.entries({
  paper:      '#FFFFFF',
  surface:    '#F6F5EF',
  sage:       '#BFCA89',
  sageSoft:   '#DCE4BD',
  sagePale:   '#EFF2E2',
  olive:      '#4E5C22',
  orange:     '#F6AB66',
  orangePale: '#FDEEDF',
  orangeInk:  '#995014',
  ink:        '#1C2118',
  soft:       '#585F52',
  rule:       '#E4E5DC',
  white:      '#FFFFFF',
}).map(([k, v]) => [k, hex(v)]));


const L = {
  planning: 'Planificación',
  nutrition: 'de alimentación',
  intro: 'Introducción',
  mustRead: 'Importante leer',
  patient: 'Paciente',
  date: 'Fecha',
  option: 'Opción',
  note: 'Nota',
  notes: 'Notas',
  important: 'Importante',
  continued: 'Continuación',
  chooseAB: 'Elige una de las dos opciones',
  lunch: 'Comida',
  dinner: 'Cena',
  lunches: 'Comidas',
  dinners: 'Cenas',
  colegiada: 'Nº colegiada',
  days: {
    lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
    viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
  },
  sections: {
    desayunos:   { index: 'Desayunos',          title: 'Opciones de desayuno',     sub: 'Elige cada día la opción que prefieras.' },
    mediaManana: { index: 'Media mañana',       title: 'Opciones de media mañana', sub: 'Elige cada día la opción que prefieras.' },
    merienda:    { index: 'Merienda',           title: 'Opciones de merienda',     sub: 'Elige cada día la opción que prefieras.' },
    cantidades:  { index: 'Guía de cantidades', title: 'Guía de cantidades',       sub: 'Lo que es una ración para ti, por alimento.' },
    menu:        { index: 'Menú semanal',       title: 'Menú semanal',             sub: 'Comidas y cenas de lunes a domingo.' },
    productos:   { index: 'Productos',          title: 'Productos del menú',       sub: '' },
  },
};

const INDEX_DESC = {
  desayunos:   () => 'Las diferentes opciones para desayunar. Elige cada día la que prefieras.',
  mediaManana: () => 'Las diferentes opciones para media mañana. Elige cada día la que prefieras.',
  merienda:    () => 'Las diferentes opciones para la merienda. Elige cada día la que prefieras.',
  cantidades:  () => 'Lo que es una ración para ti. No es el máximo diario: es la cantidad que pones cada vez que tomas ese alimento.',
  menu:        () => 'De lunes a domingo, con dos opciones (A y B) por comida y cena. Los platos subrayados te llevan a la receta.',
  productos:   (p) => `Productos que aparecen en tu menú${p.supermercado ? `, de ${p.supermercado}` : ''}.`,
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthYear = (iso) => {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return '';
  const name = MONTHS[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
};

// ── Icones (Lucide v0.294, ISC; viewBox 24×24, traç) ──────────────────────
const ICONS = {
  coffee: ['M17 8h1a4 4 0 1 1 0 8h-1', 'M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z', 'M6 2L6 4', 'M10 2L10 4', 'M14 2L14 4'],
  apple: ['M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z', 'M10 2c1 .5 2 2 2 5'],
  cookie: ['M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5', 'M8.5 8.5v.01', 'M16 15.5v.01', 'M12 12v.01', 'M11 17v.01', 'M7 14v.01'],
  pieChart: ['M21.21 15.89A10 10 0 1 1 8 2.83', 'M22 12A10 10 0 0 0 12 2v10z'],
  calendarDays: ['M5 4H19a2 2 0 0 1 2 2V20a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2V6a2 2 0 0 1 2 -2Z', 'M16 2L16 6', 'M8 2L8 6', 'M3 10L21 10', 'M8 14h.01', 'M12 14h.01', 'M16 14h.01', 'M8 18h.01', 'M12 18h.01', 'M16 18h.01'],
  shoppingBasket: ['m5 11 4-7', 'm19 11-4-7', 'M2 11h20', 'm3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8c.9 0 1.8-.7 2-1.6l1.7-7.4', 'm9 11 1 9', 'M4.5 15.5h15', 'm15 11-1 9'],
  wheat: ['M2 22 16 8', 'M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z', 'M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z', 'M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z', 'M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z', 'M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z', 'M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z', 'M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z'],
  drumstick: ['M15.45 15.4c-2.13.65-4.3.32-5.7-1.1-2.29-2.27-1.76-6.5 1.17-9.42 2.93-2.93 7.15-3.46 9.43-1.18 1.41 1.41 1.74 3.57 1.1 5.71-1.4-.51-3.26-.02-4.64 1.36-1.38 1.38-1.87 3.23-1.36 4.63z', 'm11.25 15.6-2.16 2.16a2.5 2.5 0 1 1-4.56 1.73 2.49 2.49 0 0 1-1.41-4.24 2.5 2.5 0 0 1 3.14-.32l2.16-2.16'],
  fish: ['M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z', 'M18 12v.5', 'M16 17.93a9.77 9.77 0 0 1 0-11.86', 'M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33', 'M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4', 'm16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98'],
  carrot: ['M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46', 'M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z', 'M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z'],
  milk: ['M8 2h8', 'M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2', 'M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0'],
  egg: ['M12 22c6.23-.05 7.87-5.57 7.5-10-.36-4.34-3.95-9.96-7.5-10-3.55.04-7.14 5.66-7.5 10-.37 4.43 1.27 9.95 7.5 10z'],
  droplet: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  soup: ['M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z', 'M7 21h10', 'M19.5 12 22 6', 'M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62', 'M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62', 'M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62'],
  info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 16v-4', 'M12 8h.01'],
  leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'],
};
const SECTION_ICON = {
  desayunos: 'coffee', mediaManana: 'apple', merienda: 'cookie',
  cantidades: 'pieChart', menu: 'calendarDays', productos: 'shoppingBasket',
};
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const GROUP_ICONS = [
  [/cereal|legumbre|tubercul|pan\b|pasta|arroz/, 'wheat'],
  [/carne|pollo|pavo/, 'drumstick'],
  [/pescado|marisco/, 'fish'],
  [/fruta|verdura|hortaliza/, 'carrot'],
  [/lacteo|leche|yogur|queso/, 'milk'],
  [/huevo/, 'egg'],
  [/grasa|aceite/, 'droplet'],
  [/salsa/, 'soup'],
];
const groupIcon = (title) => (GROUP_ICONS.find(([re]) => re.test(fold(title))) || [null, 'leaf'])[1];

// ── Fonts ──────────────────────────────────────────────────────────────────
// Onest: títols en ExtraBold, subtítol de portada en Light
async function embedFonts(doc, loadFont) {
  try {
    doc.registerFontkit(fontkit);
    const pairs = await Promise.all(Object.entries(ONEST_FILES).map(async ([k, file]) =>
      [k, await doc.embedFont(await loadFont(file), { subset: true })]));
    return Object.fromEntries(pairs);
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('Planificación PDF: fonts unavailable, using Helvetica:', err);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { light: reg, reg, med: reg, semi: bold, bold, display: bold };
  }
}

// Caràcters que la font pot no tenir → alternatives, en ordre.
const ALTERNATIVES = {
  '⟶': ['→', '—', '->'], '→': ['—', '->'], '–': ['-'], '—': ['-'], '…': ['...'],
  '“': ['"'], '”': ['"'], '‘': ["'"], '’': ["'"], '•': ['·', '-'], '½': ['1/2'], '¼': ['1/4'],
  ' ': [' '], ' ': [' '], ' ': [' '], '\t': [' '],
};

function makeSanitizer(font) {
  const set = new Set(font.getCharacterSet());
  const has = (s) => [...s].every(ch => set.has(ch.codePointAt(0)));
  const cache = new Map();
  return (raw) => {
    const s = String(raw ?? '');
    if (cache.has(s)) return cache.get(s);
    const out = [...s].map(ch => {
      if (set.has(ch.codePointAt(0))) return ch;
      const alt = (ALTERNATIVES[ch] || []).find(has);
      return alt ?? '';
    }).join('');
    cache.set(s, out);
    return out;
  };
}

// ── Geometria ──────────────────────────────────────────────────────────────
function roundedRectPath(w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${k},0 H${w - k} Q${w},0 ${w},${k} V${h - k} Q${w},${h} ${w - k},${h} H${k} Q0,${h} 0,${h - k} V${k} Q0,0 ${k},0 Z`;
}

// Logo NutriPolo (public/icon-nutripolo.svg, viewBox 0 0 200 200)
const LOGO_PATHS = {
  sageA: 'M38,72.8 H69.9 Q77.3,72.8 77.3,80.2 V150.2 Q77.3,157.6 69.9,157.6 H38 Q30.6,157.6 30.6,150.2 V80.2 Q30.6,72.8 38,72.8 Z',
  sageB: 'M126.5,130.2c-8.7,0-17.3-2.2-24.9-6.6-3.3-1.9-5.7-5.1-6.7-8.8-1-3.7-.5-7.6,1.4-11l1.5-2.7h0s25.1-43.5,25.1-43.5c0,0,0,0,0,0l8.3-14.4c.2-.3.3-.5.5-.8h-37.9c-4.8,0-8.6,3.9-8.6,8.6v97.9c0,4.8,3.9,8.6,8.6,8.6h29.4c4.8,0,8.6-3.9,8.6-8.6v-19.2c-1.8.2-3.6.4-5.4.4Z',
  orange: 'M163.6,102.4h0c11.9-20.7,4.8-47.1-15.8-59h0c-1.3-.7-2.7-1.1-4.1-1.1-2.8,0-5.5,1.5-7.1,4.1l-8.3,14.4c-3.1,5.4.8,12.1,7,12.1h20.2c1.3,0,2.4,1.1,2.4,2.4,0,1.3-1.1,2.4-2.4,2.4h-20.2s0,0,0,0c-6.2,0-10,6.7-6.9,12.1l10.1,17.5c.7,1.2.3,2.6-.9,3.3-.4.2-.8.3-1.2.3-.4,0-.9-.1-1.2-.3-.4-.2-.7-.5-.9-.9l-10.1-17.5c-1.6-2.7-4.3-4-7-4-2.7,0-5.4,1.4-6.9,4l-8.5,14.8c-2.3,3.9-.9,8.9,3,11.2,6.8,3.9,14.3,5.8,21.7,5.8,14.8,0,29.2-7.8,37.2-21.6Z',
};

/** Dibuixa el logo (només la marca, ~140×125 dins el viewBox) amb la cantonada sup.-esq. a (x, top). */
function drawLogo(page, x, top, size) {
  const s = size / 140;
  const ox = x - 30 * s;
  const oy = top + 42 * s;
  page.drawSvgPath(LOGO_PATHS.sageA, { x: ox, y: oy, scale: s, color: C.sage });
  page.drawSvgPath(LOGO_PATHS.sageB, { x: ox, y: oy, scale: s, color: C.sage });
  page.drawSvgPath(LOGO_PATHS.orange, { x: ox, y: oy, scale: s, color: C.orange });
}

/** Icona de traç centrada a (cx, cy). */
function drawIcon(page, name, cx, cy, size, color, stroke = 1.4) {
  const s = size / 24;
  for (const d of ICONS[name] || ICONS.leaf) {
    page.drawSvgPath(d, {
      x: cx - size / 2, y: cy + size / 2, scale: s,
      borderColor: color, borderWidth: stroke / s, borderLineCap: LineCapStyle.Round,
    });
  }
}

// ── Enllaços ───────────────────────────────────────────────────────────────
function addLink(doc, page, [x1, y1, x2, y2], url) {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  });
  page.node.addAnnot(doc.context.register(annot));
}

// ── Imatges ────────────────────────────────────────────────────────────────
function dataUrlBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function embedImage(doc, dataUrl) {
  if (!dataUrl) return null;
  try {
    const bytes = dataUrlBytes(dataUrl);
    return /^data:image\/png/i.test(dataUrl) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('Planificación PDF: image embedding failed:', err);
    return null;
  }
}

/** Escala una imatge perquè càpiga a w×h i la centra. */
function drawContained(page, img, x, top, w, h) {
  const r = Math.min(w / img.width, h / img.height);
  const iw = img.width * r;
  const ih = img.height * r;
  page.drawImage(img, { x: x + (w - iw) / 2, y: top - h + (h - ih) / 2, width: iw, height: ih });
}

// ── Text ───────────────────────────────────────────────────────────────────

/** "Yogur griego (170 g)" → { name: 'Yogur griego', qty: '170 g' }. */
export function splitQuantity(s) {
  const m = String(s).match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  // Només si el parèntesi és una quantitat curta: "170 g", "1/4", "2 lonchas grandes"
  const q = m?.[2].trim();
  if (q && q.length <= 22 && /^[\d¼½¾]/.test(q) && !/[,%]/.test(q)) return { name: m[1], qty: q };
  return { name: String(s), qty: '' };
}

/** "Pan: 60 g" → { label: 'Pan', value: '60 g' }. */
function splitLabel(s) {
  const i = s.indexOf(':');
  if (i > 0 && i <= 48 && !/^https?:/i.test(s) && s.slice(i + 1).trim()) return { label: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
  return { label: '', value: s };
}

// ── Generador ──────────────────────────────────────────────────────────────

/**
 * @param plan     planificació (format 'planificacion')
 * @param client   client (nom a la portada)
 * @param config   config de l'app (nom, contacte, col·legiada)
 * @param options  { products: [{ id, nombre, imagen }], loadFont(filename) → Uint8Array }
 * @returns Uint8Array amb el PDF
 */
export async function generatePlanificacionPDF(plan, client, config, { products = [], loadFont = fetchFont } = {}) {
  const p = normalizePlanificacion(plan);
  const productsById = Object.fromEntries(products.map(pr => [pr.id, pr]));
  const sections = visibleSections(p, productsById);

  const doc = await PDFDocument.create();
  doc.setTitle(`${p.nombre || 'Planificación'} — ${client?.nombre || ''}`.trim());
  doc.setAuthor(config?.nombre || 'NutriPolo');
  doc.setCreator('NutriPolo');

  const F = await embedFonts(doc, loadFont);
  const sanitizers = new Map([...new Set(Object.values(F))].map(f => [f, makeSanitizer(f)]));
  const clean = (font, s) => sanitizers.get(font)(s);
  const width = (s, font, size) => font.widthOfTextAtSize(clean(font, s), size);
  const lh = (size, k = 1.42) => size * k;

  function splitLong(word, font, size, maxW, out) {
    while (font.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxW) cut--;
      out.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    return word;
  }

  /** Talla en línies; maxW pot ser una funció de l'índex de línia (sagnat penjat). */
  function wrap(s, font, size, maxW) {
    const wAt = typeof maxW === 'function' ? maxW : () => maxW;
    const out = [];
    for (const para of String(s ?? '').split(/\r?\n/)) {
      const words = clean(font, para).split(/\s+/).filter(Boolean);
      let line = '';
      for (let word of words) {
        // Paraules més llargues que la línia (URLs…) es tallen per caràcters
        if (font.widthOfTextAtSize(word, size) > wAt(out.length)) {
          if (line) { out.push(line); line = ''; }
          word = splitLong(word, font, size, wAt(out.length), out);
        }
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= wAt(out.length)) line = test;
        else { if (line) out.push(line); line = word; }
      }
      if (line) out.push(line);
    }
    return out;
  }

  const text = (page, s, x, baseline, font, size, color) => {
    const t = clean(font, s);
    if (t) page.drawText(t, { x, y: baseline, font, size, color });
  };
  const textCenter = (page, s, cx, baseline, font, size, color) =>
    text(page, s, cx - width(s, font, size) / 2, baseline, font, size, color);
  const textRight = (page, s, rx, baseline, font, size, color) =>
    text(page, s, rx - width(s, font, size), baseline, font, size, color);

  const spacedWidth = (s, font, size, sp) => {
    const t = clean(font, s);
    return font.widthOfTextAtSize(t, size) + sp * Math.max(0, [...t].length - 1);
  };
  const spaced = (page, s, x, baseline, font, size, color, sp) => {
    let cx = x;
    for (const ch of clean(font, s)) {
      page.drawText(ch, { x: cx, y: baseline, font, size, color });
      cx += font.widthOfTextAtSize(ch, size) + sp;
    }
  };
  /** Etiqueta en majúscules amb tracking. Retorna l'amplada. */
  const label = (page, s, x, baseline, { size = 7, color = C.olive, font = F.bold, sp = 1.1, align = 'left' } = {}) => {
    const t = String(s).toUpperCase();
    const w = spacedWidth(t, font, size, sp);
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    spaced(page, t, x0, baseline, font, size, color, sp);
    return w;
  };
  const labelWidth = (s, { size = 7, font = F.bold, sp = 1.1 } = {}) => spacedWidth(String(s).toUpperCase(), font, size, sp);

  const hline = (page, x1, x2, y, color = C.rule, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  const box = (page, x, top, w, h, { r = 12, fill, stroke, strokeWidth = 0.7, opacity } = {}) =>
    page.drawSvgPath(roundedRectPath(w, h, r), {
      x, y: top, color: fill, opacity,
      borderColor: stroke, borderWidth: stroke ? strokeWidth : 0,
    });

  /** Píndola amb etiqueta; retorna l'amplada. */
  const pill = (page, s, x, top, { fill = C.orangePale, color = C.orangeInk, size = 7, h = 16, sp = 0.9 } = {}) => {
    const w = labelWidth(s, { size, sp }) + 16;
    box(page, x, top, w, h, { r: h / 2, fill });
    label(page, s, x + 8, top - h / 2 - size * 0.36, { size, color, sp });
    return w;
  };
  /** Disc de color amb icona. */
  const iconDisc = (page, name, cx, cy, r, { fill = C.sagePale, color = C.olive, k = 0.98, stroke } = {}) => {
    page.drawCircle({ x: cx, y: cy, size: r, color: fill });
    drawIcon(page, name, cx, cy, r * k, color, stroke ?? Math.max(1, r * 0.075));
  };

  const clientName = client?.nombre || '';
  const when = monthYear(p.fechaInicio);
  const secNum = (key) => String(sections.indexOf(key) + 1).padStart(2, '0');
  const prof = {
    name: config?.nombre || 'NutriPolo',
    col: config?.numColegiada ? `${L.colegiada} ${config.numColegiada}` : '',
    contact: [config?.web, config?.email, config?.telefono].filter(Boolean).join('   ·   '),
  };
  const pages = [];

  const newPage = (size) => {
    const page = doc.addPage(size);
    pages.push(page);
    const { width: W, height: H } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper });
    return page;
  };

  /** Capçalera corrent. Retorna la y de sota. */
  function runningHead(page) {
    const { width: W, height: H } = page.getSize();
    const m = MARGIN;
    const bl = H - 32;
    drawLogo(page, m, bl + 10, 15);
    text(page, 'NutriPolo', m + 21, bl, F.bold, 8.4, C.ink);
    const meta = [p.nombre, clientName].filter(Boolean).join('   ·   ');
    textRight(page, meta, W - m, bl, F.med, 7.6, C.soft);
    return H - 46;
  }

  /** Capçalera de secció: franja salvia pàl·lida amb icona. Retorna la y del contingut. */
  function sectionHero(page, key, top, { continued = false, compact = false } = {}) {
    const { width: W } = page.getSize();
    const m = MARGIN;
    const meta = L.sections[key];
    const sub = key === 'productos' && p.supermercado ? `Los de tu planificación son de ${p.supermercado}.` : meta.sub;
    const showSub = sub && !continued && !compact;
    const h = compact ? 58 : 84;
    const ts = compact ? 18 : 24;
    box(page, m, top, W - m * 2, h, { r: 16, fill: C.sagePale });
    const r = Math.min(h * 0.3, 22);
    iconDisc(page, SECTION_ICON[key], m + 18 + r, top - h / 2, r, { fill: C.white, k: 0.95 });
    const tx = m + 18 + r * 2 + 16;
    // Bloc kicker + títol (+ subtítol) centrat verticalment
    const blockH = 7 * 0.72 + 8 + ts * 0.72 + (showSub ? 9 + 8.6 * 0.72 : 0);
    const kBL = top - (h - blockH) / 2 - 7 * 0.72;
    label(page, `${secNum(key)}  ·  ${meta.index}`, tx, kBL, { size: 7 });
    const tBL = kBL - 8 - ts * 0.72;
    text(page, meta.title, tx - 0.5, tBL, F.display, ts, C.ink);
    if (showSub) text(page, sub, tx, tBL - 9 - 8.6 * 0.72, F.med, 8.6, C.soft);
    if (continued) {
      const w = labelWidth(L.continued, { size: 7, sp: 0.9 }) + 16;
      pill(page, L.continued, W - m - 18 - w, top - h / 2 + 8, { fill: C.white, color: C.olive });
    }
    return top - h - 18;
  }

  function sectionPage(size, key, { continued = false } = {}) {
    const page = newPage(size);
    const { width: W, height: H } = page.getSize();
    const m = MARGIN;
    const y = sectionHero(page, key, runningHead(page), { continued });
    return { page, y, m, W, H };
  }

  // ── 1. Portada ───────────────────────────────────────────────────────────
  {
    const page = newPage(PORTRAIT);
    const [W, H] = PORTRAIT;
    const m = MARGIN;
    const bandH = 432;
    // Ona de Raquel, en una sola corba neta + un filet que l'acompanya
    page.drawSvgPath(`M0,0 H${W} V${bandH * 0.9} C${W * 0.68},${bandH * 1.02} ${W * 0.34},${bandH * 0.86} 0,${bandH} Z`, { x: 0, y: H, color: C.sage });
    page.drawSvgPath(`M0,${bandH + 16} C${W * 0.34},${bandH * 0.86 + 16} ${W * 0.68},${bandH * 1.02 + 16} ${W},${bandH * 0.9 + 16}`, { x: 0, y: H, borderColor: C.sageSoft, borderWidth: 1.4 });

    page.drawCircle({ x: m + 21, y: H - 62, size: 21, color: C.white });
    drawLogo(page, m + 21 - 12.5, H - 62 + 13, 25);
    const byline = prof.col || (prof.name !== 'NutriPolo' ? prof.name : '');
    text(page, 'NutriPolo', m + 52, byline ? H - 59 : H - 65.5, F.bold, 11, C.ink);
    if (byline) text(page, byline, m + 52, H - 71, F.med, 7.6, C.ink);

    // Títol
    spaced(page, L.planning, m - 2, H - 196, F.display, 54, C.ink, -1.4);
    spaced(page, L.nutrition, m - 1, H - 244, F.light, 42, C.ink, -0.9);

    // Número de planificació
    if (p.numero) {
      const cx = W - m - 44;
      const cy = H - 92;
      page.drawCircle({ x: cx, y: cy, size: 44, color: C.orange, borderColor: C.white, borderWidth: 3 });
      label(page, 'Nº', cx + 0.5, cy + 15, { size: 7, color: C.ink, align: 'center' });
      textCenter(page, String(p.numero), cx, cy - 16, F.display, 34, C.ink);
    }

    // Fitxa: pacient | data
    const cardTop = H - 290;
    const cardW = W - m * 2;
    const nameW = cardW * 0.66 - 40;
    let nSize = 16;
    while (nSize > 12.5 && width(clientName, F.bold, nSize) > nameW) nSize -= 0.5;
    const nameLines = wrap(clientName || '—', F.bold, nSize, nameW).slice(0, 2);
    const cardH = 62 + (nameLines.length - 1) * lh(nSize, 1.2);
    box(page, m, cardTop, cardW, cardH, { r: 18, fill: C.white });
    label(page, L.patient, m + 22, cardTop - 22, { size: 7 });
    nameLines.forEach((ln, i) => text(page, ln, m + 22, cardTop - 42 - i * lh(nSize, 1.2), F.bold, nSize, C.ink));
    const dx = m + cardW * 0.66;
    page.drawLine({ start: { x: dx, y: cardTop - 14 }, end: { x: dx, y: cardTop - cardH + 14 }, thickness: 0.7, color: C.rule });
    label(page, L.date, dx + 22, cardTop - 22, { size: 7 });
    text(page, when || '—', dx + 22, cardTop - 42, F.semi, 12, C.ink);

    // Índex
    let y = H - bandH - 58;
    const lw = label(page, L.intro, m, y, { size: 7.4, color: C.ink, sp: 1.6 });
    pill(page, L.mustRead, m + lw + 10, y + 11);
    y -= 22;
    const gap = 28;
    const colW = (W - m * 2 - gap) / 2;
    const descW = colW - 50;
    const items = sections.map((k, i) => ({
      k, n: String(i + 1).padStart(2, '0'), desc: wrap(INDEX_DESC[k](p), F.reg, 8.4, descW),
    }));
    const rows = Math.ceil(items.length / 2);
    const itemH = (it) => Math.max(40, 22 + it.desc.length * lh(8.4, 1.45)) + 16;
    const rowH = [...Array(rows)].map((_, r) => Math.max(...[items[r], items[r + rows]].filter(Boolean).map(itemH)));
    items.forEach((it, i) => {
      const col = i < rows ? 0 : 1;
      const row = i < rows ? i : i - rows;
      const x = m + col * (colW + gap);
      const top = y - rowH.slice(0, row).reduce((a, b) => a + b, 0);
      hline(page, x, x + colW, top, C.rule, 0.6);
      iconDisc(page, SECTION_ICON[it.k], x + 17, top - 30, 17, { k: 0.9 });
      text(page, it.n, x + 50, top - 23, F.bold, 9, C.olive);
      text(page, L.sections[it.k].index, x + 50 + width(it.n, F.bold, 9) + 7, top - 23, F.bold, 10.6, C.ink);
      it.desc.forEach((ln, j) => text(page, ln, x + 50, top - 37 - j * lh(8.4, 1.45), F.reg, 8.4, C.soft));
    });

    // Peu: professional
    const fy = 52;
    if (prof.contact) text(page, prof.contact, m, fy, F.med, 8, C.soft);
    textRight(page, prof.name, W - m, fy, F.bold, 8.4, C.ink);
  }

  // ── 2. Seccions d'opcions ────────────────────────────────────────────────
  const optionKeys = sections.filter(k => OPTION_SECTIONS.includes(k));
  let cur = null; // { page, y, m, W }
  const imgCache = new Map();
  const productImage = async (id) => {
    if (!imgCache.has(id)) imgCache.set(id, await embedImage(doc, productsById[id]?.imagen));
    return imgCache.get(id);
  };

  const CARD = { pad: 16, gap: 12, ts: 11.4, is: 8.8, ns: 8.2 };
  /** Mesura una targeta d'opció d'amplada w. */
  const measureOption = (o, w) => {
    const inner = w - CARD.pad * 2;
    const title = wrap(o.titulo || '', F.bold, CARD.ts, inner);
    const rows = linesOf(o.alimentos).map(a => {
      let { name, qty } = splitQuantity(a);
      let qw = qty ? width(qty, F.semi, CARD.is) : 0;
      if (qw > inner * 0.4) { name = a; qty = ''; qw = 0; }
      const lines = wrap(name, F.reg, CARD.is, inner - 10 - (qty ? qw + 12 : 0));
      return { lines, qty, h: lines.length * lh(CARD.is, 1.4) + 5 };
    });
    const nota = o.nota?.trim() ? wrap(o.nota.trim(), F.med, CARD.ns, inner - 34) : [];
    const notaH = nota.length ? Math.max(30, nota.length * lh(CARD.ns, 1.4) + 18) : 0;
    const h = CARD.pad + 15 + 10 + title.length * lh(CARD.ts, 1.25) + 12 + rows.reduce((n, r) => n + r.h, 0) + (notaH ? notaH + 8 : 0) + CARD.pad - 6;
    return { title, rows, nota, notaH, h };
  };

  const drawOption = (page, oi, x, top, w, mm, h) => {
    box(page, x, top, w, h, { r: 16, fill: C.white, stroke: C.rule });
    const ix = x + CARD.pad;
    const inner = w - CARD.pad * 2;
    let y = top - CARD.pad;
    pill(page, `${L.option} ${oi + 1}`, ix, y);
    y -= 15 + 10;
    mm.title.forEach((ln, j) => text(page, ln, ix, y - CARD.ts * 0.74 - j * lh(CARD.ts, 1.25), F.bold, CARD.ts, C.ink));
    y -= mm.title.length * lh(CARD.ts, 1.25) + 2;
    hline(page, ix, ix + inner, y, C.rule, 0.6);
    y -= 10;
    for (const r of mm.rows) {
      page.drawCircle({ x: ix + 2, y: y - CARD.is * 0.66, size: 1.8, color: C.sage });
      r.lines.forEach((ln, j) => text(page, ln, ix + 10, y - CARD.is * 0.76 - j * lh(CARD.is, 1.4) - 0.5, F.reg, CARD.is, C.ink));
      if (r.qty) textRight(page, r.qty, ix + inner, y - CARD.is * 0.76 - 0.5, F.semi, CARD.is, C.olive);
      y -= r.h;
    }
    if (mm.nota.length) {
      const ny = top - h + CARD.pad - 6 + mm.notaH;
      box(page, ix, ny, inner, mm.notaH, { r: 10, fill: C.sagePale });
      drawIcon(page, 'leaf', ix + 15, ny - mm.notaH / 2, 11, C.olive, 1.1);
      const th = mm.nota.length * lh(CARD.ns, 1.4);
      mm.nota.forEach((ln, j) => text(page, ln, ix + 28, ny - (mm.notaH - th) / 2 - CARD.ns * 0.8 - j * lh(CARD.ns, 1.4), F.med, CARD.ns, C.olive));
    }
  };

  for (const [si, key] of optionKeys.entries()) {
    const sec = p[key];
    const opts = sec.opciones.filter(o => o.titulo?.trim() || linesOf(o.alimentos).length);
    const full = PORTRAIT[0] - MARGIN * 2;
    const colW = (full - CARD.gap) / 2;
    // Una sola opció ocupa tota l'amplada; si no, graella de dues columnes
    const cols = opts.length === 1 ? 1 : 2;
    const cw = cols === 1 ? full : colW;
    const rowsOfCards = [];
    for (let i = 0; i < opts.length; i += cols) {
      const pair = opts.slice(i, i + cols).map((o, j) => ({ oi: i + j, mm: measureOption(o, cw) }));
      rowsOfCards.push({ pair, h: Math.max(...pair.map(c => c.mm.h)) });
    }

    // Les seccions curtes comparteixen pàgina si hi caben
    const firstH = rowsOfCards[0]?.h || 0;
    if (!cur || si === 0 || cur.y - 80 - firstH < BOTTOM) {
      cur = sectionPage(PORTRAIT, key);
    } else {
      cur.y = sectionHero(cur.page, key, cur.y - 10, { compact: true });
    }

    for (const row of rowsOfCards) {
      if (cur.y - row.h < BOTTOM) cur = sectionPage(PORTRAIT, key, { continued: true });
      row.pair.forEach((c, j) => drawOption(cur.page, c.oi, cur.m + j * (cw + CARD.gap), cur.y, cw, c.mm, row.h));
      cur.y -= row.h + CARD.gap;
    }

    // Nota i productes de la secció (p. ex. "Cereales que puedes elegir")
    const thumbs = (sec.productos || []).filter(id => productsById[id]?.imagen);
    const notaLines = sec.nota?.trim() ? wrap(sec.nota.trim(), F.semi, 9, full - 66) : [];
    if (notaLines.length || thumbs.length) {
      const TS = 64;
      const perRow = Math.max(1, Math.floor((full - 66 + 8) / (TS + 8)));
      const thumbRows = Math.ceil(thumbs.length / perRow);
      const thumbsH = thumbRows ? thumbRows * TS + (thumbRows - 1) * 8 : 0;
      const h = 34 + notaLines.length * lh(9, 1.4) + (thumbsH ? thumbsH + (notaLines.length ? 12 : 0) : 0);
      if (cur.y - h < BOTTOM) cur = sectionPage(PORTRAIT, key, { continued: true });
      const { page, m } = cur;
      const top = cur.y;
      box(page, m, top, full, h, { r: 16, fill: C.surface });
      iconDisc(page, notaLines.length ? 'info' : 'shoppingBasket', m + 28, top - 28, 11, { fill: C.white, color: C.orangeInk, k: 1.1 });
      let y = top - 17;
      label(page, notaLines.length ? L.note : L.sections.productos.index, m + 50, y - 6, { size: 7, color: C.orangeInk });
      y -= 14;
      notaLines.forEach((ln, j) => text(page, ln, m + 50, y - 9 * 0.76 - 2 - j * lh(9, 1.4), F.semi, 9, C.ink));
      y -= notaLines.length * lh(9, 1.4) + (notaLines.length ? 12 : 0);
      for (const [i, id] of thumbs.entries()) {
        const img = await productImage(id);
        const tx = m + 50 + (i % perRow) * (TS + 8);
        const ty = y - Math.floor(i / perRow) * (TS + 8);
        box(page, tx, ty, TS, TS, { r: 12, fill: C.white });
        if (img) drawContained(page, img, tx + 7, ty - 7, TS - 14, TS - 14);
      }
      cur.y = top - h - CARD.gap;
    }
  }

  // ── 3. Guia de quantitats ───────────────────────────────────────────────
  if (sections.includes('cantidades')) {
    let pg = sectionPage(PORTRAIT, 'cantidades');
    const { W, m } = pg;
    const full = W - m * 2;
    const nota = p.cantidades.nota?.trim();

    // La nota ("no és el màxim diari") va a dalt: és el primer que cal llegir
    if (nota) {
      const ls = wrap(nota, F.semi, 9.2, full - 70);
      const h = Math.max(48, ls.length * lh(9.2, 1.45) + 34);
      box(pg.page, m, pg.y, full, h, { r: 16, fill: C.orangePale });
      iconDisc(pg.page, 'info', m + 28, pg.y - h / 2, 12, { fill: C.white, color: C.orangeInk, k: 1.1 });
      label(pg.page, L.important, m + 52, pg.y - 19, { size: 7, color: C.orangeInk });
      ls.forEach((ln, j) => text(pg.page, ln, m + 52, pg.y - 33 - j * lh(9.2, 1.45), F.semi, 9.2, C.ink));
      pg.y -= h + CARD.gap;
    }

    const gap = CARD.gap;
    const colW = (full - gap) / 2;
    const pad = 14;
    const inner = colW - pad * 2;
    const is = 8.3;
    const labW = inner * 0.4;
    const cards = p.cantidades.grupos
      .filter(g => g.titulo?.trim() || linesOf(g.texto).length)
      .map(g => {
        const title = wrap(g.titulo || '', F.bold, 10.6, inner - 34);
        const rows = linesOf(g.texto).map(t => {
          const { label: lab, value } = splitLabel(t);
          const ll = lab ? wrap(lab, F.semi, is, labW - 8) : [];
          const vl = wrap(value, F.reg, is, lab ? inner - labW : inner);
          return { ll, vl, h: Math.max(ll.length, vl.length) * lh(is, 1.34) + 5.5 };
        });
        const headH = Math.max(22, title.length * lh(10.6, 1.25) + 8);
        const h = pad + headH + 6 + rows.reduce((n, r) => n + r.h, 0) + pad - 6;
        return { g, title, rows, headH, h };
      });

    let colY = [pg.y, pg.y];
    for (const c of cards) {
      let col = colY[0] >= colY[1] ? 0 : 1;
      if (colY[col] - c.h < BOTTOM) {
        pg = sectionPage(PORTRAIT, 'cantidades', { continued: true });
        colY = [pg.y, pg.y];
        col = 0;
      }
      const { page } = pg;
      const x = m + col * (colW + gap);
      const top = colY[col];
      box(page, x, top, colW, c.h, { r: 16, fill: C.white, stroke: C.rule });
      const ix = x + pad;
      let y = top - pad;
      iconDisc(page, groupIcon(c.g.titulo), ix + 12, y - c.headH / 2, 12, { k: 0.95 });
      const tth = c.title.length * lh(10.6, 1.25);
      c.title.forEach((ln, j) => text(page, ln, ix + 34, y - (c.headH - tth) / 2 - 10.6 * 0.8 - j * lh(10.6, 1.25), F.bold, 10.6, C.ink));
      y -= c.headH + 6;
      c.rows.forEach((r, ri) => {
        if (ri > 0) hline(page, ix, ix + inner, y + 0.5, C.rule, 0.5);
        const bl = y - 2.9 - is * 0.76;
        r.ll.forEach((ln, j) => text(page, ln, ix, bl - j * lh(is, 1.34), F.semi, is, C.ink));
        r.vl.forEach((ln, j) => text(page, ln, r.ll.length ? ix + labW : ix, bl - j * lh(is, 1.34), F.reg, is, r.ll.length ? C.soft : C.ink));
        y -= r.h;
      });
      colY[col] = top - c.h - gap;
    }
  }

  // ── 4. Menú setmanal (A4 vertical) ─────────────────────────────────────
  // Un dia per fila i les columnes Comida A/B · Cena A/B. Una sola pàgina si
  // el text hi cap a mida llegible; si no, comidas i cenas van en pàgines
  // separades (mateixa escala a totes dues).
  if (sections.includes('menu')) {
    const [W, H] = PORTRAIT;
    const m = MARGIN;
    const labelW = 22;
    const gap = 4;
    const groupGap = 10;
    const headH = 22;
    const cellPad = 7;
    const cellPadY = 5;
    const MENU = { ts: 8.4, is: 7.5, minK: 0.94, maxK: 1.15 };
    const gridTop = H - 46 - 48;

    const notas = linesOf(p.menu.notas);
    const NS = 8;
    const noteColW = (W - m * 2 - 96) / 2;
    const noteLines = notas.map(nt => wrap(nt, F.reg, NS, noteColW - 20));
    const half = Math.ceil(notas.length / 2);
    const colLines = (a) => a.reduce((s, ls) => s + ls.length, 0);
    const notesH = notas.length ? Math.max(colLines(noteLines.slice(0, half)), colLines(noteLines.slice(half))) * lh(NS, 1.42) + 24 : 0;

    // Columnes A i B de cada àpat; entre àpats, una mica més d'aire
    const columnsFor = (slots) => {
      const cols = slots.flatMap(s => MENU_VARIANTS.map(v => ({ s, v })));
      const gaps = cols.slice(1).map((c, i) => (c.s === cols[i].s ? gap : groupGap));
      const colW = (W - m * 2 - labelW - gap - gaps.reduce((a, b) => a + b, 0)) / cols.length;
      const x = [m + labelW + gap];
      gaps.forEach(g => x.push(x[x.length - 1] + colW + g));
      return { cols, colW, x };
    };

    const layoutCell = (dish, k, innerW) => {
      const ts = MENU.ts * k;
      const is = MENU.is * k;
      const chip = 12 * k;
      if (isDishEmpty(dish)) return { empty: true, chip, h: chip };
      // Sagnat penjat: la primera línia del títol deixa lloc a la marca A/B
      const title = wrap(dish.titulo || '', F.bold, ts, (i) => (i === 0 ? innerW - chip - 4 : innerW));
      const ings = linesOf(dish.alimentos).flatMap(a => wrap(a, F.reg, is, innerW));
      const h = title.length * lh(ts, 1.28) + (ings.length ? 4 + ings.length * lh(is, 1.34) : 0);
      return { title, ings, ts, is, chip, h: Math.max(h, chip), url: safeUrl(dish.receta) };
    };
    const availFor = (withNotes) => gridTop - headH - gap - (BOTTOM - 14) - (withNotes && notesH ? notesH + 8 : 0) - gap * (p.menu.dias.length - 1);
    const layoutAt = (slots, k) => {
      const { cols, colW } = columnsFor(slots);
      const cells = p.menu.dias.map(d => cols.map(({ s, v }) => layoutCell(d[s][v], k, colW - cellPad * 2)));
      const rowH = cells.map(row => Math.max(...row.map(c => c.h)) + cellPadY * 2);
      return { cells, rowH };
    };
    const fits = (slots, withNotes, k) =>
      layoutAt(slots, k).rowH.reduce((a, b) => a + b, 0) <= availFor(withNotes);
    // Escala més gran (entre lo i maxK) amb què les files hi caben, per bisecció
    const bestK = (slots, withNotes, lo = 0.6) => {
      if (fits(slots, withNotes, MENU.maxK)) return MENU.maxK;
      let hi = MENU.maxK;
      while (hi - lo > 0.01) {
        const mid = (lo + hi) / 2;
        if (fits(slots, withNotes, mid)) lo = mid; else hi = mid;
      }
      return lo;
    };

    const oneFits = fits(MENU_SLOTS, true, MENU.minK);
    let parts = [{ slots: MENU_SLOTS, k: oneFits ? bestK(MENU_SLOTS, true, MENU.minK) : 0, withNotes: true }];
    if (!oneFits) {
      const k = Math.min(bestK(['comida'], false), bestK(['cena'], true));
      parts = [
        { slots: ['comida'], k, withNotes: false, part: L.lunches },
        { slots: ['cena'], k, withNotes: true, part: L.dinners },
      ];
    }

    for (const part of parts) {
      const page = newPage(PORTRAIT);
      const top = runningHead(page);
      const { cols, colW, x: colX } = columnsFor(part.slots);
      const { cells, rowH: natural } = layoutAt(part.slots, part.k);
      // L'espai que sobra es reparteix perquè la graella ompli la pàgina
      const extra = Math.max(0, availFor(part.withNotes) - natural.reduce((a, b) => a + b, 0)) / natural.length;
      const rowH = natural.map(h => h + extra);

      // Títol compacte + llegenda A/B
      const r = 15;
      iconDisc(page, SECTION_ICON.menu, m + r, top - 6 - r, r, { k: 0.95 });
      label(page, `${secNum('menu')}  ·  ${L.sections.menu.index}`, m + r * 2 + 12, top - 15, { size: 7 });
      const title = part.part ? `${L.sections.menu.title} · ${part.part}` : L.sections.menu.title;
      spaced(page, title, m + r * 2 + 11.5, top - 35, F.display, 19, C.ink, -0.4);
      let lx = W - m;
      textRight(page, L.chooseAB, lx, top - 27, F.semi, 8.4, C.ink);
      lx -= width(L.chooseAB, F.semi, 8.4) + 18;
      for (const [v, fill] of [['B', C.sage], ['A', C.orange]]) {
        page.drawCircle({ x: lx - 7, y: top - 24, size: 7.5, color: fill });
        textCenter(page, v, lx - 7, top - 26.9, F.bold, 8, C.ink);
        lx -= 19;
      }

      // Capçalera: una franja per àpat sobre les seves columnes A i B
      for (const s of part.slots) {
        const first = cols.findIndex(c => c.s === s);
        const last = cols.findLastIndex(c => c.s === s);
        const w = colX[last] + colW - colX[first];
        box(page, colX[first], gridTop, w, headH, { r: 8, fill: C.olive });
        label(page, s === 'comida' ? L.lunch : L.dinner, colX[first] + w / 2, gridTop - 13.8, { size: 7.4, color: C.white, sp: 1.6, align: 'center' });
      }

      let y = gridTop - headH - gap;
      p.menu.dias.forEach((d, di) => {
        const h = rowH[di];
        box(page, m, y, labelW, h, { r: 8, fill: C.sage });
        const t = L.days[d.id].toUpperCase();
        const sz = 7.4;
        const lw = spacedWidth(t, F.bold, sz, 1);
        let cy = y - h / 2 - lw / 2;
        for (const ch of clean(F.bold, t)) {
          page.drawText(ch, { x: m + labelW / 2 + 2.6, y: cy, font: F.bold, size: sz, color: C.ink, rotate: degrees(90) });
          cy += F.bold.widthOfTextAtSize(ch, sz) + 1;
        }
        cells[di].forEach((c, ci) => {
          const { v } = cols[ci];
          const x = colX[ci];
          box(page, x, y, colW, h, v === 'a' ? { r: 8, fill: C.white, stroke: C.rule } : { r: 8, fill: C.surface });
          const ix = x + cellPad;
          const ty = y - cellPadY;
          const cr = c.chip / 2;
          page.drawCircle({ x: ix + cr, y: ty - cr, size: cr, color: v === 'a' ? C.orange : C.sage });
          textCenter(page, v.toUpperCase(), ix + cr, ty - cr - cr * 0.6, F.bold, cr * 1.2, C.ink);
          if (c.empty) {
            text(page, '—', ix + c.chip + 4, ty - cr - 2.8, F.reg, 8, C.soft);
            return;
          }
          c.title.forEach((ln, j) => {
            const lx2 = j === 0 ? ix + c.chip + 4 : ix;
            const bl = ty - cr - c.ts * 0.36 - j * lh(c.ts, 1.28);
            const color = c.url ? C.orangeInk : C.ink;
            text(page, ln, lx2, bl, F.bold, c.ts, color);
            if (c.url) {
              const lw = width(ln, F.bold, c.ts);
              page.drawLine({ start: { x: lx2, y: bl - 1.5 }, end: { x: lx2 + lw, y: bl - 1.5 }, thickness: 0.55, color });
              addLink(doc, page, [lx2, bl - 3, lx2 + lw, bl + c.ts], c.url);
            }
          });
          const iy = ty - cr - c.ts * 0.36 - (c.title.length - 1) * lh(c.ts, 1.28) - 4;
          c.ings.forEach((ln, j) => text(page, ln, ix, iy - c.is * 1.1 - j * lh(c.is, 1.34), F.reg, c.is, C.soft));
        });
        y -= h + gap;
      });

      if (part.withNotes && notesH) {
        const ntop = y - 4;
        const w = W - m * 2;
        box(page, m, ntop, w, notesH, { r: 12, fill: C.surface });
        iconDisc(page, 'info', m + 22, ntop - notesH / 2, 10, { fill: C.white, color: C.orangeInk, k: 1.1 });
        label(page, L.notes, m + 40, ntop - notesH / 2 - 2.5, { size: 7, color: C.orangeInk });
        [noteLines.slice(0, half), noteLines.slice(half)].forEach((list, col) => {
          let ny = ntop - 12 - NS * 0.76;
          const nx = m + 96 + col * noteColW;
          for (const ls of list) {
            page.drawCircle({ x: nx + 2, y: ny + 2.7, size: 1.7, color: C.sage });
            ls.forEach((ln, j) => text(page, ln, nx + 9, ny - j * lh(NS, 1.42), F.reg, NS, C.ink));
            ny -= ls.length * lh(NS, 1.42);
          }
        });
      }
    }
  }

  // ── 5. Productes ─────────────────────────────────────────────────────────
  if (sections.includes('productos')) {
    let pg = sectionPage(PORTRAIT, 'productos');
    const cols = 4;
    const gap = CARD.gap;
    const cardW = (pg.W - pg.m * 2 - gap * (cols - 1)) / cols;
    const imgH = cardW * 0.94;
    const ns = 8.6;
    const list = p.productos.map(id => productsById[id]).filter(Boolean);
    for (let i = 0; i < list.length; i += cols) {
      const row = list.slice(i, i + cols);
      const names = row.map(pr => wrap(pr.nombre || '', F.semi, ns, cardW - 4).slice(0, 2));
      const h = imgH + 12 + Math.max(1, ...names.map(n => n.length)) * lh(ns, 1.3);
      if (pg.y - h < BOTTOM) pg = sectionPage(PORTRAIT, 'productos', { continued: true });
      for (const [j, pr] of row.entries()) {
        const x = pg.m + j * (cardW + gap);
        box(pg.page, x, pg.y, cardW, imgH, { r: 16, fill: C.white, stroke: C.rule });
        const img = await productImage(pr.id);
        if (img) drawContained(pg.page, img, x + 14, pg.y - 14, cardW - 28, imgH - 28);
        names[j].forEach((ln, li) => text(pg.page, ln, x + 2, pg.y - imgH - 13 - li * lh(ns, 1.3), F.semi, ns, C.ink));
      }
      pg.y -= h + 18;
    }
  }

  // ── Peu de pàgina (excepte portada) ──────────────────────────────────────
  const n = pages.length;
  pages.forEach((page, i) => {
    if (i === 0) return;
    const { width: W } = page.getSize();
    const m = MARGIN;
    const bl = 24;
    text(page, [prof.name, prof.col].filter(Boolean).join('   ·   '), m, bl, F.med, 7.6, C.soft);
    if (config?.web) textCenter(page, config.web, W / 2, bl, F.med, 7.6, C.soft);
    const folio = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    textRight(page, folio, W - m, bl, F.bold, 7.6, C.ink);
  });

  return doc.save();
}
