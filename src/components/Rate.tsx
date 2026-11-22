'use client';
import { useEffect, useRef, useState } from 'react';
import type { MsgView } from '@/lib/types';
import type { RatingView } from '@/lib/rating';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import '@/styles/user-memory.css';

const LINE = ['long', 'format', 'misread', 'wrong', 'other'] as const;

export function Rate({ m }: { m: MsgView }) {
  const tx = useT();
  const [r, setR] = useState<RatingView | null>(m.rating ?? null);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
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
    if (v === -1) { setComment(''); setOther(false); setDone(null); setOpen(true); } else setOpen(false);
  };
  const pick = (id: string, note = '') => {
    const prev = r;
    const rs = id === 'other' ? (note.trim() ? ['other'] : []) : [id];
    setR({ value: -1, reasons: rs, comment: note.trim() });
    void put({ value: -1, reasons: rs, ...(note.trim() ? { comment: note.trim() } : {}) }, prev);
    setDone(id === 'wrong' || id === 'misread' ? 'recheck' : 'thanks');
    window.setTimeout(() => { setOpen(false); setDone(null); setOther(false); setComment(''); }, 2600);
  };
  const [done, setDone] = useState<null | 'thanks' | 'recheck'>(null);
  const [other, setOther] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(`rate-why-${m.id}`)); }, [m.id, open]);
  const line = !open ? null : done ? (
    <div className="ans-line" role="status" data-testid="rate-done">{tx(done === 'recheck' ? 'rate.line.recheck' : 'rate.line.thanks')}</div>
  ) : other ? (
    <form className="ans-line ans-line--edit" data-testid="rate-other" onSubmit={(e) => { e.preventDefault(); pick('other', comment); }}>
      <input className="ans-line-in" value={comment} maxLength={2000} autoFocus placeholder={tx('rate.line.otherPh')} aria-label={tx('rate.comment')} onChange={(e) => setComment(e.target.value)} data-testid="rate-comment" />
      <span className="ans-line-acts">
        <button type="submit" className="ans-link" disabled={!comment.trim()} data-testid="rate-send">{tx('rate.line.send')}</button>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ans-link" onClick={() => setOther(false)} data-testid="rate-other-back">{tx('rate.skip')}</button>
      </span>
    </form>
  ) : (
    <div className="ans-line" data-testid="rate-why">
      <span>{tx('rate.line')}</span>{' '}
      {LINE.map((id, i) => (
        <span key={id}>{i > 0 && <span aria-hidden="true"> · </span>}
          <button type="button" className="ans-link" onClick={() => (id === 'other' ? setOther(true) : pick(id))} data-testid={`why-${id}`}>{tx(`rate.line.${id}`)}</button>
        </span>
      ))}
      <span aria-hidden="true"> · </span>
      <button type="button" className="ans-link ans-link--quiet" onClick={() => setOpen(false)} data-testid="rate-skip">{tx('rate.line.hide')}</button>
    </div>
  );

  return (
    <>
      <button type="button" className="icon-btn rate" aria-label={tx('rate.good')} aria-pressed={r?.value === 1} data-testid="rate-up" onClick={() => tap(1)}>
        <Icon n="thumb" sm />
      </button>
      <button type="button" className="icon-btn rate" aria-label={tx('rate.bad')} aria-pressed={r?.value === -1} data-testid="rate-down" onClick={() => tap(-1)}>
        <Icon n="thumb" sm className="flip" />
      </button>
      {line && slot ? createPortal(line, slot) : null}
    </>
  );
}
