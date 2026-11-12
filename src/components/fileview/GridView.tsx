'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { colIndex, colName } from '@/lib/srcmark';
import type { Place } from '@/lib/fileView';
import type { Cell, GridMeta, StyleDef } from '@/lib/gridview';
import { Icon } from '../Icon';

const BLOCK = 100;
const LETTERS_H = 22;
const SCALE = 1.1;
const NUM = /^[\s ]*[-+−]?[\d\s ]*[.,]?\d+[\s ]*[%₽$€]?[\s ]*$/;

export const cellText = (c?: Cell) => (c === undefined ? '' : typeof c === 'string' ? c : c[0]);
const cellStyleIdx = (c?: Cell) => (c && typeof c !== 'string' ? c[1] : 0);
const cellFormula = (c?: Cell) => (c && typeof c !== 'string' ? c[2] : undefined);

type RowsResp = { rows?: Cell[][]; from?: number };
type ListResp = { rows?: Record<string, Cell[]> };
type Merge = { r1: number; c1: number; r2: number; c2: number };

const nm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/[«»"']/g, '');
const BD_STYLE: Record<string, string> = { s: 'solid', d: 'dashed', o: 'dotted', x: 'double' };

function cssOf(d: StyleDef | undefined, text: string): CSSProperties {
  if (!d) return NUM.test(text) && text.trim() ? { justifyContent: 'flex-end' } : {};
  const o: CSSProperties = {};
  if (d.b) o.fontWeight = 600;
  if (d.i) o.fontStyle = 'italic';
  if (d.u || d.s) o.textDecoration = `${d.u ? 'underline' : ''} ${d.s ? 'line-through' : ''}`.trim();
  if (d.c) o.color = d.c;
  if (d.f) o.background = d.f;
  if (d.sz && d.sz !== 11) o.fontSize = `${Math.round((d.sz / 11) * 13 * 10) / 10}px`;
  if (d.h) o.justifyContent = { l: 'flex-start', c: 'center', r: 'flex-end', j: 'flex-start' }[d.h];
  if (d.v) o.alignItems = { t: 'flex-start', m: 'center', b: 'flex-end' }[d.v];
  if (d.in) o.paddingLeft = 6 + d.in * 8;
  if (d.bd) for (const [k, side] of [['t', 'Top'], ['r', 'Right'], ['b', 'Bottom'], ['l', 'Left']] as const) {
    const x = d.bd[k];
    if (x) (o as Record<string, string>)[`border${side}`] = `${x[0]}px ${BD_STYLE[x[1]] ?? 'solid'} ${x[2]}`;
  }
  return o;
}

function parseRange(a: string): Merge | null {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(a.trim());
  if (!m) return null;
  const c1 = (colIndex(m[1]) ?? 1) - 1, r1 = Number(m[2]);
  return { r1, c1, r2: m[4] ? Number(m[4]) : r1, c2: m[3] ? (colIndex(m[3]) ?? 1) - 1 : c1 };
}

export function GridView({ id, meta, at, marks, onPlace }: { id: string; meta: GridMeta; at?: Place; marks: Place[]; onPlace?: (s: string) => void }) {
  const tx = useT();
  const sheets = meta.sheets;
  const styles = meta.styles;
  const sheetIdx = useCallback((name: string | undefined) => {
    if (!name) return 0;
    const n = nm(name);
    const i = sheets.findIndex((s) => nm(s.name) === n);
    if (i >= 0) return i;
    const j = sheets.findIndex((s) => nm(s.name).includes(n) || n.includes(nm(s.name)));
    return j >= 0 ? j : sheets.length === 1 ? 0 : -1;
  }, [sheets]);
  const marksBy = useMemo(() => {
    const by = new Map<number, { rows: Set<number>; cells: Map<number, Set<number>> }>();
    for (const m of marks) {
      if (m.kind !== 'row' && m.kind !== 'cell') continue;
      const si = sheetIdx(m.sheet);
      if (si < 0 || !m.row) continue;
      const e = by.get(si) ?? by.set(si, { rows: new Set(), cells: new Map() }).get(si)!;
      for (let r = m.row; r <= Math.min(m.row_to ?? m.row, m.row + 2000); r++) e.rows.add(r);
      const c = colIndex(m.col);
      if (m.kind === 'cell' && c) (e.cells.get(m.row) ?? e.cells.set(m.row, new Set()).get(m.row)!).add(c);
    }
    return by;
  }, [marks, sheetIdx]);
  const first = at ? sheetIdx(at.sheet) : -1;
  const [sheet, setSheet] = useState(() => (first >= 0 ? first : [...marksBy.keys()].sort()[0] ?? 0));
  const [only, setOnly] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [ver, setVer] = useState(0);
  const cache = useRef(new Map<string, Cell[]>());
  const asked = useRef(new Set<string>());
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState({ top: 0, left: 0, h: 640, w: 640 });
  const scroller = useRef<HTMLDivElement>(null);

  const sm = sheets[sheet];
  const mk = marksBy.get(sheet);
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const DEF_H = coarse ? 28 : 22;
  const markRows = useMemo(() => [...(mk?.rows ?? [])].filter((r) => sm && r >= 1 && r <= sm.rows).sort((a, b) => a - b), [mk, sm]);
  const list = only ? markRows : null;

  const frozenRows = list ? 0 : sm ? Math.min(sm.frozen ? sm.frozen.rows : sm.header === 1 ? 1 : 0, Math.max(0, sm.rows - 1)) : 0;
  const frozenCols = sm?.frozen ? Math.min(sm.frozen.cols, sm.cols) : 0;
  const rowH = useCallback((r: number) => { const h = sm?.heights?.[r]; return h === undefined ? DEF_H : Math.round(h * SCALE); }, [sm, DEF_H]);
  const count = list ? list.length : Math.max(0, (sm?.rows ?? 0) - frozenRows);
  const rowAt = useCallback((i: number) => (list ? list[i] : frozenRows + 1 + i), [list, frozenRows]);
  const tops = useMemo(() => {
    const t = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) t[i + 1] = t[i] + rowH(rowAt(i));
    return t;
  }, [count, rowH, rowAt]);
  const frozenH = useMemo(() => { let h = 0; for (let r = 1; r <= frozenRows; r++) h += rowH(r); return h; }, [frozenRows, rowH]);
  const headH = LETTERS_H + frozenH;
  const indexAt = useCallback((y: number) => { let lo = 0, hi = count; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tops[m] <= y) lo = m; else hi = m - 1; } return Math.min(lo, Math.max(0, count - 1)); }, [tops, count]);

  const cols = sm?.cols ?? 0;
  const put = (si: number, r: number, row: Cell[]) => { cache.current.set(`${si}:${r}`, row); };
  const widths = useMemo(() => {
    const w = Array.from({ length: cols }, (_, c) => (sm?.widths && sm.widths[c] !== undefined ? Math.round(sm.widths[c] * SCALE) : 0));
    if (!sm) return w;
    if (!sm.widths) {
      const sample: Cell[][] = [];
      for (let r = 1; r < 70; r++) { const row = cache.current.get(`${sheet}:${r}`); if (row) sample.push(row); }
      for (const row of sample) row.forEach((cell, i) => { if (i < w.length) w[i] = Math.max(w[i], Math.min(300, 26 + cellText(cell).length * 8)); });
      return w.map((x) => Math.round(Math.max(x, 56)));
    }
    return w.map((x, i) => (sm.widths![i] === 0 ? 0 : Math.max(24, x)));
  }, [cols, sm, sheet, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const lefts = useMemo(() => { const l = new Float64Array(cols + 1); for (let c = 0; c < cols; c++) l[c + 1] = l[c] + widths[c]; return l; }, [cols, widths]);
  const RN_W = Math.max(44, 12 + String(sm?.rows ?? 100).length * 8);
  const innerW = RN_W + (lefts[cols] ?? 0) + 24;

  const merges = useMemo(() => (sm?.merges ?? []).map(parseRange).filter((m): m is Merge => !!m && (m.r2 > m.r1 || m.c2 > m.c1)), [sm]);
  const mergeByRow = useMemo(() => {
    const by = new Map<number, Merge[]>();
    for (const m of merges) for (let r = m.r1; r <= Math.min(m.r2, m.r1 + 300); r++) (by.get(r) ?? by.set(r, []).get(r)!).push(m);
    return by;
  }, [merges]);

  const fetchBlock = useCallback(async (si: number, blk: number) => {
    const key = `${si}:b${blk}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    try {
      const a = blk * BLOCK + 1;
      const r = await fetch(`/api/files/${id}/grid?sheet=${si}&from=${a}&to=${a + BLOCK - 1}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as RowsResp;
      (j.rows ?? []).forEach((row, i) => put(si, a + i, row));
      setVer((x) => x + 1);
    } catch { asked.current.delete(key); setFailed(true); }
  }, [id]);
  const fetchList = useCallback(async (si: number, rows: number[]) => {
    const need = rows.filter((r) => !cache.current.has(`${si}:${r}`) && !asked.current.has(`${si}:r${r}`));
    for (let i = 0; i < need.length; i += 200) {
      const part = need.slice(i, i + 200);
      part.forEach((r) => asked.current.add(`${si}:r${r}`));
      try {
        const r = await fetch(`/api/files/${id}/grid?sheet=${si}&rows=${part.join(',')}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as ListResp;
        for (const [k, row] of Object.entries(j.rows ?? {})) put(si, Number(k), row);
        setVer((x) => x + 1);
      } catch { part.forEach((r) => asked.current.delete(`${si}:r${r}`)); setFailed(true); }
    }
  }, [id]);

  const readView = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setView((v) => (v.top === el.scrollTop && v.left === el.scrollLeft && v.h === el.clientHeight && v.w === el.clientWidth ? v : { top: el.scrollTop, left: el.scrollLeft, h: el.clientHeight, w: el.clientWidth }));
  }, []);
  const raf = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; readView(); }); };
    el.addEventListener('scroll', on, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(readView) : null;
    ro?.observe(el);
    readView();
    return () => { el.removeEventListener('scroll', on); ro?.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [readView, sheet]);
  const firstI = count ? Math.max(0, indexAt(Math.max(0, view.top - headH)) - 6) : 0;
  const lastI = count ? Math.min(count - 1, indexAt(Math.max(0, view.top - headH + view.h)) + 6) : -1;

  useEffect(() => {
    if (!sm) return;
    for (let r = 1; r <= frozenRows; r += BLOCK) void fetchBlock(sheet, Math.floor((r - 1) / BLOCK));
    if (list) { void fetchList(sheet, list.slice(Math.max(0, firstI), lastI + 1)); return; }
    if (lastI < firstI) return;
    for (let b = Math.floor((rowAt(firstI) - 1) / BLOCK); b <= Math.floor((rowAt(lastI) - 1) / BLOCK); b++) void fetchBlock(sheet, b);
  }, [sheet, sm, list, frozenRows, firstI, lastI, fetchBlock, fetchList, rowAt]);

  const scrollToRow = useCallback((r: number) => {
    const el = scroller.current;
    if (!el) return;
    const i = list ? list.indexOf(r) : r - frozenRows - 1;
    if (i < 0) { el.scrollTop = 0; return; }
    el.scrollTop = Math.max(0, headH + tops[Math.min(i, count)] - el.clientHeight / 3);
    readView();
  }, [list, frozenRows, headH, tops, count, readView]);
  const goRow = useCallback((r: number, c?: number) => {
    setCursor(r);
    setSel({ r, c: c ?? 0 });
    requestAnimationFrame(() => scrollToRow(r));
  }, [scrollToRow]);
  const done = useRef<string>('');
  useEffect(() => {
    const k = `${sheet}|${only}|${at?.row ?? ''}|${at?.sheet ?? ''}|${count}`;
    if (done.current === k || !sm) return;
    done.current = k;
    const target = at?.row && sheetIdx(at.sheet) === sheet ? at.row : null;
    if (target) goRow(target, (colIndex(at?.col) ?? 1) - 1); else if (scroller.current) scroller.current.scrollTop = 0;
  });
  useEffect(() => { onPlace?.(cursor ? tx('files.row', { n: String(cursor) }) : ''); }, [cursor, onPlace, tx]);

  const moveSel = (dr: number, dc: number) => {
    const cur = sel ?? { r: rowAt(Math.max(0, firstI)), c: 0 };
    const rows = sm?.rows ?? 1;
    const r = Math.min(rows, Math.max(1, cur.r + dr)), c = Math.min(Math.max(0, cols - 1), Math.max(0, cur.c + dc));
    setSel({ r, c });
    const el = scroller.current;
    if (!el) return;
    if (r > frozenRows) {
      const i = list ? list.indexOf(r) : r - frozenRows - 1;
      if (i >= 0) {
        const top = headH + tops[i], bot = headH + tops[i + 1];
        if (top < el.scrollTop + headH) el.scrollTop = top - headH;
        else if (bot > el.scrollTop + el.clientHeight) el.scrollTop = bot - el.clientHeight + 4;
      }
    }
    const l = RN_W + lefts[c], rr = RN_W + lefts[c + 1];
    const fr = RN_W + lefts[frozenCols];
    if (c >= frozenCols) { if (l < el.scrollLeft + fr) el.scrollLeft = l - fr; else if (rr > el.scrollLeft + el.clientWidth) el.scrollLeft = rr - el.clientWidth + 4; }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageDown: [20, 0], PageUp: [-20, 0] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    moveSel(m[0], m[1]);
  };

  const styleCss = useMemo(() => new Map<number, CSSProperties>(), [styles, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderRow = (r: number, top: number | null, frozen: boolean) => {
    const data = cache.current.get(`${sheet}:${r}`);
    const h = rowH(r);
    if (h === 0) return null;
    const marked = !!mk?.rows.has(r);
    const cm = mk?.cells.get(r);
    const cov = new Map<number, { m: Merge; master: boolean }>();
    for (const m of mergeByRow.get(r) ?? []) for (let c = m.c1; c <= m.c2; c++) cov.set(c, { m, master: r === m.r1 && c === m.c1 });
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const w = widths[c];
      if (w === 0) continue;
      const cv = cov.get(c);
      if (cv && !cv.master) {
        if (c !== cv.m.c1) continue;
        let sw = 0; for (let k = cv.m.c1; k <= cv.m.c2; k++) sw += widths[k];
        cells.push(<span key={c} className="xl-c is-cov" style={{ width: sw }} />);
        continue;
      }
      const cell = data?.[c];
      const text = cellText(cell);
      const sid = cellStyleIdx(cell);
      let css = styleCss.get(sid * 4 + (text && NUM.test(text) && !sid ? 1 : 0));
      if (!css) { css = cssOf(sid ? styles?.[sid] : undefined, text); styleCss.set(sid * 4 + (text && NUM.test(text) && !sid ? 1 : 0), css); }
      let width = w, height: number | undefined;
      if (cv?.master) {
        width = 0; for (let k = cv.m.c1; k <= cv.m.c2; k++) width += widths[k];
        if (cv.m.r2 > r) { height = 0; for (let k = r; k <= cv.m.r2; k++) height += rowH(k); }
      }
      const isSel = sel?.r === r && sel.c === c;
      const isCell = !!cm?.has(c + 1);
      const wrap = sid && styles?.[sid]?.w;
      cells.push(
        <span key={c} className={`xl-c${c < frozenCols ? ' is-fz' : ''}${isSel ? ' is-sel' : ''}${isCell ? ' is-cell' : ''}${height ? ' is-span' : ''}${wrap ? ' is-wrap' : ''}`} data-c={c}
          style={{ width, ...(height ? { height } : {}), ...(c < frozenCols ? { left: RN_W + lefts[c] } : {}), ...css }} title={text.length > 30 ? text : undefined}
          onClick={() => setSel({ r, c })}><span className="xl-t">{text}</span></span>,
      );
    }
    return (
      <div key={r} className={`xl-row${marked ? ' is-mark' : ''}${cursor === r ? ' is-cur' : ''}${data ? '' : ' is-wait'}${frozen ? ' is-frozen' : ''}`} style={{ ...(top === null ? {} : { transform: `translateY(${top}px)` }), height: h, width: innerW }} data-row={r} data-testid={frozen ? 'grid-frozen-row' : 'grid-row'} data-mark={marked || undefined}>
        <span className={`xl-rn${sel?.r === r ? ' is-sel' : ''}`} style={{ width: RN_W }}>{r}</span>
        {cells}
      </div>
    );
  };

  const body = [];
  for (let i = firstI; i <= lastI; i++) body.push(renderRow(rowAt(i), tops[i], false));
  const head = [];
  for (let r = 1; r <= frozenRows; r++) head.push(renderRow(r, null, true));

  const selCell = sel ? cache.current.get(`${sheet}:${sel.r}`)?.[sel.c] : undefined;
  const nMarked = markRows.length;
  const cur = nMarked ? markRows.indexOf(cursor ?? -1) : -1;
  const step = (d: number) => { if (!nMarked) return; const k = cur < 0 ? (d > 0 ? 0 : nMarked - 1) : (cur + d + nMarked) % nMarked; const r = markRows[k]; const c = [...(mk?.cells.get(r) ?? [])][0]; goRow(r, c ? c - 1 : 0); };
  const shownRow = list ? list[firstI] ?? 0 : frozenRows + 1 + Math.min(count - 1, Math.max(0, indexAt(Math.max(0, view.top - headH))));

  return (
    <div className="fv-grid xl" data-testid="grid-view" data-sheet={sm?.name} onKeyDown={onKey}>
      <div className="fv-gbar xl-nav">
        {nMarked > 0 ? (
          <>
            <button type="button" className={`btn${only ? ' btn--primary' : ''}`} aria-pressed={only} data-testid="only-marked" onClick={() => { setOnly((x) => !x); done.current = ''; }}>
              {tx('files.onlyMarked')}
            </button>
            <span className="xl-step" role="group" aria-label={tx('files.nMarked', { n: nMarked })}>
              <button type="button" className="icon-btn" aria-label={tx('files.prevMark')} data-testid="mark-prev" onClick={() => step(-1)}><Icon n="chev-right" sm className="flip" /></button>
              <span className="xl-stepn" data-testid="mark-count">{cur >= 0 ? tx('files.markOf', { i: cur + 1, n: nMarked }) : tx('files.nMarked', { n: nMarked })}</span>
              <button type="button" className="icon-btn" aria-label={tx('files.nextMark')} data-testid="mark-next" onClick={() => step(1)}><Icon n="chev-right" sm /></button>
            </span>
          </>
        ) : null}
        <span className="grow" />
        <small className="fv-pos" data-testid="grid-pos"><span>{count ? tx('files.row', { n: String(shownRow) }) : ''}</span><span className="fv-pos-b"> · {tx('files.rows', { n: sm?.rows ?? 0 })}</span></small>
      </div>
      <div className="xl-fbar" data-testid="formula-bar">
        <span className="xl-name" data-testid="name-box">{sel ? `${colName(sel.c + 1)}${sel.r}` : ''}</span>
        <span className="xl-fx" aria-hidden="true">fx</span>
        <span className="xl-fval" data-testid="formula-value" title={cellFormula(selCell) ?? cellText(selCell)}>{cellFormula(selCell) ?? cellText(selCell)}</span>
      </div>
      <div className={`xl-scroll${sm?.grid === false ? ' xl-nogrid' : ''}`} ref={scroller} tabIndex={0} aria-label={sm?.name} data-testid="grid-scroll">
        <div className="xl-inner" style={{ width: innerW, height: headH + tops[count] + 24 }}>
          <div className="xl-head" style={{ width: innerW, height: headH }}>
            <div className="xl-letters" style={{ height: LETTERS_H, width: innerW }}>
              <span className="xl-corner" style={{ width: RN_W }} />
              {widths.map((w, c) => (w === 0 ? null : <span key={c} className={`xl-l${c < frozenCols ? ' is-fz' : ''}${sel?.c === c ? ' is-sel' : ''}`} style={{ width: w, ...(c < frozenCols ? { left: RN_W + lefts[c] } : {}) }}>{colName(c + 1)}</span>))}
            </div>
            <div className="xl-frozen" data-testid="grid-header" style={{ height: frozenH, width: innerW }}>{head}</div>
          </div>
          <div className="xl-body" style={{ top: headH }}>{body}</div>
        </div>
      </div>
      {failed && <p className="fv-note is-err" role="alert">{tx('files.err')}</p>}
      {sheets.length > 1 && (
        <div className="xl-tabs" role="tablist" aria-label={tx('files.sheets')} data-testid="sheet-tabs">
          {sheets.map((s, i) => (s.hidden ? null : (
            <button key={i} type="button" role="tab" aria-selected={i === sheet} className={`xl-tab${i === sheet ? ' is-on' : ''}`} data-testid="sheet-tab" style={s.tab ? ({ '--tab': s.tab } as CSSProperties) : undefined}
              onClick={() => { setSheet(i); setOnly(false); setCursor(null); setSel(null); done.current = ''; }}>
              {s.name}{marksBy.has(i) && <i className="fv-dot" aria-hidden="true" />}
            </button>
          )))}
        </div>
      )}
      {sm?.truncated && <p className="fv-note">{tx('files.truncated')}</p>}
    </div>
  );
}
