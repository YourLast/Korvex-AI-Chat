'use client';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadLite } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import { attachPageSwipe } from '@/lib/pageSwipe';
import { fmtWhen } from '@/lib/format';
import { useT, type T } from '@/lib/i18n/react';
import { Icon } from './Icon';
import '@/styles/search.css';

export type Seg = [string, 0 | 1];
export type Hit = {
  key: string; href: string; title: Seg[]; model: string; at: number; where: 'title' | 'user' | 'answer' | 'file' | 'recent';
  snippet: Seg[] | null; marks: string[]; msgId: string | null; more: number;
};
type State = { q: string; hits: Hit[]; total: number; error?: boolean } | null;

const cache = new Map<string, { hits: Hit[]; total: number; at: number }>();

export function useChatSearch(q0: string, delay = 150): { res: State; loading: boolean } {
  const q = q0.trim();
  const [res, setRes] = useState<State>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!q) { setRes(null); setLoading(false); return; }
    const hit = cache.get(q);
    if (hit && Date.now() - hit.at < 4000) { setRes({ q, hits: hit.hits, total: hit.total }); setLoading(false); return; }
    setLoading(true);
    const my = ++seq.current;
    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal, cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { hits: Hit[]; total: number };
        if (my !== seq.current) return;
        cache.set(q, { hits: j.hits, total: j.total, at: Date.now() });
        if (cache.size > 30) cache.delete(cache.keys().next().value!);
        setRes({ q, hits: j.hits, total: j.total });
      } catch (e) {
        if ((e as Error).name === 'AbortError' || my !== seq.current) return;
        setRes({ q, hits: [], total: 0, error: true });
      } finally { if (my === seq.current) setLoading(false); }
    }, delay);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [q, delay]);
  return { res, loading };
}

export function dropSearchCache() { cache.clear(); }

function Segs({ s }: { s: Seg[] }) {
  return <>{s.map(([t, h], i) => (h ? <mark key={i} className="find-hl">{t}</mark> : <span key={i}>{t}</span>))}</>;
}

function Snip({ s, file }: { s: Seg[]; file: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const b = box.current, i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      i.style.transform = ''; b.removeAttribute('data-cut');
      const room = b.clientWidth, full = i.scrollWidth;
      if (!room || full <= room + 1) return;
      const m = i.querySelector<HTMLElement>('mark');
      const end = m ? m.offsetLeft + m.offsetWidth : 0;
      if (!m || end <= room - 12) { b.dataset.cut = 'r'; return; }
      const shift = Math.min(end - room + 32, full - room);
      i.style.transform = `translateX(${-shift}px)`;
      b.dataset.cut = full - shift > room + 1 ? 'both' : 'l';
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [s]);
  return (
    <span className="find-snip">
      {file && <Icon n="file" sm className="find-ic" />}
      <span className="find-snip-box" ref={box}><span className="find-snip-in" ref={inner}><Segs s={s} /></span></span>
    </span>
  );
}

function HitRow({ h, active, id, onPick, onHover }: { h: Hit; active: boolean; id: string; onPick: (h: Hit) => void; onHover: () => void }) {
  const t = useT();
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const compare = h.href.startsWith('/g/');
  return (
    <a ref={ref} id={id} href={h.href} role="option" aria-selected={active} className="find-row" data-testid="search-hit" data-where={h.where} data-active={active ? '' : undefined}
      onMouseMove={onHover} onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onPick(h); }}>
      <span className="find-main">
        <span className="find-t">{compare && <Icon n="columns" sm className="find-ic" />}<span className="find-t-in"><Segs s={h.title} /></span></span>
        {h.snippet && <Snip s={h.snippet} file={h.where === 'file'} />}
      </span>
      <span className="find-side">
        <time className="find-when" dateTime={new Date(h.at).toISOString()}>{fmtWhen(h.at, Date.now(), t.lang)}</time>
        <span className="find-sub">
          <span className="find-model">{h.model}</span>
          {h.more > 0 && <em className="find-more" title={t('shell.moreMatches', { n: h.more })} aria-label={t('shell.moreMatches', { n: h.more })}>+{h.more}</em>}
        </span>
      </span>
    </a>
  );
}

function emptyTip(q: string, t: T): string {
  if (/["«»“”„]/.test(q)) return t('shell.tipQuotes');
  if (q.trim().split(/\s+/).length > 1) return t('shell.tipOneWord');
  return t('shell.tipSpelling');
}

function SearchArt({ apart }: { apart?: boolean }) {
  return (
    <svg className={`find-art${apart ? ' is-apart' : ''}`} viewBox="0 0 56 56" width="56" height="56" aria-hidden="true" focusable="false">
      <rect className="fa-b" x="7" y="7" width="30" height="30" rx="8" />
      <rect className="fa-a" x="19" y="19" width="30" height="30" rx="8" />
    </svg>
  );
}

export function SearchResults({ q, res, loading, active, setActive, onPick, idBase, empty }: {
  q: string; res: State; loading: boolean; active: number; setActive: (i: number) => void; onPick: (h: Hit) => void; idBase: string; empty?: ReactNode;
}) {
  const t = useT();
  if (!q.trim()) return <>{empty}</>;
  if (!res) return <div className="find-state" aria-busy="true"><span className="find-sk" /><span className="find-sk find-sk--2" /><span className="find-sk find-sk--3" /></div>;
  if (res.error) return <div className="find-empty" role="status"><SearchArt apart /><b>{t('shell.searchDown')}</b><p>{t('shell.searchDownText')}</p></div>;
  if (!res.hits.length) {
    return loading ? <div className="find-state" aria-busy="true"><span className="find-sk" /><span className="find-sk find-sk--2" /></div> : (
      <div className="find-empty" role="status" data-testid="search-empty">
        <SearchArt apart />
        <b>{t('shell.nothingFoundTitle')}</b>
        <p>{t('shell.nothingFoundFor', { q: res.q, tip: emptyTip(res.q, t) })}</p>
      </div>
    );
  }
  return (
    <div className="find-wrap" data-loading={loading ? '' : undefined}>
      <div className="find-count" role="status">{res.total > res.hits.length ? t('shell.shownOf', { shown: res.hits.length, n: res.total }) : t('shell.foundN', { n: res.total })}</div>
      <div className="find-list" role="listbox" aria-label={t('shell.results')} id={`${idBase}-list`}>
        {res.hits.map((h, i) => <HitRow key={h.key} h={h} id={`${idBase}-${i}`} active={i === active} onPick={onPick} onHover={() => setActive(i)} />)}
      </div>
    </div>
  );
}

export function useListNav(n: number, resetKey: string) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [resetKey]);
  const onKey = useCallback((e: React.KeyboardEvent, pick: (i: number) => void) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (n ? (a + 1) % n : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (n ? (a - 1 + n) % n : 0)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing && n) { e.preventDefault(); pick(active); }
  }, [n, active]);
  return { active, setActive, onKey };
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function SearchPalette({ open, onClose, q, setQ, onPick, threads, models }: {
  open: boolean; onClose: () => void; q: string; setQ: (q: string) => void; onPick: (h: Hit) => void; threads: ThreadLite[]; models: PublicModel[];
}) {
  const tx = useT();
  const input = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  const { res, loading } = useChatSearch(open ? q : '');
  const recent = useMemo<Hit[]>(() => threads.slice(0, 8).map((t) => ({
    key: t.groupId ?? t.id, href: t.groupId ? `/g/${t.groupId}` : `/c/${t.id}`, title: [[t.title, 0]], at: t.updatedAt, where: 'recent', snippet: null, marks: [], msgId: null, more: 0,
    model: t.groupId ? tx('shell.compareHit') : models.find((m) => m.id === t.modelId)?.name ?? t.modelId,
  })), [threads, models, tx]);
  const list = q.trim() ? res?.hits ?? [] : recent;
  const { active, setActive, onKey } = useListNav(list.length, q.trim() ? (res?.q ?? '') : '');
  useEffect(() => {
    if (!open) return;
    setHelp(false);
    const back = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    document.documentElement.classList.add('sp-open');
    return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', key); document.documentElement.classList.remove('sp-open'); back?.focus?.({ preventScroll: true }); };
  }, [open, onClose]);
  const page = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = page.current;
    if (!open || !el || !window.matchMedia('(max-width: 760px)').matches) return;
    return attachPageSwipe(el, () => closeRef.current());
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  const pick = (i: number) => { const h = list[i]; if (h) onPick(h); };
  const recentView = recent.length > 0 ? (
    <div className="find-wrap">
      <div className="find-count">{tx('shell.recent')}</div>
      <div className="find-list" role="listbox" aria-label={tx('shell.recentChats')} id="sp-list">
        {recent.map((h, i) => <HitRow key={h.key} h={h} id={`sp-${i}`} active={i === active} onPick={onPick} onHover={() => setActive(i)} />)}
      </div>
    </div>
  ) : (
    <div className="find-empty" role="status" data-testid="search-blank">
      <SearchArt />
      <b>{tx('shell.searchBlankTitle')}</b>
      <p>{tx('shell.searchBlankText')}</p>
    </div>
  );
  return createPortal(
    <div className="sp-scrim" ref={page} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp" role="dialog" aria-modal="true" aria-label={tx('shell.searchChats')} data-testid="search-palette">
        <div className="sp-field">
          <button type="button" className="sp-back only-m" aria-label={tx('common.back')} onClick={onClose} data-testid="search-back"><Icon n="chev-right" /></button>
          <Icon n="search" className="sp-ic only-d" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => onKey(e, pick)} placeholder={tx('shell.searchPh')} aria-label={tx('shell.searchChats')}
            role="combobox" aria-expanded="true" aria-controls="sp-list" aria-activedescendant={list.length ? `sp-${active}` : undefined} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" autoFocus data-testid="search-input" />
          {q
            ? <button type="button" className="sp-btn" aria-label={tx('shell.clear')} onClick={() => { setQ(''); input.current?.focus(); }} data-testid="search-clear"><Icon n="x" sm /></button>
            : <button type="button" className="sp-btn sp-q" aria-label={tx('shell.searchHelp')} title={tx('shell.searchHelp')} aria-expanded={help} onClick={() => setHelp((v) => !v)} data-testid="search-help-btn">?</button>}
        </div>
        {help && !q && <p className="sp-help" role="note" data-testid="search-help">{tx('shell.searchHint')}</p>}
        <div className="sp-body">
          <SearchResults q={q} res={res} loading={loading} active={active} setActive={setActive} onPick={onPick} idBase="sp" empty={recentView} />
        </div>
        <div className="sp-foot only-d" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>{tx('shell.kbSelect')}</span><span><kbd>↵</kbd>{tx('shell.kbOpen')}</span><span><kbd>Esc</kbd>{tx('shell.kbClose')}</span></div>
      </div>
    </div>,
    document.body,
  );
}

export function SidebarSearch({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useT();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);
  return (
    <button type="button" className="sb-find" onClick={onOpenPalette} data-testid="search-open" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
      <Icon n="search" /><span>{t('shell.searchChats')}</span><kbd className="only-d">{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export function FadeText({ text }: { text: string }) {
  const prev = useRef(text);
  const [n, setN] = useState(0);
  useEffect(() => { if (prev.current !== text) { prev.current = text; setN((x) => x + 1); } }, [text]);
  return <span key={n} className={n ? 'fade-swap' : undefined}>{text}</span>;
}
