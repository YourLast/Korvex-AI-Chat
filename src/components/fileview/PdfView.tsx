'use client';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { viewKind } from '@/lib/viewKind';
import type { Place } from '@/lib/fileView';
import { Icon } from '../Icon';
import { fontPx, highlightText, quoteRects, type Rect } from './pdfjs';
import { quoteView } from '@/lib/srcmark';
import { acquirePdf, pdfErrorCode, peekPdf, type PdfDoc, type PdfHandle, type Size } from './pdfDocs';
import { anchorAt, buildLayout, FIT_MAX, MAX_ZOOM, PAD, pageAt, planJump, revealAt, windowOf, yOfAnchor, type Anchor, type Plan } from './pdfJump';

export { MAX_ZOOM };

export const pageOf = (p: Place | undefined): number | null => (p ? (p.kind === 'slide' ? p.slide : p.kind === 'page' ? p.page : p.page ?? p.slide) ?? null : null);
const MARKS_SHOWN = 14;
export const pagesOf = (p: Place): number[] => { const a = pageOf(p); if (!a) return []; const b = Math.min(p.page_to ?? a, a + 30); return Array.from({ length: Math.max(1, b - a + 1) }, (_, i) => a + i); };

let sbw: number | null = null;
const scrollbarW = (): number => {
  if (sbw !== null) return sbw;
  try { const d = document.createElement('div'); d.style.cssText = 'position:absolute;top:-9999px;width:50px;height:50px;overflow:scroll;visibility:hidden'; document.body.appendChild(d); sbw = d.offsetWidth - d.clientWidth; d.remove(); } catch { sbw = 0; }
  return sbw ?? 0;
};

type PageProps = { h: PdfDoc; num: number; top: number; width: number; height: number; quotes: string[]; focus?: string; onSize: (n: number, s: Size) => void; onPainted: (n: number) => void };
type Drawn = Rect & { f: boolean };

const Page = memo(function Page({ h, num, top, width, height, quotes, focus, onSize, onPainted }: PageProps) {
  const tx = useT();
  const cv = useRef<HTMLCanvasElement>(null);
  const [rects, setRects] = useState<Drawn[]>([]);
  const [bad, setBad] = useState(false);
  const [painted, setPainted] = useState(false);
  useEffect(() => { const c = cv.current; return () => { if (c) { c.width = 0; c.height = 0; } }; }, []);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    setBad(false); setPainted(false);
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let dead = false;
    void (async () => {
      const page = await h.doc.getPage(num);
      if (dead) return;
      const v1 = page.getViewport({ scale: 1 });
      onSize(num, [v1.width, v1.height]);
      const scale = width / v1.width;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1, 2200 / width));
      const vp = page.getViewport({ scale: scale * dpr });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${width}px`; c.style.height = `${Math.round(v1.height * scale)}px`;
      task = page.render({ canvas: c, viewport: vp });
      try { await task.promise; } catch { return; }
      if (dead) return;
      setPainted(true); onPainted(num);
    })().catch((e) => { if (!dead) { console.warn('[pdf] страница', num, e); setBad(true); } });
    return () => { dead = true; task?.cancel(); };
  }, [h.doc, num, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = quotes.join('\u0001');
  useEffect(() => {
    if (!painted || !quotes.length) { setRects([]); return; }
    let dead = false;
    void (async () => {
      const page = await h.doc.getPage(num);
      const v1 = page.getViewport({ scale: 1 });
      const scale = width / v1.width;
      const css = page.getViewport({ scale });
      const items = await h.text(num);
      if (dead) return;
      const all: Drawn[] = [];
      for (const q of quotes) for (const r of quoteRects(items as never, css.transform, scale, q, h.lib.Util as never)) all.push({ ...r, f: q === focus });
      setRects(all);
    })().catch(() => {});
    return () => { dead = true; };
  }, [painted, h.doc, num, width, key, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const strong = rects.filter((x) => x.f);
  return (
    <div className="fv-page" style={{ left: PAD, top, width, height }} data-page={num} data-testid="pdf-page" data-rendered data-painted={painted || undefined}>
      <canvas ref={cv} />
      {bad && <span className="fv-pbad" role="alert" data-testid="pdf-page-bad">{tx('files.pageBad')}</span>}
      {rects.map((r, i) => <i key={i} className={`fv-hl${r.f ? ' is-strong' : ''}`} data-fs={r.f ? Math.round(fontPx(strong) * 10) / 10 : undefined} style={{ left: r.l - 2, top: r.t - 1, width: r.w + 4, height: r.h + 2 }} data-testid="pdf-hl" />)}
    </div>
  );
});

export function PdfView({ id, name, at, marks, onPlace, seq = 0 }: { id: string; name: string; at?: Place; marks: Place[]; onPlace?: (s: string) => void; seq?: number }) {
  const tx = useT();
  const [h, setH] = useState<PdfDoc | null>(() => peekPdf(id));
  const [state, setState] = useState<'load' | 'prep' | 'error'>('load');
  const [code, setCode] = useState('');
  const [boxW, setBoxW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [ver, setVer] = useState(0);
  const [cur, setCur] = useState(1);
  const [win, setWin] = useState<[number, number]>([1, 0]);
  const [jump, setJump] = useState<{ n: number; plan: Plan; boxW: number } | null>(null);
  const [hold, setHold] = useState(true);
  const [qOpen, setQOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [pick, setPick] = useState<{ from: string; n: number; page: number; quote?: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    let got: PdfHandle | null = null;
    setState('load'); setCode('');
    setH((x) => (x && x.id === id ? x : peekPdf(id)));
    acquirePdf(id, () => setState('prep'), ac.signal, viewKind(name) === 'pdf').then((x) => { if (ac.signal.aborted) { x.release(); return; } got = x; setH(x); })
      .catch((e) => { if (!ac.signal.aborted) { setCode(pdfErrorCode(e)); setState('error'); } });
    return () => { ac.abort(); got?.release(); };
  }, [id]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setBoxW(Math.max(160, Math.min(FIT_MAX, Math.floor(el.clientWidth - scrollbarW() - PAD * 2))));
    read();
    let timer = 0;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(read, 120); }) : null;
    ro?.observe(el);
    return () => { window.clearTimeout(timer); ro?.disconnect(); };
  }, []);

  const n = h?.doc.numPages ?? 0;
  const width = Math.round(boxW * zoom);
  const L = useMemo(() => buildLayout(n, width, h?.sizes ?? {}, h?.sizes[1] ?? [595, 842]), [n, width, ver, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef({ L, width, boxW, zoom, h });
  live.current = { L, width, boxW, zoom, h };
  const onSize = useCallback((p: number, s: Size) => {
    const sz = live.current.h?.sizes;
    if (!sz) return;
    const o = sz[p];
    if (o && Math.abs(o[0] - s[0]) < 0.5 && Math.abs(o[1] - s[1]) < 0.5) return;
    sz[p] = s; setVer((v) => v + 1);
  }, []);

  const atText = highlightText(at);
  const propKey = `${id}|${at ? pageOf(at) ?? '' : ''}|${atText ?? ''}|${seq}`;
  const goal = useMemo(() => (pick && pick.from === propKey ? { page: pick.page, quote: pick.quote, key: `${propKey}#${pick.n}` } : { page: pageOf(at) ?? null, quote: atText, key: propKey }), [pick, propKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickN = useRef(0);

  const anchor = useRef<Anchor | null>(null);
  const mine = useRef({ y: -1, x: -1 });
  const setScroll = useCallback((y: number, x?: number) => {
    const el = root.current;
    if (!el) return;
    el.scrollTop = y;
    if (x !== undefined) el.scrollLeft = x;
    mine.current = { y: el.scrollTop, x: el.scrollLeft };
  }, []);
  const capture = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const { L: l, width: w } = live.current;
    anchor.current = anchorAt(l, el.scrollTop, el.scrollLeft + el.clientWidth / 2, w, w + PAD * 2);
  }, []);
  const syncWin = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const w = windowOf(live.current.L, el.scrollTop, el.clientHeight, Math.max(el.clientHeight, 600));
    setWin((o) => (o[0] === w[0] && o[1] === w[1] ? o : w));
  }, []);

  useLayoutEffect(() => {
    const el = root.current, a = anchor.current;
    if (el && a) setScroll(yOfAnchor(L, a, width), Math.max(0, a.xc * (width + PAD * 2) - el.clientWidth / 2));
    syncWin();
  }, [L, width]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!h || !boxW) return;
    let dead = false;
    const fallback = (): Plan => ({ page: Math.min(h.doc.numPages, Math.max(1, goal.page ?? 1)), rects: [], found: false });
    planJump(h, { page: goal.page, quote: goal.quote }, { boxW })
      .catch((e) => { console.warn('[pdf] переход', e); return fallback(); })
      .then((plan) => { if (!dead) { setVer((v) => v + 1); setJump((j) => ({ n: (j?.n ?? 0) + 1, plan, boxW })); } });
    return () => { dead = true; };
  }, [h?.doc, !!boxW, goal.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitKey = at?.kind === 'slide' || marks.some((m) => m.kind === 'slide') ? 'files.loc.slide' : 'files.pageShort';
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !jump) return;
    const { L: l, width: w } = live.current;
    const p = jump.plan;
    const pos = p.rects.length ? revealAt(l, p.page, p.rects, w / jump.boxW, el.clientWidth, el.clientHeight, w + PAD * 2) : { y: Math.max(0, (l.tops[p.page] ?? 0) - PAD), x: el.scrollLeft };
    setScroll(pos.y, pos.x); capture(); setCur(p.page); syncWin();
    onPlace?.(tx(unitKey, { n: String(p.page) }));
  }, [jump]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = jump?.plan.page ?? 0;
  const targetRef = useRef(0);
  targetRef.current = target;
  const onPainted = useCallback((num: number) => { if (num === targetRef.current) setHold(false); }, []);
  useEffect(() => { if (!jump || !hold) return; const t = window.setTimeout(() => setHold(false), 2500); return () => window.clearTimeout(t); }, [!!jump, hold]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpPage = useCallback((p: number) => {
    const el = root.current;
    const { L: l } = live.current;
    if (!el || l.n < 1) return;
    const q = Math.min(l.n, Math.max(1, Math.round(p) || 1));
    setScroll(Math.max(0, l.tops[q] - PAD)); capture(); setCur(q); syncWin();
  }, [setScroll, capture, syncWin]);
  const pickMark = useCallback((p: number) => {
    const qs = [...new Set(marks.filter((m) => pageOf(m) === p).map(highlightText).filter((q): q is string => !!q))];
    const at0 = qs.indexOf(goal.quote ?? '');
    const quote = qs.length ? qs[(at0 < 0 ? 0 : at0 + 1) % qs.length] : undefined;
    setPick({ from: propKey, n: ++pickN.current, page: p, quote });
  }, [marks, goal.quote, propKey]);

  const raf = useRef(0);
  const onScroll = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - mine.current.y) < 1 && Math.abs(el.scrollLeft - mine.current.x) < 1) return;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const e = root.current;
      if (!e) return;
      capture(); syncWin();
      setCur(pageAt(live.current.L, e.scrollTop + e.clientHeight / 3));
    });
  }, [capture, syncWin]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const setZ = useCallback((f: (z: number) => number) => { capture(); setZoom(f); }, [capture]);

  const markPages = useMemo(() => [...new Set([...marks, ...(at ? [at] : [])].flatMap(pagesOf).filter((p) => !n || p <= n))].sort((a, b) => a - b), [marks, at, n]);
  const shown = useMemo(() => {
    if (markPages.length <= MARKS_SHOWN) return markPages;
    let near = 0;
    markPages.forEach((p, i) => { if (Math.abs(p - cur) < Math.abs(markPages[near] - cur)) near = i; });
    const from = Math.min(Math.max(0, near - (MARKS_SHOWN >> 1)), markPages.length - MARKS_SHOWN);
    return markPages.slice(from, from + MARKS_SHOWN);
  }, [markPages, cur]);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => { row.current?.querySelector<HTMLElement>('.is-on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [cur, !!jump]); // eslint-disable-line react-hooks/exhaustive-deps
  const quotesBy = useMemo(() => {
    const by = new Map<number, string[]>();
    const add = (p: number | null | undefined, q: string | undefined) => {
      if (!p || !q) return;
      const l = by.get(p) ?? by.set(p, []).get(p)!;
      if (!l.includes(q)) l.push(q);
    };
    for (const m of marks) add(pageOf(m), highlightText(m));
    if (at) add(pageOf(at), atText);
    if (jump?.plan.found) add(jump.plan.page, goal.quote);
    return by;
  }, [marks, at, atText, jump, goal.quote]);

  const ready = !!h && !!jump;
  const empty = (key: 'files.preparing' | 'files.loading', tid: string, cls = '') => <div className={`fv-empty fv-delay${cls}`} role="status" data-testid={tid}><span className="up-spin fv-spin" /><span>{tx(key)}</span></div>;
  if (state === 'error' && !h) return <div className="fv-empty" role="alert" data-testid="pdf-error"><b>{tx('files.noPreview')}</b><span>{tx('files.noPreviewHint')}</span>{code && <small>{code}</small>}</div>;
  const focusPage = jump?.plan.found ? jump.plan.page : 0;
  const pages = [];
  if (ready) for (let i = win[0]; i <= win[1]; i++) {
    pages.push(<Page key={i} h={h} num={i} top={L.tops[i]} width={width} height={L.hs[i]} quotes={quotesBy.get(i) ?? []} focus={i === focusPage ? goal.quote : undefined} onSize={onSize} onPainted={onPainted} />);
  }
  const commit = () => { const v = Number(draft); const d = draft; setDraft(null); if (d !== null && v >= 1) jumpPage(v); };
  return (
    <div className="fv-pdf" ref={box} data-testid={ready ? 'pdf-view' : undefined} data-name={name} data-zoom={zoom} data-target={target || undefined} data-hold={ready && hold ? '' : undefined}>
      {!ready && empty(state === 'prep' ? 'files.preparing' : 'files.loading', 'pdf-loading')}
      {ready && (
        <>
          <div className="fv-gbar">
            <button type="button" className="icon-btn" aria-label={tx('files.prev')} disabled={cur <= 1} data-testid="pdf-prev" onClick={() => jumpPage(cur - 1)}><Icon n="chev-up" sm /></button>
            <label className="fv-pg">
              <input type="number" inputMode="numeric" min={1} max={n} value={draft ?? String(cur)} aria-label={tx('files.goPage')} data-testid="pdf-page-input"
                onChange={(e) => setDraft(e.target.value)} onBlur={commit} onFocus={(e) => e.target.select()}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); } }} />
              <span>/ {n}</span>
            </label>
            <button type="button" className="icon-btn" aria-label={tx('files.next')} disabled={cur >= n} data-testid="pdf-next" onClick={() => jumpPage(cur + 1)}><Icon n="chev-down" sm /></button>
            <span className="grow" />
            {zoom !== 1 && <button type="button" className="icon-btn fv-fit" aria-label={tx('files.zoomFit')} title={tx('files.zoomFit')} data-testid="pdf-fit" onClick={() => setZ(() => 1)}>1×</button>}
            <button type="button" className="icon-btn" aria-label={tx('files.zoomOut')} disabled={zoom <= 0.6} data-testid="pdf-zoom-out" onClick={() => setZ((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}>−</button>
            <button type="button" className="icon-btn" aria-label={tx('files.zoomIn')} disabled={zoom >= MAX_ZOOM} data-testid="pdf-zoom-in" onClick={() => setZ((z) => Math.min(MAX_ZOOM, +(z + 0.2).toFixed(1)))}>+</button>
          </div>
          {goal.quote && (
            <button type="button" className={`fv-q${qOpen ? ' is-open' : ''}`} aria-expanded={qOpen} aria-label={tx('files.quoteBar')} data-testid="pdf-quote" onClick={() => setQOpen((o) => !o)}>
              <span>«{quoteView(goal.quote)}»</span>
            </button>
          )}
          {markPages.length > 0 && (
            <div className="fv-marks" data-testid="pdf-marks" ref={row}>
              {shown.map((p) => <button key={p} type="button" className={`fv-mchip${p === cur ? ' is-on' : ''}`} data-testid="pdf-mark" onClick={() => pickMark(p)}>{tx(unitKey, { n: String(p) })}</button>)}
            </div>
          )}
          <div className="fv-pwrap">
            <div className="fv-pages" ref={root} onScroll={onScroll} data-testid="pdf-scroll">
              <div className="fv-pcol" style={{ width: width + PAD * 2, height: L.total }}>{pages}</div>
            </div>
            {hold && empty('files.loading', 'pdf-hold', ' fv-hold')}
          </div>
        </>
      )}
    </div>
  );
}
