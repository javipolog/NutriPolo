/**
 * pdfInvoiceGenerator.js — NutriPolo
 * ====================================
 * PDF vectorial de la factura amb pdf-lib + fontkit (Onest).
 *
 * De dalt a baix: marca i títol amb número i data · professional i client
 * en dues columnes · taula de conceptes (continua a la pàgina següent si cal)
 * · forma de pagament al costat dels totals · rectificació, notes i menció
 * d'exempció d'IVA · peu amb el contacte i la pàgina.
 * Els colors surten del disseny triat a Ajustos (validateDesign).
 * Retorna Uint8Array amb els bytes del PDF.
 */

import { PDFDocument, rgb, LineCapStyle, StandardFonts, setCharacterSpacing } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { validateDesign } from './invoiceDesignPresets';
import { ONEST_FILES, fetchFont } from './pdfFonts';
import { drawLogoMark, logoMarkHeight } from './pdfLogo';
import { invoiceParties, recipientAddressLines, isCorrective, DEFAULT_VAT_EXEMPTION_TEXT, formatIban } from './invoicing';

// ─── Pàgina (punts) ─────────────────────────────────────────
const A4_W = 595.28;
const A4_H = 841.89;
const M = 48;                        // marges laterals
const R = A4_W - M;                  // vora dreta del contingut
const W = R - M;
const TOP = A4_H - 50;               // dalt del contingut
const GUTTER = 32;
const COL_W = (W - GUTTER) / 2;      // columnes professional / client
const RX = M + COL_W + GUTTER;
const FOOTER_LINE = 50;              // filet del peu: per sota només hi ha el peu
const BOTTOM = FOOTER_LINE + 20;     // el contingut no baixa d'aquí

// Escala tipogràfica: una mida per rol, res per sota de 7 pt
const T = { label: 7, small: 8, body: 9, name: 10.5, total: 16, title: 22 };
const LH = { small: 11.5, body: 12.5, name: 14 };
const TRACK = 0.8;                   // espaiat de les etiquetes en majúscules

// Taula de conceptes
const COLS = { amountR: R, priceR: R - 82, qtyC: R - 162 };
const DESC_W = COLS.qtyC - 26 - M;
const ROW_PAD = 8;

// Bloc de totals (a la dreta)
const TOTALS_W = 224;
const TOTALS_X = R - TOTALS_W;
const TOTAL_BAND_H = 36;

const LABELS = {
  title: 'Factura',
  titleCorrective: 'Factura rectificativa',
  invoiceNumber: 'Nº FACTURA',
  correctiveNumber: 'Nº RECTIFICATIVA',
  date: 'FECHA',
  corrects: 'RECTIFICA A',
  professional: 'PROFESIONAL',
  client: 'CLIENTE',
  concept: 'CONCEPTO',
  quantity: 'CANT.',
  unitPrice: 'PRECIO',
  amount: 'IMPORTE',
  baseAmount: 'Base imponible',
  iva: 'IVA',
  exempt: 'Exento',
  irpf: 'Retención IRPF',
  total: 'TOTAL',
  paymentMethod: 'FORMA DE PAGO',
  iban: 'IBAN',
  paymentConcept: 'Concepto',
  correction: 'RECTIFICACIÓN',
  correctiveOf: 'Factura rectificativa de',
  correctiveReason: 'Motivo',
  notes: 'NOTAS',
  location: 'Lugar de atención',
  registration: 'Núm. Colegiada',
  continuesOn: 'continúa →',
  page: (n, total) => `Pág. ${n} de ${total}`,
};

const PAYMENT_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia bancaria',
  bizum: 'Bizum',
  tarjeta: 'Tarjeta',
};

// ─── Utilitats ──────────────────────────────────────────────
const hexToRgb = (hex) => {
  const h = (hex || '#000000').replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
};

const base64ToUint8Array = (dataUrl) => {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const safeCurrency = (num) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
    .format(num ?? 0)
    .replace(/[   ]/g, ' ');

const formatDateShort = (d) => {
  if (!d) return '--/--/--';
  const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'));
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

const formatQty = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace('.', ','));

function wrapText(text, maxWidth, font, size) {
  const fits = (t) => font.widthOfTextAtSize(t, size) <= maxWidth;
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (let word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (fits(test)) { line = test; continue; }
      if (line) lines.push(line);
      // A word wider than the column (an email, a long company name) is cut
      while (!fits(word) && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && !fits(word.slice(0, n))) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    }
    lines.push(line);
  }
  return lines.filter((l, i) => l || i < lines.length - 1);
}

function roundedRectPath(w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${k},0 H${w - k} Q${w},0 ${w},${k} V${h - k} Q${w},${h} ${w - k},${h} H${k} Q0,${h} 0,${h - k} V${k} Q0,0 ${k},0 Z`;
}

// A page that draws nothing: the same code measures a block before drawing it
const NO_PAGE = {
  drawText() {}, drawLine() {}, drawRectangle() {}, drawSvgPath() {}, drawImage() {}, pushOperators() {},
};

// ─── Dibuix bàsic ───────────────────────────────────────────
const widthOf = (str, font, size, track = 0) =>
  font.widthOfTextAtSize(str, size) + track * Math.max(0, [...str].length - 1);

/** Text on one line; `align` left / right / center around x. Returns its width. */
function text(page, str, x, y, font, size, color, { align = 'left', track = 0 } = {}) {
  const w = widthOf(str, font, size, track);
  const dx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  if (track) page.pushOperators(setCharacterSpacing(track));
  page.drawText(str, { x: dx, y, size, font, color });
  if (track) page.pushOperators(setCharacterSpacing(0));
  return w;
}

/** Wrapped paragraph from baseline `y` down; returns the baseline of the next line. */
function paragraph(page, str, x, y, maxW, font, size, lineH, color) {
  for (const line of wrapText(str, maxW, font, size)) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineH;
  }
  return y;
}

function hline(page, x1, x2, y, thickness, color) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color, lineCap: LineCapStyle.Butt });
}

/** Small tracked caps label (section titles, table header). */
const label = (page, ctx, str, x, y, color, align) =>
  text(page, str, x, y, ctx.F.semi, T.label, color || ctx.C.muted, { align, track: TRACK });

// ─── Fonts (Onest, pdfFonts.js) ─────────────────────────────
async function embedFonts(pdfDoc) {
  try {
    const [reg, med, semi, bold] = await Promise.all(['reg', 'med', 'semi', 'bold'].map(async (k) =>
      pdfDoc.embedFont(await fetchFont(ONEST_FILES[k]), { subset: true })));
    return { reg, med, semi, bold };
  } catch (err) {
    if (import.meta.env.DEV) console.error('Font loading failed, using fallback:', err);
    const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    return { reg, med: bold, semi: bold, bold };
  }
}

function buildPalette(colors) {
  return {
    accent:      hexToRgb(colors.accent),
    accentDark:  hexToRgb(colors.accentDark),
    accentMid:   hexToRgb(colors.accentMid),
    accentLight: hexToRgb(colors.accentLight),
    primary:     hexToRgb(colors.primary),
    secondary:   hexToRgb(colors.secondary),
    muted:       hexToRgb(colors.muted),
    // structural, the same for every design
    rule:        hexToRgb('#D9D5CC'),
    hairline:    hexToRgb('#ECE9E2'),
  };
}

// ─── Capçalera ──────────────────────────────────────────────
function drawTopBar(page, ctx) {
  page.drawRectangle({ x: 0, y: A4_H - 4, width: A4_W, height: 4, color: ctx.C.accent });
}

/** Brand (logo image, or the NutriPolo mark + name) and tagline. Returns its bottom. */
function drawBrand(page, ctx) {
  const { F, C, design, logoImage } = ctx;
  const tagline = design.showTagline !== false ? (design.taglineText || '') : '';

  if (logoImage) {
    const dims = logoImage.scale(1);
    const ratio = Math.min(170 / dims.width, 48 / dims.height, 1);
    const w = dims.width * ratio;
    const h = dims.height * ratio;
    page.drawImage(logoImage, { x: M, y: TOP - h, width: w, height: h });
    if (!tagline) return TOP - h;
    text(page, tagline, M, TOP - h - 12, F.med, T.small, C.muted);
    return TOP - h - 15;
  }

  const mark = 38;
  drawLogoMark(page, M, TOP, mark);
  const tx = M + mark + 10;
  const nameY = tagline ? TOP - 18 : TOP - 24;
  text(page, 'NutriPolo', tx, nameY, F.bold, 18, C.primary);
  if (tagline) text(page, tagline, tx, nameY - 13, F.med, T.small, C.muted);
  return TOP - logoMarkHeight(mark);
}

/** Title, number and date on the right. Returns its bottom. */
function drawTitleBlock(page, ctx, invoice) {
  const { F, C } = ctx;
  const corrective = isCorrective(invoice);
  let y = TOP - 17;
  text(page, corrective ? LABELS.titleCorrective : LABELS.title, R, y, F.semi, T.title, C.primary, { align: 'right' });
  y -= 22;

  const rows = [
    [corrective ? LABELS.correctiveNumber : LABELS.invoiceNumber, invoice?.numero || '---'],
    [LABELS.date, formatDateShort(invoice?.fecha)],
  ];
  if (corrective && invoice?.rectificaNumero) rows.push([LABELS.corrects, invoice.rectificaNumero]);
  for (const [lbl, value] of rows) {
    label(page, ctx, lbl, R - 150, y, C.muted);
    text(page, value, R, y, F.semi, T.body, C.primary, { align: 'right' });
    y -= 15;
  }
  return y + 15 - 4;
}

// ─── Professional i client ──────────────────────────────────
/**
 * One party column: caps label, name, then lines. Every line keeps to the
 * column width (long names, addresses and emails wrap). Returns the baseline
 * below the last line.
 */
function drawParty(page, ctx, x, top, w, title, name, groups) {
  const { F, C } = ctx;
  label(page, ctx, title, x, top, C.accentDark);
  let y = paragraph(page, name || '---', x, top - 17, w, F.semi, T.name, LH.name, C.primary);
  for (const group of groups) {
    const lines = group.lines.filter(Boolean);
    if (!lines.length) continue;
    if (group.gap) y -= group.gap;
    for (const line of lines) {
      y = paragraph(page, line, x, y, w, F.reg, group.size || T.body, group.size === T.small ? LH.small : LH.body, group.color || C.secondary);
    }
  }
  return y;
}

function drawParties(page, ctx, config, parties, invoice, top) {
  const { C } = ctx;
  const { emisor, destinatario } = parties;

  const location = invoice?.locationId
    ? (config?.locations || []).find(l => l.id === invoice.locationId)
    : null;
  const locationText = location
    ? `${LABELS.location}: ${location.address ? `${location.name} — ${location.address}` : location.name}`
    : '';

  const left = drawParty(page, ctx, M, top, COL_W, LABELS.professional, emisor.nombre, [
    { lines: [
      emisor.nif && `NIF: ${emisor.nif}`,
      emisor.numColegiada && `${LABELS.registration}: ${emisor.numColegiada}`,
      emisor.direccion,
    ] },
    { gap: 5, size: T.small, color: C.muted, lines: [emisor.email, emisor.telefono, emisor.web] },
    { gap: 5, size: T.small, color: C.muted, lines: [locationText] },
  ]);
  const right = drawParty(page, ctx, RX, top, COL_W, LABELS.client, destinatario.nombre, [
    { lines: [destinatario.nif && `NIF: ${destinatario.nif}`, ...recipientAddressLines(destinatario)] },
    { gap: 5, size: T.small, color: C.muted, lines: [destinatario.email, destinatario.telefono] },
  ]);
  return Math.min(left, right);
}

// ─── Taula de conceptes ─────────────────────────────────────
function drawTableHeader(page, ctx, y) {
  const { C } = ctx;
  label(page, ctx, LABELS.concept, M, y, C.muted);
  label(page, ctx, LABELS.quantity, COLS.qtyC, y, C.muted, 'center');
  label(page, ctx, LABELS.unitPrice, COLS.priceR, y, C.muted, 'right');
  label(page, ctx, LABELS.amount, COLS.amountR, y, C.muted, 'right');
  hline(page, M, R, y - 8, 1, C.accent);
  return y - 8;
}

/** Header of the pages after the first: number and date. Returns where content starts. */
function addContinuationPage(pdfDoc, ctx, invoice) {
  const { F, C } = ctx;
  const page = pdfDoc.addPage([A4_W, A4_H]);
  drawTopBar(page, ctx);
  const y = TOP - 4;
  const title = isCorrective(invoice) ? LABELS.titleCorrective : LABELS.title;
  text(page, `${title} ${invoice?.numero || '---'}`, M, y, F.semi, T.body, C.primary);
  text(page, formatDateShort(invoice?.fecha), R, y, F.reg, T.body, C.secondary, { align: 'right' });
  hline(page, M, R, y - 10, 0.6, C.rule);
  return { page, y: y - 34 };
}

function markContinues(page, ctx) {
  text(page, LABELS.continuesOn, R, FOOTER_LINE + 8, ctx.F.reg, T.small, ctx.C.muted, { align: 'right' });
}

function drawItemsTable(pdfDoc, page0, ctx, invoice, top) {
  const { F, C } = ctx;
  // Old invoices without lines
  const items = invoice?.items?.length
    ? invoice.items
    : [{ descripcion: invoice?.concepto || '---', cantidad: 1, precioUnitario: invoice?.importe || 0 }];

  let page = page0;
  let y = drawTableHeader(page, ctx, top);

  for (const item of items) {
    const qty = item.cantidad ?? 1;
    const price = item.precioUnitario ?? 0;
    const lines = wrapText(item.descripcion || '---', DESC_W, F.reg, T.body);
    const rowH = ROW_PAD * 2 + 7 + (lines.length - 1) * LH.body + 2;

    if (y - rowH < BOTTOM) {
      markContinues(page, ctx);
      ({ page, y } = addContinuationPage(pdfDoc, ctx, invoice));
      y = drawTableHeader(page, ctx, y);
    }

    // Figures sit on the first line of the description
    const base = y - ROW_PAD - 7;
    lines.forEach((ln, i) => page.drawText(ln, { x: M, y: base - i * LH.body, size: T.body, font: F.reg, color: C.primary }));
    text(page, formatQty(qty), COLS.qtyC, base, F.reg, T.body, C.secondary, { align: 'center' });
    text(page, safeCurrency(price), COLS.priceR, base, F.reg, T.body, C.secondary, { align: 'right' });
    text(page, safeCurrency(qty * price), COLS.amountR, base, F.med, T.body, C.primary, { align: 'right' });

    y -= rowH;
    hline(page, M, R, y, 0.5, C.hairline);
  }
  return { page, y };
}

// ─── Pagament, totals i notes ───────────────────────────────
/** Payment method (and the bank details for a transfer) on the left. Returns its bottom. */
function drawPayment(page, ctx, invoice, emisor, top) {
  const { F, C } = ctx;
  if (!invoice?.metodoPago) return top;
  const maxW = TOTALS_X - 32 - M;
  label(page, ctx, LABELS.paymentMethod, M, top - 7, C.muted);
  let y = top - 22;
  text(page, PAYMENT_LABELS[invoice.metodoPago] || invoice.metodoPago, M, y, F.semi, T.body, C.primary);
  if (invoice.metodoPago === 'transferencia' && emisor?.iban) {
    y -= 17;
    label(page, ctx, LABELS.iban, M, y, C.muted);
    y -= 13;
    text(page, formatIban(emisor.iban), M, y, F.med, T.body, C.primary);
    y -= LH.body;
    y = paragraph(page, `${LABELS.paymentConcept}: ${invoice.numero || '---'}`, M, y, maxW, F.reg, T.small, LH.small, C.secondary);
    return y + LH.small - 4;
  }
  return y - 4;
}

/** Base, VAT, withholding and the total band on the right. Returns its bottom. */
function drawTotals(page, ctx, invoice, top) {
  const { F, C } = ctx;
  const ivaPct = invoice?.ivaPct ?? 0;
  const irpfPct = invoice?.irpfPct ?? 0;
  const rows = [[LABELS.baseAmount, safeCurrency(invoice?.baseImponible ?? invoice?.importe ?? 0)]];
  rows.push(ivaPct > 0
    ? [`${LABELS.iva} (${ivaPct} %)`, safeCurrency(invoice?.ivaImporte ?? 0)]
    : [LABELS.iva, LABELS.exempt]);
  if (irpfPct > 0) rows.push([`${LABELS.irpf} (${irpfPct} %)`, safeCurrency(-(invoice?.irpfImporte ?? 0))]);

  // Rows and the total band share the same inset, inside the right margin
  const lx = TOTALS_X + 12;
  const vx = R - 12;
  let y = top - 7;
  for (const [lbl, value] of rows) {
    text(page, lbl, lx, y, F.reg, T.body, C.secondary);
    text(page, value, vx, y, F.reg, T.body, C.primary, { align: 'right' });
    y -= 16;
  }

  const bandTop = y + 2;
  page.drawSvgPath(roundedRectPath(TOTALS_W, TOTAL_BAND_H, 5), { x: TOTALS_X, y: bandTop, color: C.accentLight });
  const by = bandTop - TOTAL_BAND_H / 2;
  label(page, ctx, LABELS.total, lx, by - 2.5, C.accentDark);
  text(page, safeCurrency(invoice?.total ?? invoice?.importe ?? 0), vx, by - 5.5, F.bold, T.total, C.accentDark, { align: 'right' });
  return bandTop - TOTAL_BAND_H;
}

/** Corrective reference, notes and the VAT exemption wording, full width. */
function drawNotes(page, ctx, invoice, exemptionText, top) {
  const { F, C } = ctx;
  const corrective = isCorrective(invoice);
  const exempt = (invoice?.ivaPct ?? 0) === 0 && !!exemptionText;
  let y = top;

  const section = (title, write) => {
    y -= 22;
    label(page, ctx, title, M, y, C.muted);
    y -= 14;
    write();
  };

  if (corrective) {
    section(LABELS.correction, () => {
      y = paragraph(page, `${LABELS.correctiveOf} ${invoice.rectificaNumero || '---'} (${formatDateShort(invoice.rectificaFecha)}).`, M, y, W, F.semi, T.small, LH.small, C.primary);
      if (invoice.motivoRectificacion) {
        y = paragraph(page, `${LABELS.correctiveReason}: ${invoice.motivoRectificacion}`, M, y, W, F.reg, T.small, LH.small, C.primary);
      }
    });
  }
  if (invoice?.notas) {
    section(LABELS.notes, () => {
      y = paragraph(page, invoice.notas, M, y, W, F.reg, T.small, LH.small, C.primary);
    });
  }
  if (exempt) {
    y -= 18;
    hline(page, M, R, y + 8, 0.5, C.hairline);
    y -= 4;
    y = paragraph(page, exemptionText, M, y, W, F.reg, T.small, LH.small, C.muted);
  }
  return y;
}

/** Everything after the table. With NO_PAGE it only measures. Returns its bottom. */
function drawClosing(page, ctx, invoice, emisor, exemptionText, top) {
  const blockTop = top - 22;
  const bottom = Math.min(
    drawPayment(page, ctx, invoice, emisor, blockTop),
    drawTotals(page, ctx, invoice, blockTop),
  );
  return drawNotes(page, ctx, invoice, exemptionText, bottom);
}

// ─── Peu ────────────────────────────────────────────────────
function drawFooter(page, ctx, emisor, pageNum, totalPages) {
  const { F, C } = ctx;
  hline(page, M, R, FOOTER_LINE, 0.6, C.rule);
  const y = FOOTER_LINE - 16;
  const pageStr = LABELS.page(pageNum, totalPages);
  const pageW = text(page, pageStr, R, y, F.reg, T.label, C.muted, { align: 'right' });

  // Contact on the left; the name goes first while it fits
  const maxW = W - pageW - 24;
  const contact = [emisor?.email, emisor?.telefono, emisor?.web].filter(Boolean);
  const full = [emisor?.nombre, ...contact].filter(Boolean).join('  ·  ');
  const str = F.reg.widthOfTextAtSize(full, T.label) <= maxW ? full : contact.join('  ·  ');
  if (str) text(page, wrapText(str, maxW, F.reg, T.label)[0], M, y, F.reg, T.label, C.muted);
}

// ─── Funció principal ───────────────────────────────────────
export async function generateInvoicePDF(invoice, client, config) {
  const design = validateDesign(config?.invoiceDesign);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const F = await embedFonts(pdfDoc);
  const C = buildPalette(design.colors);

  let logoImage = null;
  if (design.logo?.data) {
    try {
      const logoBytes = base64ToUint8Array(design.logo.data);
      logoImage = design.logo.type === 'png'
        ? await pdfDoc.embedPng(logoBytes)
        : await pdfDoc.embedJpg(logoBytes);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('Logo embedding failed, using the NutriPolo mark:', err);
    }
  }
  const ctx = { F, C, design, logoImage };

  // 1. Brand, title, number and date
  const page0 = pdfDoc.addPage([A4_W, A4_H]);
  drawTopBar(page0, ctx);
  const headerBottom = Math.min(drawBrand(page0, ctx), drawTitleBlock(page0, ctx, invoice));
  const partiesTop = headerBottom - 22;
  hline(page0, M, R, partiesTop + 4, 0.6, C.rule);

  // 2. Parties: frozen on issue, current ones for a draft
  const parties = invoiceParties(invoice, client, config);
  const partiesBottom = drawParties(page0, ctx, config, parties, invoice, partiesTop - 18);

  // 3. Lines (continue on the next page when needed)
  let { page, y } = drawItemsTable(pdfDoc, page0, ctx, invoice, partiesBottom - 20);

  // 4. Payment, totals and notes stay together; if they would run into the
  //    footer they move to a new page (never under the footer).
  const exemptionText = (config?.textoExencionIva || '').trim() || DEFAULT_VAT_EXEMPTION_TEXT;
  if (drawClosing(NO_PAGE, ctx, invoice, parties.emisor, exemptionText, y) < BOTTOM) {
    markContinues(page, ctx);
    ({ page, y } = addContinuationPage(pdfDoc, ctx, invoice));
  }
  drawClosing(page, ctx, invoice, parties.emisor, exemptionText, y);

  // 5. Footer on every page
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) drawFooter(pdfDoc.getPage(i), ctx, parties.emisor, i + 1, totalPages);

  return await pdfDoc.save();
}
