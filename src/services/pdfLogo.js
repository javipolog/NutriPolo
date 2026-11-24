/**
 * pdfLogo.js — NutriPolo
 * La marca de NutriPolo (public/icon-nutripolo.svg, viewBox 0 0 200 200) en
 * traços vectorials, per als PDF de planificacions i factures.
 */
import { rgb } from 'pdf-lib';

export const LOGO_PATHS = {
  sageA: 'M38,72.8 H69.9 Q77.3,72.8 77.3,80.2 V150.2 Q77.3,157.6 69.9,157.6 H38 Q30.6,157.6 30.6,150.2 V80.2 Q30.6,72.8 38,72.8 Z',
  sageB: 'M126.5,130.2c-8.7,0-17.3-2.2-24.9-6.6-3.3-1.9-5.7-5.1-6.7-8.8-1-3.7-.5-7.6,1.4-11l1.5-2.7h0s25.1-43.5,25.1-43.5c0,0,0,0,0,0l8.3-14.4c.2-.3.3-.5.5-.8h-37.9c-4.8,0-8.6,3.9-8.6,8.6v97.9c0,4.8,3.9,8.6,8.6,8.6h29.4c4.8,0,8.6-3.9,8.6-8.6v-19.2c-1.8.2-3.6.4-5.4.4Z',
  orange: 'M163.6,102.4h0c11.9-20.7,4.8-47.1-15.8-59h0c-1.3-.7-2.7-1.1-4.1-1.1-2.8,0-5.5,1.5-7.1,4.1l-8.3,14.4c-3.1,5.4.8,12.1,7,12.1h20.2c1.3,0,2.4,1.1,2.4,2.4,0,1.3-1.1,2.4-2.4,2.4h-20.2s0,0,0,0c-6.2,0-10,6.7-6.9,12.1l10.1,17.5c.7,1.2.3,2.6-.9,3.3-.4.2-.8.3-1.2.3-.4,0-.9-.1-1.2-.3-.4-.2-.7-.5-.9-.9l-10.1-17.5c-1.6-2.7-4.3-4-7-4-2.7,0-5.4,1.4-6.9,4l-8.5,14.8c-2.3,3.9-.9,8.9,3,11.2,6.8,3.9,14.3,5.8,21.7,5.8,14.8,0,29.2-7.8,37.2-21.6Z',
};

// Salvia i taronja del logo
const SAGE = rgb(0xBF / 255, 0xCA / 255, 0x89 / 255);
const ORANGE = rgb(0xF6 / 255, 0xAB / 255, 0x66 / 255);

/** Alçada de la marca quan fa `size` d'amplada (~140×125 dins el viewBox). */
export const logoMarkHeight = (size) => size * 125 / 140;

/** Dibuixa la marca, `size` d'amplada, amb la cantonada sup.-esq. a (x, top). */
export function drawLogoMark(page, x, top, size, colors = {}) {
  const s = size / 140;
  const ox = x - 30 * s;
  const oy = top + 42 * s;
  const sage = colors.sage || SAGE;
  page.drawSvgPath(LOGO_PATHS.sageA, { x: ox, y: oy, scale: s, color: sage });
  page.drawSvgPath(LOGO_PATHS.sageB, { x: ox, y: oy, scale: s, color: sage });
  page.drawSvgPath(LOGO_PATHS.orange, { x: ox, y: oy, scale: s, color: colors.orange || ORANGE });
}
