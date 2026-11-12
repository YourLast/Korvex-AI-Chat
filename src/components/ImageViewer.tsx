'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import {
  GAP, DOUBLE_MS, DOUBLE_PX, TAP_PX, clamp, doubleTap, dismissLook, easeOut, fit, fitView, glide, maxScale, morph, pageStep,
  rubberClamp, rubberScale, shouldDismiss, thumbRect, trackOffset, velocity, visibleEnough, zoomAt, type Box, type View,
} from '@/lib/viewer';
import { canCopyImage, copyImage, prefetch, saveImage, shareImage, type Outcome } from '@/lib/imageActions';
import { registerViewer } from './iv';
import { SaveLink } from './SaveLink';
import { useT } from '@/lib/i18n/react';
import { useBackClose } from '@/lib/backClose';
import { needsShare } from '@/lib/fileSave';
import { pageUrl, type PreviewKind } from '@/lib/previewKind';

export type IvItem = { src: string; name: string; size?: string; el: HTMLElement | null; nw: number; nh: number; thumb?: string; hi?: string; fixed?: boolean };
export type IvDoc = { href: string; name: string; kind: PreviewKind };
type DocSt = IvDoc & { phase: 'loading' | 'ready' | 'error'; code?: string; total?: number };
export type DocManifest = { state: 'ready'; v: string; pages: [number, number][]; total: number } | { state: 'pending' } | { state: 'error'; code: string };

export async function loadDoc(href: string, signal: AbortSignal, limitMs = 180_000): Promise<DocManifest> {
  const t0 = Date.now();
  for (;;) {
    let r: Response;
    try { r = await fetch(`${href}?preview=1&wait=15000`, { signal, credentials: 'same-origin', cache: 'no-store' }); }
    catch (e) { if (signal.aborted) throw e; return { state: 'error', code: 'network' }; }
    let j: DocManifest | null = null;
    try { j = (await r.json()) as DocManifest; } catch {  }
    if (!r.ok && !(j && j.state === 'error')) return { state: 'error', code: r.status === 404 ? 'gone' : 'network' };
    if (!j || !j.state) return { state: 'error', code: 'network' };
    if (j.state !== 'pending') return j;
    if (Date.now() - t0 > limitMs) return { state: 'error', code: 'timeout' };
    await new Promise((ok) => setTimeout(ok, 400));
  }
}

export function docItems(href: string, name: string, m: { v: string; pages: [number, number][] }, phone: boolean): IvItem[] {
  return m.pages.map(([w, h], i) => ({
    src: pageUrl(href, m.v, i + 1, phone ? 1080 : 1600), hi: phone ? pageUrl(href, m.v, i + 1, 1600) : undefined, thumb: pageUrl(href, m.v, i + 1, 320),
    name, el: null, nw: w, nh: h, fixed: true,
  }));
}

let hostOpen: ((items: IvItem[], index: number) => void) | null = null;
let hostDoc: ((d: IvDoc, from?: HTMLElement | null) => void) | null = null;

const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest('details:not([open])');
const thumbImg = (el: HTMLElement | null) => (el ? (el.matches('img') ? (el as HTMLImageElement) : el.querySelector('img')) : null);

export function galleryOf(el: HTMLElement): { items: IvItem[]; index: number } {
  const scope = el.closest('[data-iv-scope], .thread, main') ?? document.body;
  const seen = new Map<string, number>();
  const items: IvItem[] = [];
  let index = 0;
  for (const x of scope.querySelectorAll<HTMLElement>('[data-iv]')) {
    if (x !== el && !visible(x)) continue;
    const src = x.dataset.ivSrc || '';
    if (!src) continue;
    const img = thumbImg(x);
    const it: IvItem = { src, name: x.dataset.ivName || '', size: x.dataset.ivSize || undefined, el: x, nw: Number(x.dataset.ivW) || img?.naturalWidth || 0, nh: Number(x.dataset.ivH) || img?.naturalHeight || 0,
      thumb: img?.currentSrc || img?.src || undefined };
    const was = seen.get(src);
    if (was !== undefined) { if (x === el) { items[was] = it; index = was; } continue; }
    seen.set(src, items.length);
    if (x === el) index = items.length;
    items.push(it);
  }
  if (!items.length) { const img = thumbImg(el); items.push({ src: el.dataset.ivSrc || '', name: el.dataset.ivName || '', el, nw: img?.naturalWidth ?? 0, nh: img?.naturalHeight ?? 0 }); }
  return { items, index };
}

export const viewerReady = () => !!hostOpen && !!hostDoc;

export function openDoc(d: IvDoc, from?: HTMLElement | null) {
  if (hostDoc) hostDoc(d, from);
  else window.open(d.href, '_blank', 'noopener');
}

export function openImage(el: HTMLElement) {
  const g = galleryOf(el);
  if (hostOpen) hostOpen(g.items, g.index);
  else window.open(g.items[g.index].src, '_blank', 'noopener');
}

function under(el: HTMLImageElement, it: IvItem) {
  if (el.complete && el.naturalWidth > 0) return;
  if (!it.thumb || it.thumb === it.src || el.dataset.under) return;
  try { if (new URL(it.thumb, window.location.href).href === new URL(it.src, window.location.href).href) return; } catch { return; }
  el.dataset.under = '1';
  el.style.backgroundImage = `url("${it.thumb.replace(/"/g, '%22')}")`;
  el.style.backgroundSize = '100% 100%';
}

type Frame = { v: View; inset: [number, number, number, number]; r: number };
type G =
  | { m: 'wait'; id: number; x0: number; y0: number; t0: number; v0: View; type: string; samples: { t: number; x: number; y: number }[] }
  | { m: 'pan' | 'page' | 'dismiss' | 'up'; id: number; x0: number; y0: number; t0: number; v0: View; type: string; samples: { t: number; x: number; y: number }[] }
  | { m: 'pinch'; s0: number; v0: View; mx: number; my: number; d0: number; lx: number; ly: number };

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const NOTE_MS = 3200;

export function ImageViewerHost() {
  const t = useT();
  const [st, setSt] = useState<{ items: IvItem[]; index: number; doc?: DocSt } | null>(null);
  const [chrome, setChrome] = useState(true);
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [desk, setDesk] = useState(false);
  const root = useRef<HTMLDivElement>(null), bg = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), closeBtn = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null), strip = useRef<HTMLElement>(null);
  const imgs = useRef(new Map<number, HTMLImageElement>());
  const S = useRef({ W: 0, H: 0, view: { x: 0, y: 0, s: 1 } as View, anim: 0, closing: false, opening: false, g: null as G | null,
    pts: new Map<number, { x: number; y: number }>(), lastTap: null as { t: number; x: number; y: number } | null, tapT: 0 as number | ReturnType<typeof setTimeout>,
    hidden: null as HTMLElement | null, items: [] as IvItem[], index: 0, noteT: 0 as number | ReturnType<typeof setTimeout>, returnFocus: null as HTMLElement | null,
    doc: false, ox: 0, oy: 0, ac: null as AbortController | null, wheelAcc: 0, wheelT: 0, wheelFlip: 0 });

  const pad = () => (coarse() ? { x: 0, y: 0 } : S.current.doc ? { x: 40, y: 28 } : { x: 72, y: 64 });
  const boxOf = (i: number): Box => { const s = S.current, it = s.items[i]; return fit(it?.nw ?? 0, it?.nh ?? 0, s.W, s.H, pad()); };
  const cur = () => S.current.index;
  const paint = (img: HTMLImageElement | undefined, b: Box, v: View, inset?: [number, number, number, number], r?: number) => {
    if (!img) return;
    img.style.width = `${b.w}px`; img.style.height = `${b.h}px`;
    img.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`;
    img.style.clipPath = inset && inset.some((x) => x > 0.01) ? `inset(${inset.map((x) => `${x}px`).join(' ')} round ${Math.max(0, r ?? 0)}px)` : '';
  };
  const apply = (v: View) => { S.current.view = v; paint(imgs.current.get(cur()), boxOf(cur()), v); if (v.s > 1.3) sharpen(); };
  const sharpen = () => {
    const s = S.current, it = s.items[s.index], img = imgs.current.get(s.index);
    if (!it?.hi || !img || img.dataset.hi) return;
    img.dataset.hi = '1';
    const pre = new Image();
    pre.src = it.hi;
    pre.decode().then(() => { if (imgs.current.get(s.index) === img) img.src = it.hi!; }).catch(() => { delete img.dataset.hi; });
  };
  const loc = (x: number, y: number) => ({ x: x - S.current.ox, y: y - S.current.oy });
  const setBg = (o: number) => { if (bg.current) bg.current.style.opacity = String(o); };
  const setTrack = (dx: number) => { if (track.current) track.current.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : ''; };
  const layout = useCallback(() => {
    const s = S.current, r = stage.current ?? root.current;
    if (!r) return;
    s.W = r.clientWidth || window.innerWidth; s.H = r.clientHeight || window.innerHeight;
    const b = r.getBoundingClientRect(); s.ox = b.left; s.oy = b.top;
    for (const [i, img] of imgs.current) {
      const slide = img.parentElement as HTMLElement | null;
      if (slide) slide.style.transform = `translate3d(${(i - s.index) * (s.W + GAP)}px, 0, 0)`;
      if (i !== s.index) paint(img, boxOf(i), fitView(boxOf(i)));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => { cancelAnimationFrame(S.current.anim); S.current.anim = 0; };
  const tween = (ms: number, frame: (p: number) => void, done?: () => void) => {
    stop();
    if (ms <= 0) { frame(1); done?.(); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      frame(easeOut(p));
      if (p < 1) S.current.anim = requestAnimationFrame(step); else { S.current.anim = 0; done?.(); }
    };
    S.current.anim = requestAnimationFrame(step);
  };
  const animateTo = (to: View, ms = 280, done?: () => void) => {
    const from = S.current.view;
    if (reduced()) { apply(to); done?.(); return; }
    tween(ms, (p) => apply({ x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, s: from.s + (to.s - from.s) * p }), done);
  };

  const liveEl = (it: IvItem): HTMLElement | null => {
    if (S.current.doc) return null;
    if (it.el && document.contains(it.el)) return it.el;
    return document.querySelector<HTMLElement>(`[data-iv-src="${CSS.escape(it.src)}"]`);
  };
  const hideThumb = (el: HTMLElement | null) => {
    const s = S.current;
    if (s.hidden && s.hidden !== el) s.hidden.style.visibility = '';
    s.hidden = el;
    if (el) el.style.visibility = 'hidden';
  };
  const thumbFrame = (i: number): Frame | null => {
    const it = S.current.items[i];
    const el = it ? liveEl(it) : null, img = thumbImg(el);
    if (!img || !(it.nw > 0)) return null;
    const b = img.getBoundingClientRect();
    const box = { x: b.left, y: b.top, w: b.width, h: b.height };
    if (!visibleEnough(box, S.current.W, S.current.H)) return null;
    const tr = thumbRect(box, it.nw, it.nh, getComputedStyle(img).objectFit || 'fill');
    const rad = (x: Element | null) => (x ? parseFloat(getComputedStyle(x).borderTopLeftRadius) || 0 : 0);
    const r = Math.max(rad(img), rad(img.closest('.md-fig-img')));
    const m = morph(boxOf(i), tr, 0, r);
    return { v: m.v, inset: m.inset, r: m.r };
  };

  const open = useCallback((items: IvItem[], index: number) => {
    const s = S.current;
    s.ac?.abort(); s.ac = null; s.doc = false;
    s.items = items; s.index = index; s.closing = false; s.g = null; s.pts.clear(); s.lastTap = null;
    s.returnFocus = (document.activeElement as HTMLElement) ?? null;
    imgs.current.clear();
    setFailed({}); setNote(null); setChrome(true);
    setDesk(!coarse());
    setSt({ items, index });
    for (const it of items.slice(Math.max(0, index - 1), index + 2)) prefetch(it);
  }, []);

  const openDocument = useCallback((d: IvDoc, from?: HTMLElement | null) => {
    const s = S.current;
    s.ac?.abort();
    const ac = new AbortController();
    s.ac = ac; s.doc = true;
    s.items = []; s.index = 0; s.closing = false; s.g = null; s.pts.clear(); s.lastTap = null; s.view = { x: 0, y: 0, s: 1 };
    s.returnFocus = from ?? (document.activeElement as HTMLElement) ?? null;
    imgs.current.clear();
    setFailed({}); setNote(null); setChrome(true);
    setDesk(!coarse());
    setSt({ items: [], index: 0, doc: { ...d, phase: 'loading' } });
    void loadDoc(d.href, ac.signal).then((m) => {
      if (ac.signal.aborted) return;
      if (m.state !== 'ready') { setSt((p) => (p?.doc?.href === d.href ? { ...p, doc: { ...p.doc, phase: 'error', code: m.state === 'error' ? m.code : 'timeout' } } : p)); return; }
      const items = docItems(d.href, d.name, m, coarse());
      s.items = items; s.index = 0;
      setSt((p) => (p?.doc?.href === d.href ? { items, index: 0, doc: { ...p.doc, phase: 'ready', total: m.total } } : p));
    }).catch(() => {  });
  }, []);

  const finishClose = useCallback(() => {
    const s = S.current;
    s.ac?.abort(); s.ac = null;
    stop();
    hideThumb(null);
    clearTimeout(s.tapT);
    s.closing = false;
    document.documentElement.classList.remove('iv-open');
    setSt(null);
    const back = s.items[s.index] ? liveEl(s.items[s.index]) : null;
    (back ?? s.returnFocus)?.focus?.({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    const s = S.current;
    if (s.closing || !root.current) return;
    s.closing = true; s.g = null; s.pts.clear();
    clearTimeout(s.tapT);
    setTrack(0);
    root.current.dataset.chrome = '0';
    const r = root.current;
    if (reduced()) {
      r.style.transition = 'opacity 160ms linear'; r.style.opacity = '0';
      setTimeout(finishClose, 170);
      return;
    }
    const to = thumbFrame(s.index);
    const from: Frame = { v: s.view, inset: [0, 0, 0, 0], r: 0 };
    const bg0 = Number(bg.current?.style.opacity || 1);
    const img = imgs.current.get(s.index), b = boxOf(s.index);
    if (to && img) {
      hideThumb(liveEl(s.items[s.index]));
      tween(300, (p) => {
        const L = (a: number, z: number) => a + (z - a) * p;
        paint(img, b, { x: L(from.v.x, to.v.x), y: L(from.v.y, to.v.y), s: L(from.v.s, to.v.s) }, [0, 1, 2, 3].map((k) => L(0, to.inset[k])) as Frame['inset'], L(0, to.r));
        setBg(bg0 * (1 - p));
      }, finishClose);
    } else {
      hideThumb(null);
      const v0 = s.view;
      tween(220, (p) => {
        const k = 1 - 0.08 * p;
        if (img) { paint(img, b, { x: v0.x + (b.w * v0.s * (1 - k)) / 2, y: v0.y + (b.h * v0.s * (1 - k)) / 2, s: v0.s * k }); img.style.opacity = String(1 - p); }
        setBg(bg0 * (1 - p));
      }, finishClose);
    }
  }, [finishClose]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    hostOpen = open; hostDoc = openDocument;
    return () => { if (hostOpen === open) hostOpen = null; if (hostDoc === openDocument) hostDoc = null; };
  }, [open, openDocument]);
  useBackClose(!!st?.doc, () => close());

  useLayoutEffect(() => {
    if (!st) return;
    const s = S.current;
    document.documentElement.classList.add('iv-open');
    layout();
    const f = boxOf(s.index);
    const r = root.current!;
    if (s.doc) {
      setBg(1);
      const img = imgs.current.get(s.index);
      if (s.items.length) apply(fitView(f));
      if (reduced()) {  }
      else if (img) { img.style.opacity = '0'; tween(180, (p) => { img.style.opacity = String(p); }, () => { img.style.opacity = ''; }); }
      else if (!s.items.length) { r.style.opacity = '0'; r.style.transition = 'opacity 160ms linear'; requestAnimationFrame(() => { r.style.opacity = '1'; }); }
      if (!s.items.length) closeBtn.current?.focus({ preventScroll: true });
      return () => { stop(); };
    }
    if (reduced()) {
      apply(fitView(f)); setBg(1);
      r.style.opacity = '0'; r.style.transition = 'opacity 160ms linear';
      requestAnimationFrame(() => { r.style.opacity = '1'; });
      hideThumb(liveEl(s.items[s.index]));
    } else {
      const from = thumbFrame(s.index);
      const img = imgs.current.get(s.index);
      if (from && img) {
        s.opening = true;
        paint(img, f, from.v, from.inset, from.r); setBg(0);
        hideThumb(liveEl(s.items[s.index]));
        tween(320, (p) => {
          const L = (a: number, z: number) => a + (z - a) * p;
          const v = { x: L(from.v.x, f.x), y: L(from.v.y, f.y), s: L(from.v.s, 1) };
          S.current.view = v;
          paint(img, f, v, from.inset.map((x) => x * (1 - p)) as Frame['inset'], from.r * (1 - p));
          setBg(p);
        }, () => { S.current.opening = false; apply(fitView(f)); });
      } else {
        apply(fitView(f)); setBg(0);
        if (img) img.style.opacity = '0';
        hideThumb(liveEl(s.items[s.index]));
        tween(200, (p) => { setBg(p); if (img) img.style.opacity = String(p); }, () => { if (img) img.style.opacity = ''; });
      }
    }
    closeBtn.current?.focus({ preventScroll: true });
    return () => { stop(); };
  }, [st ? st.items : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!st) return;
    setTrack(0);
    layout();
    if (!S.current.opening) apply(fitView(boxOf(S.current.index)));
  }, [st?.index, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st) return;
    const onResize = () => { layout(); apply(fitView(boxOf(S.current.index))); };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    let w0 = 0, h0 = 0;
    const ro = typeof ResizeObserver !== 'undefined' && stage.current ? new ResizeObserver(() => {
      const el = stage.current;
      if (!el || (el.clientWidth === w0 && el.clientHeight === h0)) return;
      w0 = el.clientWidth; h0 = el.clientHeight;
      if (S.current.g || S.current.closing) return;
      onResize();
    }) : null;
    if (ro && stage.current) { w0 = stage.current.clientWidth; h0 = stage.current.clientHeight; ro.observe(stage.current); }
    return () => { window.removeEventListener('resize', onResize); window.visualViewport?.removeEventListener('resize', onResize); ro?.disconnect(); };
  }, [st, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((step: -1 | 1, animated = true) => {
    const s = S.current;
    const j = s.index + step;
    if (j < 0 || j >= s.items.length || s.closing) return;
    const commit = () => {
      s.index = j;
      hideThumb(liveEl(s.items[j]));
      setSt((p) => (p ? { ...p, index: j } : p));
      if (!s.doc) for (const it of s.items.slice(Math.max(0, j - 1), j + 2)) prefetch(it);
    };
    if (!animated || reduced()) { commit(); return; }
    const from = Number(/translate3d\((-?[\d.]+)px/.exec(track.current?.style.transform ?? '')?.[1] ?? 0);
    const to = -step * (s.W + GAP);
    tween(260, (p) => setTrack(from + (to - from) * p), commit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback((j: number) => {
    const s = S.current;
    if (j === s.index || j < 0 || j >= s.items.length || s.closing) return;
    stop(); setTrack(0);
    s.index = j;
    setSt((p) => (p ? { ...p, index: j } : p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const say = useCallback((o: Outcome) => {
    if (!o.note) return;
    clearTimeout(S.current.noteT);
    setNote({ text: o.note, err: !o.ok });
    S.current.noteT = setTimeout(() => setNote(null), NOTE_MS);
  }, []);
  const item = st ? st.items[st.index] : null;
  const act = (fn: (i: { src: string; name: string }, lang: typeof t.lang) => Promise<Outcome>) => () => { if (item) void fn({ src: item.src, name: item.name }, t.lang).then(say); };

  const onDown = (e: React.PointerEvent) => {
    const s = S.current;
    if (s.closing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (s.opening) { stop(); s.opening = false; apply(fitView(boxOf(s.index))); setBg(1); }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const P = loc(e.clientX, e.clientY);
    s.pts.set(e.pointerId, P);
    if (s.anim) { stop(); }
    if (s.pts.size === 1) {
      s.g = { m: 'wait', id: e.pointerId, x0: P.x, y0: P.y, t0: performance.now(), v0: s.view, type: e.pointerType, samples: [{ t: performance.now(), x: P.x, y: P.y }] };
    } else if (s.pts.size === 2) {
      clearTimeout(s.tapT); s.lastTap = null;
      setTrack(0);
      const [a, b] = [...s.pts.values()];
      s.g = { m: 'pinch', s0: s.view.s, v0: s.view, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), lx: (a.x + b.x) / 2, ly: (a.y + b.y) / 2 };
      if (!s.doc) setChrome(false);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const s = S.current, g = s.g;
    if (!g || !s.pts.has(e.pointerId)) return;
    const P = loc(e.clientX, e.clientY);
    s.pts.set(e.pointerId, P);
    const f = boxOf(s.index);
    if (g.m === 'pinch') {
      if (s.pts.size < 2) return;
      const [a, b] = [...s.pts.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const sc = rubberScale(g.s0 * (d / g.d0), maxScale(s.items[s.index]?.nw ?? 0, f));
      const z = zoomAt(g.v0, sc, g.mx, g.my);
      apply({ x: z.x + (mx - g.mx), y: z.y + (my - g.my), s: sc });
      g.lx = mx; g.ly = my;
      return;
    }
    if (e.pointerId !== g.id) return;
    const now = performance.now();
    g.samples.push({ t: now, x: P.x, y: P.y }); if (g.samples.length > 12) g.samples.shift();
    const dx = P.x - g.x0, dy = P.y - g.y0;
    let m: string = g.m;
    if (m === 'wait') {
      if (Math.hypot(dx, dy) < TAP_PX) return;
      clearTimeout(s.tapT); s.lastTap = null;
      m = s.view.s > 1.01 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? (s.items.length > 1 ? 'page' : 'pan') : dy > 0 ? 'dismiss' : 'up';
      (g as { m: string }).m = m;
      if (m === 'dismiss') root.current?.setAttribute('data-drag', '1');
    }
    if (m === 'pan') apply(rubberClamp({ x: g.v0.x + dx, y: g.v0.y + dy, s: g.v0.s }, f, s.W, s.H));
    else if (m === 'page') setTrack(trackOffset(dx, s.W, s.index > 0, s.index < s.items.length - 1));
    else if (m === 'up') apply(rubberClamp({ x: g.v0.x, y: g.v0.y + dy, s: g.v0.s }, f, s.W, s.H));
    else if (m === 'dismiss') {
      const look = dismissLook(dy, s.H);
      apply({ x: f.x + dx + (f.w * (1 - look.s)) / 2, y: f.y + Math.max(0, dy) + (f.h * (1 - look.s)) / 2 + Math.min(0, dy) * 0.2, s: look.s });
      setBg(look.bg);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const s = S.current, g = s.g;
    if (!s.pts.has(e.pointerId)) return;
    s.pts.delete(e.pointerId);
    if (!g) return;
    const f = boxOf(s.index), W = s.W, H = s.H;
    if (g.m === 'pinch') {
      if (s.pts.size === 1) {
        const [id, p] = [...s.pts.entries()][0];
        s.g = { m: s.view.s > 1.01 ? 'pan' : 'up', id, x0: p.x, y0: p.y, t0: performance.now(), v0: s.view, type: 'touch', samples: [] };
        return;
      }
      if (s.pts.size === 0) {
        s.g = null;
        const max = maxScale(s.items[s.index]?.nw ?? 0, f);
        let v = s.view;
        if (v.s < 1) v = fitView(f);
        else if (v.s > max) v = zoomAt(v, max, g.lx, g.ly);
        animateTo(clamp(v, f, W, H), 300);
      }
      return;
    }
    if (e.pointerId !== g.id || s.pts.size) return;
    s.g = null;
    const now = performance.now();
    const P = loc(e.clientX, e.clientY);
    g.samples.push({ t: now, x: P.x, y: P.y });
    const { vx, vy } = velocity(g.samples, now);
    const dx = P.x - g.x0, dy = P.y - g.y0;
    if (g.m === 'wait') { tap(P.x, P.y, g.type); return; }
    if (g.m === 'pan') {
      const over = g.v0.x + dx - clamp({ ...g.v0, x: g.v0.x + dx }, f, W, H).x;
      if (Math.abs(over) > W * 0.25 && ((over < 0 && s.index < s.items.length - 1) || (over > 0 && s.index > 0))) { go(over < 0 ? 1 : -1); return; }
      animateTo(glide(s.view, vx, vy, f, W, H), 380);
      return;
    }
    if (g.m === 'up') { animateTo(clamp(s.view, f, W, H), 260); return; }
    if (g.m === 'page') {
      const step = pageStep(dx, W, vx, s.index > 0, s.index < s.items.length - 1);
      if (step) go(step);
      else { const from = trackOffset(dx, W, s.index > 0, s.index < s.items.length - 1); if (reduced()) setTrack(0); else tween(240, (p) => setTrack(from * (1 - p))); }
      return;
    }
    if (g.m === 'dismiss') {
      root.current?.removeAttribute('data-drag');
      if (shouldDismiss(dy, H, vy)) { close(); return; }
      const bg0 = Number(bg.current?.style.opacity || 1), v0 = s.view, to = fitView(f);
      if (reduced()) { apply(to); setBg(1); return; }
      tween(260, (p) => { apply({ x: v0.x + (to.x - v0.x) * p, y: v0.y + (to.y - v0.y) * p, s: v0.s + (to.s - v0.s) * p }); setBg(bg0 + (1 - bg0) * p); });
    }
  };

  const tap = (x: number, y: number, type: string) => {
    const s = S.current, f = boxOf(s.index);
    const now = performance.now();
    const last = s.lastTap;
    if (last && now - last.t < DOUBLE_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_PX) {
      clearTimeout(s.tapT); s.lastTap = null;
      const to = doubleTap(s.view, f, s.W, s.H, x, y);
      if (to.s > 1 && !s.doc) setChrome(false);
      animateTo(to, 300);
      return;
    }
    s.lastTap = { t: now, x, y };
    clearTimeout(s.tapT);
    const v = s.view, onImg = x >= v.x && x <= v.x + f.w * v.s && y >= v.y && y <= v.y + f.h * v.s;
    s.tapT = setTimeout(() => {
      s.lastTap = null;
      if (s.doc) return;
      if (type === 'mouse') { if (!onImg) close(); return; }
      setChrome((c) => !c);
    }, DOUBLE_MS);
  };

  useEffect(() => {
    const r = root.current;
    if (!st || !r) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.iv-strip')) return;
      e.preventDefault();
      const s = S.current;
      if (s.closing || !s.items.length) return;
      const f = boxOf(s.index);
      const k1 = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.H : 1;
      const dX = e.deltaX * k1, dY = e.deltaY * k1;
      if (s.doc && !e.ctrlKey) {
        if (s.view.s > 1.01) { stop(); apply(clamp({ x: s.view.x - dX, y: s.view.y - dY, s: s.view.s }, f, s.W, s.H)); return; }
        const now = performance.now();
        const quiet = now - s.wheelT > 200;
        s.wheelT = now;
        if (s.wheelFlip && !quiet && now - s.wheelFlip < 700) return;
        if (quiet) s.wheelAcc = 0;
        s.wheelFlip = 0;
        s.wheelAcc += Math.abs(dY) >= Math.abs(dX) ? dY : dX;
        if (Math.abs(s.wheelAcc) >= 50) { const step = s.wheelAcc > 0 ? 1 : -1; s.wheelAcc = 0; s.wheelFlip = now; go(step); }
        return;
      }
      stop();
      const p = loc(e.clientX, e.clientY);
      const k = Math.exp(-dY * (e.ctrlKey ? 0.01 : 0.0025));
      const sc = Math.min(maxScale(s.items[s.index]?.nw ?? 0, f), Math.max(1, s.view.s * k));
      apply(clamp(sc <= 1.001 ? fitView(f) : zoomAt(s.view, sc, p.x, p.y), f, s.W, s.H));
    };
    const noGesture = (e: Event) => e.preventDefault();
    r.addEventListener('wheel', onWheel, { passive: false });
    r.addEventListener('gesturestart', noGesture as EventListener, { passive: false });
    r.addEventListener('gesturechange', noGesture as EventListener, { passive: false });
    return () => { r.removeEventListener('wheel', onWheel); r.removeEventListener('gesturestart', noGesture as EventListener); r.removeEventListener('gesturechange', noGesture as EventListener); };
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st) return;
    const onKey = (e: KeyboardEvent) => {
      const s = S.current, f = boxOf(s.index);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || (s.doc && (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' '))) { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || (s.doc && (e.key === 'ArrowUp' || e.key === 'PageUp'))) { e.preventDefault(); go(-1); }
      else if (s.doc && e.key === 'Home') { e.preventDefault(); jump(0); }
      else if (s.doc && e.key === 'End') { e.preventDefault(); jump(s.items.length - 1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); animateTo(clamp(zoomAt(s.view, Math.min(maxScale(s.items[s.index]?.nw ?? 0, f), s.view.s * 1.5), s.W / 2, s.H / 2), f, s.W, s.H), 200); }
      else if (e.key === '-') { e.preventDefault(); const sc = Math.max(1, s.view.s / 1.5); animateTo(sc <= 1.001 ? fitView(f) : clamp(zoomAt(s.view, sc, s.W / 2, s.H / 2), f, s.W, s.H), 200); }
      else if (e.key === '0') { e.preventDefault(); animateTo(fitView(f), 200); }
      else if (e.key === 'Tab' && root.current) {
        const els = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')].filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        const j = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i === els.length - 1 ? 0 : i + 1);
        e.preventDefault(); els[j].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [st, close, go, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [st?.index, st?.items]);

  if (!st || typeof document === 'undefined') return null;
  const { items, index, doc } = st;
  const shown = [index - 1, index, index + 1].filter((i) => i >= 0 && i < items.length);
  const many = items.length > 1;

  const track$ = (
    <div ref={track} className="iv-track">
      {shown.map((i) => (
        <div key={i} className="iv-slide" data-i={i}>
          {failed[items[i].src] ? (
            <p className="iv-miss">{t(doc ? 'doc.pageMiss' : 'work.iv.miss')}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={(el) => { if (el) { imgs.current.set(i, el); under(el, items[i]); } else imgs.current.delete(i); }} className="iv-img" src={items[i].src} alt={doc ? t(doc.kind === 'slides' ? 'doc.slide' : 'doc.page', { n: i + 1 }) : items[i].name} draggable={false}
              data-testid={i === index ? 'iv-img' : undefined} decoding="async"
              onLoad={(e) => {
                const it = S.current.items[i], im = e.currentTarget;
                im.style.backgroundImage = '';
                if (it && !it.fixed && (it.nw !== im.naturalWidth || it.nh !== im.naturalHeight)) {
                  it.nw = im.naturalWidth; it.nh = im.naturalHeight; layout();
                  if (i === S.current.index && !S.current.opening && !S.current.closing) apply(fitView(boxOf(i)));
                }
              }}
              onError={() => setFailed((m) => ({ ...m, [items[i].src]: true }))} />
          )}
        </div>
      ))}
    </div>
  );
  const stage$ = (
    <div ref={stage} className="iv-stage" data-testid="iv-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(e) => { if (coarse()) e.preventDefault(); }}>
      {track$}
    </div>
  );
  const arrows$ = many && desk && (
    <>
      <button type="button" className="iv-nav iv-prev" aria-label={t('work.iv.prev')} disabled={index === 0} onClick={() => go(-1)}><Icon n="chev-right" className="flip" /></button>
      <button type="button" className="iv-nav iv-next" aria-label={t('work.iv.next')} disabled={index === items.length - 1} onClick={() => go(1)}><Icon n="chev-right" /></button>
    </>
  );
  const note$ = note && <div className={`iv-note${note.err ? ' is-err' : ''}`} role="status" aria-live="polite" data-testid="iv-note">{note.text}</div>;

  if (doc) {
    const share = needsShare();
    const sayNote = (text: string) => say({ ok: true, note: text, kind: 'retry' });
    const close$ = <button ref={closeBtn} type="button" className="iv-hb iv-x" aria-label={t('common.close')} data-testid="iv-close" onClick={close}><Icon n="x" /></button>;
    const save$ = (
      <SaveLink className={desk ? 'iv-hb iv-hb-txt' : 'iv-hb'} href={doc.href} name={doc.name} onNote={sayNote} testid="iv-dl"
        label={desk ? undefined : t(share ? 'work.iv.share' : 'md.download')}>
        <Icon n={share ? 'share' : 'download'} />{desk ? <span>{t('md.download')}</span> : null}
      </SaveLink>
    );
    const errKey = doc.code === 'too-big' ? 'doc.errBig' : doc.code === 'gone' ? 'doc.errGone' : doc.code === 'network' ? 'doc.errNet' : 'doc.err';
    const thumbs = desk && doc.phase === 'ready' && items.length > 0;
    return createPortal(
      <div ref={root} className="iv iv-doc" role="dialog" aria-modal="true" aria-label={t('doc.view', { name: doc.name })} data-noswipe data-nodrag tabIndex={-1}
        data-chrome={chrome ? '1' : '0'} data-desk={desk ? '1' : '0'} data-strip={thumbs ? '1' : '0'} data-phase={doc.phase} data-testid="iv">
        <div ref={bg} className="iv-bg" />
        {stage$}
        {doc.phase !== 'ready' && (
          <div className="iv-doc-state" data-testid="iv-doc-state" role={doc.phase === 'error' ? 'alert' : 'status'} aria-live="polite">
            {doc.phase === 'loading' ? (
              <>
                <div className={`iv-skel${doc.kind === 'slides' ? '' : ' is-page'}`} aria-hidden="true" />
                <p className="iv-doc-msg">{t('doc.preparing')}</p>
              </>
            ) : (
              <>
                <p className="iv-doc-msg is-err">{t(errKey)}</p>
                <SaveLink className="btn iv-doc-dl" href={doc.href} name={doc.name} onNote={sayNote} testid="iv-doc-dl"><Icon n="download" />{t('md.download')}</SaveLink>
              </>
            )}
          </div>
        )}
        <header className="iv-top iv-dtop">
          {!desk && close$}
          <span className="iv-name" data-testid="iv-name">{doc.name}</span>
          {desk && many && <button type="button" className="iv-hb" aria-label={t('doc.prev')} disabled={index === 0} onClick={() => go(-1)} data-testid="iv-prev"><Icon n="chev-right" className="flip" /></button>}
          {items.length > 0 && <span className="iv-count tnum" data-testid="iv-count">{t('doc.count', { i: index + 1, n: items.length })}</span>}
          {desk && many && <button type="button" className="iv-hb" aria-label={t('doc.next')} disabled={index === items.length - 1} onClick={() => go(1)} data-testid="iv-next"><Icon n="chev-right" /></button>}
          {save$}
          {desk && close$}
        </header>
        {thumbs && (
          <nav ref={strip} className="iv-strip" aria-label={t(doc.kind === 'slides' ? 'doc.slides' : 'doc.pages')} data-testid="iv-strip">
            {items.map((it, i) => (
              <button key={i} type="button" className="iv-th" aria-current={i === index ? 'true' : undefined} data-testid="iv-th"
                onClick={(e) => { jump(i); if (e.detail > 0) root.current?.focus({ preventScroll: true }); }}
                aria-label={t(doc.kind === 'slides' ? 'doc.slide' : 'doc.page', { n: i + 1 })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.thumb} alt="" loading="lazy" decoding="async" draggable={false} style={{ aspectRatio: `${it.nw} / ${it.nh}` }} />
                <span className="iv-th-n tnum" aria-hidden="true">{i + 1}</span>
              </button>
            ))}
            {(doc.total ?? 0) > items.length && <p className="iv-strip-cut">{t('doc.cut', { n: items.length, total: doc.total ?? 0 })}</p>}
          </nav>
        )}
        {note$}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div ref={root} className="iv" role="dialog" aria-modal="true" aria-label={t(item?.name ? 'work.iv.viewNamed' : 'work.iv.view', { name: item?.name ?? '' })} data-noswipe data-nodrag
      data-chrome={chrome ? '1' : '0'} data-testid="iv">
      <div ref={bg} className="iv-bg" />
      {stage$}
      <header className="iv-top">
        <button ref={closeBtn} type="button" className="iv-btn iv-x" aria-label={t('common.close')} data-testid="iv-close" onClick={close}><Icon n="x" /></button>
        <span className="iv-name" data-testid="iv-name">{item?.name || t('work.iv.image')}{item?.size ? <small> · {item.size}</small> : null}</span>
        {many && <span className="iv-count tnum" data-testid="iv-count">{t('work.iv.count', { i: index + 1, n: items.length })}</span>}
      </header>
      {arrows$}
      {note$}
      <footer className="iv-bot">
        <button type="button" className="iv-btn iv-act" data-testid="iv-share" onPointerDown={() => item && prefetch(item)} onClick={act(shareImage)}><Icon n="share" /><span>{t('work.iv.share')}</span></button>
        <button type="button" className="iv-btn iv-act" data-testid="iv-save" onPointerDown={() => item && prefetch(item)} onClick={act(saveImage)}><Icon n="download" /><span>{t('work.img.save')}</span></button>
        {desk && canCopyImage() && <button type="button" className="iv-btn iv-act" data-testid="iv-copy" onClick={act(copyImage)}><Icon n="copy" /><span>{t('work.iv.copy')}</span></button>}
      </footer>
    </div>,
    document.body,
  );
}

registerViewer({ openImage, openDoc, viewerReady, ImageViewerHost });
