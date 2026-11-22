'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { docUrlParams, loadPdfjs } from './fileview/pdfjs';

const done = new Map<string, string | null>();
const waiting = new Map<string, Promise<string | null>>();
let running = 0;
const queue: (() => void)[] = [];
const slot = () => new Promise<void>((ok) => { if (running < 2) { running++; ok(); } else queue.push(() => { running++; ok(); }); });
const free = () => { running--; queue.shift()?.(); };

async function render(src: string, px: number): Promise<string | null> {
  await slot();
  let task: { destroy: () => Promise<void> } | null = null;
  try {
    const lib = await loadPdfjs();
    const t = lib.getDocument({ ...docUrlParams(src), disableAutoFetch: true });
    task = t;
    const doc: PDFDocumentProxy = await t.promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = (px * 2) / Math.max(1, v1.width);
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(v.width); c.height = Math.min(Math.ceil(v.height), Math.ceil(v.width * 1.5));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, canvas: c, viewport: v }).promise;
    return c.toDataURL('image/png');
  } catch { return null; }
  finally { void task?.destroy().catch(() => {}); free(); }
}

export function pdfThumb(src: string, px = 40): Promise<string | null> {
  const key = `${px}|${src}`;
  if (done.has(key)) return Promise.resolve(done.get(key)!);
  let p = waiting.get(key);
  if (!p) { p = render(src, px).then((u) => { done.set(key, u); waiting.delete(key); return u; }); waiting.set(key, p); }
  return p;
}
export const isPdf = (name: string) => /\.pdf$/i.test(name);

export function PdfThumb({ src, px = 40, className, children }: { src?: string; px?: number; className?: string; children: ReactNode }) {
  const key = src ? `${px}|${src}` : '';
  const [url, setUrl] = useState<string | null>(() => (key && done.get(key)) || null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    void pdfThumb(src, px).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [src, px]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className={`pdf-thumb${className ? ' ' + className : ''}`} src={url} alt="" draggable={false} data-testid="pdf-thumb" /> : <>{children}</>;
}
