/**
 * pdfFonts.js — NutriPolo
 * Fonts dels PDF (factures, plans i planificacions): Onest (OFL), instàncies
 * estàtiques completes a public/fonts. Es llegeixen amb fetch i es guarden
 * en memòria perquè la vista prèvia en viu no les torni a demanar.
 */

export const ONEST_FILES = {
  light: 'Onest-Light.ttf', reg: 'Onest-Regular.ttf', med: 'Onest-Medium.ttf',
  semi: 'Onest-SemiBold.ttf', bold: 'Onest-Bold.ttf', display: 'Onest-ExtraBold.ttf',
};

const cache = {};

export async function fetchFont(filename) {
  if (cache[filename]) return cache[filename];
  const resp = await fetch(`/fonts/${filename}`);
  if (!resp.ok) throw new Error(`Font not found: ${filename}`);
  cache[filename] = new Uint8Array(await resp.arrayBuffer());
  return cache[filename];
}
