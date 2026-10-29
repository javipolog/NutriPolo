/**
 * planPdf.js — NutriPolo
 * Tria el generador segons el format del pla: planificació setmanal (nou)
 * o pla per àpats (antic).
 */
import { PLAN_FORMAT } from './planificacion';

export async function generatePlanPdf(plan, client, config, planLibrary) {
  if (plan?.formato === PLAN_FORMAT) {
    const { generatePlanificacionPDF } = await import('./pdfPlanificacionGenerator');
    return generatePlanificacionPDF(plan, client, config, { products: planLibrary?.productos || [] });
  }
  const { generateNutritionPlanPDF } = await import('./pdfPlanGenerator');
  return generateNutritionPlanPDF(plan, client, config);
}

export const planPdfFileName = (plan, client) =>
  `${[plan?.nombre || 'Plan', client?.nombre].filter(Boolean).join(' - ')}.pdf`.replace(/[\\/:*?"<>|]/g, '_');

/**
 * Imatge triada per l'usuari → JPEG petit sobre fons blanc (data URL), per
 * guardar-la al store sense inflar-lo. Les transparències queden en blanc.
 */
export async function imageFileToDataUrl(file, maxSide = 480) {
  // data: i no blob: — la CSP de Tauri només permet img-src 'self' data:
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('image'));
    el.src = source;
  });
  const r = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * r));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * r));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

/**
 * Foto de la biblioteca d'aliments (servida per l'app) → el mateix JPEG petit
 * que una foto pujada a mà, per copiar-la a la biblioteca de productes.
 */
export async function foodPhotoDataUrl(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`food photo ${resp.status}`);
  return imageFileToDataUrl(await resp.blob());
}
