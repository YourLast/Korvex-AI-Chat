'use client';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ActIcon } from './ActIcon';
import { HeadMark } from './HeadMark';
import { Markdown, thumbClick } from './Markdown';
import { thumbSrc } from './OutImage';
import { closeOpen } from './ToolSteps';
import { useWork } from './WorkCtx';
import { DiffView } from './code/DiffView';
import { serverNow } from '@/lib/clock';
import { LANGS, tr, type Lang } from '@/lib/i18n/core';
import { useT, type T } from '@/lib/i18n/react';
import {
  KIND_ICON, allSteps, buildFeed, countSteps, diffStat, fmtDur, kindName, nowOf, statusSpoken, statusText, summaryLine, turnSettled,
  type Attachment, type StepEvent, type WItem, type WStep,
} from '@/lib/work';
import { COLLAPSE_MS, SETTLE_MS, atBottom, easeOut, holdOf, initView, reduceView, userInput, viewOf, type ViewState } from '@/lib/workView';
import { iconState } from '@/lib/actIcons';
import type { HmPose } from '@/lib/headMark';
import '@/styles/work.css';

export type LiveReq = { step: WStep; all: WStep[] };
export type Decision = boolean | 'open';

export function Elapsed({ since, min = 3000 }: { since: number; min?: number }) {
  const { lang } = useT();
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 1000); return () => clearInterval(t); }, []);
  const ms = Math.max(0, now - since);
  if (ms < min) return null;
  return <span className="tnum wk-time" aria-hidden="true">{fmtDur(ms, lang)}</span>;
}

function StepStatus({ s }: { s: WStep }) {
  const tl = useT();
  if (s.status === 'run') return null;
  const t = statusText(s, tl.lang);
  if (!t) return null;
  const cls = s.status === 'err' || (s.http ?? 0) >= 400 ? 'is-err' : s.status === 'timeout' ? 'is-warn' : s.status === 'wait' ? 'is-wait' : s.status === 'denied' || s.status === 'stopped' ? 'is-off' : '';
  return <span className={`wk-st ${cls}`} data-testid="work-status">{t}</span>;
}

const ANSI_RE = /\x1b\[([0-9;]*)m/g;
const ANSI_CLS: Record<string, string> = { '31': 'r', '91': 'r', '32': 'g', '92': 'g', '33': 'y', '93': 'y', '34': 'b', '94': 'b', '35': 'm', '95': 'm', '36': 'c', '96': 'c', '90': 'k', '2': 'k' };
const outWords = (...keys: Parameters<typeof tr>[1][]) => keys.flatMap((k) => LANGS.map((l) => tr(l, k)));
const startsAny = (line: string, words: string[]) => words.some((w) => line.startsWith(w));
let OUT_BAD: string[] | null = null, OUT_STOP: string[] | null = null, OUT_OK: string[] | null = null, OUT_NONE: string[] | null = null;
export function ansiLine(line: string): { c: string; s: string }[] {
  if (!line.includes('\x1b[')) {
    OUT_BAD ??= outWords('work.out.failed', 'work.out.error', 'work.out.noResult', 'work.out.noStart').map((w) => w.replace(/\{\w+\}/g, ''));
    OUT_STOP ??= outWords('work.out.timeout'); OUT_OK ??= outWords('work.out.saved').map((w) => w.replace(/\{\w+\}.*$/, '')); OUT_NONE ??= outWords('work.out.noOutput');
    const c = /^(Traceback|\w*Error\b|error:|fatal:|Не удалось)/.test(line) || startsAny(line, OUT_BAD) ? 'r'
      : /^(warning:|Warning|WARN)/i.test(line) || /^Остановлено/i.test(line) || startsAny(line, OUT_STOP) ? 'y' : /^(✓|ok\b|OK\b|PASS|passed)/.test(line) || startsAny(line, OUT_OK) ? 'g' : OUT_NONE.includes(line) ? 'k' : '';
    return [{ c, s: line }];
  }
  const out: { c: string; s: string }[] = [];
  let cur = '', last = 0, m: RegExpExecArray | null;
  ANSI_RE.lastIndex = 0;
  while ((m = ANSI_RE.exec(line))) {
    if (m.index > last) out.push({ c: cur, s: line.slice(last, m.index) });
    const codes = m[1].split(';');
    cur = m[1] === '' || codes.includes('0') ? '' : codes.map((k) => ANSI_CLS[k]).filter(Boolean).pop() ?? cur;
    last = ANSI_RE.lastIndex;
  }
  if (last < line.length) out.push({ c: cur, s: line.slice(last) });
  return out;
}

export function Terminal({ s }: { s: WStep }) {
  const tl = useT();
  const t = s.term!;
  const py = t.lang === 'python';
  const body = useRef<HTMLPreElement>(null);
  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [t.out.length]);
  const fail = s.status === 'err' || s.status === 'timeout';
  return (
    <div className="wk-term" data-testid="work-term">
      <pre className="wk-term-body" ref={body} tabIndex={0} role="region" aria-label={py ? tl('work.term.pyAria') : tl('work.term.bashAria')}>
        {t.cmd && (t.code && !py
          ? <span className="wk-term-cmd"><span className="wk-term-ps" aria-hidden="true">$ </span>{t.cmd}{'\n'}</span>
          : <span className="wk-term-cmd wk-term-cap"><span className="wk-term-ps" aria-hidden="true"># </span>{t.cmd}{'\n'}</span>)}
        {t.out.map((l, i) => <span key={i}>{ansiLine(l).map((p, k) => <span key={k} className={p.c ? `a-${p.c}` : undefined}>{p.s}</span>)}{'\n'}</span>)}
        {t.more && <span className="a-k">…{'\n'}</span>}
        {s.status === 'run' && <span className="wk-term-caret" aria-hidden="true" />}
      </pre>
      {fail && <p className={`wk-term-end${s.recovered ? ' is-recovered' : ''}`} data-testid="work-term-end">{s.status === 'timeout' ? tl('work.out.timeout') : t.out.find((l) => /(?:код|code|kôd|kod) -?\d+/i.test(l)) ?? tl('work.out.failed')}</p>}
    </div>
  );
}

export function AskButtons({ s, onDecide, big, onLive }: { s: WStep; onDecide?: (s: WStep, d: Decision) => void; big?: boolean; onLive?: (s: WStep) => void }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState<null | boolean>(null);
  const slow = /оплат|купи|удал|плат|₽|\$|€|\bpay|\bbuy|\bpurchas|\bdelet|\bremov|plati|plać|kupi|kupov|obriš|brisa/i.test(`${s.ask?.text ?? ''} ${s.ask?.allow ?? ''}`);
  useEffect(() => { const t = setTimeout(() => setArmed(true), slow ? 1200 : 600); return () => clearTimeout(t); }, [slow, s.id]);
  const go = (allow: boolean) => { if (!armed || sent !== null || !onDecide) return; setSent(allow); onDecide(s, allow); };
  return (
    <>
    {s.kind === 'browser' && s.live && onLive && (
      <button type="button" className="btn btn--ghost wk-ask-open" onClick={() => onLive(s)} data-testid="ask-open-browser"><Icon n="eye" sm />{t('work.openBrowser')}</button>
    )}
    <div className={`wk-ask${big ? ' wk-ask--big' : ''}`} data-armed={armed || undefined} data-testid="work-ask">
      <button type="button" className="btn wk-ask-deny" onClick={() => go(false)} aria-disabled={!armed || sent !== null} data-testid="ask-deny">{s.ask?.deny || t('work.deny')}</button>
      <button type="button" className="btn btn--primary wk-ask-allow" onClick={() => go(true)} aria-disabled={!armed || sent !== null} data-testid="ask-allow">{s.ask?.allow || t('work.allow')}</button>
    </div>
    </>
  );
}

export function leftText(ms: number, lang: Lang): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s <= 60 ? tr(lang, 'work.dur.s', { s }) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function useLeft(until: number | undefined): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

export function CheckCard({ s, onDecide, onLive, big }: { s: WStep; onDecide?: (s: WStep, d: Decision) => void; onLive?: (s: WStep) => void; big?: boolean }) {
  const t = useT();
  const c = s.check!;
  const left = useLeft(c.until);
  const [sent, setSent] = useState(false);
  const pass = () => { onDecide?.(s, 'open'); onLive?.(s); };
  const end = (ok: boolean) => { if (sent || !onDecide) return; setSent(true); onDecide(s, ok); };
  return (
    <div className={`wk-check${big ? ' wk-check--big' : ''}`} role="group" aria-label={t('work.check.aria', { host: c.host })} data-testid="check-card" data-open={c.open ? '' : undefined}>
      <p className="wk-check-t">
        <b>{t('work.check.title')}</b>
        <span className="wk-check-sub" data-testid="check-left"><span className="wk-host">{c.host}</span> · <span className="tnum">{t('work.check.wait', { t: leftText(left, t.lang) })}</span></span>
      </p>
      <div className="wk-check-act">
        {c.open ? (
          <>
            {onLive && <button type="button" className="btn btn--ghost" onClick={() => onLive(s)} data-testid="check-reopen">{t('work.openBrowser')}</button>}
            <button type="button" className="btn btn--primary" onClick={() => end(true)} aria-disabled={sent || !onDecide} data-testid="check-done">{t('work.check.done')}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => end(false)} aria-disabled={sent || !onDecide} data-testid="check-skip">{t('work.check.skip')}</button>
            <button type="button" className="btn btn--primary" onClick={pass} aria-disabled={!onLive} data-testid="check-pass">{t('work.check.pass')}</button>
          </>
        )}
      </div>
    </div>
  );
}

function RichText({ text }: { text: string }) {
  const t = useT();
  const parts: { k: 'text' | 'out'; v: string }[] = [];
  const re = /```(\w*)\n([\s\S]*?)\n?```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === 'diff' || m[1] === 'patch') { if (m.index > last) parts.push({ k: 'text', v: text.slice(last, m.index) }); last = m.index + m[0].length; continue; }
    if (m.index > last) parts.push({ k: 'text', v: text.slice(last, m.index) });
    parts.push({ k: 'out', v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ k: 'text', v: text.slice(last) });
  return (
    <>
      {parts.map((p, i) => p.k === 'out'
        ? <pre key={i} className="wk-term-body wk-term-solo" tabIndex={0} role="region" aria-label={t('work.output')}>{p.v.split('\n').map((l, j) => <span key={j}>{ansiLine(l).map((x, k) => <span key={k} className={x.c ? `a-${x.c}` : undefined}>{x.s}</span>)}{'\n'}</span>)}</pre>
        : p.v.trim() ? <div key={i} className="wk-text think-md" data-testid="work-text"><Markdown text={p.v.trim()} /></div> : null)}
    </>
  );
}

function Detail({ s, onDecide }: { s: WStep; onDecide?: (s: WStep, d: Decision) => void }) {
  const t = useT();
  return (
    <>
      {s.term && <Terminal s={s} />}
      {s.diff?.length && s.diffRaw ? (
        <div className="wk-diff" data-testid="work-diff">
          <div className="wk-diff-h">
            <b>{t('work.diffChanged', { n: s.diff.length })}</b>
            <span className="tnum"><b className="a-g">+{diffStat(s.diff).add}</b> <b className="a-r">−{diffStat(s.diff).del}</b></span>
          </div>
          <DiffView diff={s.diffRaw.endsWith('\n') ? s.diffRaw : s.diffRaw + '\n'} />
        </div>
      ) : null}
      {s.agent && (
        <div className="wk-agent" data-testid="work-agent">
          <p className="wk-agent-q"><span className="wk-agent-who">{t('work.agentAsk', { title: s.agent.threadTitle })}</span>{s.agent.question}</p>
          {s.agent.answer && <p className="wk-agent-a"><span className="wk-agent-who">{t('work.agentAnswer')}</span>{s.agent.answer}</p>}
          <a className="lnk wk-agent-go" href={`/c/${s.agent.threadId}${s.agent.messageId ? `#m-${s.agent.messageId}` : ''}`}>{t('work.openChat')}</a>
        </div>
      )}
      {s.search && <SearchDetail info={s.search} />}
      {s.text && !s.term && <RichText text={s.text} />}
      {s.kids?.length ? <ol className="wk-sublist">{s.kids.map((k) => <StepRow key={k.id} s={k} nested onDecide={onDecide} />)}</ol> : null}
    </>
  );
}

function SearchDetail({ info }: { info: NonNullable<WStep['search']> }) {
  const t = useT();
  const shown = info.groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="wk-search" data-testid="work-search" tabIndex={0} aria-label={t('work.searchAria')}>
      {info.groups.map((g) => (
        <section key={g.name} className="wk-sq">
          <h4>{g.name} <span className="tnum">{g.items.length}</span></h4>
          <ul>{g.items.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </section>
      ))}
      {info.more && shown < info.total && <p className="wk-sq-more">{t('work.searchMore', { n: info.total - shown })}</p>}
      {info.pages?.length ? (
        <section className="wk-sq">
          <h4>{t('work.pagesRead')} <span className="tnum">{info.pages.length}</span></h4>
          <ul className="wk-pages">{info.pages.map((p, i) => <li key={i}><span className="wk-host">{p.host}</span>{p.label && <span className="wk-tag">{p.label}</span>}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

const nameOf = (s: WStep, lang: Lang) => `${kindName(s.kind, lang)}. ${s.title}${s.sub ? ' ' + s.sub : ''}. ${statusSpoken(s, lang)}`;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const isBrowser = (s: WStep) => s.kind === 'browser' && !!(s.live || s.shots?.length || s.thumb);

export const StepRow = memo(function StepRow({ s, onLive, onDecide, nested, fresh, askInBar }: {
  s: WStep; onLive?: (s: WStep) => void; onDecide?: (s: WStep, d: Decision) => void; nested?: boolean; fresh?: boolean; askInBar?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shown = useWork()?.liveId === s.id;
  const live = isBrowser(s) && !!onLive;
  const hasDetail = !!(s.term || s.diff?.length || s.text || s.agent || s.kids?.length || s.search);
  const press = () => { if (live) onLive!(s); else if (hasDetail) setOpen(!open); };
  const steer = s.kind === 'steer';
  const head: ReactNode = (
    <>
      <span className="wk-ic" aria-hidden="true"><ActIcon n={s.icon ?? KIND_ICON[s.kind]} state={iconState(s.status, s.recovered)} quiet /></span>
      <span className="wk-line">
        <b className="wk-title">{s.title}{steer ? ':' : ''}</b>
        {s.sub && <span className="wk-sub" data-testid="work-sub">{s.sub}</span>}
      </span>
      <StepStatus s={s} />
      {!s.thumb && (live ? <Icon n="eye" sm className="wk-chev" /> : hasDetail ? <Icon n="chev-right" sm className="wk-chev" /> : null)}
    </>
  );
  return (
    <li className={`wk-step is-${s.status}${s.recovered ? ' is-recovered' : ''}${open ? ' is-open' : ''}${nested ? ' is-nested' : ''}${s.thumb ? ' has-thumb' : ''}${steer ? ' is-steer' : ''}${fresh ? ' wk-in' : ''}${shown ? ' is-shown' : ''}${s.search ? ' is-wide' : ''}`} aria-current={shown ? 'true' : undefined}
      data-testid="work-step" data-kind={s.kind} data-status={s.status} data-id={s.id}>
      <div className="wk-row">
        {live || hasDetail ? (
          <button type="button" className="wk-head" onClick={press} aria-expanded={!live ? open : undefined} aria-label={live ? `${nameOf(s, t.lang)}. ${t('work.watchBrowser')}` : nameOf(s, t.lang)}
            data-testid={live ? 'work-live-open' : 'work-head'}>{head}</button>
        ) : <div className="wk-head">{head}<span className="sr">. {statusSpoken(s, t.lang)}</span></div>}
        {s.thumb && <Thumb a={s.thumb} label={`${s.title}${s.sub ? ' ' + s.sub : ''}`} run={s.status === 'run'} />}
      </div>
      {s.status === 'err' && s.recovered && <p className="wk-retried" data-testid="work-retried"><ActIcon n="retry" px={14} /><span>{cap(t('work.st.retried'))}</span></p>}
      {s.status === 'wait' && s.check && !askInBar && <CheckCard s={s} onDecide={onDecide} onLive={onLive} />}
      {s.status === 'wait' && s.ask && !s.check && !askInBar && (
        <div className="wk-wait">
          <p className="wk-wait-q">{s.ask.text}</p>
          <AskButtons s={s} onDecide={onDecide} onLive={onLive} />
        </div>
      )}
      {open && hasDetail && <div className="wk-detail"><Detail s={s} onDecide={onDecide} /></div>}
    </li>
  );
});

function Thumb({ a, label, run }: { a: Attachment; label: string; run: boolean }) {
  const t = useT();
  return (
    <button type="button" className={`wk-thumb iv-thumb${run ? ' is-run' : ''}`} data-iv="" data-iv-src={a.url} data-iv-name={a.name || label} data-testid="work-thumb"
      data-iv-w={a.w || undefined} data-iv-h={a.h || undefined}
      aria-label={t('work.shotAria', { label })} onClick={(e) => thumbClick(e, a.url)}>
      {}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumbSrc(a.url, 160)} alt="" loading="lazy" decoding="async" draggable={false} width={a.w} height={a.h} />
    </button>
  );
}

function groupTitle(steps: WStep[], t: T, host?: string): [string, string] {
  const n = steps.length, k = steps[0].kind;
  const last = steps[steps.length - 1];
  const running = steps.some((s) => s.status === 'run');
  const vp = (id: string) => tr(t.lang, `work.v.${id}` as Parameters<typeof tr>[1]).split('|')[running ? 0 : 1];
  if (k === 'browser') {
    const bad = steps.filter((s) => (s.http ?? 0) >= 400).length;
    return running ? [`${host ?? t('work.kind.browser')}:`, last.title.charAt(0).toLowerCase() + last.title.slice(1)]
      : [`${host ?? t('work.kind.browser')} · ${t('work.actions', { n })}`, bad ? t('work.badPages', { n: bad }) : ''];
  }
  if (k === 'bash') return [`${vp('exec')} ${t('work.cmds', { n })}`, last.sub ?? ''];
  if (k === 'web' && steps.some((s) => s.search || s.wide)) {
    const q = steps.reduce((a, s) => a + (s.wide?.queries || 1), 0);
    const pg = steps.reduce((a, s) => a + (s.wide?.read || 0), 0);
    return [`${t(running ? 'work.g.webNow' : 'work.g.webDone')} · ${t('work.queries', { n: q })}`, pg ? t('work.pages', { n: pg }) : ''];
  }
  if (k === 'web' || k === 'memory') {
    const found = steps.reduce((a, s) => a + (Number(/^(\d+)/.exec(s.result ?? '')?.[1]) || 0), 0);
    return [`${t(k === 'memory' ? (running ? 'work.g.memNow' : 'work.g.memDone') : running ? 'work.g.webNow' : 'work.g.webDone')} · ${t('work.queries', { n })}`, found ? t('work.sources', { n: found }) : ''];
  }
  return [`${t(`work.kind.${k}` as const)} · ${n}`, ''];
}

function GroupRow({ steps, host, onLive, onDecide, fresh, askInBar }: { steps: WStep[]; host?: string; onLive?: (s: WStep) => void; onDecide?: (s: WStep, d: Decision) => void; fresh?: boolean; askInBar?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = steps.some((s) => s.status === 'run');
  const thumb = [...steps].reverse().find((s) => s.thumb)?.thumb;
  const [title, sub] = groupTitle(steps, t, host);
  const k = steps[0].kind;
  const browser = k === 'browser' && !!onLive && steps.some(isBrowser);
  const last = steps[steps.length - 1];
  const liveId = useWork()?.liveId;
  const shown = !!liveId && steps.some((x) => x.id === liveId || x.kids?.some((k) => k.id === liveId));

  return (
    <li className={`wk-step wk-group${open ? ' is-open' : ''}${running ? ' is-run' : ''}${thumb ? ' has-thumb' : ''}${fresh ? ' wk-in' : ''}${shown ? ' is-shown' : ''}`} aria-current={shown ? 'true' : undefined} data-testid="work-group" data-kind={k} data-n={steps.length}>
      <div className="wk-row">
        <button type="button" className="wk-head" aria-expanded={browser ? undefined : open} onClick={() => (browser ? onLive!(last) : setOpen(!open))}
          aria-label={`${title}${sub ? ' ' + sub : ''}. ${t(running ? 'work.st.running' : 'work.st.done')}${browser ? '. ' + t('work.watchBrowser') : ''}`} data-testid={browser ? 'work-live-open' : 'work-head'}>
          <span className="wk-ic" aria-hidden="true"><ActIcon n={KIND_ICON[k]} state={running ? 'run' : 'ok'} quiet /></span>
          <span className="wk-line"><b className="wk-title">{title}</b>{sub && <span className="wk-sub">{sub}</span>}</span>
          {!thumb && <Icon n={browser ? 'eye' : 'chev-right'} sm className="wk-chev" />}
        </button>
        {thumb && <Thumb a={thumb} label={title} run={running} />}
      </div>
      {open && (
        <ol className="wk-sublist">
          {steps.map((s) => <StepRow key={s.id} s={s} onLive={onLive} onDecide={onDecide} nested askInBar={askInBar} />)}
        </ol>
      )}
    </li>
  );
}

const Thought = memo(function Thought({ text, live, fresh }: { text: string; live: boolean; fresh?: boolean }) {
  return (
    <li className={`wk-think${live ? ' is-live' : ''}${fresh ? ' wk-in' : ''}`} data-testid="work-think">
      <div className="wk-think-in think-md"><Markdown text={live ? closeOpen(text) : text} live={live} /></div>
    </li>
  );
});

export function WorkList({ items, live, onLive, onDecide, steps, askInBar }: { items: WItem[]; live: boolean; onLive?: (s: WStep) => void; onDecide?: (s: WStep, d: Decision) => void; steps?: number; askInBar?: boolean }) {
  const t = useT();
  const n = steps ?? countSteps(items);
  const seen = useRef<Set<string> | null>(null);
  const ids = items.map((it) => (it.t === 'step' ? it.step.id : it.id));
  const first = seen.current === null;
  if (first) seen.current = new Set(ids);
  const fresh = (id: string) => !first && live && !seen.current!.has(id);
  useEffect(() => { ids.forEach((id) => seen.current!.add(id)); });
  const list = useRef<HTMLOListElement>(null);
  return (
    <ol className="wk-list" ref={list} aria-label={`${t('work.title')}: ${t('work.steps', { n })}`} data-testid="work-list">
      {items.map((it) => {
        if (it.t === 'step') return <StepRow key={it.step.id} s={it.step} onLive={onLive} onDecide={onDecide} fresh={fresh(it.step.id)} askInBar={askInBar} />;
        if (it.t === 'group') return <GroupRow key={it.id} steps={it.steps} host={it.host} onLive={onLive} onDecide={onDecide} fresh={fresh(it.id)} askInBar={askInBar} />;
        if (it.t === 'note') return <li key={it.id} className="wk-note" data-testid="tool-note"><ActIcon n={it.kind === 'check' ? 'retry' : 'doc'} /><span>{it.text}</span></li>;
        return <Thought key={it.id} text={it.text} live={it.live} fresh={fresh(it.id)} />;
      })}
    </ol>
  );
}

export type WorkMsg = { id?: string; reasoning?: string | null; steps?: StepEvent[] | null; streaming?: boolean; rStartedAt?: number | null; reasoningMs?: number | null; startedAt?: number; phase?: string; content?: string; meta?: { durationMs?: number; error?: string | null; errorUser?: string | null; stopped?: boolean } | null };

export function useFeed(m: WorkMsg): WItem[] {
  const { lang } = useT();
  const evs = m.steps;
  const raw = m.reasoning ?? '';
  const live = !!m.streaming && !!m.rStartedAt;
  const done = !m.streaming;
  const calm = turnSettled(m);
  return useMemo(() => buildFeed(raw, evs ?? [], live, done, lang, calm), [raw, evs, live, done, lang, calm]);
}

const anchorTop = (el: HTMLElement, a: Element | null) => (a?.isConnected ? a.getBoundingClientRect().top : el.getBoundingClientRect().bottom);
const restick = (sc: HTMLElement | null) => { sc?.dispatchEvent(new Event('scroll')); };
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function WorkFeed({ m, onLive, onDecide, askInBar }: { m: WorkMsg; onLive?: (r: LiveReq) => void; onDecide?: (s: WStep, d: Decision) => void; askInBar?: boolean }) {
  const t = useT();
  const items = useFeed(m);
  const live = !!m.streaming;
  const working = live && !m.content;
  const steps = allSteps(items);
  const waiting = steps.some((s) => s.status === 'wait');
  const [vs, setVs] = useState<ViewState>(() => initView(live));
  const view = viewOf(vs, waiting);
  const vsRef = useRef(vs), viewRef = useRef(view);
  vsRef.current = vs; viewRef.current = view;
  const has = items.length > 0;
  const sec = useRef<HTMLElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const touchAt = useRef(0);
  const anim = useRef(0);
  const fix = useRef<{ sc: HTMLElement; a: Element | null; a0: number } | null>(null);
  const act = useRef<{ row?: Element; top?: number } | null>(null);
  const sc = () => sec.current?.closest('.thread') as HTMLElement | null;

  const wasWorking = useRef(working);
  useEffect(() => {
    if (working && !wasWorking.current) setVs((s) => reduceView(s, { t: 'live' }));
    wasWorking.current = working;
  }, [working]);

  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = 0;
    const b = win.current;
    if (b) { b.style.height = ''; b.style.opacity = ''; b.style.overflow = ''; }
    const f = fix.current;
    if (f) { fix.current = null; f.sc.style.overflowAnchor = ''; }
  };

  const wasLive = useRef(live);
  useEffect(() => {
    const was = wasLive.current;
    wasLive.current = live;
    if (live) { stopAnim(); return; }
    if (!was) return;
    const id = window.setTimeout(() => {
      const s = vsRef.current, el = sec.current, b = win.current, root = sc();
      if (s.user !== null || s.auto === 'line') return;
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      const v = root?.getBoundingClientRect(), r = b?.getBoundingClientRect();
      const hold = !!el && holdOf({
        focus: el.contains(document.activeElement),
        selection: !!sel && !sel.isCollapsed && !!sel.anchorNode && el.contains(sel.anchorNode),
        paused: !!b && !follow.current,
        onScreen: !!v && !!r && r.height > 0 && r.bottom > v.top && r.top < v.bottom,
      });
      const done = () => { anim.current = 0; setVs((x) => reduceView(x, { t: 'settle', hold })); };
      if (hold || viewRef.current !== 'window' || !el || !b || !root || !v || !r || el.offsetParent === null) { done(); return; }
      const a = el.nextElementSibling;
      const a0 = anchorTop(el, a);
      if (a0 < v.bottom) { fix.current = { sc: root, a, a0 }; root.style.overflowAnchor = 'none'; }
      if (reducedMotion() || r.bottom <= v.top || r.top >= v.bottom) { done(); return; }
      const h0 = b.offsetHeight, t0 = performance.now();
      b.style.overflow = 'hidden';
      const frame = (now: number) => {
        const k = easeOut((now - t0) / COLLAPSE_MS);
        b.style.height = `${h0 * (1 - k)}px`;
        b.style.opacity = String(1 - k);
        const f = fix.current;
        if (f) f.sc.scrollTop += anchorTop(el, f.a) - f.a0;
        if (k < 1) anim.current = requestAnimationFrame(frame); else done();
      };
      anim.current = requestAnimationFrame(frame);
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const f = fix.current, el = sec.current;
    if (f && view === 'line' && el) {
      fix.current = null;
      f.sc.scrollTop += anchorTop(el, f.a) - f.a0;
      requestAnimationFrame(() => requestAnimationFrame(() => { f.sc.style.overflowAnchor = ''; }));
    }
    const u = act.current;
    if (u) {
      act.current = null;
      const root = sc();
      if (root && u.row?.isConnected && u.top !== undefined) root.scrollTop += u.row.getBoundingClientRect().top - u.top;
      restick(root);
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (view !== 'window') return;
    const b = win.current, list = b?.firstElementChild;
    if (!b) return;
    follow.current = true;
    b.scrollTop = b.scrollHeight;
    lastTop.current = b.scrollTop;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (follow.current) { b.scrollTop = b.scrollHeight; lastTop.current = b.scrollTop; } });
    ro.observe(list);
    return () => ro.disconnect();
  }, [view, has]);
  const onWinScroll = () => {
    const b = win.current;
    if (!b || anim.current) return;
    const top = b.scrollTop;
    if (atBottom(b.scrollHeight, top, b.clientHeight)) follow.current = true;
    else if (top < lastTop.current - 1 && userInput(touchAt.current)) follow.current = false;
    lastTop.current = top;
  };
  const touched = () => { touchAt.current = Date.now(); };
  const onWinClick = (e: MouseEvent) => {
    const row = (e.target as Element).closest?.('button.wk-head[aria-expanded]');
    if (!row || view !== 'window') return;
    stopAnim();
    act.current = { row, top: row.getBoundingClientRect().top };
    setVs((s) => reduceView(s, { t: 'tap', view: 'window' }));
  };
  const tap = () => {
    stopAnim();
    act.current = {};
    setVs((s) => reduceView(s, { t: 'tap', view }));
  };

  const now = nowOf(items);
  const n = countSteps(items);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<{ id: string }>).detail?.id === m.id) { stopAnim(); setVs((s) => reduceView(s, { t: 'open' })); } };
    window.addEventListener('kx:work-open', on);
    return () => window.removeEventListener('kx:work-open', on);
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopAnim(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  const ms = (n ? m.meta?.durationMs : null) ?? m.reasoningMs ?? null;
  const errs = steps.some((s) => s.status === 'err' && !s.recovered);
  const failed = !working && !!(m.meta?.error || m.meta?.errorUser);
  const stopped = !working && !failed && !!m.meta?.stopped;
  const openLive = onLive ? (s: WStep) => onLive({ step: s, all: steps.filter(isBrowser) }) : undefined;
  const sum = summaryLine(items, ms, (x) => fmtDur(x, t.lang), t.lang);
  const low = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  const open = view !== 'line';
  const endPose: HmPose | null = working ? null : failed ? 'error' : stopped ? 'stop' : errs ? 'error' : 'check';
  return (
    <section ref={sec} className={`wk${working ? ' wk--live' : ''}${open ? ' is-open' : ''}${view === 'window' ? ' is-win' : ''}`} data-testid="reasoning" data-work="" data-view={view} aria-label={t('work.title')}>
      <button type="button" className="wk-sum" aria-expanded={open} onClick={tap} data-testid="work-summary">
        <span className="wk-sum-ic wk-sum-ic--mark" aria-hidden="true" data-end={endPose ?? undefined}><HeadMark live={working} end={endPose} calm={working && open && now?.kind === 'step'} /></span>
        {working ? (
          <span className="wk-sum-t" data-testid="work-now">
            <b className={working ? 'wk-shim' : undefined}>{n ? t('work.working') : t('work.thinking')}</b>
            {m.startedAt ? <Elapsed since={m.startedAt} min={0} /> : null}
          </span>
        ) : (
          <span className="wk-sum-t" data-testid="work-done"><b>{failed ? `${t('work.st.errCap')} · ${low(sum)}`
            : stopped ? `${t('work.st.stoppedCap')} · ${low(sum)}` : sum}</b></span>
        )}
        <Icon n="chev-right" sm className="wk-chev" />
      </button>
      {open && (
        <div ref={win} className={`wk-body${view === 'window' ? ' is-win' : ''}`} data-testid="work-body" onScroll={view === 'window' ? onWinScroll : undefined} onClickCapture={view === 'window' ? onWinClick : undefined}
          onWheel={touched} onTouchStart={touched} onTouchMove={touched} onPointerDown={touched} onKeyDown={touched}>
          <WorkList items={items} live={live} onLive={openLive} onDecide={onDecide} steps={n} askInBar={askInBar} />
        </div>
      )}
    </section>
  );
}
