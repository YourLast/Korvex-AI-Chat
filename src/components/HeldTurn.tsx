'use client';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useT } from '@/lib/i18n/react';
import { fmtBytes, fmtSec, stripMarker } from '@/lib/format';
import { baseName } from '@/lib/upload/paths';
import type { HeldFile } from '@/lib/sendHold';
import { ActIcon } from './ActIcon';
import { Icon } from './Icon';
import { HeadMark } from './HeadMark';
import '@/styles/queue-card.css';
import '@/styles/held.css';

export type HeldView = { id: string; text: string; done: number; total: number; failed: number; unpacking: boolean; files?: HeldFile[]; at?: number; sending?: boolean };

const SHOW = 5;

export function heldVariant(): 'a' | 'b' {
  try { return localStorage.getItem('kx.heldVariant') === 'b' ? 'b' : 'a'; } catch { return 'a'; }
}

export function HeldTurn({ h, onCancel, variant = 'a' }: { h: HeldView; onCancel: (id: string) => void; variant?: 'a' | 'b' }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { el.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  if (variant === 'b') return <HeldMsg h={h} onCancel={onCancel} el={el} />;
  return <HeldWork h={h} onCancel={onCancel} el={el} />;
}

function Elapsed({ at }: { at?: number }) {
  const lang = useT().lang;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!at) return null;
  return <span className="tnum">{fmtSec(now - at, lang)}</span>;
}

function FileIcon({ f, px = 16 }: { f: HeldFile; px?: number }) {
  const n = f.kind === 'folder' ? 'folder' : f.kind === 'zip' ? 'layers' : f.kind;
  const st = f.state === 'run' ? 'run' : f.state === 'err' ? 'err' : 'ok';
  return <ActIcon n={n} state={st} px={px} />;
}

function useLine(f: HeldFile) {
  const tx = useT();
  const size = [f.size ? fmtBytes(f.size, tx.lang) : '', f.pages ? tx('msg.pagesPages', { n: f.pages }) : ''].filter(Boolean).join(' · ');
  const sub = f.total != null && (f.kind === 'folder' || f.kind === 'zip')
    ? (f.unpacking ? tx('hold.st.unpacking') : [tx('hold.count', { done: f.done ?? 0, total: f.total }), size].filter(Boolean).join(' · '))
    : size;
  let st = '';
  if (f.state === 'wait') st = tx('hold.st.wait');
  else if (f.state === 'run' && !f.unpacking) st = tx('hold.st.run');
  else if (f.state === 'err') st = tx('hold.st.err');
  return { sub, st };
}

function Rows({ files, render }: { files: HeldFile[]; render: (f: HeldFile) => ReactNode }) {
  const tx = useT();
  const [open, setOpen] = useState(false);
  const cut = !open && files.length > SHOW + 1;
  const shown = cut ? files.slice(0, SHOW) : files;
  const rest = files.slice(shown.length);
  return (
    <>
      {shown.map(render)}
      {cut && (
        <li className="held-more-li">
          <button type="button" className="held-more" data-testid="held-more" onClick={() => setOpen(true)}>
            {tx('hold.more', { n: rest.length })}<span className="tnum"> · {tx('hold.moreReady', { n: rest.filter((f) => f.state === 'ok').length })}</span>
          </button>
        </li>
      )}
    </>
  );
}

type Props = { h: HeldView; onCancel: (id: string) => void; el: RefObject<HTMLDivElement | null> };

function HeldWork({ h, onCancel, el }: Props) {
  const tx = useT();
  const text = stripMarker(h.text);
  const files = h.files ?? [];
  return (
    <>
      <div className="turn-user" data-testid="held-msg" data-held-id={h.id}>
        {text.trim() && <div className="bubble" data-held-bubble="" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</div>}
      </div>
      <div className="held-a" ref={el} role="status" aria-live="polite" data-testid="held-card" data-variant="a" data-done={h.done} data-total={h.total}>
        <p className="held-head">
          <span className="ans-wait-ic" aria-hidden="true" data-held-mark=""><HeadMark live calm /></span>
          <b className="shimmer" data-testid="held-title">{h.unpacking && !h.total ? tx('hold.unpackingShort') : tx('hold.reading')}</b>
          {h.total > 0 && <span className="held-n tnum" data-testid="held-count">{tx('hold.count', { done: h.done, total: h.total })}</span>}
          {h.failed > 0 && <span className="held-n is-err tnum" data-testid="held-failed">· {tx('hold.failedSoFar', { n: h.failed })}</span>}
          <span className="held-time"><Elapsed at={h.at} /></span>
        </p>
        {files.length > 0 && (
          <ul className="held-list" data-testid="held-files">
            <Rows files={files} render={(f) => <WorkRow key={f.key} f={f} />} />
          </ul>
        )}
        <p className="held-foot">
          <span>{tx('hold.sendSelf')}</span>
          <button type="button" disabled={h.sending} className="held-cancel" data-testid="held-cancel" aria-label={tx('hold.cancelAria')} onClick={() => onCancel(h.id)}>{tx('hold.cancel')}</button>
        </p>
      </div>
    </>
  );
}

export const whyText = (err?: string) => (err ?? '').replace(/^[^:«“„]*[«“„][^»”“]*[»”“][^:]*:\s*/, '').trim();

function WorkRow({ f }: { f: HeldFile }) {
  const tx = useT();
  const { sub, st } = useLine(f);
  const [open, setOpen] = useState(false);
  const err = f.state === 'err';
  const line = (
    <>
      <span className="wk-ic"><FileIcon f={f} /></span>
      <span className="wk-line">
        <span className="wk-title">{baseName(f.name)}</span>
        {sub && <span className="wk-sub tnum">{sub}</span>}
      </span>
      {st && <span className={`held-st is-${f.state}${f.state === 'run' ? ' shimmer' : ''}`}>{st}</span>}
      {err && <span className="held-chev" aria-hidden="true"><Icon n={open ? 'chev-up' : 'chev-down'} sm /></span>}
    </>
  );
  return (
    <li className={`held-row is-${f.state}`} data-testid="held-file" data-state={f.state} title={err ? undefined : f.name}>
      {err
        ? <button type="button" className="held-row-in held-row-btn" aria-expanded={open} data-testid="held-why-toggle" onClick={() => setOpen((x) => !x)}>{line}</button>
        : <div className="held-row-in">{line}</div>}
      {err && open && (
        <p className="held-why" data-testid="held-why">
          {whyText(f.err) && <span className="held-why-r">{whyText(f.err)}</span>}
          <span className="held-why-h">{tx(`hold.fix.${f.errKind ?? 'other'}` as 'hold.fix.other')}</span>
        </p>
      )}
    </li>
  );
}

function HeldMsg({ h, onCancel, el }: Props) {
  const tx = useT();
  const text = stripMarker(h.text);
  const files = h.files ?? [];
  return (
    <div className="turn-user held-b" ref={el} data-testid="held-msg" data-held-id={h.id}>
      {files.length > 0 && (
        <ul className="held-atts" data-testid="held-files">
          <Rows files={files} render={(f) => <AttRow key={f.key} f={f} />} />
        </ul>
      )}
      {text.trim() && <div data-held-bubble="" className="bubble held-bubble" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</div>}
      <p className="held-cap" role="status" aria-live="polite" data-testid="held-card" data-variant="b" data-done={h.done} data-total={h.total}>
        <span className="held-cap-mk" aria-hidden="true" data-held-mark=""><HeadMark live calm /></span>
        <span data-testid="held-title">{h.unpacking && !h.total ? tx('hold.unpackingShort') : tx('hold.sendSelfB')}</span>
        {h.total > 0 && <span className="tnum" data-testid="held-count">· {tx('hold.count', { done: h.done, total: h.total })}</span>}
        {h.failed > 0 && <span className="is-err tnum" data-testid="held-failed">· {tx('hold.failedSoFar', { n: h.failed })}</span>}
        <button type="button" className="held-cancel" data-testid="held-cancel" aria-label={tx('hold.cancelAria')} onClick={() => onCancel(h.id)}>{tx('hold.cancel')}</button>
      </p>
    </div>
  );
}

function AttRow({ f }: { f: HeldFile }) {
  const { sub, st } = useLine(f);
  return (
    <li className={`attach held-att is-${f.state}`} data-testid="held-file" data-state={f.state} title={f.err || f.name}>
      <span className="ficon"><FileIcon f={f} /></span>
      <span className="fmeta">
        <b>{baseName(f.name)}</b>
        <small className="tnum">
          {st && <span className={f.state === 'run' ? 'shimmer' : undefined}>{st}</span>}
          {st && sub ? ' · ' : ''}{sub}
        </small>
      </span>
    </li>
  );
}
