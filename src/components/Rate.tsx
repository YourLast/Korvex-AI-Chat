'use client';
import { useEffect, useRef, useState } from 'react';
import type { MsgView } from '@/lib/types';
import { REASONS, type RatingView } from '@/lib/rating';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import { Popover } from './Popover';

export function Rate({ m }: { m: MsgView }) {
  const tx = useT();
  const [r, setR] = useState<RatingView | null>(m.rating ?? null);
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [down, setDown] = useState<HTMLButtonElement | null>(null);
  const seq = useRef(0);
  const srv = m.rating ? `${m.rating.value}|${m.rating.reasons.join(',')}|${m.rating.comment}` : '';
  useEffect(() => { setR(m.rating ?? null); }, [m.id, srv]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = async (body: { value: 1 | -1 | 0; reasons?: string[]; comment?: string }, prev: RatingView | null) => {
    const n = ++seq.current;
    try {
      const res = await fetch(`/api/messages/${m.id}/rating`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { rating: RatingView | null };
      if (n === seq.current) setR(j.rating);
    } catch {
      if (n === seq.current) setR(prev);
    }
  };
  const tap = (v: 1 | -1) => {
    const prev = r;
    if (r?.value === v) { setR(null); setOpen(false); void put({ value: 0 }, prev); return; }
    setR({ value: v, reasons: [], comment: '' });
    void put({ value: v }, prev);
    if (v === -1) { setReasons([]); setComment(''); setOpen(true); } else setOpen(false);
  };
  const submit = () => {
    setOpen(false);
    if (!reasons.length && !comment.trim()) return;
    const prev = r;
    setR({ value: -1, reasons, comment: comment.trim() });
    void put({ value: -1, reasons, comment }, prev);
  };
  const toggle = (id: string) => setReasons((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <>
      <button type="button" className="icon-btn rate" aria-label={tx('rate.good')} aria-pressed={r?.value === 1} data-testid="rate-up" onClick={() => tap(1)}>
        <Icon n="thumb" sm />
      </button>
      <button type="button" className="icon-btn rate" aria-label={tx('rate.bad')} aria-pressed={r?.value === -1} data-testid="rate-down" ref={setDown} onClick={() => tap(-1)}>
        <Icon n="thumb" sm className="flip" />
      </button>
      <Popover anchor={down} open={open} onClose={() => setOpen(false)} title={tx('rate.title')} sub={tx('rate.optional')} align="right" className="pop--rate" sheetClass="sheet--rate"
        focusFirst=".why-chip" testId="rate-pop"
        foot={<>
          <span className="grow" />
          <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} data-testid="rate-skip">{tx('rate.skip')}</button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!reasons.length && !comment.trim()} data-testid="rate-send">{tx('comp.send')}</button>
        </>}>
        <div className="why" role="group" aria-label={tx('rate.reason')}>
          {REASONS.map((x) => (
            <button type="button" key={x.id} className="why-chip" aria-pressed={reasons.includes(x.id)} data-testid={`why-${x.id}`} onClick={() => toggle(x.id)}>{tx(`rate.why.${x.id}`)}</button>
          ))}
        </div>
        <label className="why-note">
          <span className="sr">{tx('rate.comment')}</span>
          <textarea rows={3} maxLength={2000} placeholder={tx('rate.commentPh')} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="rate-comment" />
        </label>
      </Popover>
    </>
  );
}
