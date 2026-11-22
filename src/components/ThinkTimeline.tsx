'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import type { TLRow } from '@/lib/thoughtTimeline';
import { hostOf, type WStep } from '@/lib/work';
import { Icon } from './Icon';
import { StepRow, type Decision } from './WorkFeed';
import '@/styles/think-timeline.css';

export function LiveTitle({ text, className }: { text: string; className?: string }) {
  const [cur, setCur] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => {
    if (text === cur) return;
    setPrev(cur); setCur(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPrev(null), 340);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span className={`tl-now${className ? ' ' + className : ''}`} data-testid="think-now">
      {prev !== null && <span className="tl-now-out" aria-hidden="true">{prev}</span>}
      <span className="tl-now-in wk-shim" key={cur}>{cur}</span>
    </span>
  );
}

function More({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tl-more" data-open={open || undefined}>
      <button type="button" className="tl-more-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        <span>{label}</span><Icon n="chev-right" sm className="tl-more-chev" />
      </button>
      <div className="tl-acc" data-open={open || undefined}><div className="tl-acc-in">{open && children}</div></div>
    </div>
  );
}

function Row({ r, i, onLive, onDecide, askInBar }: { r: TLRow; i: number; onLive?: (s: WStep) => void; onDecide?: (s: WStep, d: Decision) => void; askInBar?: boolean }) {
  const t = useT();
  if (r.kind === 'wait' && r.step) return <StepRow s={r.step} onLive={onLive} onDecide={onDecide} askInBar={askInBar} />;
  return (
    <li className={`tl-row tl-row--${r.kind}${r.live ? ' is-now' : ''}${r.err ? ' is-err' : ''}`} style={{ ['--i' as string]: Math.min(i, 14) }} data-testid="think-row" data-kind={r.kind}>
      <span className="tl-dot" aria-hidden="true" />
      <span className="tl-t">{r.text}{r.note && r.kind !== 'title' ? <span className="tl-inl"> · {r.note}</span> : null}</span>
      {r.kind === 'title' && r.note && <span className="tl-note">{r.note}</span>}
      {r.kind === 'search' && !!r.hosts?.length && (
        r.links?.length
          ? <More label={r.hosts.join(' · ')} testId="think-links">
              <ul className="tl-links">{r.links.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{hostOf(u) ?? u}<small>{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90)}</small></a></li>)}</ul>
            </More>
          : <span className="tl-note tl-hosts">{r.hosts.join(' · ')}</span>
      )}
      {r.kind === 'calc' && r.calc && (
        <More label={t('think.tl.how')} testId="think-how">
          <pre className="tl-calc">{r.calc.join('\n')}</pre>
        </More>
      )}
    </li>
  );
}

export function ThinkTimeline({ rows, onLive, onDecide, askInBar }: { rows: TLRow[]; onLive?: (s: WStep) => void; onDecide?: (s: WStep, d: Decision) => void; askInBar?: boolean }) {
  const t = useT();
  return (
    <ol className="tl" aria-label={t('work.title')} data-testid="work-brief">
      {rows.map((r, i) => <Row key={r.id} r={r} i={i} onLive={onLive} onDecide={onDecide} askInBar={askInBar} />)}
    </ol>
  );
}
