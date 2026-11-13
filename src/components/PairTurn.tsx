'use client';
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import type { PublicModel } from '@/lib/models';
import type { MsgView, PairView } from '@/lib/types';
import { AssistantMsg } from './Message';
import { levelLabel, pairLabels } from './ModelPicker';
import { ModelMark } from './ModelMark';
import { Icon } from './Icon';
import '@/styles/pair.css';

export type Lane = 'a' | 'b';
export type Winner = 'a' | 'b' | 'tie' | 'bad';

const VOTE_IDS: Winner[] = ['a', 'tie', 'bad', 'b'];

export function sideLabel(models: PublicModel[], m: MsgView | undefined) {
  return levelLabel(models, { modelId: m?.meta?.modelId ?? '', levelId: m?.meta?.levelId ?? '' });
}

export function voteNames(la: { model: string; level: string }, lb: { model: string; level: string }): [string, string] {
  if (la.model !== lb.model) return [la.model, lb.model];
  if (la.level !== lb.level) return [`${la.model} · ${la.level}`, `${lb.model} · ${lb.level}`];
  return ['A', 'B'];
}

export function PairVote({ a, b, vote, names, onVoted, compact }: { a?: MsgView; b?: MsgView; vote: Winner | null; names: [string, string]; onVoted?: (w: Winner | null) => void; compact?: boolean }) {
  const t = useT();
  const label = (id: Winner) => (id === 'a' ? t('tools.vote.better', { a: names[0] }) : id === 'b' ? t('tools.vote.better', { a: names[1] }) : id === 'tie' ? t('tools.vote.bothGood') : t('tools.vote.bothBad'));
  const [v, setV] = useState<Winner | null>(vote);
  const seq = useRef(0);
  useEffect(() => setV(vote), [vote]);
  const ready = !!a && !!b && !a.streaming && !b.streaming && !a.id.startsWith('a-') && !b.id.startsWith('a-');
  if (!ready) return null;
  const put = (w: Winner | null) => {
    const prev = v;
    const n = ++seq.current;
    setV(w); onVoted?.(w);
    void fetch('/api/votes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: a!.id, b: b!.id, winner: w }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .catch(() => { if (n === seq.current) { setV(prev); onVoted?.(prev); } });
  };
  return (
    <div className={`pair-vote${compact ? ' pair-vote--compact' : ''}`} role="group" aria-label={t('tools.vote.aria')} data-testid="pair-vote" data-vote={v ?? ''}>
      <span className="pair-vote-q">{t('tools.vote.q')}</span>
      {}
      <span className="pair-vote-main">
        {VOTE_IDS.filter((o) => o === 'a' || o === 'b').map((o) => (
          <button type="button" key={o} className="pair-vote-opt" aria-pressed={v === o} data-testid={`vote-${o}`} title={label(o)}
            onClick={() => put(v === o ? null : o)}>{t('tools.vote.short', { x: o.toUpperCase() })}</button>
        ))}
      </span>
      <span className="pair-vote-alt">
        {VOTE_IDS.filter((o) => o === 'tie' || o === 'bad').map((o) => (
          <button type="button" key={o} className="pair-vote-alt-opt" aria-pressed={v === o} data-testid={`vote-${o}`}
            onClick={() => put(v === o ? null : o)}>{label(o)}</button>
        ))}
      </span>
    </div>
  );
}

const laneState = (m?: MsgView) => (!m ? undefined : m.streaming ? (m.phase === 'queued' || m.squeue ? 'queued' : 'live') : m.meta?.error || m.meta?.errorUser ? 'err' : 'done');

export function PairTurn({ u, a, b, models, fileNames, last, open, busy, onRegen, onContinue, onSwitch, onPick, onVoted, readOnly, foot }: {
  u: MsgView & { pair: PairView }; a?: MsgView; b?: MsgView; models: PublicModel[]; fileNames: string[]; last: boolean; open: boolean; busy: boolean;
  onRegen: (lane: Lane, m: MsgView) => void; onContinue: (lane: Lane, m: MsgView) => void; onSwitch: (id: string) => void;
  onPick: (m: MsgView) => void; onVoted: (w: Winner | null) => void;
  readOnly?: boolean; foot?: (m: MsgView) => ReactNode;
}) {
  const t = useT();
  const p = u.pair;
  const first: Lane = p.pick ?? (p.vote === 'b' ? 'b' : 'a');
  const [tab, setTab] = useState<Lane>(first);
  const [anim, setAnim] = useState<'' | 'l' | 'r'>('');
  useEffect(() => { if (p.pick) setTab(p.pick); }, [p.pick]);
  useEffect(() => {
    const f = () => { const h = window.location.hash; if (b && h === `#m-${b.id}`) setTab('b'); else if (a && h === `#m-${a.id}`) setTab('a'); };
    f();
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, [a?.id, b?.id]);
  const [la, lb] = pairLabels(models, { modelId: a?.meta?.modelId ?? '', levelId: a?.meta?.levelId ?? '' }, { modelId: b?.meta?.modelId ?? '', levelId: b?.meta?.levelId ?? '' });
  const names = voteNames(la, lb);
  const sameName = la.short === lb.short;
  const nm = (l: Lane) => (l === 'a' ? la : lb);
  const go = (l: Lane) => { if (l === tab) return; setAnim(l === 'b' ? 'l' : 'r'); setTab(l); };
  const sw = useRef<{ x: number; y: number; t: number; skip: boolean } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    const el = e.target as Element;
    const skip = !!el.closest('pre, .md-tbl-scroll, .katex-display, textarea, input, .ver, .pop, .sheet');
    sw.current = { x: t.clientX, y: t.clientY, t: Date.now(), skip };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = sw.current; sw.current = null;
    if (!s || s.skip) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - s.t > 900) return;
    go(dx < 0 ? 'b' : 'a');
  };
  const canAct = !readOnly && open && last && !busy;
  const pickBtn = (l: Lane, m?: MsgView) => (readOnly ? null : canAct && m && !m.streaming && !m.id.startsWith('a-') && (m.content.trim() || m.reasoning?.trim()) ? (
    <button type="button" className="btn btn--ghost pair-pick" data-testid={`pick-${l}`} onClick={() => onPick(m)} title={t('tools.vote.pickTitle')}>
      <Icon n="check" sm />{t('tools.vote.pick')}
    </button>
  ) : p.pick === l ? <span className="pair-picked" data-testid={`picked-${l}`}><Icon n="check" sm />{t('tools.vote.picked')}</span> : null);
  const col = (l: Lane, m?: MsgView) => (m
    ? <AssistantMsg key={l} col={l} m={m} models={models} fileNames={fileNames} last={last && open} canRegen={canAct} readOnly={readOnly} markSlot={readOnly ? foot?.(m) : undefined}
        headSlot={<><ModelMark id={m.meta?.modelId ?? ''} models={models} /><b>{nm(l).model}</b><span className="sep" /><span>{nm(l).level}</span><span className="sep" /></>}
        footSlot={pickBtn(l, m)}
        onRegenerate={() => onRegen(l, m)} onContinue={() => onContinue(l, m)} onSwitch={open ? onSwitch : undefined} />
    : <div key={l} className={`ans ans-${l}`} />);
  return (
    <div className="pair" data-testid="pair" data-active={tab} data-open={open || undefined} data-pick={p.pick ?? undefined} data-anim={anim || undefined} onAnimationEnd={() => setAnim('')}>
      <div className="pair-tabs" role="tablist" aria-label={t('tools.vote.two')}>
        {(['a', 'b'] as const).map((l) => {
          const m = l === 'a' ? a : b;
          const x = nm(l);
          return (
            <button type="button" key={l} role="tab" aria-selected={tab === l} className="pair-tab" data-testid={`pair-tab-${l}`} onClick={() => go(l)}>
              <ModelMark id={m?.meta?.modelId ?? ''} models={models} state={laneState(m)} className={m ? `pair-dot pair-dot--${laneState(m)}` : undefined} />
              <span className="pair-tab-t">{sameName ? `${l.toUpperCase()} · ` : ''}{x.short}<em>{x.level}</em></span>
            </button>
          );
        })}
      </div>
      <div className="pair-cols" data-noswipe="" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-testid="pair-cols">
        {col('a', a)}
        {col('b', b)}
      </div>
      {readOnly
        ? p.vote && <p className="pair-vote-ro t-cap" data-testid="pair-vote-ro">{t('tools.vote.human', { what: p.vote === 'a' ? t('tools.vote.humanBetter', { a: names[0] }) : p.vote === 'b' ? t('tools.vote.humanBetter', { a: names[1] }) : p.vote === 'tie' ? t('tools.vote.bothGood').toLowerCase() : t('tools.vote.bothBad').toLowerCase() })}</p>
        : <PairVote a={a} b={b} vote={p.vote} names={names} onVoted={onVoted} />}
    </div>
  );
}
