import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '../UI';
import { useT } from '../../i18n';

// pdf.js es carrega només quan s'obre la vista prèvia
let pdfjsPromise = null;
const loadPdfjs = () => {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
};

/**
 * Vista prèvia d'un PDF generat al vol. `generate` retorna els bytes; es
 * torna a cridar (amb retard) cada cop que canvia `deps`.
 */
export const PdfPreview = ({ generate, deps, delay = 700 }) => {
  const t = useT();
  const containerRef = useRef(null);
  const [state, setState] = useState({ busy: true, error: null });
  const genRef = useRef(generate);
  genRef.current = generate;

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, busy: true }));
      try {
        const [pdfjs, bytes] = await Promise.all([loadPdfjs(), genRef.current()]);
        if (cancelled) return;
        doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
        const container = containerRef.current;
        if (cancelled || !container) return;
        const width = container.clientWidth - 16;
        const canvases = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: scale * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.className = 'block mx-auto mb-3 shadow-card rounded-sm bg-white';
          canvas.setAttribute('aria-label', `${t.pf_preview_page} ${i}`);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          canvases.push(canvas);
        }
        if (cancelled) return;
        // Substitució d'un cop: evita parpelleig mentre es redibuixa
        container.replaceChildren(...canvases);
        setState({ busy: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ busy: false, error: String(e?.message || e) });
      } finally {
        doc?.destroy();
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <div className="relative h-full">
      {state.busy && (
        <div className="absolute top-2 right-3 z-10" aria-live="polite">
          <Spinner size="sm" />
        </div>
      )}
      {state.error && (
        <div className="m-3 p-3 rounded-button bg-danger-light text-danger text-xs flex gap-2" role="alert">
          <AlertTriangle size={14} className="shrink-0" /> {state.error}
        </div>
      )}
      <div ref={containerRef} className="p-2" />
    </div>
  );
};

export default PdfPreview;
