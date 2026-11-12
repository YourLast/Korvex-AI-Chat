import type * as Pdfjs from 'pdfjs-dist';

export type PdfjsLib = typeof Pdfjs;
export const PDFJS_BASE = '/pdfjs';
let lib: Promise<PdfjsLib> | null = null;

export function loadPdfjs(): Promise<PdfjsLib> {
  return (lib ??= (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${PDFJS_BASE}/legacy/build/pdf.min.mjs`) as Promise<PdfjsLib>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/legacy/build/pdf.worker.min.mjs`;
    return m;
  }).catch((e) => { lib = null; throw e; }));
}

const docOpts = {
  isEvalSupported: false, enableXfa: false,
  standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`, cMapUrl: `${PDFJS_BASE}/cmaps/`, cMapPacked: true, iccUrl: `${PDFJS_BASE}/iccs/`, wasmUrl: `${PDFJS_BASE}/wasm/`,
};
export const docParams = (data: Uint8Array) => ({ data, ...docOpts });
export const docUrlParams = (url: string) => ({ url, withCredentials: true, rangeChunkSize: 1 << 18, ...docOpts });

const cmp = (s: string) => s.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');

export type Rect = { l: number; t: number; w: number; h: number };
export function fontPx(rects: Rect[]): number {
  const v = rects.map((r) => r.h / 1.15).filter((x) => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}
export function highlightText(p: { quote?: string; snippet?: string } | undefined): string | undefined {
  if (!p) return undefined;
  if (p.quote && p.quote.trim()) return p.quote.trim();
  const s = (p.snippet ?? '').replace(/^[\s….]+|[\s….]+$/g, '').trim();
  return s.length >= 12 ? s : undefined;
}
type Item = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };

export function quoteRects(items: Item[], viewportTransform: number[], scale: number, quote: string, util: { transform: (a: number[], b: number[]) => number[] }): Rect[] {
  const parts: { s: number; e: number; it: Item }[] = [];
  let all = '';
  for (const it of items) {
    if (!it.str) continue;
    const t = cmp(it.str);
    if (!t) continue;
    const s = all.length;
    all += t;
    parts.push({ s, e: all.length, it });
  }
  const q = cmp(quote);
  if (q.length < 3) return [];
  let at = all.indexOf(q), len = q.length;
  if (at < 0 && q.length > 30) {
    const head = q.slice(0, 30), i = all.indexOf(head);
    if (i >= 0) { at = i; len = Math.min(q.length, all.length - i); }
    else { const tail = q.slice(-30), j = all.indexOf(tail); if (j >= 0) { at = Math.max(0, j + 30 - q.length); len = Math.min(q.length, all.length - at); } }
  }
  if (at < 0) return [];
  const out: Rect[] = [];
  for (const p of parts) {
    if (p.e <= at || p.s >= at + len) continue;
    const m = util.transform(viewportTransform, p.it.transform);
    const h = Math.hypot(m[2], m[3]);
    out.push({ l: m[4], t: m[5] - h, w: Math.max(2, p.it.width * scale), h: h * 1.15 });
  }
  return out;
}
