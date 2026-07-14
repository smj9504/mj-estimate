/**
 * usePdfRenderer - Reusable hook for rendering PDF pages to canvas images.
 * Shared between ContractSigning and FieldContractSigning pages.
 */

import { useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { publicApi } from '../../services/api';

// Setup pdfjs worker
if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

export interface RenderedPage {
  dataUrl: string;
  width: number;
  height: number;
}

export function usePdfRenderer() {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);

  const render = useCallback(async (pdfUrl: string) => {
    setLoading(true);
    try {
      const baseURL = publicApi.defaults.baseURL || '';
      const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${baseURL}${pdfUrl}`;
      const res = await fetch(fullUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const rendered: RenderedPage[] = [];
      const RENDER_SCALE = 2;

      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        rendered.push({
          dataUrl: canvas.toDataURL('image/png'),
          width: viewport.width / RENDER_SCALE,
          height: viewport.height / RENDER_SCALE,
        });
      }
      setPages(rendered);
    } catch (err) {
      console.error('Failed to render PDF:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPages([]);
  }, []);

  return { pages, loading, render, reset };
}
