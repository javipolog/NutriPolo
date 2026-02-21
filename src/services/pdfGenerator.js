/**
 * pdfGenerator.js
 * Genera PDFs de factures renderitzant InvoicePreviewModern amb html2canvas + jsPDF.
 * Substitueix el generador bàsic de Rust, utilitzant el disseny real de l'usuari.
 */

import { createRoot } from 'react-dom/client';
import React from 'react';

/**
 * Renderitza InvoicePreviewModern en un element off-screen i el captura com a PDF.
 *
 * @param {Object} invoice - Dades de la factura
 * @param {Object} client  - Dades del client
 * @param {Object} config  - Configuració de l'autònom
 * @returns {Promise<Uint8Array>} - Bytes del PDF generat
 */
export const generateInvoicePDF = async (invoice, client, config) => {
  // Importar dinàmicament per no bloquejar el bundle principal
  const [html2canvas, { default: jsPDF }, { InvoicePreviewModern }] = await Promise.all([
    import('html2canvas').then(m => m.default),
    import('jspdf'),
    import('../components/InvoicePreview'),
  ]);

  // Contenidor off-screen: ampla A4 a 96dpi (794px)
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: absolute',
    'left: -9999px',
    'top: 0',
    'width: 794px',
    'overflow: hidden',
    'background: #ffffff',
    'z-index: -9999',
  ].join(';');
  document.body.appendChild(wrapper);

  const root = createRoot(wrapper);

  return new Promise((resolve, reject) => {
    // Renderitzar el component
    root.render(
      React.createElement(InvoicePreviewModern, { invoice, client, config, scale: 1 })
    );

    // Esperar a que les fonts de Google i les imatges carreguen
    const doCapture = async () => {
      try {
        await document.fonts.ready;

        const target = wrapper.firstChild;
        if (!target) throw new Error('No s\'ha pogut renderitzar la previsualització de la factura');

        const canvas = await html2canvas(target, {
          scale: 2,              // 2x per qualitat
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          width: 794,
          windowWidth: 794,
          logging: false,
        });

        // Crear PDF A4 (210mm × 297mm)
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true,
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

        const arrayBuffer = pdf.output('arraybuffer');
        resolve(new Uint8Array(arrayBuffer));
      } catch (err) {
        reject(err);
      } finally {
        root.unmount();
        if (document.body.contains(wrapper)) {
          document.body.removeChild(wrapper);
        }
      }
    };

    // Donar temps al navegador per fer el layout i carregar fonts
    setTimeout(doCapture, 600);
  });
};

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
