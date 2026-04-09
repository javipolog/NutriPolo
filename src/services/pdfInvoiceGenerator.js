/**
 * pdfInvoiceGenerator.js — NutriPolo
 * ====================================
 * Genera PDFs vectorials de factures amb pdf-lib + fontkit.
 * Layout grid 8 columnes, branding NutriPolo terra palette.
 * Retorna Uint8Array amb els bytes del PDF.
 */

import { PDFDocument, rgb, LineCapStyle, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { validateDesign } from './invoiceDesignPresets';

// ─── Constants A4 ───────────────────────────────────────────
const A4_W = 595.28;  // punts (210mm)
const A4_H = 841.89;  // punts (297mm)
const PX_W = 794;     // amplada total del grid en píxels
const S = A4_W / PX_W; // factor escala px→pt ≈ 0.7497

// ─── Utilitats ──────────────────────────────────────────────
const px = (v) => v * S;
const yTop = (topPx) => A4_H - px(topPx);

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
    .replace(/[\u00A0\u202F\u2009]/g, ' ');

const formatDateShort = (d) => {
  if (!d) return '--/--/--';
  const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'));
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

function wrapText(text, maxWidth, font, size) {
  const words = (text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ─── Design tokens NutriPolo ────────────────────────────────

const SIZE = {
  logoMain:  24,
  logoSub:   8.5,
  h1:        13,
  h2:        11,
  h3:        10,
  body:      9.5,
  caption:   8.5,
  micro:     7.5,
};

const COLORS = {
  accent:      '#C15F3C',  // terra-400
  accentDark:  '#A84E30',  // terra-500
  accentMid:   '#E8C4B4',  // terra-200
  accentLight: '#F5EDE8',  // terra-50
  primary:     '#1C1B18',  // sand-950
  secondary:   '#4A4840',  // sand-800
  muted:       '#65635B',  // sand-700
  subtle:      '#9C9A91',  // sand-500
  divider:     '#D4D0C8',  // sand-400
  dividerLight:'#E8E6E0',  // sand-300
  cardBg:      '#FAFAF8',  // sand-50
  background:  '#FFFFFF',
};

const STROKE = {
  heavy:  1.5 * S,
  medium: 1.0 * S,
  light:  0.6 * S,
};

const GRID = {
  columns: [41, 110, 110, 110, 51, 110, 110, 110],
  rows: {
    topPadding: 15,
    invoiceInfoHeight: 20,
    headerImageHeight: 72,
    headerGap: 12,
    sectionLabelHeight: 20,
    partyGap: 10,
    partyLineHeight: 19,
    conceptGap: 20,
    conceptHeaderHeight: 22,
    conceptRowHeight: 22,
    totalsGap: 20,
    totalRowHeight: 22,
    grandTotalGap: 15,
    grandTotalHeight: 28,
  },
  footerPadding: 44,
};

const LABELS = {
  invoiceNumber: 'Nº FACTURA',
  date: 'FECHA',
  professional: 'PROFESIONAL',
  client: 'CLIENTE',
  nif: 'NIF',
  concept: 'SERVICIO',
  quantity: 'CANT.',
  unitPrice: 'PRECIO UNIT.',
  amount: 'IMPORTE',
  baseAmount: 'BASE IMPONIBLE',
  iva: 'IVA',
  irpf: 'IRPF',
  total: 'TOTAL',
  taxExempt: 'Exento de IVA',
  paymentMethod: 'FORMA DE PAGO',
  bankDetails: 'DATOS BANCARIOS',
  paymentConcept: 'CONCEPTO DE PAGO',
  details: 'DETALLES',
  notes: 'Notas',
  continuesOn: 'continúa →',
};

const PAYMENT_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia bancaria',
  bizum: 'Bizum',
  tarjeta: 'Tarjeta',
};

// ─── Font loading amb cache ─────────────────────────────────
const bytesCache = {};

async function loadFontBytes(filename) {
  if (bytesCache[filename]) return bytesCache[filename];
  const resp = await fetch(`/fonts/${filename}`);
  if (!resp.ok) throw new Error(`Font not found: ${filename}`);
  const buf = await resp.arrayBuffer();
  bytesCache[filename] = new Uint8Array(buf);
  return bytesCache[filename];
}

async function embedFonts(pdfDoc, fontFamily = 'worksans') {
  try {
    if (fontFamily === 'helvetica') {
      const reg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      let mono = reg;
      try { mono = await pdfDoc.embedFont(await loadFontBytes('JetBrainsMono-Regular.ttf')); } catch { /* Mono font unavailable — falls back to regular */ }
      return { priReg: reg, priBold: bold, priMed: bold, secReg: reg, secBold: bold, secMed: bold, mono };
    }

    const [wsReg, wsBold, wsMed, rbReg, rbBold, rbMed, monoReg] = await Promise.all([
      loadFontBytes('WorkSans-Regular.ttf'),
      loadFontBytes('WorkSans-Bold.ttf'),
      loadFontBytes('WorkSans-Medium.ttf'),
      loadFontBytes('Roboto-Regular.ttf'),
      loadFontBytes('Roboto-Bold.ttf'),
      loadFontBytes('Roboto-Medium.ttf'),
      loadFontBytes('JetBrainsMono-Regular.ttf'),
    ]);

    const ws  = { reg: await pdfDoc.embedFont(wsReg), bold: await pdfDoc.embedFont(wsBold), med: await pdfDoc.embedFont(wsMed) };
    const rb  = { reg: await pdfDoc.embedFont(rbReg), bold: await pdfDoc.embedFont(rbBold), med: await pdfDoc.embedFont(rbMed) };
    const mono = await pdfDoc.embedFont(monoReg);

    // 'roboto' swaps primary/secondary roles
    const pri = fontFamily === 'roboto' ? rb : ws;
    const sec = fontFamily === 'roboto' ? ws : rb;

    return {
      priReg: pri.reg, priBold: pri.bold, priMed: pri.med,
      secReg: sec.reg, secBold: sec.bold, secMed: sec.med,
      mono,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error('Font loading failed, using fallback:', err);
    const fallback = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fallbackBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    return {
      priReg: fallback, priBold: fallbackBold, priMed: fallbackBold,
      secReg: fallback, secBold: fallbackBold, secMed: fallbackBold,
      mono: fallback,
    };
  }
}

// ─── Layout computation ─────────────────────────────────────
function computeLayout() {
  const cols = GRID.columns;
  const r = GRID.rows;

  const colX = [];
  let cx = 0;
  for (const w of cols) { colX.push(px(cx)); cx += w; }
  const colEnd = px(cx);
  const colW = cols.map(w => px(w));

  let y = r.topPadding;
  const pos = {};
  pos.infoRow1     = y;            y += r.invoiceInfoHeight;
  pos.infoRow2     = y;            y += r.invoiceInfoHeight;
  pos.logoAreaEnd  = r.topPadding + r.headerImageHeight;
  y = Math.max(y, pos.logoAreaEnd);
  y += r.headerGap;
  pos.sectionLbl   = y;            y += r.sectionLabelHeight;
  pos.sectionLblEnd = y;
  y += r.partyGap;
  pos.partyName    = y;            y += r.partyLineHeight;
  pos.partyNif     = y;            y += r.partyLineHeight;
  pos.partyExtra   = y;            y += r.partyLineHeight;
  pos.partyAddr    = y;

  pos.conceptGap   = r.conceptGap;
  pos.conceptHdr   = r.conceptHeaderHeight;
  pos.conceptRow   = r.conceptRowHeight;
  pos.totalsGap    = r.totalsGap;
  pos.totalRow     = r.totalRowHeight;
  pos.grandGap     = r.grandTotalGap;
  pos.grandH       = r.grandTotalHeight;

  return { colX, colW, colEnd, pos, cols };
}

// ─── Draw helpers ───────────────────────────────────────────
function drawTextRight(page, text, rightX, topY, font, size, color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y: topY, size, font, color });
}

function drawLine(page, x1, y, x2, thickness, color) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color, lineCap: LineCapStyle.Butt });
}

function drawMultiline(page, text, x, topY, font, size, lineH, color) {
  const lines = (text || '---').split('\n');
  let cy = topY;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color });
    cy -= lineH;
  }
  return cy;
}

// ─── Tokens precompilats ────────────────────────────────────
function buildTokens(fonts, designColors) {
  const C = designColors || COLORS;
  return {
    colorAccent:      hexToRgb(C.accent),
    colorAccentDark:  hexToRgb(C.accentDark),
    colorAccentMid:   hexToRgb(C.accentMid),
    colorAccentLight: hexToRgb(C.accentLight),
    colorPrimary:     hexToRgb(C.primary),
    colorSecondary:   hexToRgb(C.secondary),
    colorMuted:       hexToRgb(C.muted),
    colorSubtle:      hexToRgb(COLORS.subtle),       // structural — always hardcoded
    colorDivider:     hexToRgb(COLORS.divider),       // structural
    colorDividerLight:hexToRgb(COLORS.dividerLight),  // structural
    colorCardBg:      hexToRgb(C.cardBg),
    fontPriBold:      fonts.priBold,
  };
}

// ─── Seccions de dibuix ─────────────────────────────────────

function drawAccentBar(page, tokens) {
  page.drawRectangle({
    x: 0,
    y: A4_H - px(4),
    width: A4_W,
    height: px(4),
    color: tokens.colorAccent,
  });
}

function drawHeader(page, layout, tokens, fonts, invoice) {
  const { colX, colW } = layout;
  const { pos } = layout;

  const gStart = colX[6];
  const hEnd = colX[7] + colW[7];

  // Nº factura
  const yNro = yTop(pos.infoRow1 + 14);
  page.drawText(LABELS.invoiceNumber, { x: gStart, y: yNro, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent });
  drawTextRight(page, invoice?.numero || '---', hEnd, yNro, fonts.secBold, SIZE.caption, tokens.colorAccent);

  // Data
  const yFecha = yTop(pos.infoRow2 + 14);
  page.drawText(LABELS.date, { x: gStart, y: yFecha, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent });
  const dateStr = formatDateShort(invoice?.fecha);
  drawTextRight(page, dateStr, hEnd, yFecha, fonts.secBold, SIZE.caption, tokens.colorAccent);
}

function drawLogo(page, layout, tokens, fonts, design, logoImage) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const logoX = colX[0] + colW[0];
  const baseY = yTop(pos.infoRow1 + 28);

  // Image logo path
  if (logoImage) {
    try {
      const maxW = px(180);
      const maxH = px(50);
      const imgDims = logoImage.scale(1);
      const ratio = Math.min(maxW / imgDims.width, maxH / imgDims.height, 1);
      const w = imgDims.width * ratio;
      const h = imgDims.height * ratio;
      page.drawImage(logoImage, { x: logoX, y: baseY - h + px(8), width: w, height: h });

      // Tagline below image
      if (design?.showTagline !== false) {
        page.drawText(design?.taglineText || 'Nutricion Clinica', {
          x: logoX, y: baseY - h - px(6),
          size: SIZE.logoSub, font: fonts.priMed, color: tokens.colorMuted,
        });
      }
      return;
    } catch (err) {
      if (import.meta.env.DEV) console.warn('Logo image draw failed, falling back to text:', err);
    }
  }

  // Text logo fallback
  const logoText = 'NUTRIPOLO';
  const spacing = 3.5;

  let cx = logoX;
  for (const ch of logoText) {
    page.drawText(ch, { x: cx, y: baseY, size: SIZE.logoMain, font: tokens.fontPriBold, color: tokens.colorAccent });
    cx += tokens.fontPriBold.widthOfTextAtSize(ch, SIZE.logoMain) + spacing;
  }

  // Underline
  drawLine(page, logoX, baseY - px(5), cx - spacing, STROKE.medium, tokens.colorAccentMid);

  // Tagline
  if (design?.showTagline !== false) {
    page.drawText(design?.taglineText || 'Nutricion Clinica', {
      x: logoX, y: baseY - px(14),
      size: SIZE.logoSub, font: fonts.priMed, color: tokens.colorMuted,
    });
  }
}

function drawSectionLabels(page, layout, tokens, fonts) {
  const { colX, colW } = layout;
  const { pos } = layout;

  const baseY = yTop(pos.sectionLblEnd - 4);
  const lineY = yTop(pos.sectionLblEnd);

  // PROFESIONAL (cols B-D)
  const leftStart = colX[1];
  const leftEnd = colX[4];
  page.drawText(LABELS.professional, {
    x: leftStart, y: baseY, size: SIZE.h2, font: fonts.secBold, color: tokens.colorAccent,
  });
  drawLine(page, leftStart, lineY, leftEnd, STROKE.heavy, tokens.colorDivider);

  // CLIENTE (cols F-H)
  const rightStart = colX[5];
  const rightEnd = colX[7] + colW[7];
  page.drawText(LABELS.client, {
    x: rightStart, y: baseY, size: SIZE.h2, font: fonts.secBold, color: tokens.colorAccent,
  });
  drawLine(page, rightStart, lineY, rightEnd, STROKE.heavy, tokens.colorDivider);
}

function drawPartyDetails(page, layout, tokens, fonts, config, client, invoice) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const lineH = px(17);

  const lx = colX[1];
  const rx = colX[5];
  const leftEnd = colX[4];
  const rightEnd = colX[7] + colW[7];

  // (card backgrounds removed for cleaner look)

  // Noms
  const nameY = yTop(pos.partyName + 14);
  page.drawText(config?.nombre || '---', { x: lx, y: nameY, size: SIZE.body, font: fonts.priBold, color: tokens.colorPrimary });
  page.drawText(client?.nombre || '---', { x: rx, y: nameY, size: SIZE.body, font: fonts.priBold, color: tokens.colorPrimary });

  // NIF
  const nifY = yTop(pos.partyNif + 14);
  if (config?.nif) {
    page.drawText(`NIF: ${config.nif}`, { x: lx, y: nifY, size: SIZE.body, font: fonts.priReg, color: tokens.colorSecondary });
  }
  if (client?.cifNif) {
    page.drawText(client.cifNif, { x: rx, y: nifY, size: SIZE.body, font: fonts.priReg, color: tokens.colorSecondary });
  }

  // Núm. Colegiada (esquerra)
  const extraY = yTop(pos.partyExtra + 14);
  if (config?.numColegiada) {
    page.drawText(`Núm. Colegiada: ${config.numColegiada}`, { x: lx, y: extraY, size: SIZE.body, font: fonts.priReg, color: tokens.colorSecondary });
  }

  // Adreces
  const addrStartY = yTop(pos.partyAddr + 14);
  let leftBottomY = addrStartY;
  let rightBottomY = addrStartY;

  if (config?.direccion) {
    leftBottomY = drawMultiline(page, config.direccion, lx, addrStartY, fonts.priReg, SIZE.body, lineH, tokens.colorSecondary);
  }
  const clientAddr = [client?.calle, [client?.codigoPostal, client?.ciudad].filter(Boolean).join(' '), client?.provincia].filter(Boolean).join('\n');
  if (clientAddr) {
    rightBottomY = drawMultiline(page, clientAddr, rx, addrStartY, fonts.priReg, SIZE.body, lineH, tokens.colorSecondary);
  }

  // Contacte professional
  let lyContact = leftBottomY - px(10);
  if (config?.email) {
    page.drawText(config.email, { x: lx, y: lyContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    lyContact -= lineH;
  }
  if (config?.telefono) {
    page.drawText(config.telefono, { x: lx, y: lyContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    lyContact -= lineH;
  }
  if (config?.web) {
    page.drawText(config.web, { x: lx, y: lyContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    lyContact -= lineH;
  }

  // Contacte client
  let ryContact = rightBottomY - px(10);
  if (client?.email) {
    page.drawText(client.email, { x: rx, y: ryContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    ryContact -= lineH;
  }
  if (client?.telefono) {
    page.drawText(client.telefono, { x: rx, y: ryContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    ryContact -= lineH;
  }

  // Lloc d'atenció
  const location = invoice?.locationId
    ? (config?.locations || []).find(l => l.id === invoice.locationId)
    : null;
  if (location) {
    lyContact -= px(4);
    page.drawText('Lugar de atención:', { x: lx, y: lyContact, size: SIZE.caption, font: fonts.priBold, color: tokens.colorSecondary });
    lyContact -= lineH;
    const locText = location.address ? `${location.name} — ${location.address}` : location.name;
    page.drawText(locText, { x: lx, y: lyContact, size: SIZE.caption, font: fonts.priReg, color: tokens.colorSecondary });
    lyContact -= lineH;
  }

  // Border inferior
  const lowestY = Math.min(lyContact, ryContact) - px(4);
  drawLine(page, lx, lowestY, leftEnd, STROKE.heavy, tokens.colorDivider);
  drawLine(page, rx, lowestY, rightEnd, STROKE.heavy, tokens.colorDivider);

  return lowestY;
}

// ─── Items table (multi-page aware) ────────────────────────
const FOOTER_H = px(72);
const FOOTER_RESERVE = FOOTER_H + px(100);
const ITEMS_ROW_MIN_H = px(36);

function addContinuationPage(pdfDoc, layout, tokens, fonts, invoice) {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  drawAccentBar(page, tokens);

  const { colX, colW } = layout;
  const lx = colX[1];
  const rightEnd = colX[7] + colW[7];
  const topY = yTop(12);

  // Branding left + invoice number right
  page.drawText('NUTRIPOLO', { x: lx, y: topY, size: SIZE.caption, font: fonts.priMed, color: tokens.colorMuted });
  drawTextRight(page, `${invoice?.numero || '---'}  ·  ${formatDateShort(invoice?.fecha)}`, rightEnd, topY, fonts.secBold, SIZE.caption, tokens.colorAccent);
  drawLine(page, lx, topY - px(6), rightEnd, STROKE.medium, tokens.colorDivider);

  return { page, startY: topY - px(18) };
}

function drawItemsTable(pdfDoc, page0, layout, tokens, fonts, invoice, addrBottomY) {
  const { colX, colW } = layout;

  const lx = colX[1];
  const rightEnd = colX[7] + colW[7];

  // Normalize items (backward compat)
  const items = (invoice?.items?.length)
    ? invoice.items
    : [{ descripcion: invoice?.concepto || '---', cantidad: 1, precioUnitario: invoice?.importe || 0 }];

  // Column positions — with breathing margins
  const descColEnd = colX[5] - px(10);
  const descColW = descColEnd - lx;
  const cantCenterX = colX[5] + colW[5] / 2;
  const precioRightX = colX[6] + colW[6] - px(4);
  const importeRightX = rightEnd - px(4);

  // ── Table header ─────────────────────────────────────────
  const conceptHeaderTopY = addrBottomY - px(26);
  const hdrHeight = px(28);
  const hdrLineY = conceptHeaderTopY - hdrHeight;
  const hdrBaseY = hdrLineY + px(8);

  // Header background fill
  page0.drawRectangle({
    x: lx - px(6), y: hdrLineY,
    width: rightEnd - lx + px(12), height: hdrHeight,
    color: tokens.colorAccentLight,
  });

  page0.drawText(LABELS.concept, {
    x: lx, y: hdrBaseY, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent,
  });

  const cantW = fonts.secBold.widthOfTextAtSize(LABELS.quantity, SIZE.caption);
  page0.drawText(LABELS.quantity, { x: cantCenterX - cantW / 2, y: hdrBaseY, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent });
  drawTextRight(page0, LABELS.unitPrice, precioRightX, hdrBaseY, fonts.secBold, SIZE.caption, tokens.colorAccent);
  drawTextRight(page0, LABELS.amount, importeRightX, hdrBaseY, fonts.secBold, SIZE.caption, tokens.colorAccent);

  drawLine(page0, lx, hdrLineY, rightEnd, STROKE.medium, tokens.colorDivider);

  // ── Item rows ─────────────────────────────────────────────
  let page = page0;
  let currentY = hdrLineY;

  items.forEach((item, idx) => {
    const desc = item.descripcion || '---';
    const qty = item.cantidad ?? 1;
    const price = item.precioUnitario ?? 0;
    const lineTotal = qty * price;

    const descLines = wrapText(desc, descColW, fonts.secReg, SIZE.body);
    const rowH = Math.max(ITEMS_ROW_MIN_H, descLines.length * (SIZE.body + 4) + px(24));

    // Check if we need a new page
    if (currentY - rowH < FOOTER_RESERVE) {
      page.drawText(LABELS.continuesOn, {
        x: rightEnd - fonts.priReg.widthOfTextAtSize(LABELS.continuesOn, SIZE.micro) - px(2),
        y: FOOTER_RESERVE - px(10),
        size: SIZE.micro, font: fonts.priReg, color: tokens.colorMuted,
      });
      const next = addContinuationPage(pdfDoc, layout, tokens, fonts, invoice);
      page = next.page;
      currentY = next.startY;

      // Re-draw column headers on new page
      const newHdrTop = currentY;
      const newHdrH = px(28);
      const newHdrLine = newHdrTop - newHdrH;
      const newHdrBase = newHdrLine + px(8);

      page.drawRectangle({
        x: lx - px(6), y: newHdrLine,
        width: rightEnd - lx + px(12), height: newHdrH,
        color: tokens.colorAccentLight,
      });
      page.drawText(LABELS.concept, {
        x: lx, y: newHdrBase, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent,
      });
      page.drawText(LABELS.quantity, { x: cantCenterX - cantW / 2, y: newHdrBase, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent });
      drawTextRight(page, LABELS.unitPrice, precioRightX, newHdrBase, fonts.secBold, SIZE.caption, tokens.colorAccent);
      drawTextRight(page, LABELS.amount, importeRightX, newHdrBase, fonts.secBold, SIZE.caption, tokens.colorAccent);
      drawLine(page, lx, newHdrLine, rightEnd, STROKE.medium, tokens.colorDivider);
      currentY = newHdrLine;
    }

    // Alternating row background
    if (idx % 2 === 0) {
      page.drawRectangle({
        x: lx - px(4), y: currentY - rowH,
        width: rightEnd - lx + px(8), height: rowH,
        color: tokens.colorCardBg,
      });
    }

    // Vertically center all text within the row
    // pdf-lib y = baseline; cap-height ≈ fontSize * 0.72
    // To visually center: baseline = center - capHeight/2 = center - fontSize*0.36
    const rowCenterY = currentY - rowH * 0.65; // more space above, less below
    const lineSpacing = SIZE.body + 4;
    const blockSpan = (descLines.length - 1) * lineSpacing;
    const descStartY = rowCenterY + blockSpan / 2 + SIZE.body * 0.36;
    const numY = rowCenterY + SIZE.h3 * 0.36;

    // Description lines
    descLines.forEach((ln, i) => {
      page.drawText(ln, {
        x: lx, y: descStartY - i * (SIZE.body + 4),
        size: SIZE.body, font: fonts.secReg, color: tokens.colorPrimary,
      });
    });

    // Quantity (centered)
    const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
    const qtyW = fonts.mono.widthOfTextAtSize(qtyStr, SIZE.h3);
    page.drawText(qtyStr, { x: cantCenterX - qtyW / 2, y: numY, size: SIZE.h3, font: fonts.mono, color: tokens.colorPrimary });

    // Unit price
    drawTextRight(page, safeCurrency(price), precioRightX, numY, fonts.mono, SIZE.h3, tokens.colorPrimary);

    // Line total
    drawTextRight(page, safeCurrency(lineTotal), importeRightX, numY, fonts.mono, SIZE.h3, tokens.colorPrimary);

    currentY -= rowH;
    drawLine(page, lx, currentY, rightEnd, STROKE.light, tokens.colorDividerLight);
  });

  return { page, tableBottomY: currentY };
}

function drawDetails(page, layout, tokens, fonts, invoice, conceptLineY) {
  const { colX, colW } = layout;
  const lx = colX[1];
  const rightEnd = colX[7] + colW[7];

  if (!invoice?.metodoPago && !invoice?.notas) return conceptLineY;

  let y = conceptLineY - px(20);

  page.drawText(LABELS.details, { x: lx, y, size: SIZE.caption, font: fonts.secBold, color: tokens.colorAccent });
  y -= px(4);
  drawLine(page, lx, y, rightEnd, STROKE.light, tokens.colorAccentMid);
  y -= px(12);

  if (invoice?.metodoPago) {
    const methodLabel = `${LABELS.paymentMethod}:`;
    page.drawText(methodLabel, { x: lx, y, size: SIZE.caption, font: fonts.secBold, color: tokens.colorMuted });
    const labelW = fonts.secBold.widthOfTextAtSize(methodLabel, SIZE.caption);
    const payDisplay = PAYMENT_LABELS[invoice.metodoPago] || invoice.metodoPago;
    page.drawText(payDisplay, { x: lx + labelW + 6, y, size: SIZE.caption, font: fonts.priReg, color: tokens.colorPrimary });
    y -= px(14);
  }

  if (invoice?.notas) {
    page.drawText(`${LABELS.notes}:`, { x: lx, y, size: SIZE.caption, font: fonts.secBold, color: tokens.colorMuted });
    y -= px(12);
    const notaColW = rightEnd - lx - px(4);
    const notaLines = wrapText(invoice.notas, notaColW, fonts.priReg, SIZE.caption);
    notaLines.forEach(ln => {
      page.drawText(ln, { x: lx + px(4), y, size: SIZE.caption, font: fonts.priReg, color: tokens.colorPrimary });
      y -= px(12);
    });
  }

  return y;
}

function drawTotalSection(page, layout, tokens, fonts, invoice, afterDetailsY) {
  const { colX, colW } = layout;

  const fx = colX[5] + px(4);
  const hEnd = colX[7] + colW[7] - px(4);

  const ivaPct = invoice?.ivaPct ?? 0;
  const irpfPct = invoice?.irpfPct ?? 0;
  const baseImponible = invoice?.baseImponible ?? (invoice?.importe ?? 0);
  const ivaImporte = invoice?.ivaImporte ?? 0;
  const irpfImporte = invoice?.irpfImporte ?? 0;
  const total = invoice?.total ?? invoice?.importe ?? 0;

  const taxRowH = px(20);
  const labelSize = SIZE.caption;

  // Calculate section height for background
  let rowCount = 2; // base + iva/exempt
  if (irpfPct > 0) rowCount++;
  rowCount++; // total
  const sectionH = rowCount * taxRowH + px(36);

  let y = afterDetailsY - px(24);

  // Accent background card
  page.drawRectangle({
    x: fx - px(10), y: y - sectionH,
    width: hEnd - fx + px(20), height: sectionH + px(8),
    color: tokens.colorAccentLight,
  });

  // Base imponible
  drawLine(page, fx, y, hEnd, STROKE.medium, tokens.colorDivider);
  y -= px(8) + labelSize;
  page.drawText(LABELS.baseAmount, { x: fx, y, size: labelSize, font: fonts.secReg, color: tokens.colorMuted });
  drawTextRight(page, safeCurrency(baseImponible), hEnd, y, fonts.mono, labelSize, tokens.colorPrimary);
  y -= taxRowH;

  // IVA line
  if (ivaPct > 0) {
    page.drawText(`${LABELS.iva} (${ivaPct}%)`, { x: fx, y, size: labelSize, font: fonts.secReg, color: tokens.colorMuted });
    drawTextRight(page, `+${safeCurrency(ivaImporte)}`, hEnd, y, fonts.mono, labelSize, tokens.colorPrimary);
    y -= taxRowH;
  } else {
    page.drawText(LABELS.taxExempt, { x: fx, y, size: labelSize, font: fonts.secReg, color: tokens.colorMuted });
    y -= taxRowH;
  }

  // IRPF line
  if (irpfPct > 0) {
    page.drawText(`${LABELS.irpf} (-${irpfPct}%)`, { x: fx, y, size: labelSize, font: fonts.secReg, color: tokens.colorMuted });
    drawTextRight(page, `-${safeCurrency(irpfImporte)}`, hEnd, y, fonts.mono, labelSize, tokens.colorAccentDark);
    y -= taxRowH;
  }

  // Separator + TOTAL
  drawLine(page, fx, y, hEnd, STROKE.heavy, tokens.colorDivider);
  y -= px(10) + SIZE.h1;
  page.drawText(LABELS.total, { x: fx, y, size: SIZE.h1, font: fonts.priBold, color: tokens.colorAccentDark });
  drawTextRight(page, safeCurrency(total), hEnd, y, fonts.priBold, SIZE.h1, tokens.colorAccentDark);
}

function drawFooter(page, layout, tokens, fonts, invoice, config, pageNum, totalPages) {
  const { colX, colW } = layout;

  const footerLeftX = colX[1];
  const footerRightX = colX[7] + colW[7];
  const footerWidth = footerRightX - footerLeftX;
  const footerLineH = px(18);

  // Full-width footer background
  page.drawRectangle({
    x: 0, y: 0,
    width: A4_W, height: FOOTER_H,
    color: tokens.colorAccentLight,
  });

  // Top accent line
  drawLine(page, footerLeftX, FOOTER_H, footerRightX, STROKE.heavy, tokens.colorAccentMid);

  let cy = FOOTER_H - px(12);

  // Forma de pagament (dynamic)
  const paymentDisplay = PAYMENT_LABELS[invoice?.metodoPago] || invoice?.metodoPago || 'No especificado';
  page.drawText(LABELS.paymentMethod, { x: footerLeftX, y: cy, size: SIZE.micro, font: fonts.priReg, color: tokens.colorSecondary });
  drawTextRight(page, paymentDisplay, footerRightX, cy, fonts.priReg, SIZE.micro, tokens.colorPrimary);
  cy -= footerLineH;

  // Dades bancàries (IBAN) — only for transferencia
  if (invoice?.metodoPago === 'transferencia' && config?.iban) {
    page.drawText(LABELS.bankDetails, { x: footerLeftX, y: cy, size: SIZE.micro, font: fonts.priReg, color: tokens.colorSecondary });
    drawTextRight(page, config.iban, footerRightX, cy, fonts.priReg, SIZE.micro, tokens.colorPrimary);
    cy -= footerLineH;
  }

  // Concepte de pagament
  page.drawText(LABELS.paymentConcept, { x: footerLeftX, y: cy, size: SIZE.micro, font: fonts.priReg, color: tokens.colorSecondary });
  drawTextRight(page, invoice?.numero || '---', footerRightX, cy, fonts.priReg, SIZE.micro, tokens.colorPrimary);
  cy -= footerLineH;

  // Bottom strip: brand left | contact center | page number right
  drawLine(page, footerLeftX, cy + px(6), footerRightX, STROKE.light, tokens.colorDividerLight);

  // Brand
  page.drawText('NUTRIPOLO', { x: footerLeftX, y: cy - px(4), size: SIZE.micro, font: fonts.priMed, color: tokens.colorSubtle });

  // Page numbers
  if (totalPages > 0) {
    const pageStr = `Pág. ${pageNum} de ${totalPages}`;
    drawTextRight(page, pageStr, footerRightX, cy - px(4), fonts.priReg, SIZE.micro, tokens.colorSubtle);
  }

  // Contact info centered
  const contact = [config?.email, config?.telefono, config?.web].filter(Boolean);
  if (contact.length) {
    const contactStr = contact.join('  ·  ');
    const cw = fonts.priMed.widthOfTextAtSize(contactStr, SIZE.micro);
    const contactX = footerLeftX + (footerWidth - cw) / 2;
    page.drawText(contactStr, { x: contactX, y: cy - px(4), size: SIZE.micro, font: fonts.priMed, color: tokens.colorSubtle });
  }
}

// ─── Funció principal ───────────────────────────────────────
export async function generateInvoicePDF(invoice, client, config) {
  const design = validateDesign(config?.invoiceDesign);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = await embedFonts(pdfDoc, design.fontFamily);
  const page0 = pdfDoc.addPage([A4_W, A4_H]);
  const tokens = buildTokens(fonts, design.colors);
  const layout = computeLayout();

  // Embed logo image if provided
  let logoImage = null;
  if (design.logo?.data) {
    try {
      const logoBytes = base64ToUint8Array(design.logo.data);
      logoImage = design.logo.type === 'png'
        ? await pdfDoc.embedPng(logoBytes)
        : await pdfDoc.embedJpg(logoBytes);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('Logo embedding failed, using text fallback:', err);
    }
  }

  // 1. Accent bar + Header + Logo
  drawAccentBar(page0, tokens);
  drawHeader(page0, layout, tokens, fonts, invoice);
  drawLogo(page0, layout, tokens, fonts, design, logoImage);

  // 2. Section labels
  drawSectionLabels(page0, layout, tokens, fonts);

  // 3. Party details
  const addrBottomY = drawPartyDetails(page0, layout, tokens, fonts, config, client, invoice);

  // 4. Items table (multi-page aware)
  const { page: lastPage, tableBottomY } = drawItemsTable(pdfDoc, page0, layout, tokens, fonts, invoice, addrBottomY);

  // 5. Details (metodoPago, notas)
  const afterDetailsY = drawDetails(lastPage, layout, tokens, fonts, invoice, tableBottomY);

  // 6. Tax breakdown + Total
  drawTotalSection(lastPage, layout, tokens, fonts, invoice, afterDetailsY);

  // 7. Footer on ALL pages with page numbers
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    drawFooter(pdfDoc.getPage(i), layout, tokens, fonts, invoice, config, i + 1, totalPages);
  }

  return await pdfDoc.save();
}
