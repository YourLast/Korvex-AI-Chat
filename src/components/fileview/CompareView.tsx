'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { diffTexts, cites, type Diff, type Row, type Seg } from '@/lib/textdiff';
import type { FileTarget } from '@/lib/fileView';
import { orderByNames, orderByTexts, shortLabels } from '@/lib/compareOrder';
import { useT } from '@/lib/i18n/react';
import { Icon } from '../Icon';

const STEP = 1200;

function Words({ segs, cls }: { segs: Seg[]; cls: string }) {
  return <>{segs.map((s, i) => (s.mark ? <mark key={i} className={`fv-w ${cls}`}>{s.t}</mark> : <span key={i}>{s.t}</span>))}</>;
}

const Cell = memo(function Cell({ text, loc, segs, cls, side }: { text?: string; loc?: string; segs?: Seg[]; cls: string; side: 'a' | 'b' }) {
  if (text === undefined) return <div className={`fv-cell is-empty ${side}`} aria-hidden="true" />;
  return (
    <div className={`fv-cell ${cls} ${side}`}>
      {loc && <small className="fv-loc">{loc}</small>}
      <p>{segs ? <Words segs={segs} cls={side === 'a' ? 'del' : 'add'} /> : text}</p>
    </div>
  );
});

export function CompareView({ a, b }: { a: FileTarget; b: FileTarget }) {
  const tx = useT();
  const [tt, setTt] = useState<{ a: string; b: string } | null>(null);
  const [flip, setFlip] = useState(false);
  const [err, setErr] = useState(false);
  const [all, setAll] = useState(false);
  const [side, setSide] = useState<'a' | 'b'>('b');
  const [limit, setLimit] = useState(STEP);
  const [cur, setCur] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    setTt(null); setErr(false); setFlip(false);
    (async () => {
      const [ra, rb] = await Promise.all([fetch(`/api/files/${a.id}/view?content=1`), fetch(`/api/files/${b.id}/view?content=1`)]);
      if (!ra.ok || !rb.ok) throw new Error('x');
      const [ja, jb] = (await Promise.all([ra.json(), rb.json()])) as { text: string }[];
      if (!dead) setTt({ a: ja.text ?? '', b: jb.text ?? '' });
    })().catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [a.id, b.id]);

  const auto = useMemo(() => orderByNames(a.name, b.name) || (tt ? orderByTexts(tt.a, tt.b) : 0), [a.name, b.name, tt]);
  const swapped = (auto === 1) !== flip;
  const [first, second] = swapped ? [b, a] : [a, b];
  const [la, lb] = useMemo(() => shortLabels(first.name, second.name), [first.name, second.name]);
  const d = useMemo(() => (tt ? diffTexts(swapped ? tt.b : tt.a, swapped ? tt.a : tt.b) : null), [tt, swapped]);
  useEffect(() => { if (d) { setAll(d.changes === 0 || d.rows.length < 60); setLimit(STEP); setCur(-1); } }, [d]);

  const marks = useMemo(() => [...(a.marks ?? []), ...(b.marks ?? [])], [a.marks, b.marks]);
  const rows = useMemo(() => {
    if (!d) return [] as { r: Row; i: number; cited: boolean; skipped: number }[];
    const out: { r: Row; i: number; cited: boolean; skipped: number }[] = [];
    let skipped = 0;
    d.rows.forEach((r, i) => {
      const cited = cites(r, marks);
      if (all || r.kind !== 'eq' || cited) { out.push({ r, i, cited, skipped }); skipped = 0; }
      else skipped++;
    });
    return out;
  }, [d, all, marks]);
  const changeIdx = useMemo(() => rows.map((x, k) => (x.r.kind !== 'eq' ? k : -1)).filter((k) => k >= 0), [rows]);

  const go = (dir: number) => {
    if (!changeIdx.length) return;
    const pos = changeIdx.findIndex((k) => k > cur);
    const next = dir > 0 ? (pos < 0 ? changeIdx[0] : changeIdx[pos]) : [...changeIdx].reverse().find((k) => k < cur) ?? changeIdx[changeIdx.length - 1];
    if (next >= limit) setLimit(Math.ceil((next + 1) / STEP) * STEP);
    setCur(next);
    requestAnimationFrame(() => box.current?.querySelector(`[data-k="${next}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  if (err) return <div className="fv-empty" role="alert" data-testid="cmp-error"><b>{tx('files.cmpFail')}</b></div>;
  if (!d) return <div className="fv-empty" role="status"><span className="up-spin fv-spin" /><span>{tx('files.loading')}</span></div>;
  const shown = rows.slice(0, limit);
  return (
    <div className="fv-cmp" data-testid="compare-view" data-changes={d.changes} data-first={first.id} data-swapped={swapped || undefined}>
      <div className="fv-gbar">
        <b className="fv-cnt" data-testid="cmp-count">{d.changes ? tx('files.cmpChanges', { n: d.changes }) : tx('files.cmpSame')}</b>
        {changeIdx.length > 0 && (
          <>
            <button type="button" className="icon-btn" aria-label={tx('files.cmpPrev')} data-testid="cmp-prev" onClick={() => go(-1)}><Icon n="chev-up" sm /></button>
            <button type="button" className="icon-btn" aria-label={tx('files.cmpNext')} data-testid="cmp-next" onClick={() => go(1)}><Icon n="chev-down" sm /></button>
          </>
        )}
        <span className="grow" />
        <button type="button" className="btn fv-swap" data-testid="cmp-swap" title={tx('files.cmpSwap')} aria-label={tx('files.cmpSwap')} onClick={() => setFlip((x) => !x)}><span aria-hidden="true">⇄</span><span className="fv-swap-t">{tx('files.cmpSwap')}</span></button>
        <button type="button" className="btn" aria-pressed={all} data-testid="cmp-all" onClick={() => setAll((x) => !x)}>{tx(all ? 'files.cmpOnly' : 'files.cmpAll')}</button>
      </div>
      <div className="fv-cmp-tabs" role="tablist" data-testid="cmp-tabs">
        <button type="button" role="tab" aria-selected={side === 'a'} className={`fv-tab${side === 'a' ? ' is-on' : ''}`} title={first.name} onClick={() => setSide('a')}>{tx('files.cmpWas')} · {la}</button>
        <button type="button" role="tab" aria-selected={side === 'b'} className={`fv-tab${side === 'b' ? ' is-on' : ''}`} title={second.name} onClick={() => setSide('b')}>{tx('files.cmpNow')} · {lb}</button>
      </div>
      <div className="fv-cmp-head" data-testid="cmp-head"><span title={first.name} data-testid="cmp-was">{tx('files.cmpWas')} · {la}</span><span title={second.name} data-testid="cmp-now">{tx('files.cmpNow')} · {lb}</span></div>
      <div className="fv-cmp-rows" ref={box} data-side={side} data-testid="cmp-rows">
        {shown.map((x, k) => {
          const r = x.r;
          return (
            <div key={x.i}>
              {x.skipped > 0 && <div className="fv-skip" aria-hidden="true">⋯ {x.skipped}</div>}
              <div className={`fv-crow is-${r.kind}${x.cited ? ' is-cited' : ''}${cur === k ? ' is-cur' : ''}`} data-k={k} data-kind={r.kind} data-testid="cmp-row" data-cited={x.cited || undefined}>
                {x.cited && <i className="fv-cite" title={tx('files.cmpCited')} aria-label={tx('files.cmpCited')} />}
                <Cell side="a" text={r.kind === 'add' ? undefined : r.a.text} loc={r.kind === 'add' ? undefined : r.a.loc} segs={r.kind === 'chg' ? r.sa : undefined} cls={r.kind === 'del' || r.kind === 'chg' ? 'is-del' : ''} />
                <Cell side="b" text={r.kind === 'del' ? undefined : r.b.text} loc={r.kind === 'del' ? undefined : r.b.loc} segs={r.kind === 'chg' ? r.sb : undefined} cls={r.kind === 'add' || r.kind === 'chg' ? 'is-add' : ''} />
              </div>
            </div>
          );
        })}
        {rows.length > limit && <button type="button" className="btn fv-more" onClick={() => setLimit((l) => l + STEP)}>{rows.length - limit}…</button>}
        {d.truncated && <p className="fv-note">{tx('files.cmpBig')}</p>}
      </div>
    </div>
  );
}
