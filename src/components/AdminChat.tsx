'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminChatData, Mark } from '@/lib/adminTypes';
import { deferredKeysFor, feedEst, feedKey, feedOf, type FeedItem } from '@/lib/feed';
import { currentIndex, navMarks, posByIndex, posOf, stepMark, summarize, viewport, type MarkFilter } from '@/lib/ratingNav';
import { count, W } from '@/lib/plural';
import { relTime } from '@/lib/schedule';
import { modelLabel } from '@/lib/levels';
import type { MsgView } from '@/lib/types';
import { AssistantMsg, UserTurn } from './Message';
import { PairTurn } from './PairTurn';
import { Defer } from './Defer';
import { Icon } from './Icon';
import { ReasonTags, when } from './AdminBits';
import { Seg, ToastHost } from './Kit';
import { Topbar, useShell } from './Shell';

const ANCHOR = 72;
const FILTERS: { value: MarkFilter; label: string }[] = [{ value: 'all', label: 'Все' }, { value: 'down', label: 'Плохие' }, { value: 'up', label: 'Хорошие' }];

const noop = () => {};
const idsOf = (it: FeedItem): string[] => (it.kind === 'pair' ? [it.u.id, it.a?.id, it.b?.id].filter((x): x is string => !!x) : [it.m.id]);
const firstId = (it: FeedItem) => (it.kind === 'pair' ? it.u.id : it.m.id);

export function RateMark({ mk, no, of, tz }: { mk: Mark; no: number; of: number; tz: string }) {
  const down = mk.value < 0;
  return (
    <div className={`adm-mark adm-mark--${down ? 'down' : 'up'}`} data-testid="admin-mark" data-mark={mk.id} data-value={mk.value}>
      <span className="adm-mark-h">
        <Icon n="thumb" sm className={down ? 'flip' : undefined} />
        <b>{down ? 'Плохо' : 'Хорошо'}</b>
        {no > 0 && <span className="adm-mark-n tnum">оценка {no} из {of}</span>}
        <span className="adm-mark-t">{when(mk.at, tz)}</span>
      </span>
      <ReasonTags reasons={mk.reasons} comment={mk.comment} />
    </div>
  );
}

type RailProps = { marks: { m: Mark; pos: number; dim: boolean; no: number }[]; vp: { top: number; h: number }; curId: string | null; onJump: (m: Mark) => void; onSeek: (frac: number) => void };
export function Rail({ marks, vp, curId, onJump, onSeek }: RailProps) {
  const track = useRef<HTMLDivElement>(null);
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.adm-tick')) return;
    const r = track.current!.getBoundingClientRect();
    const horizontal = r.width > r.height;
    onSeek(horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };
  return (
    <div className="adm-rail" role="group" aria-label="Карта оценок по длине чата" data-testid="rating-rail">
      <div className="adm-rail-track" ref={track} onClick={seek} data-testid="rail-track">
        <span className="adm-rail-view" style={{ '--t': vp.top, '--h': vp.h } as React.CSSProperties} aria-hidden="true" data-testid="rail-view" />
        {marks.map(({ m, pos, dim, no }) => (
          <button type="button" key={m.id} className={`adm-tick adm-tick--${m.value < 0 ? 'down' : 'up'}`} style={{ '--p': pos } as React.CSSProperties}
            data-testid="rail-tick" data-mark={m.id} data-dim={dim || undefined} data-cur={m.id === curId || undefined}
            aria-label={`${m.value < 0 ? 'Плохая' : 'Хорошая'} оценка ${no}`} aria-current={m.id === curId || undefined} onClick={() => onJump(m)} />
        ))}
      </div>
    </div>
  );
}

export function AdminChat({ data, tz, focus }: { data: AdminChatData; tz: string; focus: string | null }) {
  const router = useRouter();
  const { models } = useShell();
  const { thread, owner } = data;
  const [filter, setFilter] = useState<MarkFilter>('all');
  const [cur, setCur] = useState<string | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [mids, setMids] = useState<Record<string, number>>({});
  const [vp, setVp] = useState({ top: 0, h: 1 });
  const [total, setTotal] = useState(0);
  const sc = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const settled = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);

  const feed = useMemo(() => feedOf(data.messages), [data.messages]);
  const deferred = useMemo(() => deferredKeysFor(feed, focus), [feed, focus]);
  const order = useMemo(() => new Map(data.messages.map((m, i) => [m.id, i])), [data.messages]);
  const onPath = useMemo(() => navMarks(data.marks, order, 'all'), [data.marks, order]);
  const nav = useMemo(() => navMarks(data.marks, order, filter), [data.marks, order, filter]);
  const noOf = useMemo(() => new Map(onPath.map((m, i) => [m.id, i + 1])), [onPath]);
  const byMsg = useMemo(() => new Map(data.marks.map((m) => [m.messageId, m])), [data.marks]);
  const sum = useMemo(() => summarize(data.marks), [data.marks]);
  const others = useMemo(() => data.marks.filter((m) => !m.onPath), [data.marks]);
  const mName = (id: string) => modelLabel(models, id);

  const topOf = useCallback((m: Mark) => tops[m.id] ?? (order.get(m.messageId) ?? 0) * 400, [tops, order]);

  const measure = useCallback(() => {
    const el = sc.current;
    if (!el) return;
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const t: Record<string, number> = {}, mm: Record<string, number> = {};
    for (const m of onPath) {
      const node = els.current.get(m.messageId);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      t[m.id] = r.top - base;
      mm[m.id] = r.top - base + r.height / 2;
    }
    setTops(t); setMids(mm); setTotal(el.scrollHeight);
    setVp(viewport(el.scrollTop, el.clientHeight, el.scrollHeight));
  }, [onPath]);

  useEffect(() => {
    const el = sc.current;
    if (!el) return;
    measure();
    const inner = el.firstElementChild;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro) { ro.observe(el); if (inner) ro.observe(inner); }
    window.addEventListener('resize', measure);
    const late = window.setTimeout(measure, 600);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); window.clearTimeout(late); };
  }, [measure]);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = sc.current;
      if (el) setVp(viewport(el.scrollTop, el.clientHeight, el.scrollHeight));
    });
  }, []);

  const isScrolled = () => {
    const el = sc.current;
    return !el || settled.current === null ? false : Math.abs(el.scrollTop - settled.current) > 40;
  };
  const stopJump = useCallback(() => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; }, []);
  useEffect(() => {
    const el = sc.current;
    if (!el) return;
    const cancel = () => { stopJump(); settled.current = el.scrollTop; };
    el.addEventListener('wheel', cancel, { passive: true });
    el.addEventListener('touchstart', cancel, { passive: true });
    return () => { el.removeEventListener('wheel', cancel); el.removeEventListener('touchstart', cancel); stopJump(); };
  }, [stopJump]);

  const flash = (messageId: string) => {
    const t = document.getElementById(`m-${messageId}`);
    if (!t) return;
    t.classList.add('ans--hl');
    window.setTimeout(() => t.classList.remove('ans--hl'), 2200);
  };

  const jump = useCallback((m: Mark, smooth = true) => {
    const el = sc.current;
    if (!el || !els.current.get(m.messageId)) return;
    stopJump();
    setCur(m.id); settled.current = null;
    let stable = 0;
    const pass = (n: number) => {
      const node = els.current.get(m.messageId);
      if (!node) return;
      const want = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - ANCHOR;
      const target = Math.max(0, Math.min(want, el.scrollHeight - el.clientHeight));
      if (Math.abs(el.scrollTop - target) <= 2) stable++; else { stable = 0; el.scrollTo({ top: target, behavior: n === 0 && smooth ? 'smooth' : 'auto' }); }
      if (stable >= 2 || n >= 6) { settled.current = el.scrollTop; flash(m.messageId); measure(); setVp(viewport(el.scrollTop, el.clientHeight, el.scrollHeight)); return; }
      timers.current.push(window.setTimeout(() => pass(n + 1), n === 0 && smooth ? 480 : 220));
    };
    pass(0);
  }, [measure, stopJump]);

  useEffect(() => {
    if (!focus) return;
    const mk = byMsg.get(focus);
    if (mk && mk.onPath) { jump(mk, false); return; }
    const t = window.setTimeout(() => {
      const n = els.current.get(focus), el = sc.current;
      if (n && el) { el.scrollTo({ top: Math.max(0, n.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - ANCHOR), behavior: 'auto' }); flash(focus); }
    }, 120);
    return () => window.clearTimeout(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => nav.map((m) => ({ id: m.id, y: topOf(m) })), [nav, topOf]);
  const anchor = () => (sc.current?.scrollTop ?? 0) + ANCHOR;
  const step = (dir: 1 | -1) => {
    const id = stepMark(list, dir, { cur, scrolled: isScrolled(), anchor: anchor() });
    const m = id ? nav.find((x) => x.id === id) : null;
    if (m) jump(m);
  };
  const posNo = currentIndex(list, { cur, scrolled: isScrolled(), anchor: anchor() });
  const seek = (frac: number) => {
    const el = sc.current;
    if (el) el.scrollTo({ top: Math.max(0, frac * el.scrollHeight - el.clientHeight / 2), behavior: 'smooth' });
  };
  const open = (id: string) => router.push(`/admin/chat/${thread.id}?m=${id}`);

  const rail = useMemo(() => {
    const inNav = new Set(nav.map((m) => m.id));
    return onPath.map((m) => ({ m, no: noOf.get(m.id) ?? 0, dim: !inNav.has(m.id), pos: mids[m.id] !== undefined ? posOf(mids[m.id], total) : posByIndex(order.get(m.messageId) ?? 0, data.messages.length) }));
  }, [onPath, nav, noOf, mids, total, order, data.messages.length]);

  const markOf = (m: MsgView): ReactNode => {
    const mk = byMsg.get(m.id);
    return mk ? <RateMark mk={mk} no={noOf.get(mk.id) ?? 0} of={onPath.length} tz={tz} /> : null;
  };

  const dayKey = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { timeZone: tz });
  let prevDay = '';
  const item = (it: FeedItem) => {
    if (it.kind === 'user') return <UserTurn key={it.m.id} m={it.m} onSwitch={open} />;
    if (it.kind === 'pair') {
      return <PairTurn key={`p-${it.u.id}`} u={it.u} a={it.a} b={it.b} models={models} fileNames={data.fileNames} last={false} open={false} busy={false}
        onRegen={noop} onContinue={noop} onSwitch={noop} onPick={noop} onVoted={noop} readOnly foot={markOf} />;
    }
    return <AssistantMsg key={it.m.id} m={it.m} models={models} fileNames={data.fileNames} readOnly onSwitch={open} markSlot={markOf(it.m)} />;
  };

  const meta = [mName(thread.modelId), count(data.messages.length, W.message), thread.folder ? `папка «${thread.folder}»` : '', thread.temporary ? 'временный чат' : ''].filter(Boolean).join(' · ');

  return (
    <>
      <Topbar title={thread.title} sub={`${owner.name} · только чтение`}>
        <Link href={`/admin/users/${owner.id}`} className="icon-btn" aria-label={`К карточке: ${owner.name}`} title="К карточке человека" data-testid="to-user"><Icon n="user" /></Link>
      </Topbar>
      <div className="adm-chat" data-testid="admin-chat" data-thread={thread.id}>
        <div className="adm-note adm-note--lg" data-testid="admin-note"><Icon n="eye" sm /><span>Чат: <Link href={`/admin/users/${owner.id}`}>{owner.name}</Link> ({owner.email}) · {meta}. Только чтение, просмотр записан в журнал.</span></div>
        {data.otherBranch && (
          <div className="adm-note adm-note--warn" data-testid="other-branch"><Icon n="branch" sm /><span>Показана другая версия чата — с оценённым ответом. <Link href={`/admin/chat/${thread.id}`}>Показать активную</Link></span></div>
        )}
        <div className="adm-bar" data-testid="rating-bar">
          <div className="adm-sum" data-testid="rating-sum" aria-label="Оценки в этом чате">
            <span className="adm-rate adm-rate--down"><Icon n="thumb" sm className="flip" /><b className="tnum" data-testid="sum-down">{sum.down}</b><span className="adm-lab">плохих</span></span>
            <span className="adm-rate adm-rate--up"><Icon n="thumb" sm /><b className="tnum" data-testid="sum-up">{sum.up}</b><span className="adm-lab">хороших</span></span>
          </div>
          {data.marks.length > 0 ? (
            <>
              <div className="adm-seg"><Seg label="Какие оценки показывать" value={filter} onChange={(v) => { setFilter(v); setCur(null); }} options={FILTERS.map((f) => ({ ...f, testId: `mf-${f.value}` }))} /></div>
              <div className="adm-step" role="group" aria-label="Переход по оценкам">
                <button type="button" className="adm-step-b" onClick={() => step(-1)} disabled={!nav.length} data-testid="mark-prev" aria-label="Предыдущая оценка"><Icon n="chev-up" sm /><span>Пред.</span></button>
                <span className="adm-step-n tnum" data-testid="mark-pos" aria-live="polite">{nav.length ? `${posNo} из ${nav.length}` : 'нет'}</span>
                <button type="button" className="adm-step-b" onClick={() => step(1)} disabled={!nav.length} data-testid="mark-next" aria-label="Следующая оценка"><span>След.</span><Icon n="chev-down" sm /></button>
              </div>
            </>
          ) : <span className="adm-none" data-testid="no-marks">В этом чате оценок нет</span>}
        </div>
        {others.length > 0 && (
          <div className="adm-note" data-testid="other-marks"><Icon n="layers" sm /><span>
            {count(others.length, W.rating)} на другой версии ответа:{' '}
            {others.map((m, i) => <span key={m.id}>{i > 0 && ', '}<Link href={`/admin/chat/${thread.id}?m=${m.messageId}`} data-testid="other-mark">{m.value < 0 ? 'плохая' : 'хорошая'}</Link></span>)}
          </span></div>
        )}
        <div className="adm-body">
          {onPath.length > 0 && <Rail marks={rail} vp={vp} curId={cur} onJump={(m) => jump(m)} onSeek={seek} />}
          <div className="thread" ref={sc} onScroll={onScroll} data-testid="admin-thread">
            <div className="thread-in">
              {feed.length === 0 && <p className="t-cap">В чате нет сообщений.</p>}
              {feed.map((it) => {
                const k = feedKey(it);
                const ids = idsOf(it);
                const t = data.times[firstId(it)];
                const day = t ? dayKey(t) : '';
                const sep = !!t && day !== prevDay;
                if (t) prevDay = day;
                const body = deferred.has(k) ? <Defer key={k} est={feedEst(it)}>{item(it)}</Defer> : item(it);
                return (
                  <div key={k} className="adm-item" data-mid={ids.join(' ')} ref={(el) => { for (const id of ids) { if (el) els.current.set(id, el); else els.current.delete(id); } }}>
                    {sep && <div className="adm-day" data-testid="day-sep">{relTime(t, tz)}</div>}
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <ToastHost />
    </>
  );
}
