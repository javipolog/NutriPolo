/**
 * pdfLibGenerator.js
 * Genera PDFs vectorials de factures amb pdf-lib.
 * Posicionament exacte de text, línies i imatges — rèplica fidel del template Excel.
 */

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { useDesignStore } from '../stores/designStore';
import { formatCurrency } from '../stores/store';

// ─── Constants A4 ───────────────────────────────────────────
const A4_W = 595.28;  // punts (210mm)
const A4_H = 841.89;  // punts (297mm)
const PX_W = 794;     // amplada total del grid en píxels (Excel → CSS)
const S = A4_W / PX_W; // factor escala px→pt ≈ 0.7497

// ─── Utilitats ──────────────────────────────────────────────
const px = (v) => v * S;                      // px → pt
const yTop = (topPx) => A4_H - px(topPx);    // Y des del top (invertit per pdf-lib)
const parsePt = (s) => parseFloat(s) || 9;    // '10pt' → 10

const hexToRgb = (hex) => {
  const h = (hex || '#000000').replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
};

const formatDateShort = (d) => {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(-2)}`;
};

// ─── Font loading amb cache ─────────────────────────────────
const FONT_FILES = {
  'Work Sans':      { regular: 'WorkSans-Regular.ttf', medium: 'WorkSans-Medium.ttf', bold: 'WorkSans-Bold.ttf' },
  'Roboto':         { regular: 'Roboto-Regular.ttf',   medium: 'Roboto-Medium.ttf',   bold: 'Roboto-Bold.ttf' },
  'JetBrains Mono': { regular: 'JetBrainsMono-Regular.ttf', medium: null, bold: null },
};
const FALLBACK_FONT = 'Roboto';

const bytesCache = {};
async function loadFontBytes(filename) {
  if (bytesCache[filename]) return bytesCache[filename];
  const resp = await fetch(`/fonts/${filename}`);
  if (!resp.ok) throw new Error(`Font not found: ${filename}`);
  const buf = await resp.arrayBuffer();
  bytesCache[filename] = new Uint8Array(buf);
  return bytesCache[filename];
}

async function embedFonts(pdfDoc, fontNames) {
  const resolve = (name, weight) => {
    const entry = FONT_FILES[name] || FONT_FILES[FALLBACK_FONT];
    return entry[weight] || entry.regular;
  };

  const [priReg, priBold, priMed, secReg, secBold, secMed, monoReg] = await Promise.all([
    loadFontBytes(resolve(fontNames.primary, 'regular')),
    loadFontBytes(resolve(fontNames.primary, 'bold')),
    loadFontBytes(resolve(fontNames.primary, 'medium')),
    loadFontBytes(resolve(fontNames.secondary, 'regular')),
    loadFontBytes(resolve(fontNames.secondary, 'bold')),
    loadFontBytes(resolve(fontNames.secondary, 'medium')),
    loadFontBytes(resolve(fontNames.mono || 'JetBrains Mono', 'regular')),
  ]);

  return {
    priReg:  await pdfDoc.embedFont(priReg),
    priBold: await pdfDoc.embedFont(priBold),
    priMed:  await pdfDoc.embedFont(priMed),
    secReg:  await pdfDoc.embedFont(secReg),
    secBold: await pdfDoc.embedFont(secBold),
    secMed:  await pdfDoc.embedFont(secMed),
    mono:    await pdfDoc.embedFont(monoReg),
  };
}

// ─── Layout computation ─────────────────────────────────────
function computeLayout(grid) {
  const cols = grid.columns || [41, 110, 110, 110, 51, 110, 110, 110];
  const r = grid.rows || {};

  // Posicions X acumulatives de cada columna (en pt)
  const colX = [];
  let cx = 0;
  for (const w of cols) { colX.push(px(cx)); cx += w; }
  // Fi de l'última columna
  const colEnd = px(cx);

  // Amplades de columna en pt
  const colW = cols.map(w => px(w));

  // Posicions Y (des del top, en px — convertim a pt al dibuixar)
  const topPad     = r.topPadding ?? 15;
  const infoH      = r.invoiceInfoHeight ?? 20;
  const headerImgH = r.headerImageHeight ?? 84;
  const headerGap  = r.headerGap ?? 15;
  const sectionLbl = r.sectionLabelHeight ?? 22;
  const partyGap   = r.partyGap ?? 8;
  const partyLine  = r.partyLineHeight ?? 18;
  const conceptGap = r.conceptGap ?? 50;
  const conceptHdr = r.conceptHeaderHeight ?? 22;
  const conceptRow = r.conceptRowHeight ?? 20;
  const totalsGap  = r.totalsGap ?? 35;
  const totalRow   = r.totalRowHeight ?? 22;
  const grandGap   = r.grandTotalGap ?? 15;
  const grandH     = r.grandTotalHeight ?? 28;

  let y = topPad;
  const pos = {};
  pos.infoRow1     = y;            y += infoH;      // Nº
  pos.infoRow2     = y;            y += infoH;      // FECHA
  pos.logoAreaEnd  = topPad + headerImgH;
  y = Math.max(y, pos.logoAreaEnd);
  y += headerGap;
  pos.sectionLbl   = y;            y += sectionLbl; // ": FREELANCE" / ": CLIENTE"
  pos.sectionLblEnd = y;
  y += partyGap;
  pos.partyName    = y;            y += partyLine;  // Noms
  pos.partyNif     = y;            y += partyLine;  // NIF
  pos.partyAddr    = y;                              // Adreça (altura variable)
  // L'altura de l'adreça es calcula dinàmicament

  // Guadem les constants per calcular la resta dinàmicament
  pos.conceptGap   = conceptGap;
  pos.conceptHdr   = conceptHdr;
  pos.conceptRow   = conceptRow;
  pos.totalsGap    = totalsGap;
  pos.totalRow     = totalRow;
  pos.grandGap     = grandGap;
  pos.grandH       = grandH;

  return { colX, colW, colEnd, pos, cols };
}

// ─── Draw helpers ───────────────────────────────────────────
function drawTextRight(page, text, rightX, topY, font, size, color) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y: topY, size, font, color });
}

function drawLine(page, x1, y, x2, thickness, color) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

function drawMultiline(page, text, x, topY, font, size, lineH, color) {
  const lines = (text || '---').split('\n');
  let cy = topY;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color });
    cy -= lineH;
  }
  return cy; // retorna la Y final (bottom de l'últim text)
}

// ─── Seccions de dibuix ─────────────────────────────────────

function drawHeader(page, layout, tokens, fonts, invoice, config, design) {
  const { colX, colW, colEnd } = layout;
  const { pos } = layout;
  const { sizeSmall, colorPrimary } = tokens;

  // Nº (G-H: label esquerra, valor dreta)
  const gStart = colX[6]; // col G
  const hEnd = colX[7] + colW[7]; // fi col H
  const yNro = yTop(pos.infoRow1 + 14); // baseline aproximada
  page.drawText(tokens.labels.invoiceNumber, { x: gStart, y: yNro, size: sizeSmall, font: fonts.secBold, color: colorPrimary });
  drawTextRight(page, invoice?.numero || '---', hEnd, yNro, fonts.mono, sizeSmall, colorPrimary);

  // FECHA
  const yFecha = yTop(pos.infoRow2 + 14);
  page.drawText(tokens.labels.date, { x: gStart, y: yFecha, size: sizeSmall, font: fonts.secBold, color: colorPrimary });
  const dateStr = invoice?.fecha ? formatDateShort(invoice.fecha) : '--/--/--';
  drawTextRight(page, dateStr, hEnd, yFecha, fonts.mono, sizeSmall, colorPrimary);
}

async function drawLogo(page, pdfDoc, layout, tokens, config, design) {
  const logo = design.logo || {};
  const sections = design.sections || {};
  if (!sections.showLogo) return;

  const { colX, colW } = layout;
  const { pos } = layout;
  // Logo area: des de col A+padding fins col E, verticalment rows 2-4
  const logoX = colX[0] + colW[0]; // col B start (skip gutter A)
  const logoTopPx = pos.infoRow1;
  const logoAreaH = pos.logoAreaEnd - logoTopPx;

  if (logo.type === 'image' && logo.imageUrl) {
    try {
      const base64 = logo.imageUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const img = logo.imageUrl.includes('image/png')
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      const maxW = px(logo.width || 259);
      const maxH = px(logoAreaH);
      const dims = img.scaleToFit(maxW, maxH);
      page.drawImage(img, {
        x: logoX,
        y: yTop(logoTopPx) - dims.height,
        width: dims.width,
        height: dims.height,
      });
    } catch (e) {
      console.warn('Logo image embed failed, falling back to text:', e);
      drawTextLogo(page, layout, tokens, fonts, config, logo);
    }
  } else {
    // Text logo (default)
    drawTextLogo(page, layout, tokens, { priBold: null }, config, logo);
  }
}

function drawTextLogo(page, layout, tokens, fonts, config, logo) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const logoX = colX[0] + colW[0];
  const logoText = logo.text || config?.nombre?.split(' ')[0]?.toUpperCase() || 'LOGO';
  // Mida gran, bold, amb letter-spacing simulat
  const logoSize = 21;
  const spacing = 2.5; // simulació letter-spacing en pt

  let cx = logoX;
  const baseY = yTop(pos.infoRow1 + 28); // baseline visual del logo
  for (const ch of logoText) {
    page.drawText(ch, { x: cx, y: baseY, size: logoSize, font: tokens.fontPriBold, color: tokens.colorAccent });
    cx += tokens.fontPriBold.widthOfTextAtSize(ch, logoSize) + spacing;
  }
}

function drawSectionLabels(page, layout, tokens, fonts) {
  const { colX, colW, colEnd } = layout;
  const { pos } = layout;
  const { sizeHeader, colorAccent, colorDivider, borderW, prefix } = tokens;

  // Baseline dins de la fila de section labels
  const baseY = yTop(pos.sectionLblEnd - 4);
  const lineY = yTop(pos.sectionLblEnd);

  // Bloc esquerre: ": FREELANCE" (cols B-D)
  const leftStart = colX[1];
  const leftEnd = colX[4]; // fi col D (inici col E)
  page.drawText(`${prefix}${tokens.labels.freelance}`, {
    x: leftStart, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
  });
  drawLine(page, leftStart, lineY, leftEnd, borderW, colorDivider);

  // Bloc dret: ": CLIENTE" (cols F-H)
  const rightStart = colX[5];
  const rightEnd = colX[7] + colW[7];
  page.drawText(`${prefix}${tokens.labels.client}`, {
    x: rightStart, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
  });
  drawLine(page, rightStart, lineY, rightEnd, borderW, colorDivider);
}

function drawPartyDetails(page, layout, tokens, fonts, config, client) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const { sizeBody, colorPrimary } = tokens;
  const lineH = px(14); // interlineat per adreces

  // Col B start (esquerra) i Col F start (dreta)
  const lx = colX[1];
  const rx = colX[5];

  // Noms (fila 8) — medium weight
  const nameY = yTop(pos.partyName + 14);
  page.drawText(config?.nombre || '---', { x: lx, y: nameY, size: sizeBody, font: fonts.priMed, color: colorPrimary });
  page.drawText(client?.nombre || '---', { x: rx, y: nameY, size: sizeBody, font: fonts.priMed, color: colorPrimary });

  // NIF (fila 9)
  const nifY = yTop(pos.partyNif + 14);
  page.drawText(`${tokens.labels.nif}: ${config?.nif || '---'}`, { x: lx, y: nifY, size: sizeBody, font: fonts.priReg, color: colorPrimary });
  page.drawText(`${tokens.labels.nif}: ${client?.cifNif || '---'}`, { x: rx, y: nifY, size: sizeBody, font: fonts.priReg, color: colorPrimary });

  // Adreces (fila 10) — multilínia
  const addrStartY = yTop(pos.partyAddr + 14);
  const leftBottomY = drawMultiline(page, config?.direccion, lx, addrStartY, fonts.priReg, sizeBody, lineH, colorPrimary);
  const rightBottomY = drawMultiline(page, client?.direccion, rx, addrStartY, fonts.priReg, sizeBody, lineH, colorPrimary);

  // Border inferior — al punt més baix dels dos
  const lowestY = Math.min(leftBottomY, rightBottomY) - px(4);
  const leftEnd = colX[4];
  const rightEnd = colX[7] + colW[7];
  drawLine(page, lx, lowestY, leftEnd, tokens.borderW, tokens.colorDivider);
  drawLine(page, rx, lowestY, rightEnd, tokens.borderW, tokens.colorDivider);

  // Retornar la Y del border per calcular la resta del layout
  return lowestY;
}

function drawConceptSection(page, layout, tokens, fonts, invoice, addrBottomY) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const { sizeHeader, sizeBody, colorAccent, colorPrimary, colorDivider, borderW, prefix } = tokens;

  // Inici del concepte: addrBottomY - conceptGap (en pt)
  const conceptHeaderTopY = addrBottomY - px(pos.conceptGap);
  const baseY = conceptHeaderTopY - px(pos.conceptHdr - 4); // baseline dins la fila
  const lineY = conceptHeaderTopY - px(pos.conceptHdr);

  const lx = colX[1]; // col B
  const leftEnd = colX[4]; // fi col D (inici col E)
  const rightEnd = colX[7] + colW[7]; // fi col H

  if (invoice?.tipo === 'jornadas') {
    // 4 columnes: CONCEPTO (B-E), JORNADAS (F), TARIFA (G), BASE IMPONIBLE (H)
    page.drawText(`${prefix}${tokens.labels.concept}`, {
      x: lx, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
    });

    // JORNADAS centrat a col F
    const daysText = tokens.labels.days;
    const daysW = fonts.secBold.widthOfTextAtSize(daysText, sizeHeader);
    page.drawText(daysText, {
      x: colX[5] + (colW[5] - daysW) / 2, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
    });

    // TARIFA centrat a col G
    const rateText = tokens.labels.rate;
    const rateW = fonts.secBold.widthOfTextAtSize(rateText, sizeHeader);
    page.drawText(rateText, {
      x: colX[6] + (colW[6] - rateW) / 2, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
    });

    // BASE IMPONIBLE alineat a la dreta de col H
    drawTextRight(page, `${prefix}${tokens.labels.taxBase}`, rightEnd, baseY, fonts.secBold, sizeHeader, colorAccent);

    // Línia contínua sota els 4 headers
    drawLine(page, lx, lineY, rightEnd, borderW, colorDivider);

    // Data row
    const dataY = lineY - px(6) - sizeBody; // paddingTop 6px + baseline
    page.drawText(invoice?.concepto || '---', { x: lx, y: dataY, size: sizeBody, font: fonts.secReg, color: colorPrimary });

    // Jornades centrat a col F
    const daysVal = String(invoice?.jornadas || 0);
    const daysValW = fonts.mono.widthOfTextAtSize(daysVal, sizeBody);
    page.drawText(daysVal, {
      x: colX[5] + (colW[5] - daysValW) / 2, y: dataY, size: sizeBody, font: fonts.mono, color: colorPrimary,
    });

    // Tarifa centrat a col G
    const rateVal = formatCurrency(invoice?.tarifaDia);
    const rateValW = fonts.mono.widthOfTextAtSize(rateVal, sizeBody);
    page.drawText(rateVal, {
      x: colX[6] + (colW[6] - rateValW) / 2, y: dataY, size: sizeBody, font: fonts.mono, color: colorPrimary,
    });

    // Subtotal alineat a la dreta de col H
    drawTextRight(page, formatCurrency(invoice?.subtotal), rightEnd, dataY, fonts.mono, sizeBody, colorPrimary);
  } else {
    // Classic: 2 columnes — CONCEPTO (B-E) + BASE IMPONIBLE (F-H dreta)
    page.drawText(`${prefix}${tokens.labels.concept}`, {
      x: lx, y: baseY, size: sizeHeader, font: fonts.secBold, color: colorAccent,
    });
    drawTextRight(page, `${prefix}${tokens.labels.taxBase}`, rightEnd, baseY, fonts.secBold, sizeHeader, colorAccent);

    // Línies sota headers
    drawLine(page, lx, lineY, leftEnd, borderW, colorDivider);
    drawLine(page, colX[5], lineY, rightEnd, borderW, colorDivider);

    // Data row
    const dataY = lineY - px(6) - sizeBody;
    page.drawText(invoice?.concepto || '---', { x: lx, y: dataY, size: sizeBody, font: fonts.secReg, color: colorPrimary });
    drawTextRight(page, formatCurrency(invoice?.subtotal), rightEnd, dataY, fonts.mono, sizeBody, colorPrimary);
  }

  // Retornar lineY per calcular totals
  return lineY;
}

function drawTotals(page, layout, tokens, fonts, invoice, conceptLineY) {
  const { colX, colW } = layout;
  const { pos } = layout;
  const { sizeHeader, sizeTotal, colorPrimary, colorHighlight, colorDivider, borderW } = tokens;

  const fx = colX[5]; // col F
  const hEnd = colX[7] + colW[7]; // fi col H

  // +IVA
  const ivaY = conceptLineY - px(pos.conceptRow) - px(pos.totalsGap);
  const ivaLabel = `+ ${invoice?.ivaPorcentaje || 21}% ${tokens.labels.iva}`;
  page.drawText(ivaLabel, { x: fx, y: ivaY, size: sizeHeader, font: fonts.priReg, color: colorPrimary });
  drawTextRight(page, formatCurrency(invoice?.iva), hEnd, ivaY, fonts.mono, sizeHeader, colorPrimary);

  // -IRPF
  const irpfY = ivaY - px(pos.totalRow);
  const irpfLabel = `- ${invoice?.irpfPorcentaje || 15}% ${tokens.labels.irpf}`;
  page.drawText(irpfLabel, { x: fx, y: irpfY, size: sizeHeader, font: fonts.priReg, color: colorPrimary });
  drawTextRight(page, formatCurrency(invoice?.irpf), hEnd, irpfY, fonts.mono, sizeHeader, colorPrimary);

  // TOTAL amb border superior
  const totalBorderY = irpfY - px(pos.grandGap);
  drawLine(page, fx, totalBorderY, hEnd, borderW, colorHighlight);

  const totalY = totalBorderY - px(6) - sizeTotal; // padding + baseline
  page.drawText(tokens.labels.total, { x: fx, y: totalY, size: sizeTotal, font: fonts.priBold, color: colorHighlight });
  drawTextRight(page, formatCurrency(invoice?.total), hEnd, totalY, fonts.mono, sizeTotal, colorHighlight);
}

function drawFooter(page, layout, tokens, fonts, invoice, config, design) {
  const { colX, colW } = layout;
  const sections = design.sections || {};
  const { sizeSmall, colorPrimary, colorMuted, colorDivider, borderW } = tokens;
  const footerPad = (design.grid?.footerPadding ?? 30);

  // Posició Y del footer (des del bottom de la pàgina)
  const footerLeftX = colX[1]; // col B
  const footerRightX = colX[7] + colW[7]; // fi col H
  const footerWidth = footerRightX - footerLeftX;

  // El footer comença a footerPad px des del bottom
  // En pt: footerPad * S des del bottom
  let footerY = px(footerPad);

  // Contacte (bottom-most, dibuixem primer i pugem)
  if (sections.showFooterContact) {
    const contactY = footerY;
    page.drawText(config?.email || '---', { x: footerLeftX, y: contactY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priReg, color: colorMuted });
    // Web centrat
    const webText = config?.web || '---';
    const webW = fonts.priMed.widthOfTextAtSize(webText, parsePt(tokens.sizeSmallRaw));
    const webX = footerLeftX + (footerWidth - webW) / 2;
    page.drawText(webText, { x: webX, y: contactY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priMed, color: colorMuted });
    // Subratllat del web
    page.drawLine({
      start: { x: webX, y: contactY - 1 },
      end: { x: webX + webW, y: contactY - 1 },
      thickness: 0.5,
      color: colorMuted,
    });
    // Telèfon a la dreta
    drawTextRight(page, config?.telefono || '---', footerRightX, contactY, fonts.priReg, parsePt(tokens.sizeSmallRaw), colorMuted);
    // Línia separadora sobre contacte
    footerY = contactY + px(10) + parsePt(tokens.sizeSmallRaw);
    drawLine(page, footerLeftX, footerY, footerRightX, 0.3, colorDivider);
    footerY += px(10);
  }

  // Concepte pagament
  const conceptY = footerY;
  page.drawText(tokens.labels.paymentConcept, { x: footerLeftX, y: conceptY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priBold, color: colorPrimary });
  const labelW = fonts.priBold.widthOfTextAtSize(tokens.labels.paymentConcept, parsePt(tokens.sizeSmallRaw));
  page.drawText(invoice?.numero || '---', {
    x: footerLeftX + labelW + px(20),
    y: conceptY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priReg, color: colorPrimary,
  });
  footerY = conceptY + px(18);

  // Dades bancàries
  if (sections.showBankDetails) {
    page.drawText(tokens.labels.bankDetails, { x: footerLeftX, y: footerY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priBold, color: colorPrimary });
    drawTextRight(page, config?.iban || '---', footerRightX, footerY, fonts.mono, parsePt(tokens.sizeSmallRaw), colorPrimary);
    footerY += px(18);
  }

  // Forma de pagament
  if (sections.showPaymentMethod) {
    page.drawText(tokens.labels.paymentMethod, { x: footerLeftX, y: footerY, size: parsePt(tokens.sizeSmallRaw), font: fonts.priBold, color: colorPrimary });
    drawTextRight(page, tokens.labels.transfer, footerRightX, footerY, fonts.priReg, parsePt(tokens.sizeSmallRaw), colorPrimary);
    footerY += px(18);
  }

  // Línia divisòria superior del footer
  footerY += px(4);
  drawLine(page, footerLeftX, footerY, footerRightX, borderW, colorDivider);
}

// ─── Funció principal ───────────────────────────────────────
export async function generateInvoicePDF(invoice, client, config) {
  const { design, getLabels } = useDesignStore.getState();
  const labels = getLabels(invoice?.idioma || 'es');

  // Crear document i registrar fontkit
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Embeddir fonts
  const fontNames = design.fonts || { primary: 'Work Sans', secondary: 'Roboto', mono: 'JetBrains Mono' };
  const fonts = await embedFonts(pdfDoc, fontNames);

  // Afegir pàgina A4
  const page = pdfDoc.addPage([A4_W, A4_H]);

  // Extreure tokens de disseny
  const fs = design.fontSizes || {};
  const colors = design.colors || {};
  const tokens = {
    sizeHeader:    parsePt(fs.header),
    sizeBody:      parsePt(fs.body),
    sizeSmall:     parsePt(fs.small),
    sizeSmallRaw:  fs.small || '8pt',
    sizeTotal:     parsePt(fs.total),
    colorPrimary:  hexToRgb(colors.primary),
    colorSecondary: hexToRgb(colors.secondary),
    colorAccent:   hexToRgb(colors.accent),
    colorDivider:  hexToRgb(colors.divider),
    colorMuted:    hexToRgb(colors.muted),
    colorHighlight: hexToRgb(colors.highlight || colors.accent),
    borderW:       (design.layout?.borderWidth || 1) * S,
    prefix:        design.grid?.labelPrefix ?? ': ',
    labels,
    fontPriBold:   fonts.priBold,
  };

  // Calcular layout
  const layout = computeLayout(design.grid || {});

  // 1. Header: Logo + Nº + FECHA
  drawHeader(page, layout, tokens, fonts, invoice, config, design);
  await drawLogo(page, pdfDoc, layout, tokens, config, design);

  // 2. Section labels: ": FREELANCE" / ": CLIENTE"
  drawSectionLabels(page, layout, tokens, fonts);

  // 3. Party details: Noms, NIF, Adreces
  const addrBottomY = drawPartyDetails(page, layout, tokens, fonts, config, client);

  // 4. Concept section
  const conceptLineY = drawConceptSection(page, layout, tokens, fonts, invoice, addrBottomY);

  // 5. Totals: IVA, IRPF, TOTAL
  drawTotals(page, layout, tokens, fonts, invoice, conceptLineY);

  // 6. Footer
  drawFooter(page, layout, tokens, fonts, invoice, config, design);

  // Serialitzar i retornar
  return await pdfDoc.save();
}
