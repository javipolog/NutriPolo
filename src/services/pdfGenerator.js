/**
 * pdfGenerator.js
 * Genera PDFs vectorials de factures amb pdf-lib (text seleccionable, pixel-perfect).
 * Delega a pdfLibGenerator.js per la generació real.
 * Manté savePDF per la persistència via Tauri o fallback web.
 */

// Re-exportar el generador vectorial pdf-lib
export { generateInvoicePDF } from './pdfLibGenerator';

/**
 * Guarda el PDF al disc via Tauri o el descarrega via blob en mode web.
 *
 * @param {Uint8Array} pdfBytes - Bytes del PDF
 * @param {string} filePath     - Ruta de destí (Tauri) o nom de fitxer (web)
 */
export const savePDF = async (pdfBytes, filePath) => {
  if (window.__TAURI__) {
    const { writeBinaryFile } = await import('@tauri-apps/api/fs');
    await writeBinaryFile(filePath, pdfBytes);
  } else {
    // Fallback per mode dev sense Tauri
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split(/[\\/]/).pop() || 'factura.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
