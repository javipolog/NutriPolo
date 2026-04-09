/**
 * pdfPlanGenerator.js — NutriPolo
 * =================================
 * Genera el PDF d'un pla nutricional amb pdf-lib.
 * Retorna Uint8Array amb els bytes del PDF.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { validateDesign } from './invoiceDesignPresets';

// ── Constants ─────────────────────────────────────────────────────────────
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 40;
const COL_W = A4_W - MARGIN * 2;

// Brand colors
const C_GREEN    = rgb(0.29, 0.60, 0.38);   // wellness-400 #4A9960
const C_GREEN_LT = rgb(0.91, 0.96, 0.92);   // wellness-50
const C_CORAL    = rgb(0.91, 0.52, 0.42);   // coral-400 #E8846A
const C_SAGE     = rgb(0.44, 0.47, 0.39);   // sage-600
const C_DARK     = rgb(0.10, 0.11, 0.09);   // sage-950
const C_LIGHT    = rgb(0.96, 0.97, 0.95);   // sage-50
const C_MID      = rgb(0.89, 0.91, 0.86);   // sage-200
const C_WHITE    = rgb(1, 1, 1);

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
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

// ── Main generator ─────────────────────────────────────────────────────────

export async function generateNutritionPlanPDF(plan, client, config) {
  const design = validateDesign(config?.invoiceDesign);
  const doc = await PDFDocument.create();

  // Embed standard fonts (no fetch needed)
  const fontReg  = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Embed logo image if provided
  let logoImage = null;
  if (design.logo?.data) {
    try {
      const base64 = design.logo.data.includes(',') ? design.logo.data.split(',')[1] : design.logo.data;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      logoImage = design.logo.type === 'png'
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('Plan PDF: logo embedding failed:', err);
    }
  }

  const pages = [doc.addPage([A4_W, A4_H])];
  let page = pages[0];
  let y = A4_H - MARGIN;

  // Helper: add new page when running out of space
  const ensureSpace = (needed) => {
    if (y - needed < MARGIN + 30) {
      page = doc.addPage([A4_W, A4_H]);
      pages.push(page);
      y = A4_H - MARGIN;
      drawPageHeader();
      y -= 10;
    }
  };

  const drawText = (text, x, yPos, { font = fontReg, size = 9, color = C_DARK, maxWidth } = {}) => {
    if (!text) return;
    const safe = String(text).replace(/[\u00A0\u202F\u2009]/g, ' ');
    if (maxWidth) {
      const lines = wrapText(safe, maxWidth, font, size);
      lines.forEach((ln, i) => {
        page.drawText(ln, { x, y: yPos - i * (size + 2), font, size, color });
      });
      return lines.length;
    }
    page.drawText(safe, { x, y: yPos, font, size, color });
    return 1;
  };

  const drawRect = (x, yPos, w, h, { fill, stroke, opacity } = {}) => {
    page.drawRectangle({
      x, y: yPos - h, width: w, height: h,
      color: fill, borderColor: stroke,
      borderWidth: stroke ? 0.5 : 0,
      opacity: opacity ?? 1,
    });
  };

  const drawLine = (x1, yPos, x2, color = C_MID, thickness = 0.5) => {
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness, color });
  };

  // ── Page header (logo area) ──────────────────────────────────────────────
  const drawPageHeader = () => {
    // Green top bar
    page.drawRectangle({ x: 0, y: A4_H - 28, width: A4_W, height: 28, color: C_GREEN });

    // Logo image or text
    if (logoImage) {
      try {
        const dims = logoImage.scale(1);
        const maxH = 20;
        const ratio = Math.min(maxH / dims.height, 1);
        const w = dims.width * ratio;
        const h = dims.height * ratio;
        page.drawImage(logoImage, { x: MARGIN, y: A4_H - 24, width: w, height: h });
      } catch {
        drawText(config?.nombre || 'NutriPolo', MARGIN, A4_H - 10, { font: fontBold, size: 12, color: C_WHITE });
      }
    } else {
      drawText(config?.nombre || 'NutriPolo', MARGIN, A4_H - 10, { font: fontBold, size: 12, color: C_WHITE });
    }

    const right = config?.numColegiada ? `Col. ${config.numColegiada}` : '';
    if (right) {
      const rw = fontReg.widthOfTextAtSize(right, 8);
      drawText(right, A4_W - MARGIN - rw, A4_H - 11, { size: 8, color: C_WHITE });
    }
  };

  drawPageHeader();
  y = A4_H - 28 - 16;

  // ── Client + Plan title block ───────────────────────────────────────────
  drawRect(MARGIN, y + 4, COL_W, 52, { fill: C_LIGHT });
  drawText('PLAN NUTRICIONAL PERSONALIZADO', MARGIN + 8, y - 4, { font: fontBold, size: 8, color: C_GREEN });
  drawText(plan.nombre || 'Plan nutricional', MARGIN + 8, y - 16, { font: fontBold, size: 14, color: C_DARK });

  const clientLine = client?.nombre ? `Cliente: ${client.nombre}` : '';
  const datesLine  = [plan.fechaInicio && `Inicio: ${fmt(plan.fechaInicio)}`, plan.fechaFin && `Fin: ${fmt(plan.fechaFin)}`].filter(Boolean).join('   ');
  if (clientLine) drawText(clientLine, MARGIN + 8, y - 32, { size: 9, color: C_SAGE });
  if (datesLine)  drawText(datesLine,  MARGIN + 8, y - 43, { size: 8, color: C_SAGE });

  y -= 62;

  // ── Objectives ─────────────────────────────────────────────────────────
  if (plan.objetivos) {
    ensureSpace(30);
    drawText('OBJETIVOS', MARGIN, y, { font: fontBold, size: 8, color: C_GREEN });
    y -= 4;
    drawLine(MARGIN, y, MARGIN + COL_W, C_GREEN, 1);
    y -= 10;
    const lines = wrapText(plan.objetivos, COL_W, fontReg, 9);
    ensureSpace(lines.length * 12 + 6);
    lines.forEach(ln => { drawText(ln, MARGIN, y, { size: 9 }); y -= 12; });
    y -= 6;
  }

  // ── Macros ─────────────────────────────────────────────────────────────
  const { proteinas, carbohidratos, grasas } = plan.macros || {};
  if (plan.kcalObjetivo || proteinas || carbohidratos || grasas) {
    ensureSpace(50);
    drawText('DISTRIBUCIÓN DE MACROS', MARGIN, y, { font: fontBold, size: 8, color: C_GREEN });
    y -= 4;
    drawLine(MARGIN, y, MARGIN + COL_W, C_GREEN, 1);
    y -= 12;

    const cells = [
      ['Kcal/día', plan.kcalObjetivo ? `${plan.kcalObjetivo} kcal` : '—'],
      ['Proteínas',     proteinas ? `${proteinas}g` : '—'],
      ['Carbohidratos', carbohidratos ? `${carbohidratos}g` : '—'],
      ['Grasas',        grasas ? `${grasas}g` : '—'],
    ];
    const cw = COL_W / 4;
    cells.forEach(([label, val], i) => {
      const cx = MARGIN + i * cw;
      drawRect(cx, y + 4, cw - 3, 28, { fill: i === 0 ? C_GREEN_LT : C_LIGHT });
      drawText(label, cx + 4, y - 2,  { size: 7, color: C_SAGE, font: fontBold });
      drawText(val,   cx + 4, y - 14, { size: 11, color: C_DARK, font: fontBold });
    });

    // Macro bar
    const p = parseFloat(proteinas) || 0;
    const c = parseFloat(carbohidratos) || 0;
    const g = parseFloat(grasas) || 0;
    const total = p + c + g;
    if (total > 0) {
      const barY = y - 30;
      const barH = 7;
      let bx = MARGIN;
      const segments = [[p, C_GREEN], [c, C_CORAL], [g, rgb(0.9, 0.75, 0.2)]];
      segments.forEach(([n, col]) => {
        const bw = (n / total) * COL_W;
        if (bw > 0) { drawRect(bx, barY + barH, bw, barH, { fill: col }); bx += bw; }
      });
    }

    y -= 44;
  }

  // ── Meals ───────────────────────────────────────────────────────────────
  const comidas = plan.comidas || [];
  if (comidas.length > 0) {
    ensureSpace(24);
    drawText('PLAN DE COMIDAS', MARGIN, y, { font: fontBold, size: 8, color: C_GREEN });
    y -= 4;
    drawLine(MARGIN, y, MARGIN + COL_W, C_GREEN, 1);
    y -= 14;

    for (const meal of comidas) {
      // Meal header
      ensureSpace(24);
      drawRect(MARGIN, y + 4, COL_W, 18, { fill: C_GREEN_LT });
      drawText(meal.nombre || '—', MARGIN + 6, y - 3, { font: fontBold, size: 10, color: C_GREEN });
      if (meal.hora) drawText(meal.hora, MARGIN + COL_W - 30, y - 3, { size: 9, color: C_SAGE });
      y -= 22;

      const opciones = meal.opciones || [];
      if (opciones.length === 0) {
        ensureSpace(16);
        drawText('(Sin opciones definidas)', MARGIN + 8, y, { size: 8, color: C_SAGE });
        y -= 14;
      } else {
        opciones.forEach((opt, oi) => {
          const alLines = opt.alimentos ? wrapText(opt.alimentos, COL_W - 24, fontReg, 8.5) : [];
          const needed = 14 + (opt.descripcion ? 12 : 0) + alLines.length * 11 + 6;
          ensureSpace(needed);

          if (opt.descripcion) {
            drawText(`Opción ${oi + 1}: ${opt.descripcion}`, MARGIN + 8, y, { font: fontBold, size: 8.5, color: C_DARK });
            y -= 12;
          } else if (opciones.length > 1) {
            drawText(`Opción ${oi + 1}`, MARGIN + 8, y, { font: fontBold, size: 8, color: C_SAGE });
            y -= 11;
          }

          if (alLines.length > 0) {
            alLines.forEach(ln => {
              drawText(`• ${ln}`, MARGIN + 12, y, { size: 8.5 });
              y -= 11;
            });
          }

          if (opt.kcalAprox) {
            drawText(`~${opt.kcalAprox} kcal`, MARGIN + 12, y, { size: 7.5, color: C_SAGE });
            y -= 10;
          }

          if (opt.notas) {
            const notaLines = wrapText(opt.notas, COL_W - 30, fontReg, 7.5);
            notaLines.forEach(ln => { drawText(ln, MARGIN + 14, y, { size: 7.5, color: C_SAGE }); y -= 10; });
          }

          if (oi < opciones.length - 1) {
            drawLine(MARGIN + 8, y + 2, MARGIN + COL_W - 8, C_MID);
            y -= 8;
          }
        });
      }
      y -= 8;
    }
  }

  // ── Recommendations ─────────────────────────────────────────────────────
  if (plan.recomendaciones) {
    ensureSpace(30);
    drawText('RECOMENDACIONES', MARGIN, y, { font: fontBold, size: 8, color: C_GREEN });
    y -= 4;
    drawLine(MARGIN, y, MARGIN + COL_W, C_GREEN, 1);
    y -= 12;
    const lines = wrapText(plan.recomendaciones, COL_W, fontReg, 9);
    for (const ln of lines) {
      ensureSpace(12);
      drawText(ln, MARGIN, y, { size: 9 });
      y -= 12;
    }
    y -= 6;
  }

  // ── Supplements ─────────────────────────────────────────────────────────
  if (plan.suplementos) {
    ensureSpace(30);
    drawText('SUPLEMENTACIÓN', MARGIN, y, { font: fontBold, size: 8, color: C_GREEN });
    y -= 4;
    drawLine(MARGIN, y, MARGIN + COL_W, C_GREEN, 1);
    y -= 12;
    const lines = wrapText(plan.suplementos, COL_W, fontReg, 9);
    for (const ln of lines) {
      ensureSpace(12);
      drawText(ln, MARGIN, y, { size: 9 });
      y -= 12;
    }
    y -= 6;
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const allPages = doc.getPages();
  allPages.forEach((pg, i) => {
    // Bottom bar
    pg.drawRectangle({ x: 0, y: 0, width: A4_W, height: 24, color: C_GREEN_LT });
    const contact = [config?.email, config?.telefono, config?.web].filter(Boolean).join('  ·  ');
    const fw = fontReg.widthOfTextAtSize(contact, 7);
    pg.drawText(contact, { x: (A4_W - fw) / 2, y: 8, font: fontReg, size: 7, color: C_SAGE });
    // Page number
    const pn = `${i + 1} / ${allPages.length}`;
    pg.drawText(pn, { x: A4_W - MARGIN - fontReg.widthOfTextAtSize(pn, 7), y: 8, font: fontReg, size: 7, color: C_SAGE });
  });

  return doc.save();
}
