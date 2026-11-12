import { quoteRects, type PdfjsLib, type Rect } from './pdfjs';
import type { Size } from './pdfDocs';

export const GAP = 12;
export const PAD = 12;
export const MAX_ZOOM = 4;
export const FIT_MAX = 1040;
export const SEARCH_PAGES = 400;
export const SEARCH_MS = 1500;

export type Layout = { n: number; tops: number[]; hs: number[]; total: number };
export function buildLayout(n: number, width: number, sizes: Record<number, Size>, est: Size): Layout {
  const tops: number[] = [0], hs: number[] = [0];
  let y = PAD;
  for (let i = 1; i <= n; i++) {
    const s = sizes[i] ?? est;
    const h = Math.round((width * s[1]) / s[0]);
    tops[i] = y; hs[i] = h; y += h + GAP;
  }
  return { n, tops, hs, total: y - GAP + PAD };
}

export function pageAt(L: Layout, y: number): number {
  let lo = 1, hi = L.n;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L.tops[m] <= y) lo = m; else hi = m - 1; }
  return lo;
}

export function windowOf(L: Layout, scrollTop: number, viewH: number, buf: number): [number, number] {
  if (L.n < 1) return [1, 0];
  const a = pageAt(L, Math.max(0, scrollTop - buf));
  const bottom = scrollTop + viewH + buf;
  let b = pageAt(L, bottom);
  if (L.tops[b] > bottom) b = Math.max(a, b - 1);
  return [a, Math.min(L.n, Math.max(a, b))];
}

export type Anchor = { page: number; off: number; w: number; xc: number };
export const anchorAt = (L: Layout, y: number, xcenter: number, width: number, colW: number): Anchor => {
  const page = pageAt(L, y);
  return { page, off: y - L.tops[page], w: width, xc: colW > 0 ? xcenter / colW : 0.5 };
};
export const yOfAnchor = (L: Layout, a: Anchor, width: number): number => Math.max(0, (L.tops[Math.min(a.page, L.n)] ?? 0) + a.off * (a.w > 0 ? width / a.w : 1));

export function revealAt(L: Layout, page: number, rects: Rect[], k: number, vw: number, vh: number, colW = Infinity): { y: number; x: number } {
  const l = Math.min(...rects.map((r) => r.l)) * k, r = Math.max(...rects.map((x) => x.l + x.w)) * k, t = Math.min(...rects.map((x) => x.t)) * k;
  const bw = r - l;
  const x = Math.max(0, bw <= vw - 24 ? PAD + l + bw / 2 - vw / 2 : PAD + l - 12);
  return { y: Math.max(0, (L.tops[page] ?? 0) + t - Math.min(vh * 0.28, 160)), x: Math.min(x, Math.max(0, colW - vw)) };
}

export type Goal = { page: number | null; quote?: string };
export type Plan = { page: number; rects: Rect[]; found: boolean };
export type PlanDoc = { doc: { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number; transform: number[] } }> }; lib: Pick<PdfjsLib, 'Util'>; sizes: Record<number, Size>; text: (n: number) => Promise<unknown[]> };

export async function planJump(d: PlanDoc, goal: Goal, o: { boxW: number; now?: () => number }): Promise<Plan> {
  const n = d.doc.numPages;
  const now = o.now ?? (() => Date.now());
  const p0 = Math.min(n, Math.max(1, goal.page ?? 1));
  const learn = async (p: number) => {
    const pg = await d.doc.getPage(p);
    const v1 = pg.getViewport({ scale: 1 });
    d.sizes[p] = [v1.width, v1.height];
    return { pg, v1 };
  };
  const rectsOn = async (p: number, quote: string): Promise<Rect[]> => {
    const [{ pg, v1 }, items] = await Promise.all([learn(p), d.text(p)]);
    const s = o.boxW / v1.width;
    return quoteRects(items as never, pg.getViewport({ scale: s }).transform, s, quote, d.lib.Util as never);
  };
  const quote = goal.quote;
  if (!quote) { await learn(p0); return { page: p0, rects: [], found: false }; }
  let page = p0, rects = await rectsOn(p0, quote);
  if (!rects.length) {
    const t0 = now();
    const from = goal.page == null ? 1 : Math.max(1, p0 - SEARCH_PAGES / 2), to = goal.page == null ? Math.min(n, SEARCH_PAGES) : Math.min(n, p0 + SEARCH_PAGES / 2);
    const order = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).filter((p) => p !== p0).sort((a, b) => Math.abs(a - p0) - Math.abs(b - p0));
    for (const p of order) {
      if (now() - t0 > SEARCH_MS) break;
      let r: Rect[] = [];
      try { r = await rectsOn(p, quote); } catch { continue; }
      if (r.length) { page = p; rects = r; break; }
    }
    if (!rects.length) await learn(p0);
  }
  if (!rects.length) return { page: p0, rects: [], found: false };
  return { page, rects, found: true };
}
