'use client';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import type { RateBlock as RB } from '@/lib/blocks/schema';
import type { RateView } from '@/lib/blocks/rateTypes';
import { fmtMoney, fmtNum } from '@/lib/blocks/money';
import { dateWords } from '@/lib/blocks/words';
import { rateKey } from '@/lib/blocks/text';
import { Icon } from '../Icon';
import { Frame, SourceLine } from './Frame';
import { useBlockEnv } from './BlockEnv';

const SCALE = 1_000_000n;
function toScaled(s: string): bigint | null {
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[2]) * SCALE + BigInt((m[3] ?? '').padEnd(6, '0'));
  return m[1] ? -v : v;
}
const roundDiv = (a: bigint, b: bigint) => { const q = a / b, r = a % b; return 2n * (r < 0n ? -r : r) >= (b < 0n ? -b : b) ? q + (a < 0n === b < 0n ? 1n : -1n) : q; };
const kopStr = (k: bigint) => { const neg = k < 0n, a = neg ? -k : k; return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`; };
export function mulRate(amount: string, rate: string): string | null {
  const a = toScaled(amount), r = toScaled(rate);
  return a === null || r === null ? null : kopStr(roundDiv(a * r * 100n, SCALE * SCALE));
}
export function divRate(rub: string, rate: string): string | null {
  const a = toScaled(rub), r = toScaled(rate);
  return a === null || r === null || r === 0n ? null : kopStr(roundDiv(a * 100n, r));
}
export function parseAmount(s: string): string | null {
  let t = s.replace(/[\s  ']/g, '');
  if (!t) return null;
  if (/,\d{1,2}$/.test(t) && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/,\d{1,6}$/.test(t) && !t.includes('.')) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  return /^\d{1,15}(\.\d{1,6})?$/.test(t) ? t : null;
}

async function load(code: string, date?: string, range?: { from: string; to: string }): Promise<RateView> {
  const q = new URLSearchParams({ code, ...(date ? { date } : {}), ...(range ? { from: range.from, to: range.to } : {}) });
  try {
    const r = await fetch(`/api/blocks/rate?${q}`);
    if (!r.ok) return { state: 'fail', code };
    return (await r.json()) as RateView;
  } catch { return { state: 'fail', code }; }
}

const isoMinus = (d: number) => { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().slice(0, 10); };

export default function RateBlock({ block, onPlain }: { block: RB; onPlain?: () => void }) {
  const tx = useT();
  const { snap } = useBlockEnv();
  const p = block.data;
  const saved = snap?.rates?.[rateKey(p.code, p.date)] ?? null;
  const [view, setView] = useState<RateView | null>(saved);
  const [isSaved, setIsSaved] = useState(!!saved);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<RateView['history'] | null>(null);
  const [amt, setAmt] = useState(p.amount ? fmtMoney(p.amount, tx.lang) : '');
  const [rub, setRub] = useState('');
  const [side, setSide] = useState<'cur' | 'rub'>('cur');
  const fetchNow = useCallback(async (date?: string) => {
    setBusy(true);
    const v = await load(p.code, date);
    setView(v); setIsSaved(false); setBusy(false);
  }, [p.code]);
  useEffect(() => { if (!saved) void fetchNow(p.date); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rate = view?.value ?? null;
  useEffect(() => {
    if (!rate) return;
    if (side === 'cur') { const a = parseAmount(amt); setRub(a ? fmtMoney(mulRate(a, rate), tx.lang) : ''); }
  }, [amt, rate, side, tx.lang]);
  useEffect(() => {
    if (!rate) return;
    if (side === 'rub') { const r = parseAmount(rub); setAmt(r ? fmtMoney(divRate(r, rate), tx.lang) : ''); }
  }, [rub, rate, side, tx.lang]);
  const showHist = async () => {
    if (hist) { setHist(null); return; }
    const v = await load(p.code, undefined, p.range ?? { from: isoMinus(30), to: isoMinus(0) });
    setHist(v.history ?? []);
  };
  const name = view?.name ?? p.code;
  const title = block.title || tx('blk.rate.title', { name, code: p.code });
  const ok = view && view.value && view.state !== 'fail' && view.state !== 'unknown';
  const delta = ok && view!.prev ? deltaOf(view!.value!, view!.prev.value) : null;
  const note = !view ? null
    : view.state === 'holiday' ? tx('blk.rate.holiday', { asked: dateWords(view.asked, tx.lang, false), date: dateWords(view.date, tx.lang, false) })
    : view.state === 'notYet' ? tx('blk.rate.notYet', { asked: dateWords(view.asked, tx.lang, false), date: dateWords(view.date, tx.lang, false) })
    : view.state === 'stale' ? tx('blk.rate.stale', { date: dateWords(view.date, tx.lang) })
    : null;
  const acts = (
    <>
      {isSaved && <button type="button" className="kxb-btn" disabled={busy} onClick={() => void fetchNow()} data-testid="kxb-rate-today"><Icon n="retry" sm /><span>{tx('blk.rate.today')}</span></button>}
      {ok && <button type="button" className="kxb-btn" aria-expanded={!!hist} onClick={() => void showHist()} data-testid="kxb-rate-hist"><Icon n="clock" sm /><span>{tx('blk.rate.history')}</span></button>}
    </>
  );
  const foot = <SourceLine block={block} extra={<>{ok ? <span>{tx('blk.rate.inBrowser')}</span> : null}{isSaved ? <span>{tx('blk.rate.saved')}</span> : null}</>} />;
  return (
    <Frame block={{ ...block, title }} onPlain={onPlain} actions={acts} foot={foot}>
      {!view ? <div className="kxr-wait" aria-busy="true"><span className="kxb-sk kxr-sk" /><span className="kxb-sk" /></div>
        : !ok ? (
          <div className="kxr-fail" data-testid="kxb-rate-fail">
            <p>{view.state === 'unknown' ? tx('blk.rate.unknown', { code: p.code }) : tx('blk.rate.fail')}</p>
            {view.state === 'fail' && <button type="button" className="kxb-btn" disabled={busy} onClick={() => void fetchNow(p.date)} data-testid="kxb-rate-retry"><Icon n="retry" sm /><span>{tx('blk.rate.retry')}</span></button>}
          </div>
        ) : (
          <div className="kxr">
            <span className="kxr-per">{tx('blk.rate.on', { code: view.code, date: dateWords(view.date, tx.lang) })}</span>
            <div className="kxr-line">
              <span className="kxr-v" data-testid="kxb-rate-value">{fmtNum(view.value, tx.lang)}<span className="kxr-cur">{'\u00a0'}₽</span></span>
              {delta && <span className="kxr-d" data-testid="kxb-rate-delta"><span aria-hidden="true">{delta.startsWith('-') ? '↓' : '↑'}</span>{' '}{fmtNum(delta.replace(/^-/, ''), tx.lang)} {tx('blk.rate.to', { date: dateWords(view.prev!.date, tx.lang, false) })}</span>}
            </div>
            {(view.nominal ?? 1) > 1 && <span className="kxr-note">{tx('blk.rate.nominal', { n: String(view.nominal), code: view.code })}</span>}
            {note && <span className="kxr-note kxr-note--warn">{note}</span>}
            <div className="kxr-conv" role="group" aria-label={tx('blk.rate.conv')}>
              <label className="kxr-in"><input inputMode="decimal" value={amt} aria-label={tx('blk.rate.amount', { code: view.code })} onChange={(e) => { setSide('cur'); setAmt(e.target.value); }} data-testid="kxb-rate-amt" /><span>{view.code}</span></label>
              <span className="kxr-eq" aria-hidden="true">=</span>
              <label className="kxr-in"><input inputMode="decimal" value={rub} aria-label={tx('blk.rate.amount', { code: 'RUB' })} onChange={(e) => { setSide('rub'); setRub(e.target.value); }} data-testid="kxb-rate-rub" /><span>₽</span></label>
            </div>
          </div>
        )}
      {hist && (
        <div className="kxr-hist" data-testid="kxb-rate-history">
          <span className="kxr-per">{tx('blk.rate.histCap', { code: p.code })}</span>
          <ol>{[...hist].reverse().slice(0, 30).map((h) => <li key={h.date}><span>{dateWords(h.date, tx.lang, false)}</span><b>{fmtNum(h.value, tx.lang)}</b></li>)}</ol>
        </div>
      )}
    </Frame>
  );
}

function deltaOf(v: string, prev: string): string {
  const a = toScaled(v), b = toScaled(prev);
  if (a === null || b === null) return '';
  const d = a - b, n = d < 0n ? -d : d;
  const s = `${n / SCALE}.${String(n % SCALE).padStart(6, '0').slice(0, 4)}`;
  return d < 0n ? `-${s}` : s;
}
