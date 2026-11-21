'use client';
import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import type { DeadlinesBlock as DB } from '@/lib/blocks/schema';
import { dateWords, dayOf, monthShort, monthTitle, plural, weekday } from '@/lib/blocks/words';
import { Icon } from '../Icon';
import { Frame, SourceLine, SrcTag, Unverified } from './Frame';

const dayNum = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400_000);
const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

export async function downloadIcs(block: DB): Promise<boolean> {
  try {
    const r = await fetch('/api/blocks/ics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block }) });
    if (!r.ok) return false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${block.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'deadlines'}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch { return false; }
}

export default function DeadlinesBlock({ block, onPlain }: { block: DB; onPlain?: () => void }) {
  const tx = useT();
  const [err, setErr] = useState(false);
  const today = dayNum(localToday());
  const months = useMemo(() => {
    const items = [...block.data.items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const out: { key: string; items: typeof items }[] = [];
    for (const x of items) { const k = x.date.slice(0, 7); const last = out.at(-1); if (last?.key === k) last.items.push(x); else out.push({ key: k, items: [x] }); }
    return out;
  }, [block.data.items]);
  const when = (iso: string) => {
    const n = dayNum(iso) - today;
    if (n === 0) return tx('blk.dl.today');
    if (n === 1) return tx('blk.dl.tomorrow');
    if (n < 0) return tx('blk.dl.past');
    return tx(plural(n, tx.lang, 'blk.dl.in1', 'blk.dl.in2', 'blk.dl.in5') as 'blk.dl.in1', { n: String(n) });
  };
  const ics = <button type="button" className="kxb-btn" onClick={() => { setErr(false); void downloadIcs(block).then((ok) => { if (!ok) setErr(true); }); }} data-testid="kxb-ics"><Icon n="calendar" sm /><span>{tx('blk.dl.ics')}</span></button>;
  return (
    <Frame block={block} onPlain={onPlain} actions={ics} foot={<SourceLine block={block} extra={<>{block.data.calendar ? <span>{block.data.calendar}</span> : null}{err && <span className="kxb-unv">{tx('blk.err.file')}</span>}</>} />}>
      <div className="kxdl" data-testid="kxd-list">
        {months.map((m) => (
          <section key={m.key} className="kxdl-m" aria-label={monthTitle(`${m.key}-01`, tx.lang)}>
            {months.length > 1 && <h4 className="kxdl-mt">{monthTitle(`${m.key}-01`, tx.lang)}</h4>}
            <ol className="kxdl-ol">
              {m.items.map((x, i) => {
                const n = dayNum(x.date) - today;
                return (
                  <li key={i} className={`kxdl-r${n < 0 ? ' is-past' : n <= 3 ? ' is-soon' : ''}`} data-testid="kxd-row">
                    <span className="kxdl-day" aria-label={dateWords(x.date, tx.lang)}><b>{dayOf(x.date)}</b><span>{monthShort(x.date, tx.lang)}, {weekday(x.date, tx.lang)}</span></span>
                    <span className="kxdl-what">
                      <span className="kxdl-t">{x.what}</span>
                      <span className="kxdl-s">
                        {x.basis && <span>{x.basis}</span>}
                        {x.orig && <span className="kxdl-mv"><Icon n="arrow-right" sm />{x.reason ? tx('blk.dl.movedFrom', { orig: dateWords(x.orig, tx.lang, false), reason: x.reason }) : tx('blk.dl.movedFromPlain', { orig: dateWords(x.orig, tx.lang, false) })}</span>}
                        {x.src && <SrcTag raw={x.src} />}
                        {x.verified === false && <Unverified />}
                      </span>
                    </span>
                    <span className="kxdl-when">{when(x.date)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </Frame>
  );
}
