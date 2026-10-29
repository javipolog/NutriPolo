/**
 * pdfPlanificacionGenerator.js — NutriPolo
 * =================================
 * PDF de la planificació setmanal (substitueix el disseny de Canva):
 * portada amb índex, opcions d'esmorzar / mig matí / berenar, guia de
 * quantitats, menú setmanal en horitzontal (amb enllaços a receptes) i
 * productes. Vectorial amb pdf-lib + fontkit (Poppins, OFL).
 */

import { PDFDocument, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  normalizePlanificacion, visibleSections, linesOf, isDishEmpty, safeUrl,
  MENU_SLOTS, MENU_VARIANTS, OPTION_SECTIONS,
} from './planificacion';

// ── Pàgina ─────────────────────────────────────────────────────────────────
const PORTRAIT = [595.28, 841.89];
const LANDSCAPE = [841.89, 595.28];
const MARGIN = 48;
const FOOTER_H = 40;

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// Paleta del logo NutriPolo (sage #BFCA89 + taronja #F6AB66). Els tons
// foscos són els que porten text petit (contrast AA sobre blanc/crema).
const C = {
  cream:      hex('#FBFAF3'),
  sage:       hex('#BFCA89'),
  sageSoft:   hex('#DCE4BC'),
  sagePale:   hex('#EEF2DD'),
  olive:      hex('#5F6E32'),
  oliveInk:   hex('#3D4723'),
  orange:     hex('#F6AB66'),
  orangePale: hex('#FDEEDF'),
  orangeDeep: hex('#A65A1A'),
  ink:        hex('#2B2F24'),
  muted:      hex('#5E6453'),
  line:       hex('#E3E7D3'),
  white:      rgb(1, 1, 1),
};

const L = {
  planning: 'PLANIFICACIÓN',
  nutrition: 'DE ALIMENTACIÓN',
  intro: 'INTRODUCCIÓN (IMPORTANTE LEER)',
  option: 'OPCIÓN',
  notes: 'NOTAS',
  important: 'IMPORTANTE',
  chooseAB: 'Elige una de las dos opciones (A o B)',
  lunch: 'COMIDAS',
  dinner: 'CENAS',
  colegiada: 'Nº colegiada',
  days: {
    lunes: 'LUNES', martes: 'MARTES', miercoles: 'MIÉRCOLES', jueves: 'JUEVES',
    viernes: 'VIERNES', sabado: 'SÁBADO', domingo: 'DOMINGO',
  },
  sections: {
    desayunos:   { index: 'Desayunos',          title: 'Opciones de desayuno',   sub: 'Elige cada día la opción que prefieras.' },
    mediaManana: { index: 'Media mañana',       title: 'Opciones de media mañana', sub: 'Elige cada día la opción que prefieras.' },
    merienda:    { index: 'Merienda',           title: 'Opciones de merienda',   sub: 'Elige cada día la opción que prefieras.' },
    cantidades:  { index: 'Guía de cantidades', title: 'Guía de cantidades',     sub: 'Cantidades aproximadas de una ración para ti, por alimento.' },
    menu:        { index: 'Menú semanal',       title: 'Menú semanal',           sub: 'Comidas y cenas de lunes a domingo.' },
    productos:   { index: 'Productos',          title: 'Productos del menú',     sub: '' },
  },
};

const INDEX_DESC = {
  desayunos:   () => 'Tabla con las diferentes opciones para desayunar. Elige cada día la que prefieras.',
  mediaManana: () => 'Tabla con las diferentes opciones para media mañana. Elige cada día la que prefieras.',
  merienda:    () => 'Tabla con las diferentes opciones para la merienda. Elige cada día la que prefieras.',
  cantidades:  () => 'Lo que es una ración para ti. No es el máximo diario: es la cantidad que tienes que poner cada vez que tomes ese alimento.',
  menu:        () => 'Menú de lunes a domingo con dos opciones (A y B) por comida y cena. Los platos subrayados te llevan a la receta. Las cantidades que no se indican están en la guía de cantidades.',
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

// ── Fonts ──────────────────────────────────────────────────────────────────
const FONT_FILES = {
  reg: 'Poppins-Regular.ttf', med: 'Poppins-Medium.ttf', semi: 'Poppins-SemiBold.ttf', bold: 'Poppins-Bold.ttf',
};

const fontCache = {};
async function fetchFont(filename) {
  if (fontCache[filename]) return fontCache[filename];
  const resp = await fetch(`/fonts/${filename}`);
  if (!resp.ok) throw new Error(`Font not found: ${filename}`);
  fontCache[filename] = new Uint8Array(await resp.arrayBuffer());
  return fontCache[filename];
}

async function embedFonts(doc, loadFont) {
  try {
    doc.registerFontkit(fontkit);
    const pairs = await Promise.all(Object.entries(FONT_FILES).map(async ([k, file]) =>
      [k, await doc.embedFont(await loadFont(file), { subset: true })]));
    return Object.fromEntries(pairs);
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('Planificación PDF: Poppins unavailable, using Helvetica:', err);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return { reg, med: reg, semi: bold, bold };
  }
}

// Caràcters que la font pot no tenir → alternatives, en ordre.
const ALTERNATIVES = {
  '⟶': ['→', '->'], '→': ['->'], '–': ['-'], '—': ['-'], '…': ['...'],
  '“': ['"'], '”': ['"'], '‘': ["'"], '’': ["'"], '•': ['·', '-'], '½': ['1/2'], '¼': ['1/4'],
  ' ': [' '], ' ': [' '], ' ': [' '], '\t': [' '],
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
  const san = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, makeSanitizer(f)]));
  const fontKey = new Map(Object.entries(F).map(([k, f]) => [f, k]));
  const clean = (font, s) => san[fontKey.get(font)](s);
  const width = (s, font, size) => font.widthOfTextAtSize(clean(font, s), size);
  const lh = (size) => size * 1.42;

  function wrap(s, font, size, maxW) {
    const out = [];
    for (const para of String(s ?? '').split(/\r?\n/)) {
      const words = clean(font, para).split(/\s+/).filter(Boolean);
      let line = '';
      for (let word of words) {
        // Paraules més llargues que la línia (URLs…) es tallen per caràcters
        while (font.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxW) cut--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
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

  const box = (page, x, top, w, h, { r = 8, fill, stroke, strokeWidth = 0.7, opacity } = {}) =>
    page.drawSvgPath(roundedRectPath(w, h, r), {
      x, y: top, color: fill, opacity,
      borderColor: stroke, borderWidth: stroke ? strokeWidth : 0,
    });

  const background = (page) => {
    const { width: W, height: H } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
  };

  const topWave = (page, h) => {
    const { width: W, height: H } = page.getSize();
    page.drawSvgPath(`M0,0 H${W} V${h * 0.92} C${W * 0.74},${h * 1.22} ${W * 0.4},${h * 0.62} 0,${h * 1.04} Z`, { x: 0, y: H, color: C.sageSoft });
    page.drawSvgPath(`M0,0 H${W} V${h * 0.7} C${W * 0.7},${h * 1.02} ${W * 0.36},${h * 0.38} 0,${h * 0.84} Z`, { x: 0, y: H, color: C.sage });
  };

  const clientName = client?.nombre || '';
  const pages = [];

  /** Pàgina de secció: fons, onada, capçalera i títol. Retorna la y on comença el contingut. */
  function sectionPage(size, key, { continued = false } = {}) {
    const page = doc.addPage(size);
    pages.push(page);
    background(page);
    const { width: W, height: H } = page.getSize();
    const landscape = W > H;
    const waveH = landscape ? 58 : 74;
    const m = landscape ? 30 : MARGIN;
    topWave(page, waveH);
    spaced(page, 'NUTRIPOLO', m, H - 24, F.bold, 7.5, C.oliveInk, 1.6);
    text(page, [p.nombre, clientName].filter(Boolean).join('  ·  '), m, H - 36, F.med, 7.5, C.oliveInk);
    page.drawCircle({ x: W - m - 16, y: H - 27, size: 19, color: C.white });
    drawLogo(page, W - m - 28, H - 17, 24);

    const titleTop = H - waveH - (landscape ? 8 : 24);
    const meta = L.sections[key];
    const title = continued ? `${meta.title} (cont.)` : meta.title;
    const tSize = landscape ? 19 : 22;
    text(page, title, m, titleTop - tSize, F.bold, tSize, C.oliveInk);
    page.drawRectangle({ x: m, y: titleTop - tSize - 9, width: 34, height: 3, color: C.orange });
    let y = titleTop - tSize - 14;
    const sub = key === 'productos' && p.supermercado ? `Los de tu planificación son de ${p.supermercado}.` : meta.sub;
    if (sub && !continued) {
      text(page, sub, m, y - 11, F.reg, 9, C.muted);
      y -= 14;
    }
    return { page, y: y - 14, m, W, H };
  }

  // ── 1. Portada ───────────────────────────────────────────────────────────
  {
    const page = doc.addPage(PORTRAIT);
    pages.push(page);
    background(page);
    const [W, H] = PORTRAIT;
    const bandH = 300;
    page.drawSvgPath(`M0,0 H${W} V${bandH * 0.86} C${W * 0.72},${bandH * 1.12} ${W * 0.42},${bandH * 0.7} 0,${bandH * 1.0} Z`, { x: 0, y: H, color: C.sageSoft });
    page.drawSvgPath(`M0,0 H${W} V${bandH * 0.72} C${W * 0.7},${bandH * 0.98} ${W * 0.38},${bandH * 0.5} 0,${bandH * 0.86} Z`, { x: 0, y: H, color: C.sage });

    spaced(page, 'NUTRIPOLO', MARGIN, H - 62, F.bold, 9, C.oliveInk, 2.4);
    text(page, L.planning, MARGIN - 2, H - 118, F.bold, 44, C.oliveInk);
    spaced(page, L.nutrition, MARGIN, H - 146, F.med, 15, C.oliveInk, 3);

    // Número de planificació
    if (p.numero) {
      const cx = W - MARGIN - 34;
      const cy = H - 104;
      page.drawCircle({ x: cx, y: cy, size: 34, color: C.orange });
      page.drawCircle({ x: cx, y: cy, size: 34, borderColor: C.white, borderWidth: 2.5 });
      textCenter(page, String(p.numero), cx, cy - 13, F.bold, 36, C.ink);
    }

    // Nom del client
    let y = H - 214;
    if (clientName) {
      const nSize = clientName.length > 30 ? 13 : 15;
      const pw = width(clientName, F.semi, nSize) + 40;
      box(page, MARGIN + 2, y - 2, pw, 34, { r: 17, fill: C.oliveInk, opacity: 0.12 });
      box(page, MARGIN, y, pw, 34, { r: 17, fill: C.white });
      text(page, clientName, MARGIN + 20, y - 22, F.semi, nSize, C.ink);
      const when = monthYear(p.fechaInicio);
      if (when) text(page, when, MARGIN + pw + 14, y - 21, F.med, 10, C.oliveInk);
      y -= 34;
    }

    // Índex
    y = H - bandH - 26;
    page.drawRectangle({ x: 0, y: y - 30, width: W, height: 30, color: C.olive });
    textCenter(page, L.intro, W / 2, y - 20, F.semi, 12, C.white);
    y -= 62;

    const colW = (W - MARGIN * 2 - 28) / 2;
    const rows = Math.ceil(sections.length / 2);
    const items = sections.map((k, i) => {
      const desc = wrap(INDEX_DESC[k](p), F.reg, 8.6, colW - 58);
      return { k, i, desc, h: 22 + desc.length * lh(8.6) };
    });
    const rowH = [];
    for (let r = 0; r < rows; r++) rowH.push(Math.max(54, ...items.filter(it => Math.floor(it.i / 2) === r).map(it => it.h)) + 22);
    // Columna esquerra 01..N/2, dreta la resta (com a Canva): ordre per columnes
    const order = items.map((it, i) => ({ ...it, col: i < rows ? 0 : 1, row: i < rows ? i : i - rows }));
    for (const it of order) {
      const x = MARGIN + it.col * (colW + 28);
      const top = y - rowH.slice(0, it.row).reduce((a, b) => a + b, 0);
      page.drawCircle({ x: x + 21, y: top - 19, size: 21, color: C.sage });
      textCenter(page, String(it.i + 1).padStart(2, '0'), x + 21, top - 24.5, F.bold, 14, C.oliveInk);
      text(page, L.sections[it.k].index.toUpperCase(), x + 56, top - 14, F.bold, 11, C.ink);
      it.desc.forEach((ln, j) => text(page, ln, x + 56, top - 30 - j * lh(8.6), F.reg, 8.6, C.muted));
    }

    // Peu de portada: logo + professional
    const fy = 70;
    page.drawCircle({ x: MARGIN + 34, y: fy, size: 34, color: C.white });
    drawLogo(page, MARGIN + 13, fy + 19, 42);
    const lines = [
      config?.nombre,
      config?.numColegiada ? `${L.colegiada}: ${config.numColegiada}` : '',
      [config?.web, config?.email, config?.telefono].filter(Boolean).join('  ·  '),
    ].filter(Boolean);
    lines.forEach((ln, i) => text(page, ln, MARGIN + 82, fy + 10 - i * 12, i === 0 ? F.semi : F.reg, i === 0 ? 10 : 8, i === 0 ? C.ink : C.muted));
  }

  const BOTTOM = FOOTER_H + 12;

  // ── 2. Seccions d'opcions ────────────────────────────────────────────────
  const optionKeys = sections.filter(k => OPTION_SECTIONS.includes(k));
  let cur = null; // { page, y, m, W }
  const imgCache = new Map();
  const productImage = async (id) => {
    if (!imgCache.has(id)) imgCache.set(id, await embedImage(doc, productsById[id]?.imagen));
    return imgCache.get(id);
  };

  for (const [si, key] of optionKeys.entries()) {
    const sec = p[key];
    const opts = sec.opciones.filter(o => o.titulo?.trim() || linesOf(o.alimentos).length);
    const leftW = 176;
    const pad = 14;

    const measure = (o, w) => {
      const titleLines = wrap(o.titulo || '', F.semi, 10.5, leftW - pad * 2);
      const rightW = w - leftW - pad * 2 - 12;
      const items = linesOf(o.alimentos).map(a => wrap(a, F.reg, 9, rightW - 12));
      const nota = o.nota?.trim() ? wrap(o.nota.trim(), F.med, 8.5, rightW - 8) : [];
      const leftH = 14 + titleLines.length * lh(10.5);
      const rightH = items.reduce((n, ls) => n + ls.length * lh(9) + 2, 0) + (nota.length ? 6 + nota.length * lh(8.5) : 0);
      return { titleLines, items, nota, rightW, h: Math.max(58, Math.max(leftH, rightH) + pad * 2) };
    };

    // Les seccions curtes comparteixen pàgina si hi caben
    const firstH = opts.length ? measure(opts[0], PORTRAIT[0] - MARGIN * 2).h : 0;
    const needHeader = 70;
    if (!cur || si === 0 || cur.y - needHeader - firstH < BOTTOM) {
      cur = sectionPage(PORTRAIT, key);
    } else {
      const { page, m } = cur;
      let y = cur.y - 20;
      text(page, L.sections[key].title, m, y - 20, F.bold, 20, C.oliveInk);
      page.drawRectangle({ x: m, y: y - 29, width: 34, height: 3, color: C.orange });
      text(page, L.sections[key].sub, m, y - 45, F.reg, 9, C.muted);
      cur.y = y - 62;
    }

    for (const [oi, o] of opts.entries()) {
      const w = cur.W - cur.m * 2;
      let mm = measure(o, w);
      if (cur.y - mm.h < BOTTOM) {
        cur = sectionPage(PORTRAIT, key, { continued: true });
        mm = measure(o, w);
      }
      const { page, m } = cur;
      const top = cur.y;
      box(page, m + 1.5, top - 2, w, mm.h, { r: 12, fill: C.sageSoft, opacity: 0.55 });
      box(page, m, top, w, mm.h, { r: 12, fill: C.white, stroke: C.line });
      box(page, m + 5, top - 5, leftW - 10, mm.h - 10, { r: 9, fill: C.sagePale });

      // Esquerra: etiqueta + títol, centrats verticalment
      const leftContent = 14 + mm.titleLines.length * lh(10.5);
      let ly = top - (mm.h - leftContent) / 2;
      spaced(page, `${L.option} ${oi + 1}`, m + pad, ly - 7, F.bold, 6.8, C.orangeDeep, 1.2);
      ly -= 14;
      mm.titleLines.forEach((ln, j) => text(page, ln, m + pad, ly - 9 - j * lh(10.5), F.semi, 10.5, C.ink));

      // Dreta: aliments amb pics + nota
      const rx = m + leftW + 12;
      const rightContent = mm.h - pad * 2;
      const used = mm.items.reduce((n, ls) => n + ls.length * lh(9) + 2, 0) + (mm.nota.length ? 6 + mm.nota.length * lh(8.5) : 0);
      let ry = top - pad - Math.max(0, (rightContent - used) / 2);
      for (const ls of mm.items) {
        page.drawCircle({ x: rx + 3, y: ry - 6.2, size: 1.9, color: C.orange });
        ls.forEach((ln, j) => text(page, ln, rx + 12, ry - 9 - j * lh(9), F.reg, 9, C.ink));
        ry -= ls.length * lh(9) + 2;
      }
      if (mm.nota.length) {
        ry -= 6;
        page.drawRectangle({ x: rx, y: ry - mm.nota.length * lh(8.5) + 1, width: 2, height: mm.nota.length * lh(8.5) - 2, color: C.orange });
        mm.nota.forEach((ln, j) => text(page, ln, rx + 8, ry - 8.5 - j * lh(8.5), F.med, 8.5, C.muted));
      }
      cur.y = top - mm.h - 9;
    }

    // Nota i productes de la secció (p. ex. "Cereales que puedes elegir")
    const thumbs = (sec.productos || []).filter(id => productsById[id]?.imagen);
    const notaLines = sec.nota?.trim() ? wrap(sec.nota.trim(), F.med, 9, cur.W - cur.m * 2 - 28) : [];
    if (notaLines.length || thumbs.length) {
      const thumbH = thumbs.length ? 74 : 0;
      const h = 22 + notaLines.length * lh(9) + (thumbH ? thumbH + 10 : 0);
      if (cur.y - h < BOTTOM) cur = sectionPage(PORTRAIT, key, { continued: true });
      const { page, m } = cur;
      const w = cur.W - m * 2;
      const top = cur.y - 4;
      box(page, m, top, w, h, { r: 12, fill: C.orangePale });
      let y = top - 12;
      notaLines.forEach((ln, j) => text(page, ln, m + 14, y - 9 - j * lh(9), F.med, 9, C.ink));
      y -= notaLines.length * lh(9) + (notaLines.length ? 8 : 0);
      let tx = m + 14;
      for (const id of thumbs) {
        const img = await productImage(id);
        if (!img) continue;
        if (tx + 74 > m + w - 10) break;
        box(page, tx, y, 74, thumbH, { r: 8, fill: C.white });
        drawContained(page, img, tx + 5, y - 5, 64, thumbH - 10);
        tx += 82;
      }
      cur.y = top - h - 10;
    }
  }

  // ── 3. Guia de quantitats ───────────────────────────────────────────────
  if (sections.includes('cantidades')) {
    let pg = sectionPage(PORTRAIT, 'cantidades');
    const gap = 14;
    const colW = (pg.W - pg.m * 2 - gap) / 2;
    const cards = p.cantidades.grupos
      .filter(g => g.titulo?.trim() || linesOf(g.texto).length)
      .map(g => {
        const title = wrap(g.titulo || '', F.semi, 10.5, colW - 28);
        const items = linesOf(g.texto).map(t => wrap(t, F.reg, 8.8, colW - 40));
        const h = 16 + title.length * lh(10.5) + 10 + items.reduce((n, ls) => n + ls.length * lh(8.8) + 2, 0) + 12;
        return { title, items, h };
      });
    const notaLines = p.cantidades.nota?.trim() ? wrap(p.cantidades.nota.trim(), F.med, 9, pg.W - pg.m * 2 - 90) : [];
    const notaH = notaLines.length ? 24 + notaLines.length * lh(9) : 0;

    let colY = [pg.y, pg.y];
    for (const c of cards) {
      let col = colY[0] >= colY[1] ? 0 : 1;
      if (colY[col] - c.h < BOTTOM) {
        pg = sectionPage(PORTRAIT, 'cantidades', { continued: true });
        colY = [pg.y, pg.y];
        col = 0;
      }
      const { page, m } = pg;
      const x = m + col * (colW + gap);
      const top = colY[col];
      box(page, x + 1.5, top - 2, colW, c.h, { r: 12, fill: C.sageSoft, opacity: 0.55 });
      box(page, x, top, colW, c.h, { r: 12, fill: C.white, stroke: C.line });
      const headH = 10 + c.title.length * lh(10.5);
      box(page, x + 6, top - 6, colW - 12, headH, { r: 8, fill: C.sagePale });
      c.title.forEach((ln, j) => text(page, ln, x + 14, top - 6 - 5 - 10 - j * lh(10.5) + 2, F.semi, 10.5, C.oliveInk));
      let y = top - 6 - headH - 8;
      for (const ls of c.items) {
        page.drawCircle({ x: x + 17, y: y - 6, size: 1.8, color: C.orange });
        ls.forEach((ln, j) => text(page, ln, x + 25, y - 8.8 - j * lh(8.8), F.reg, 8.8, C.ink));
        y -= ls.length * lh(8.8) + 2;
      }
      colY[col] = top - c.h - gap;
    }

    if (notaH) {
      let y = Math.min(...colY) - 4;
      if (y - notaH < BOTTOM) { pg = sectionPage(PORTRAIT, 'cantidades', { continued: true }); y = pg.y; }
      const { page, m, W } = pg;
      box(page, m, y, W - m * 2, notaH, { r: 12, fill: C.orangePale });
      spaced(page, L.important, m + 14, y - 15 - (notaH - 24) / 2 + 3, F.bold, 7.5, C.orangeDeep, 1.2);
      notaLines.forEach((ln, j) => text(page, ln, m + 90, y - 12 - 9 - j * lh(9) + 2, F.med, 9, C.ink));
    }
  }

  // ── 4. Menú setmanal (A4 horitzontal) ───────────────────────────────────
  if (sections.includes('menu')) {
    const pg = sectionPage(LANDSCAPE, 'menu');
    const { page, m, W } = pg;

    // Recordatori A/B a la dreta del títol
    const hint = L.chooseAB;
    const hw = width(hint, F.med, 8.5) + 24;
    box(page, W - m - hw, pg.y + 44, hw, 20, { r: 10, fill: C.white, stroke: C.line });
    text(page, hint, W - m - hw + 12, pg.y + 44 - 13.5, F.med, 8.5, C.oliveInk);

    const notas = linesOf(p.menu.notas);
    const labelW = 22;
    const gap = 4;
    const colW = (W - m * 2 - labelW - gap * 7) / 7;
    const headH = 20;
    const notesH = notas.length ? 18 + Math.ceil(notas.length / 2) * lh(7.6) + 10 : 0;
    const gridTop = pg.y + 6;
    const avail = gridTop - headH - gap - BOTTOM + 14 - (notesH ? notesH + 8 : 0);

    const rowsDef = MENU_SLOTS.flatMap(s => MENU_VARIANTS.map(v => ({ s, v })));
    const cellPad = 6;
    const innerW = colW - cellPad * 2;

    const layoutCell = (dish, k) => {
      const ts = 7.7 * k;
      const is = 6.8 * k;
      if (isDishEmpty(dish)) return { empty: true, h: 13 * k + 12 };
      const title = wrap(dish.titulo || '', F.semi, ts, innerW);
      const ings = linesOf(dish.alimentos).flatMap(a => wrap(a, F.reg, is, innerW));
      const h = 13 * k + 4 + title.length * lh(ts) + (ings.length ? 3 + ings.length * lh(is) : 0);
      return { title, ings, ts, is, h, url: safeUrl(dish.receta) };
    };

    // Escala de text: la més gran amb què la graella hi cap
    let k = 1.3;
    let cells;
    let rowH;
    for (; ; k -= 0.04) {
      cells = rowsDef.map(({ s, v }) => p.menu.dias.map(d => layoutCell(d[s][v], k)));
      rowH = cells.map(row => Math.max(...row.map(c => c.h)) + cellPad * 2);
      if (rowH.reduce((a, b) => a + b, 0) + gap * 3 <= avail || k <= 0.7) break;
    }
    // Reparteix l'espai que sobra perquè la graella ompli la pàgina
    const total = rowH.reduce((a, b) => a + b, 0) + gap * 3;
    if (total < avail) rowH = rowH.map(h => h + (avail - total) / 4);

    // Capçalera de dies
    const x0 = m + labelW + gap;
    p.menu.dias.forEach((d, i) => {
      const x = x0 + i * (colW + gap);
      box(page, x, gridTop, colW, headH, { r: 7, fill: C.sage });
      textCenter(page, L.days[d.id], x + colW / 2, gridTop - 13.5, F.bold, 8.5, C.oliveInk);
    });

    let y = gridTop - headH - gap;
    rowsDef.forEach(({ s, v }, ri) => {
      // Etiqueta vertical (COMIDAS / CENAS) per a cada parell A/B
      if (v === 'a') {
        const h = rowH[ri] + gap + rowH[ri + 1];
        box(page, m, y, labelW, h, { r: 8, fill: C.olive });
        const label = s === 'comida' ? L.lunch : L.dinner;
        const lw = spacedWidth(label, F.bold, 8, 1.6);
        let cy = y - h / 2 - lw / 2;
        for (const ch of clean(F.bold, label)) {
          page.drawText(ch, { x: m + labelW / 2 + 3, y: cy, font: F.bold, size: 8, color: C.white, rotate: degrees(90) });
          cy += F.bold.widthOfTextAtSize(ch, 8) + 1.6;
        }
      }
      cells[ri].forEach((c, di) => {
        const x = x0 + di * (colW + gap);
        const h = rowH[ri];
        box(page, x, y, colW, h, { r: 8, fill: v === 'a' ? C.white : C.sagePale, stroke: v === 'a' ? C.line : undefined });
        const cx = x + colW / 2;
        let ty = y - (h - c.h) / 2 - 2;
        // Distintiu A / B
        page.drawCircle({ x: cx, y: ty - 6 * k, size: 6 * k, color: v === 'a' ? C.orange : C.sage });
        textCenter(page, v.toUpperCase(), cx, ty - 8.6 * k, F.bold, 7 * k, C.ink);
        ty -= 13 * k + 4;
        if (c.empty) {
          textCenter(page, '—', cx, ty - 8, F.reg, 8, C.muted);
          return;
        }
        c.title.forEach((ln, j) => {
          const bl = ty - c.ts - j * lh(c.ts) + 1.5;
          const color = c.url ? C.orangeDeep : C.ink;
          textCenter(page, ln, cx, bl, F.semi, c.ts, color);
          if (c.url) {
            const lw = width(ln, F.semi, c.ts);
            page.drawLine({ start: { x: cx - lw / 2, y: bl - 1.4 }, end: { x: cx + lw / 2, y: bl - 1.4 }, thickness: 0.6, color });
            addLink(doc, page, [cx - lw / 2, bl - 3, cx + lw / 2, bl + c.ts], c.url);
          }
        });
        ty -= c.title.length * lh(c.ts);
        if (c.ings.length) {
          ty -= 3;
          c.ings.forEach((ln, j) => textCenter(page, ln, cx, ty - c.is - j * lh(c.is) + 1.5, F.reg, c.is, C.muted));
        }
      });
      y -= rowH[ri] + gap;
    });

    if (notesH) {
      const top = y - 4;
      const w = W - m * 2;
      box(page, m, top, w, notesH, { r: 10, fill: C.orangePale });
      spaced(page, L.notes, m + 14, top - 14, F.bold, 7.5, C.orangeDeep, 1.2);
      const half = Math.ceil(notas.length / 2);
      const nColW = (w - 28) / 2;
      notas.forEach((n, i) => {
        const col = i < half ? 0 : 1;
        const row = i < half ? i : i - half;
        const nx = m + 14 + col * nColW;
        const ny = top - 26 - row * lh(7.6);
        page.drawCircle({ x: nx + 2, y: ny + 2.6, size: 1.6, color: C.orange });
        const ln = wrap(n, F.reg, 7.6, nColW - 16)[0] || '';
        text(page, ln, nx + 9, ny, F.reg, 7.6, C.ink);
      });
    }
  }

  // ── 5. Productes ─────────────────────────────────────────────────────────
  if (sections.includes('productos')) {
    let pg = sectionPage(PORTRAIT, 'productos');
    const cols = 4;
    const gap = 12;
    const cardW = (pg.W - pg.m * 2 - gap * (cols - 1)) / cols;
    const imgH = 96;
    const list = p.productos.map(id => productsById[id]).filter(Boolean);
    let i = 0;
    while (i < list.length) {
      const row = list.slice(i, i + cols);
      const names = row.map(pr => wrap(pr.nombre || '', F.semi, 8.5, cardW - 16).slice(0, 2));
      const h = imgH + 18 + Math.max(1, ...names.map(n => n.length)) * lh(8.5);
      if (pg.y - h < BOTTOM) pg = sectionPage(PORTRAIT, 'productos', { continued: true });
      for (const [j, pr] of row.entries()) {
        const x = pg.m + j * (cardW + gap);
        box(pg.page, x + 1.5, pg.y - 2, cardW, h, { r: 12, fill: C.sageSoft, opacity: 0.55 });
        box(pg.page, x, pg.y, cardW, h, { r: 12, fill: C.white, stroke: C.line });
        const img = await productImage(pr.id);
        if (img) drawContained(pg.page, img, x + 8, pg.y - 8, cardW - 16, imgH - 8);
        names[j].forEach((ln, li) => textCenter(pg.page, ln, x + cardW / 2, pg.y - imgH - 10 - li * lh(8.5), F.semi, 8.5, C.ink));
      }
      pg.y -= h + gap;
      i += cols;
    }
  }

  // ── Peu de pàgina (excepte portada) ──────────────────────────────────────
  const n = pages.length;
  pages.forEach((page, i) => {
    if (i === 0) return;
    const { width: W } = page.getSize();
    const m = W > PORTRAIT[0] ? 30 : MARGIN;
    page.drawLine({ start: { x: m, y: 30 }, end: { x: W - m, y: 30 }, thickness: 0.6, color: C.line });
    drawLogo(page, m, 24, 13);
    text(page, config?.nombre || 'NutriPolo', m + 18, 15, F.med, 7.5, C.muted);
    const right = `${i + 1} / ${n}`;
    text(page, right, W - m - width(right, F.med, 7.5), 15, F.med, 7.5, C.muted);
    if (config?.web) textCenter(page, config.web, W / 2, 15, F.reg, 7.5, C.muted);
  });

  return doc.save();
}
