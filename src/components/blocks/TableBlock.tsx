'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { LIMITS, type Column, type TableBlock as TB } from '@/lib/blocks/schema';
import { cmpBy, fmtKop, sumKop, toKop } from '@/lib/blocks/money';
import { Icon } from '../Icon';
import { Frame, SourceLine, SrcTag } from './Frame';
import { KpiCards } from './KpiCards';
import { cellText } from './Plain';

type Row = TB['data']['rows'][number];
const STEP = 200;
const isNum = (c: Column) => c.kind === 'money' || c.kind === 'number' || c.kind === 'percent';

function match(r: Row, where: Record<string, string[]>): boolean {
  return Object.entries(where).every(([k, vals]) => vals.includes(String(r[k] ?? '')));
}

export async function downloadXlsx(block: TB, href?: string): Promise<boolean> {
  try {
    const r = await fetch('/api/blocks/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(href ? { href } : { block }) });
    if (!r.ok) return false;
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${block.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'table'}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch { return false; }
}

export default function TableBlock({ block, href, onPlain }: { block: TB; href?: string; onPlain?: () => void }) {
  const tx = useT();
  const d = block.data;
  const textCol = d.columns.find((c) => c.kind === 'text');
  const cols = textCol ? d.columns.filter((c) => c.kind !== 'status') : d.columns;
  const all = useMemo(() => d.rows.slice(0, LIMITS.showRows), [d.rows]);
  const total = d.more ?? d.rows.length;
  const dateFirst = cols[0]?.kind === 'date' && !!textCol ? cols[0] : null;
  const marks = !textCol && !d.columns.some((c) => c.kind === 'status') && d.rows.some((r) => r.note || r.status || r.verified === false);
  const firstText = textCol ?? cols[0];
  const filters = d.filters ?? [];
  const def = filters.findIndex((f) => f.default);
  const [fi, setFi] = useState<number>(def);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(STEP);
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState(false);
  const shown = useMemo(() => {
    let r = fi >= 0 ? all.filter((x) => match(x, filters[fi].where)) : all;
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      const cmp = cmpBy(c?.kind ?? 'text', tx.lang);
      r = [...r].sort((a, b) => cmp(a[sort.key], b[sort.key]) * sort.dir);
    }
    return r;
  }, [all, fi, sort, cols, filters, tx.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => filters.map((f) => all.filter((x) => match(x, f.where)).length), [all, filters]);
  const sentinel = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= shown.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setLimit((n) => n + STEP); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, shown.length]);
  useEffect(() => { setLimit(STEP); }, [fi, sort]);
  const totalsCols = cols.filter((c) => c.total && c.kind === 'money');
  const sums = useMemo(() => Object.fromEntries(totalsCols.map((c) => [c.key, sumKop(shown.map((r) => (typeof r[c.key] === 'string' ? (r[c.key] as string) : null)))])), [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const partial = fi >= 0 || shown.length < total;
  const diffKey = d.preset === 'recon' ? (cols.find((c) => c.key === 'diff' && c.kind === 'money')?.key ?? null) : null;

  const cls = (c: Column) => `${isNum(c) ? 'n' : ''}${c.key === cols[0].key ? ' kxt-first' : ''}${dateFirst && c.key === dateFirst.key ? ' kxt-hide-m' : ''}${dateFirst && c.key === firstText.key ? ' kxt-pin-m' : ''}${c.key === 'dt' || c.key === 'kt' ? ' kxt-acct' : ''}`;
  const labelKey = dateFirst ? firstText.key : cols[0].key;
  const statusOf = (r: Row) => (r.verified === false ? 'unv' : String(r.status ?? ''));
  const markCell = (r: Row) => {
    const st = statusOf(r);
    const note = r.note ? String(r.note) : st && st !== 'unv' ? (d.preset === 'registry' ? tx(st === 'pos' ? 'blk.tbl.have' : 'blk.tbl.missing') : tx(`blk.tbl.status.${st}` as 'blk.tbl.status.pos')) : '';
    if (!st && !note) return null;
    return <span className={`kxt-mark is-${st || 'none'}`} data-testid="kxt-mark"><i aria-hidden="true" />{st === 'unv' ? `${tx('blk.notVerified')}${note ? `: ${note}` : ''}` : note}</span>;
  };
  const cell = (c: Column, r: Row) => {
    if (c.kind === 'status') return markCell(r);
    const v = r[c.key];
    const txt = cellText(c.kind, v, tx.lang, tx as never);
    const neg = c.key === diffKey && typeof v === 'string' && (toKop(v) ?? 0n) !== 0n;
    if (c.key === firstText.key && (textCol ? (r.status || r.note || r.verified === false || typeof r.src === 'string' || dateFirst) : typeof r.src === 'string')) {
      return <span className="kxt-cell2"><span className="kxt-main">{txt}</span><span className="kxt-sub">{dateFirst && r[dateFirst.key] ? <span className="kxt-subdate">{cellText('date', r[dateFirst.key], tx.lang, tx as never)}</span> : null}{textCol ? markCell(r) : null}{typeof r.src === 'string' ? <SrcTag raw={r.src} /> : null}</span></span>;
    }
    return <span className={neg ? 'kxt-neg' : undefined}>{txt}</span>;
  };
  const head = (c: Column) => {
    const on = sort?.key === c.key;
    return (
      <th key={c.key} className={cls(c)} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} scope="col">
        <button type="button" className="kxt-sort" onClick={() => setSort(on ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })} aria-label={tx('blk.tbl.sort', { col: c.title })} data-testid={`kxt-sort-${c.key}`}>
          {c.title}{on && <span aria-hidden="true">{sort!.dir === 1 ? ' ↑' : ' ↓'}</span>}
        </button>
      </th>
    );
  };
  const xlsx = (
    <button type="button" className="kxb-btn" disabled={busy} onClick={() => { setBusy(true); setDlErr(false); void downloadXlsx(block, href).then((ok) => { setBusy(false); if (!ok) setDlErr(true); }); }} data-testid="kxb-xlsx">
      <Icon n="download" sm /><span>{tx('blk.tbl.xlsx')}</span>
    </button>
  );
  const shownLine = partial ? <span data-testid="kxb-shown">{(d.more ?? 0) > all.length || d.rows.length > all.length ? tx('blk.shownFile', { n: String(shown.length), all: String(total) }) : tx('blk.shown', { n: String(shown.length), all: String(total) })}</span> : null;
  const chips = filters.length > 0 && (
    <div className="kxt-chips" role="radiogroup" aria-label={block.title} data-testid="kxt-filters">
      {[...(def >= 0 ? [def] : []), -1, ...filters.map((_, i) => i).filter((i) => i !== def)].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={fi === i} className="kxt-chip" onClick={() => setFi(i)} data-testid={i < 0 ? 'kxt-filter-all' : `kxt-filter-${i}`}>
          {i < 0 ? tx('blk.tbl.all') : filters[i].title}<span className="kxt-cnt">{i < 0 ? all.length : counts[i]}</span>
        </button>
      ))}
    </div>
  );
  return (
    <Frame block={block} expand onPlain={onPlain} actions={xlsx}
      foot={<SourceLine block={block} rows extra={<>{shownLine}{dlErr && <span className="kxb-unv">{tx('blk.err.file')}</span>}</>} />}>
      {d.summary && d.summary.length > 0 && <KpiCards items={d.summary} strip />}
      {chips}
      <div className="kxt-scroll" data-testid="kxt-scroll" tabIndex={0}>
        <table className={`kxt${d.preset ? ` kxt--${d.preset}` : ''}`}>
          <thead><tr>{cols.map(head)}{marks && <th scope="col" className="kxt-markh" />}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={cols.length + (marks ? 1 : 0)} className="kxt-empty">{tx(fi >= 0 ? 'blk.tbl.emptyFilter' : 'blk.tbl.empty')}</td></tr>}
            {shown.slice(0, limit).map((r, i) => (
              <tr key={i} className={r.verified === false ? 'is-unv' : r.status ? `is-${r.status}` : undefined} data-testid="kxt-row">
                {cols.map((c) => <td key={c.key} className={cls(c)}>{cell(c, r)}</td>)}
                {marks && <td className="kxt-markc">{markCell(r)}</td>}
              </tr>
            ))}
            {limit < shown.length && <tr ref={sentinel} aria-hidden="true"><td colSpan={cols.length + (marks ? 1 : 0)} className="kxt-more">…</td></tr>}
          </tbody>
          {totalsCols.length > 0 && shown.length > 0 && (
            <tfoot>
              <tr data-testid="kxt-total">{cols.map((c) => (c.key === labelKey
                ? <th key={c.key} scope="row" className={cls(c)}>{tx('blk.tbl.total')}</th>
                : <td key={c.key} className={cls(c)}>{c.total && c.kind === 'money' ? fmtKop(sums[c.key] ?? 0n, tx.lang) : ''}</td>))}{marks && <td />}</tr>
              {partial && d.totals && Object.keys(d.totals).length > 0 && (
                <tr className="kxt-totall" data-testid="kxt-total-all">{cols.map((c) => (c.key === labelKey
                  ? <th key={c.key} scope="row" className={cls(c)}>{tx('blk.tbl.totalAll')}</th>
                  : <td key={c.key} className={cls(c)}>{d.totals?.[c.key] ? cellText('money', d.totals[c.key], tx.lang, tx as never) : ''}</td>))}{marks && <td />}</tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </Frame>
  );
}
