'use client';
import { useT } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { LIMITS, type Block } from '@/lib/blocks/schema';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/blocks/money';
import { rateKey } from '@/lib/blocks/text';
import { SrcChip } from '../SrcChip';
import { Icon } from '../Icon';
import { useBlockEnv } from './BlockEnv';
import { SourceLine } from './Frame';

const isNum = (k: string) => k === 'money' || k === 'number' || k === 'percent';
export function cellText(kind: string, v: unknown, lang: Lang, t: (k: never) => string): string {
  if (v == null || v === '') return '—';
  const s = String(v);
  if (kind === 'money') return fmtMoney(s, lang);
  if (kind === 'number') return fmtNum(s, lang);
  if (kind === 'percent') return `${fmtNum(s, lang)} %`;
  if (kind === 'date') return fmtDate(s, lang);
  if (kind === 'status') return s ? t(`blk.tbl.status.${s}` as never) : '';
  return s;
}

export function Plain({ block, onBlock }: { block: Block; onBlock?: () => void }) {
  const tx = useT();
  const { snap } = useBlockEnv();
  const back = onBlock ? <button type="button" className="kxb-ib" aria-label={tx('blk.asBlock')} title={tx('blk.asBlock')} onClick={onBlock} data-testid="kxb-block"><Icon n="layers" sm /></button> : null;
  let body: React.ReactNode = null;
  if (block.type === 'table') {
    const d = block.data, rows = d.rows.slice(0, LIMITS.showRows), notes = d.rows.some((r) => r.note);
    body = (
      <div className="md-tbl-scroll kxb-plain-scroll"><table className="kxb-plain-tbl">
        <thead><tr>{d.columns.map((c) => <th key={c.key} className={isNum(c.kind) ? 'n' : undefined}>{c.title}</th>)}{notes && <th />}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>{d.columns.map((c) => <td key={c.key} className={isNum(c.kind) ? 'n' : undefined}>{cellText(c.kind, r[c.key], tx.lang, tx as never)}</td>)}
            {notes && <td>{String(r.note ?? '')}{r.verified === false ? ` · ${tx('blk.notVerified')}` : ''}{typeof r.src === 'string' ? <> <SrcChip raw={r.src} /></> : null}</td>}</tr>
        ))}</tbody>
      </table></div>
    );
  } else if (block.type === 'kpi') {
    body = <ul className="kxb-plain-list">{block.data.items.map((k, i) => <li key={i}>{k.label}: <b>{k.kind === 'money' ? fmtMoney(k.value, tx.lang) : fmtNum(k.value, tx.lang)}{k.unit ? ` ${k.unit}` : k.kind === 'percent' ? ' %' : ''}</b>{k.verified === false ? ` · ${tx('blk.notVerified')}` : ''}{k.basis ? ` — ${k.basis}` : ''}</li>)}</ul>;
  } else if (block.type === 'rate') {
    const r = snap?.rates?.[rateKey(block.data.code, block.data.date)];
    body = <p className="kxb-plain-p">{r?.value ? <>{tx('blk.rate.per', { code: r.code, date: fmtDate(r.date, tx.lang) })}: <b>{fmtNum(r.value, tx.lang)}&nbsp;₽</b></> : block.data.code} · <a className="lnk" href="https://www.cbr.ru/currency_base/daily/" target="_blank" rel="noopener noreferrer nofollow">cbr.ru</a></p>;
  } else if (block.type === 'deadlines') {
    body = <ul className="kxb-plain-list">{block.data.items.map((x, i) => <li key={i}><b>{fmtDate(x.date, tx.lang)}</b> — {x.what}{x.basis ? ` (${x.basis})` : ''}</li>)}</ul>;
  }
  return (
    <section className="kxb kxb-plain" aria-label={block.title} data-testid="kxb-plainview">
      <header className="kxb-head"><h3 className="kxb-title">{block.title}</h3>{back && <div className="kxb-acts">{back}</div>}</header>
      {body}
      <SourceLine block={block} />
    </section>
  );
}
