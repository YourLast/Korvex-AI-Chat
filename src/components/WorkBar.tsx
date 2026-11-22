'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { AskButtons, CheckCard, type Decision } from './WorkFeed';
import { ActIcon } from './ActIcon';
import { HeadMark } from './HeadMark';
import { iconState } from '@/lib/actIcons';
import { serverNow } from '@/lib/clock';
import { useT, type T } from '@/lib/i18n/react';
import { briefOf, liveTitle } from '@/lib/thoughtTitles';
import { useThinkFull } from '@/lib/thinkPref';
import { KIND_ICON, allSteps, buildFeed, countSteps, fmtDur, historyOf, kindName, nowOf, statusSpoken, type WStep } from '@/lib/work';
import type { MsgView } from '@/lib/types';
import '@/styles/work-bar.css';

const SWIPE_PX = 24;
const SWIPE_V = 0.3;

export function useFeedOffscreen(msgId: string | null): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!msgId) { setOff(false); return; }
    const msg = document.getElementById(`m-${msgId}`);
    const root = msg?.closest('.thread') as HTMLElement | null;
    if (!msg || !root) { setOff(false); return; }
    let raf = 0, t = 0, cur = false;
    const measure = () => {
      raf = 0;
      const li = msg.querySelector('[data-work] .wk-list > li:last-child');
      const el = li?.querySelector(':scope > .wk-row') ?? li ?? msg.querySelector('[data-work]') ?? msg;
      const r = el.getBoundingClientRect(), th = root.getBoundingClientRect();
      const w = el.closest('.wk-body.is-win')?.getBoundingClientRect();
      const hidden = r.top > th.bottom - 56 || r.bottom < th.top || (!!w && (r.top >= w.bottom - 4 || r.bottom <= w.top + 4));
      if (hidden === cur) { window.clearTimeout(t); t = 0; return; }
      if (!hidden) { window.clearTimeout(t); t = 0; cur = false; setOff(false); return; }
      if (!t) t = window.setTimeout(() => { t = 0; cur = true; setOff(true); }, 250);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(measure); };
    root.addEventListener('scroll', kick, { passive: true, capture: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
    ro?.observe(root); ro?.observe(msg);
    const mo = new MutationObserver(kick);
    mo.observe(msg, { childList: true, subtree: true });
    kick();
    return () => { root.removeEventListener('scroll', kick, { capture: true }); ro?.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [msgId]);
  return off;
}

function useHold<T>(v: T, ms: number): T {
  const [shown, setShown] = useState(v);
  const at = useRef(0);
  useEffect(() => {
    const left = ms - (Date.now() - at.current);
    if (left <= 0) { at.current = Date.now(); setShown(v); return; }
    const t = setTimeout(() => { at.current = Date.now(); setShown(v); }, left);
    return () => clearTimeout(t);
  }, [v, ms]);
  return shown;
}

export function WorkBar({ m, onDecide, onShowFeed, onLive, offscreen = true }: { m: MsgView | null; onDecide?: (s: WStep, d: Decision) => void; onShowFeed?: (msgId: string) => void; onLive?: (s: WStep, all: WStep[]) => void; offscreen?: boolean }) {
  const t = useT();
  const live = !!m?.streaming;
  const working = live && !m?.content;
  const items = useMemo(() => (m ? buildFeed(m.reasoning ?? '', m.steps ?? [], !!m.streaming && !!m.rStartedAt, false, t.lang) : []), [m, t.lang]);
  const n = countSteps(items);
  const now = nowOf(items);
  const wait = now?.kind === 'step' && now.step.status === 'wait' ? now.step : null;
  const hist = historyOf(items, 6);
  const [hOpen, setHOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!working || !m?.startedAt) { setLate(false); return; }
    const left = 3000 - (serverNow() - m.startedAt);
    if (left <= 0) { setLate(true); return; }
    const t = setTimeout(() => setLate(true), left);
    return () => clearTimeout(t);
  }, [working, m?.startedAt]);
  const show = working && offscreen && (n > 0 || late || !!wait);

  const [done, setDone] = useState<string | null>(null);
  const was = useRef<{ working: boolean; show: boolean; n: number; t0: number; timer: number }>({ working: false, show: false, n: 0, t0: 0, timer: 0 });
  useEffect(() => {
    const w = was.current;
    if (w.working && !working && w.show && w.n > 0) {
      setDone(`${t('common.done')} · ${fmtDur(Math.max(0, serverNow() - w.t0), t.lang)}`);
      window.clearTimeout(w.timer);
      w.timer = window.setTimeout(() => setDone(null), 1200);
    }
    if (working && done) setDone(null);
    w.working = working; w.show = show; w.n = n; w.t0 = m?.startedAt ?? w.t0;
  }, [working, show, n, m?.startedAt, done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(was.current.timer), []);
  useEffect(() => { if (!show) setHOpen(false); }, [show]);
  useEffect(() => {
    document.documentElement.classList.toggle('wbar-on', working);
    return () => document.documentElement.classList.remove('wbar-on');
  }, [working]);
  useEffect(() => {
    document.documentElement.classList.toggle('wbar-shown', show);
    return () => document.documentElement.classList.remove('wbar-shown');
  }, [show]);
  useEffect(() => {
    const el = bar.current, root = document.documentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => root.style.setProperty('--wbar-h', `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--wbar-h'); };
  });

  const g = useRef<{ y: number; t: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { if (e.pointerType === 'touch') g.current = { y: e.clientY, t: performance.now(), id: e.pointerId }; };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dy = s.y - e.clientY, v = dy / Math.max(1, performance.now() - s.t);
    if (dy > SWIPE_PX || (dy > 8 && v > SWIPE_V)) { g.current = null; setHOpen(true); }
  };
  const onPointerEnd = () => { g.current = null; };

  if (!m || (!show && !done)) return <Announcer m={m} items={items} />;
  return <BarView t={t} m={m} items={items} n={n} now={now} wait={wait} show={show} done={done} hist={hist} hOpen={hOpen} setHOpen={setHOpen} bar={bar}
    onDecide={onDecide} onShowFeed={onShowFeed} onLive={onLive} pointer={{ onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd }} />;
}

function BarView({ t, m, items, n, now, wait, show, done, hist, hOpen, setHOpen, bar, onDecide, onShowFeed, onLive, pointer }: {
  t: T; m: MsgView; items: ReturnType<typeof buildFeed>; n: number; now: ReturnType<typeof nowOf>; wait: WStep | null; show: boolean; done: string | null; hist: WStep[];
  hOpen: boolean; setHOpen: (v: boolean) => void; bar: React.RefObject<HTMLDivElement | null>; onDecide?: (s: WStep, d: Decision) => void; onShowFeed?: (msgId: string) => void;
  onLive?: (s: WStep, all: WStep[]) => void; pointer: Record<string, (e: React.PointerEvent) => void>;
}) {
  const full = useThinkFull();
  const title = full ? null : liveTitle(briefOf(items, true, t.lang));
  const cur = useHold(!full ? { t: title ?? t('work.thinkingDots'), s: '', ic: now?.kind === 'step' ? now.step.icon ?? KIND_ICON[now.step.kind] : 'spark' }
    : now?.kind === 'step' ? { t: now.step.title, s: now.step.sub ?? '', ic: now.step.icon ?? KIND_ICON[now.step.kind] } : { t: now?.kind === 'think' ? now.text : t('work.thinkingDots'), s: '', ic: 'spark' }, 1000);
  const nowText = `${cur.t}${cur.s ? ' · ' + cur.s : ''}`;
  const decide = onDecide ? (st: WStep, allow: Decision) => {
    onDecide(st, allow);
    if (allow === 'open') return;
    if (window.matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true }));
  } : undefined;

  return (
    <>
      <Announcer m={m} items={items} />
      <div className={`wbar${wait && show ? ' wbar--ask' : ''}${done && !show ? ' wbar--done' : ''}`} ref={bar} role="region" aria-label={t('work.bar.region')} data-testid="work-bar" data-noswipe="">
        {wait && show && wait.check ? (
          <div className="wbar-ask wbar-ask--check" data-testid="work-bar-ask">
            <CheckCard s={wait} onDecide={decide} big onLive={onLive ? (x) => onLive(x, allSteps(items).filter((y) => y.kind === 'browser')) : undefined} />
          </div>
        ) : wait && show ? (
          <div className="wbar-ask" data-testid="work-bar-ask">
            <p className="wbar-ask-q"><ActIcon n={wait.icon ?? KIND_ICON[wait.kind]} state="wait" /><span>{wait.ask?.text ?? wait.title}</span></p>
            <AskButtons s={wait} onDecide={decide} big onLive={onLive ? (x) => onLive(x, allSteps(items).filter((y) => y.kind === 'browser')) : undefined} />
          </div>
        ) : done && !show ? (
          <div className="wbar-pill wbar-pill--done" data-testid="work-bar-done"><span className="wbar-ic wbar-ic--mark" aria-hidden="true"><HeadMark live={false} end="check" play /></span><span className="wbar-now">{done}</span></div>
        ) : (
          <button type="button" className="wbar-pill" aria-haspopup="dialog" aria-expanded={hOpen} data-testid="work-bar-pill"
            aria-label={`${nowText}. ${n && full ? `${t('work.bar.stepN', { n })}. ` : ''}${t('work.bar.showHistory')}`}
            onClick={() => setHOpen(true)} {...pointer}>
            {}
            <span className={`wbar-ic${cur.ic === 'spark' ? ' wbar-ic--mark' : ''}`} aria-hidden="true">{cur.ic === 'spark' ? <HeadMark live /> : <ActIcon n={cur.ic} state="run" />}</span>
            <span className="wbar-now" key={nowText} data-testid="work-bar-now"><b>{cur.t}</b>{cur.s && <span className="wbar-sub"> · {cur.s}</span>}</span>
            {n > 0 && full && <span className="wbar-n tnum">{t('work.bar.step', { n })}</span>}
            <Icon n="chev-up" sm className="wbar-chev" />
          </button>
        )}
      </div>
      <Popover anchor={bar.current} open={hOpen} onClose={() => setHOpen(false)} side="top" title={t('work.title')} sub={n ? t('work.steps', { n }) : undefined}
        className="wbar-pop" sheetClass="wbar-sheet" testId="work-history">
        <ol className="wbar-hist" data-testid="work-history-list">
          {hist.length === 0 && <li className="wbar-hist-empty">{t('work.bar.histEmpty')}</li>}
          {hist.map((s) => (
            <li key={s.id} className={`wbar-hist-row is-${s.status}`}>
              <ActIcon n={s.icon ?? KIND_ICON[s.kind]} state={iconState(s.status, s.recovered)} />
              <span className="wbar-hist-t"><b>{s.title}</b>{s.sub && <span>{s.sub}</span>}</span>
              <span className="sr">{statusSpoken(s, t.lang)}</span>
              {s.status === 'err' ? <span className="wbar-hist-st is-err">{t('work.st.err')}</span> : s.status === 'wait' ? <span className="wbar-hist-st">{t('work.st.wait')}</span> : null}
            </li>
          ))}
        </ol>
        {onShowFeed && <button type="button" className="btn btn--ghost wbar-all" onClick={() => { setHOpen(false); onShowFeed(m.id); }} data-testid="work-history-all">{t('work.bar.all')}<Icon n="arrow-right" sm /></button>}
      </Popover>
    </>
  );
}

function Announcer({ m, items }: { m: MsgView | null; items: ReturnType<typeof buildFeed> }) {
  const t = useT();
  const [msg, setMsg] = useState('');
  const [alert, setAlert] = useState('');
  const st = useRef({ kind: '', n: 0, at: 0, pending: 0, live: false, errs: new Set<string>(), asked: new Set<string>(), t: 0 as number | ReturnType<typeof setTimeout> });
  const live = !!m?.streaming && !m?.content;
  const now = nowOf(items);
  const n = countSteps(items);
  useEffect(() => {
    const s = st.current;
    const say = (t: string) => { setMsg(''); requestAnimationFrame(() => setMsg(t)); s.at = Date.now(); s.pending = 0; };
    if (live && !s.live) { s.live = true; s.n = n; say(t('work.ann.start')); return; }
    if (!live && s.live) { s.live = false; if (n) say(t('work.ann.done', { n })); return; }
    if (!live) return;
    for (const it of items) {
      const steps = it.t === 'step' ? [it.step] : it.t === 'group' ? it.steps : [];
      for (const x of steps) {
        if (x.status === 'err' && !s.errs.has(x.id)) { s.errs.add(x.id); say(t('work.ann.failed', { title: x.title })); }
        if (x.status === 'wait' && !s.asked.has(x.id)) { s.asked.add(x.id); setAlert(''); requestAnimationFrame(() => setAlert(t('work.ann.ask', { text: x.ask?.text ?? x.title }))); }
      }
    }
    if (now?.kind === 'step' && now.step.kind !== s.kind) {
      const kind = now.step.kind;
      const go = () => { s.kind = kind; say(`${kindName(kind, t.lang)}: ${now.step.title}${now.step.sub ? ' ' + now.step.sub : ''}`); };
      if (Date.now() - s.at > 5000) go();
      else {
        s.pending += Math.max(0, n - s.n);
        clearTimeout(s.t as ReturnType<typeof setTimeout>);
        s.t = setTimeout(go, Math.max(0, 5000 - (Date.now() - s.at)));
      }
    } else if (n > s.n && Date.now() - s.at > 5000 && s.pending > 0) {
      say(t('work.ann.more', { n: s.pending }));
    }
    s.n = n;
  }, [live, n, now, items]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="sr" role="status" aria-live="polite" aria-atomic="true" data-testid="work-announce">{msg}</div>
      <div className="sr" role="alert" aria-atomic="true">{alert}</div>
    </>
  );
}
