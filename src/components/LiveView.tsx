'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { useConfirm } from './Kit';
import { leftText, useLeft } from './WorkFeed';
import { attachSheetDrag } from '@/lib/sheetDrag';
import { buildFeed, quote, verbAt, type Attachment, type WItem, type WStep } from '@/lib/work';
import { tr, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import { Markdown } from './Markdown';
import type { MsgView } from '@/lib/types';
import '@/styles/live-view.css';

export type LiveAct = { type: 'click' | 'type' | 'scroll' | 'nav' | 'key' | 'move' | 'find' | 'tab'; x?: number; y?: number; label?: string; url?: string; text?: string; rect?: Rect; box?: Rect; row?: Rect; cells?: string[];
  action?: 'new' | 'select' | 'close'; id?: string; title?: string };
export type LiveTab = { id: string; i?: number; url: string; title?: string; favicon?: string | null; active?: boolean; loading?: boolean };
export const pagePath = (u: string) => u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');
export const tabsWord = (n: number, lang: Lang = 'ru') => tr(lang, 'work.live.tabs', { n });
type Rect = { x: number; y: number; w: number; h: number };
type Frame = { src: string; w: number; h: number; nw?: number };
type Zoom = { src: string; rect: Rect };

export function actText(a: LiveAct, lang: Lang = 'ru'): string {
  const q = (s?: string) => (s ? quote(s.slice(0, 40), lang) : '');
  const t = (k: Parameters<typeof tr>[1], p?: Record<string, string>) => tr(lang, k, p);
  if (a.type === 'click') return a.label ? t('work.act.click', { q: q(a.label) }) : t('work.act.clickBare');
  if (a.type === 'type') return a.label ? t('work.act.type', { q: q(a.label) }) : t('work.act.typeBare');
  if (a.type === 'scroll') return t((a.y ?? 1) < 0 ? 'work.act.up' : 'work.act.down');
  if (a.type === 'nav') return a.url === 'back' ? t('work.act.back') : a.url ? t('work.act.open', { host: hostName(a.url) }) : t('work.act.openPage');
  if (a.type === 'key') return a.label ? t('work.act.key', { key: a.label }) : t('work.act.keyBare');
  if (a.type === 'tab') { const h = a.url ? hostName(a.url) : a.title ?? ''; return a.action === 'new' ? t('work.act.tabNew', { h }).trim() : a.action === 'close' ? t('work.act.tabClose', { h }).trim() : t('work.act.tabTo', { h: h || t('work.act.tabWord') }); }
  if (a.type === 'find') { const v = foundValue(a); if (v) return v; return a.label ? t('work.act.found', { q: q(a.label) }) : t('work.act.finding'); }
  return a.label ?? '';
}
export function foundValue(a: Pick<LiveAct, 'label' | 'cells'>): string {
  const cells = (a.cells ?? []).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return '';
  const val = [...cells].reverse().find((c) => /^[-+]?\d[\d\s\u00a0]*[.,]\d+\s*[%₽$€]?$/.test(c)) ?? '';
  if (!val) return '';
  const code = cells.find((c) => /^[A-Z]{3}$/.test(c));
  const name = code ?? a.label ?? cells.find((c) => /\p{L}{3,}/u.test(c)) ?? '';
  return name ? `${name} — ${val}` : val;
}
export const hostName = (u: string) => u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
export const flyMs = (d: number) => Math.round(Math.max(160, Math.min(380, 120 + 0.35 * d)));

export function cameraAt(px: number, py: number, fw: number, fh: number, W: number, H: number, s: number, top = 0, bottom = 0): { s: number; x: number; y: number } {
  const cl = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const ah = H - top - bottom;
  const x = cl(W / 2 - px * s, W - fw * s, 0);
  const y = fh * s <= ah ? top + (ah - fh * s) / 2 : cl(top + ah / 2 - py * s, H - fh * s, 0);
  return { s, x, y };
}
export const readScale = (W: number, fw: number, H = 0, fh = 0) => Math.max(W / fw, Math.min(1.1, fh ? H / fh : W / 520));

type Shot = { a: Attachment; step: WStep; i: number };
type Line = { id: string; who: 'agent' | 'you' | 'reply' | 'now'; text: string; pending?: boolean };

const quiet = (s: WStep) => verbAt(s.title)?.id === 'scroll';
export function answerLine(content: string): string {
  return content.replace(/!\[[^\]]*\]\([^)]*\)|📎[^\n]*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`#>|]/g, '').replace(/\s+/g, ' ').trim();
}

export function chatLines(items: WItem[], content: string, max = 3, skip?: string): Line[] {
  const out: Line[] = [];
  for (const it of items) {
    const steps = it.t === 'step' ? [it.step] : it.t === 'group' ? it.steps : [];
    for (const s of steps) {
      if (s.id === skip) continue;
      if (s.kind === 'steer') out.push({ id: s.id, who: 'you', text: s.sub ?? '' });
      else if (!quiet(s)) out.push({ id: s.id, who: s.status === 'run' ? 'now' : 'agent', text: stepLine(s) });
    }
  }
  const ans = answerLine(content);
  if (ans) out.push({ id: 'answer', who: 'reply', text: ans });
  return out.filter((l) => l.text.trim()).slice(-max);
}
export const stepLine = (s: WStep) => `${s.title}${s.sub && s.kind !== 'browser' ? ' ' + s.sub : ''}${s.result ? ' · ' + s.result : ''}`;

export type CLine = Line & { md?: string };
export function convLines(conv: MsgView[], lang: Lang = 'ru'): CLine[] {
  const out: CLine[] = [];
  for (const m of conv) {
    if (m.role === 'user') { const t = (m.content ?? '').trim(); if (t) out.push({ id: `u-${m.id}`, who: 'you', text: t }); continue; }
    const items = buildFeed(m.reasoning ?? '', m.steps ?? [], !!m.streaming && !!m.rStartedAt, !m.streaming, lang);
    out.push(...chatLines(items, '', 10000));
    const md = (m.content ?? '').trim();
    if (md) out.push({ id: `a-${m.id}`, who: 'reply', text: answerLine(md), md });
  }
  return out;
}

function Clamp({ text, lead, lines = 2 }: { text: string; lead?: string; lines?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useLayoutEffect(() => {
    const el = ref.current, par = el?.parentElement;
    if (!el || !par) return;
    const fit = () => {
      const m = el.cloneNode(true) as HTMLSpanElement;
      m.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${el.getBoundingClientRect().width || par.clientWidth}px;display:block;`;
      par.appendChild(m);
      const tn = m.querySelector('[data-t]') as HTMLElement;
      const lh = parseFloat(getComputedStyle(m).lineHeight) || 18, max = lh * lines + 2;
      tn.textContent = text;
      let out = text;
      if (m.scrollHeight > max) {
        const w = text.split(' ');
        let lo = 1, hi = w.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; tn.textContent = w.slice(0, mid).join(' ') + '…'; if (m.scrollHeight <= max) lo = mid; else hi = mid - 1; }
        out = w.slice(0, lo).join(' ').replace(/[\s,;:—–-]+$/, '') + '…';
      }
      m.remove();
      setShown(out);
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(par);
    return () => ro?.disconnect();
  }, [text, lead, lines]);
  return (
    <span ref={ref} className="blv-clamp" title={shown !== text ? text : undefined}>
      <span aria-hidden="true">{lead && <b>{lead}</b>}<span data-t="">{shown}</span></span>
      <span className="sr">{lead}{text}</span>
    </span>
  );
}

const LVW_KEY = 'kx.lvw';
export function clampPanel(w: number, win: number, chatLeft: number): number {
  const max = Math.max(360, Math.min(win * 0.7, win - chatLeft - 420));
  return Math.round(Math.max(360, Math.min(max, w)));
}
const panelW = (w: number) => clampPanel(w, window.innerWidth, document.querySelector('.main')?.getBoundingClientRect().left ?? 0);

export function LiveView({ step, all, live, onClose, msg, conv, onSay, check, onCheckDone }: {
  step: WStep; all: WStep[]; live: boolean; onClose: () => void;
  check?: { id: string; host: string; until: number; open?: boolean } | null;
  onCheckDone?: () => void;
  msg?: MsgView | null;
  conv?: MsgView[];
  onSay?: (text: string) => Promise<boolean>;
}) {
  const tl = useT();
  const [mobile, setMobile] = useState(false);
  const mobileRef = useRef(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
    const on = () => { mobileRef.current = mq.matches; setMobile(mq.matches); };
    on(); mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const [confirmUi, ask] = useConfirm();
  const shots: Shot[] = useMemo(() => {
    const out: Shot[] = [];
    const seen = new Set<string>();
    for (const s of all) for (const a of [...(s.shots ?? []), ...(s.kids ?? []).flatMap((k) => k.shots ?? [])]) {
      if (seen.has(a.url)) continue; seen.add(a.url); out.push({ a, step: s.kids?.find((k) => k.shots?.includes(a)) ?? s, i: out.length });
    }
    return out;
  }, [all]);
  const startAt = useMemo(() => {
    const own = shots.filter((x) => x.step.id === step.id || step.kids?.some((k) => k.id === x.step.id));
    return own.length ? own[own.length - 1].i : Math.max(0, shots.length - 1);
  }, [shots, step]);
  const [mode, setMode] = useState<'live' | 'rec'>(live && step.live ? 'live' : 'rec');
  const [idx, setIdx] = useState(startAt);
  const host = step.host ?? all.map((s) => s.host).filter(Boolean).pop();

  const [frame, setFrame0] = useState<Frame | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const setFrame = useCallback((f: Frame | null) => { frameRef.current = f; setFrame0(f); }, []);
  const [zoom, setZoom0] = useState<Zoom | null>(null);
  const zoomAt = useRef(0);
  const zoomRef = useRef<Zoom | null>(null);
  const zoomMiss = useRef(0);
  const setZoom = useCallback((z: Zoom | null, why = '') => {
    if (!z && zoomRef.current) (window as unknown as { __kxDbg?: unknown[] }).__kxDbg?.push({ clear: why });
    zoomAt.current = z ? Date.now() : 0; zoomRef.current = z; setZoom0(z);
  }, []);
  const [cap, setCap0] = useState<{ text: string; at: number; found?: boolean; tab?: string } | null>(null);
  const activeTabRef = useRef<string | undefined>(undefined);
  const setCap = useCallback((text: string, found = false, tab?: string) => setCap0({ text, at: Date.now(), found, tab: tab ?? activeTabRef.current }), []);
  const [srCap, setSrCap] = useState('');
  const [who, setWho0] = useState<'agent' | 'user'>('agent');
  const whoRef = useRef<'agent' | 'user'>('agent');
  const setWho = useCallback((w: 'agent' | 'user') => { whoRef.current = w; setWho0(w); }, []);
  const [conn, setConn] = useState<'connecting' | 'on' | 'off' | 'closed'>('connecting');
  const [nonce, setNonce] = useState(0);
  const tookRef = useRef(false);
  const gotState = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [tabs, setTabs0] = useState<LiveTab[]>([]);
  const setTabs = useCallback((t: LiveTab[]) => { activeTabRef.current = t.find((x) => x.active)?.id; setTabs0(t); }, []);
  const [tabsOpen, setTabsOpen] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const noTall = useRef(false);
  const tallCache = useRef<number | null>(null);
  const screenOf = (st: HTMLElement) => (mobileRef.current ? { screen: { w: st.clientWidth, dpr: window.devicePixelRatio || 1 } } : {});
  const tallFor = (st: HTMLElement) => ({ ...(noTall.current ? { tall: null } : { tall: (tallCache.current ??= tallOf(st).tall) }), ...screenOf(st) });
  const lastView = useRef('');
  const retall = () => {
    const st = stage.current, s = ws.current;
    if (!st) return;
    const t = tallOf(st).tall, key = `${t}|${mobileRef.current ? st.clientWidth : 0}`;
    if (key === lastView.current && !noTall.current) return;
    lastView.current = key;
    noTall.current = false;
    tallCache.current = t;
    if (s && s.readyState === 1) s.send(JSON.stringify({ t: 'view', camera: null, tall: t, ...screenOf(st) }));
  };
  const stage = useRef<HTMLDivElement>(null);
  const cam = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const fx = useRef<HTMLDivElement>(null);
  const holdUntil = useRef(0);
  const pendingFrame = useRef<Frame | null>(null);
  const curPos = useRef<{ x: number; y: number } | null>(null);
  const reduce = useRef(false);
  useEffect(() => { reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }, []);

  const srQ = useRef<{ at: number; next: string; t: number }>({ at: 0, next: '', t: 0 });
  const speak = useCallback((text: string) => {
    const q = srQ.current; q.next = text;
    const go = () => { q.at = Date.now(); setSrCap(q.next); q.t = 0; };
    const left = 1500 - (Date.now() - q.at);
    if (left <= 0) go(); else if (!q.t) q.t = window.setTimeout(go, left);
  }, []);

  const camS = useRef({ s: 0, x: 0, y: 0, user: 0, t: 0, view: 0, moved: 0 });
  const [manual, setManual] = useState(false);
  const manualRef = useRef(false);
  const markManual = useCallback(() => { if (!manualRef.current) { manualRef.current = true; camS.current.user = Number.MAX_SAFE_INTEGER; setManual(true); } }, []);
  const unManual = useCallback(() => { manualRef.current = false; camS.current.user = 0; setManual(false); }, []);
  const chrome = useRef({ top: 0, bottom: 0 });
  const fitW = () => (stage.current && frameRef.current ? stage.current.clientWidth / frameRef.current.w : 1);
  const takeSize = () => {
    const st = stage.current, r = st?.getBoundingClientRect(), fb = foot.current?.getBoundingClientRect();
    const W = Math.round(st?.clientWidth || r?.width || 1280), H = st?.clientHeight || r?.height || 800;
    if (!mobileRef.current || !r) return { w: W, h: Math.round(H) };
    const below = fb ? r.bottom - fb.bottom : 42;
    return { w: W, h: Math.max(400, Math.round(H - chrome.current.top - below - 58 - 6)) };
  };
  const baseS = useCallback(() => {
    const st = stage.current, f = frameRef.current;
    if (!st || !f) return 1;
    const fit = st.clientWidth / f.w;
    if (!mobileRef.current || whoRef.current === 'user' || f.w < 600) return fit;
    const sharp = (1.3 * (f.nw ?? f.w) / f.w) / (window.devicePixelRatio || 1);
    return Math.max(fit, Math.min(Math.max(fit * 1.8, st.clientHeight / f.h), sharp));
  }, []);
  const applyCam = useCallback((c: { s: number; x: number; y: number }, animate = true) => {
    const el = cam.current;
    camS.current = { ...camS.current, ...c };
    if (!el) return;
    el.style.transition = animate && !reduce.current ? 'transform 520ms cubic-bezier(.22, 1, .36, 1)' : 'none';
    el.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    el.style.setProperty('--inv', String(1 / c.s));
    if (zoomAt.current) setZoom(null, 'cam');
    window.clearTimeout(camS.current.view);
    camS.current.view = window.setTimeout(() => {
      const st = stage.current, f = frameRef.current, s = ws.current;
      if (!st || !f || !s || s.readyState !== 1) return;
      const dpr = window.devicePixelRatio || 1, up = (c.s * dpr) / ((f.nw ?? f.w) / f.w);
      const x0 = Math.max(0, -c.x / c.s), y0 = Math.max(0, -c.y / c.s);
      const r = { x: Math.round(x0), y: Math.round(y0), w: Math.round(Math.min(f.w - x0, st.clientWidth / c.s)), h: Math.round(Math.min(f.h - y0, st.clientHeight / c.s)) };
      const zoomed = up > 1.3 && r.w * r.h <= 1280 * 1500;
      s.send(JSON.stringify({ t: 'view', camera: zoomed ? r : null, ...(zoomed && c.s * dpr > 2 ? { scale: 3 } : {}), ...tallFor(st) }));
      if (!zoomed) setZoom(null, 'notzoomed');
    }, 250);
  }, []);
  const camTo = useCallback((px: number, py: number, s?: number, animate = true) => {
    const st = stage.current, f = frameRef.current;
    if (!st || !f) return;
    const c = cameraAt(px, py, f.w, f.h, st.clientWidth, st.clientHeight, s ?? (camS.current.s || baseS()), chrome.current.top, chrome.current.bottom);
    if (!mobileRef.current && f.h * c.s <= st.clientHeight) c.y = 0;
    applyCam(c, animate);
  }, [applyCam, baseS]);
  const rest = useCallback((animate = true) => {
    const f = frameRef.current;
    if (f) camTo(0, 0, baseS(), animate);
  }, [camTo, baseS]);
  const pendingFollow = useRef(0);
  const follow = useCallback((px: number, py: number, area?: Rect) => {
    if (whoRef.current === 'user' || manualRef.current) return;
    const st = stage.current, f = frameRef.current;
    if (!st || !f) return;
    const go = () => {
      if (whoRef.current === 'user' || manualRef.current) return;
      const cs = camS.current, W = st.clientWidth, H = st.clientHeight, fit = W / f.w, base = baseS();
      const s = area ? Math.max(fit, Math.min(base, (W * 0.92) / Math.max(1, area.w))) : Math.max(fit, Math.min(base, cs.s || base));
      const top = chrome.current.top, bot = H - chrome.current.bottom;
      const box = area ?? { x: px - 4, y: py - 4, w: 8, h: 8 };
      const l = box.x * cs.s + cs.x, r = (box.x + box.w) * cs.s + cs.x, t = box.y * cs.s + cs.y, b = (box.y + box.h) * cs.s + cs.y;
      const inView = l >= W * 0.04 && r <= W * 0.96 && t >= top + 8 && b <= bot - 8;
      if (inView && Math.abs(s - cs.s) < 0.03) return;
      cs.moved = Date.now();
      camTo(area ? area.x + area.w / 2 : px, py, s);
    };
    window.clearTimeout(pendingFollow.current);
    const wait = camS.current.moved + 1500 - Date.now();
    if (wait > 0) pendingFollow.current = window.setTimeout(go, wait); else go();
  }, [baseS, camTo]);

  const ring = useCallback((x: number, y: number) => {
    const h = fx.current;
    if (!h) return;
    const r = document.createElement('i'); r.className = 'blv-ring'; r.style.transform = `translate(${x}px, ${y}px) scale(var(--inv, 1))`;
    const d = document.createElement('i'); d.className = 'blv-tap'; d.style.transform = `translate(${x}px, ${y}px) scale(var(--inv, 1))`;
    h.append(r, d);
    cursor.current?.classList.add('is-press');
    window.setTimeout(() => cursor.current?.classList.remove('is-press'), 120);
    window.setTimeout(() => r.remove(), 700);
    window.setTimeout(() => d.remove(), 900);
  }, []);
  const [hl, setHl] = useState<Rect | null>(null);

  const [loading, setLoading0] = useState(false);
  const loadT = useRef(0);
  const blankSince = useRef(0);
  const blankT = useRef(0);
  const loadingRef = useRef(false);
  const setLoading = useCallback((v: boolean) => {
    window.clearTimeout(loadT.current);
    loadingRef.current = v;
    setLoading0(v);
    if (v) loadT.current = window.setTimeout(() => { loadingRef.current = false; setLoading0(false); }, 10000);
  }, []);
  const lastAct = useRef(0);
  const act = useCallback((a: LiveAct) => {
    if (whoRef.current === 'user') return;
    lastAct.current = Date.now();
    if (zoomAt.current) setZoom(null, 'act');
    const text = actText(a, tl.lang);
    if (text) { setCap(text, a.type === 'find' && !!foundValue(a), a.type === 'tab' ? (a.action === 'close' ? '' : a.id) : undefined); if (a.type !== 'scroll') speak(text); }
    const c = cursor.current;
    if ((a.type === 'nav' || a.type === 'tab') && a.url && a.url !== 'back') setUrl(a.url);
    if (a.type === 'tab') { setHl(null); setZoom(null); if (c) c.style.opacity = '0'; curPos.current = null; if (a.action !== 'close') setLoading(true); return; }
    if (a.type === 'nav' || a.type === 'scroll') {
      setHl(null);
      if (c) c.style.opacity = '0';
      curPos.current = null;
      if (a.type === 'nav') { setZoom(null); setLoading(true); }
      return;
    }
    const rect = a.rect;
    const px = a.x ?? (rect ? rect.x + rect.w / 2 : undefined), py = a.y ?? (rect ? rect.y + rect.h / 2 : undefined);
    const mark = a.type === 'find' ? a.row ?? a.box ?? rect : rect;
    if (mark && (a.type === 'find' || a.type === 'type' || a.type === 'click')) { setHl(mark); window.setTimeout(() => setHl((h) => (h === mark ? null : h)), 2600); }
    if (px === undefined || py === undefined) return;
    const p = curPos.current;
    const ms = reduce.current || !p ? 0 : flyMs(Math.hypot(px - p.x, py - p.y) * (camS.current.s || 1));
    if (c) { c.style.transitionDuration = `${ms}ms, 160ms`; c.style.opacity = a.type === 'find' ? '0' : '1'; c.style.transform = `translate(${px}px, ${py}px) scale(var(--inv, 1))`; }
    curPos.current = a.type === 'find' ? null : { x: px, y: py };
    follow(px, py, a.type === 'find' ? a.row ?? a.box ?? rect : rect);
    if (a.type === 'click') { holdUntil.current = Date.now() + Math.min(400, ms + 120); window.setTimeout(() => ring(px, py), ms); }
  }, [follow, ring, speak, rest, camTo, baseS, setCap, setLoading, tl.lang]);

  const showFrame = useCallback((f0: Frame) => {
    let f = f0;
    const arrived = Date.now();
    const wait = holdUntil.current - Date.now();
    if (wait > 0) { pendingFrame.current = f; window.setTimeout(() => { if (pendingFrame.current) { setFrame(pendingFrame.current); pendingFrame.current = null; } }, wait); return; }
    const im = new Image(); im.src = f.src;
    (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).finally(() => {
      if (im.naturalWidth) f = { ...f, nw: im.naturalWidth };
      const prev = frameRef.current;
      if ((!prev || (prev.w === f.w && prev.h === f.h)) && blankImage(im)) {
        if (!blankSince.current) blankSince.current = Date.now();
        if (Date.now() - blankSince.current < 3000) {
          setLoading(true);
          window.clearTimeout(blankT.current);
          blankT.current = window.setTimeout(() => { if (frameRef.current === prev) { setFrame(f); setLoading(false); if (!prev) requestAnimationFrame(() => rest(false)); } }, 3000);
          return;
        }
      } else blankSince.current = 0;
      window.clearTimeout(blankT.current);
      const first = !prev || prev.w !== f.w || prev.h !== f.h || (!!prev.nw && !!f.nw && Math.abs(prev.nw - f.nw) > 64);
      setFrame(f);
      const z = zoomRef.current;
      if (z && zoomAt.current <= arrived) void sameAs(z.src, f, z.rect).then((ok) => {
        if (zoomRef.current !== z) return;
        if (ok) { zoomMiss.current = 0; return; }
        if (++zoomMiss.current >= 2) { zoomMiss.current = 0; setZoom(null, 'frame'); }
      });
      setLoading(false);
      if (first && !manualRef.current) requestAnimationFrame(() => rest(false));
    });
  }, [setFrame, rest, setLoading]);

  useEffect(() => {
    if (mode !== 'live' || !step.live) return;
    if (step.live.startsWith('demo:')) return demoDriver(step, shots, { showFrame, act, setConn, setWho, setTabs, who: () => whoRef.current });
    let closed = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = new WebSocket(`${proto}//${location.host}/api/browser/live?session=${encodeURIComponent(step.live)}`);
    ws.current = s;
    gotState.current = false;
    setConn('connecting');
    s.onopen = () => { setConn('on'); const st = stage.current; if (st) s.send(JSON.stringify({ t: 'view', camera: null, ...tallFor(st) })); };
    s.onclose = (ev) => {
      if (closed) return;
      if (ev.code === 1012) { setConn('connecting'); setTimeout(() => { if (!closed) setNonce((n) => n + 1); }, 400); return; }
      setConn('off');
    };
    s.onerror = () => setConn('off');
    s.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'frame' && typeof m.data === 'string') {
        showFrame({ src: `data:image/jpeg;base64,${m.data}`, w: Number(m.w) || 1280, h: Number(m.h) || 800 });
      }
      else if (m.t === 'zoom' && typeof m.data === 'string' && m.rect && !loadingRef.current) {
        const r = m.rect as Rect, st = stage.current, c = camS.current;
        const cw = st ? st.clientWidth / c.s : 0, cx = -c.x / c.s;
        const src = `data:image/jpeg;base64,${m.data}`, f0 = frameRef.current;
        const dbg = (window as unknown as { __kxDbg?: unknown[] }).__kxDbg;
        dbg?.push({ r, cx, cw, s: c.s, fw: f0?.w });
        if (cw && f0 && Math.abs(r.x - Math.max(0, cx)) < cw * 0.1 && Math.abs(r.w - Math.min(cw, f0.w - r.x)) < cw * 0.12)
          { const at = lastAct.current; void sameAs(src, f0, r).then((ok) => { dbg?.push({ same: ok, act: lastAct.current === at, load: loadingRef.current }); if (ok && frameRef.current?.w === f0.w && frameRef.current?.h === f0.h && lastAct.current === at && !loadingRef.current) setZoom({ src, rect: r }); }); }
      }
      else if (m.t === 'act') act(m as unknown as LiveAct);
      else if (m.t === 'state') {
        if (m.who === 'user' || m.who === 'agent') setWho(m.who);
        if (Array.isArray(m.tabs)) setTabs((m.tabs as LiveTab[]).map((x, i) => ({ ...x, id: String(x.id ?? `i${x.i ?? i}`) })));
        if (typeof m.url === 'string') setUrl((u) => {
          if (u && u !== m.url && noTall.current) { noTall.current = false; const st = stage.current; if (st) s.send(JSON.stringify({ t: 'view', camera: null, ...tallFor(st) })); }
          return m.url as string;
        });
        if (m.vhLayout === true && !noTall.current) { noTall.current = true; s.send(JSON.stringify({ t: 'view', camera: null, tall: null })); }
        if (m.who === 'user' && !tookRef.current) {
          tookRef.current = true;
          s.send(JSON.stringify({ t: 'take', ...takeSize() }));
        }
        if (m.who === 'agent') tookRef.current = false;
        if (!gotState.current) { gotState.current = true; checkTake(); }
      }
      else if (m.t === 'closed') { closed = true; setConn('closed'); s.close(); }
      else if (m.t === 'error' && typeof m.message === 'string') setCap(errText(tl.lang, m.message));
    };
    return () => { closed = true; s.close(); ws.current = null; };
  }, [mode, step.live, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'live' && conn === 'off' && shots.length) setMode('rec'); }, [conn, mode, shots.length]);
  useEffect(() => {
    const vis = () => { if (document.hidden) ws.current?.close(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);

  const send = (o: Record<string, unknown>) => { const s = ws.current; if (s && s.readyState === 1) s.send(JSON.stringify(o)); };
  const kb = useRef<HTMLInputElement>(null);
  const takeBtn = useRef<HTMLButtonElement>(null);
  const take = () => {
    send({ t: 'take', ...takeSize() });
    tookRef.current = true;
    setWho('user'); speak(tl('work.live.youControl'));
    if (cursor.current) cursor.current.style.opacity = '0';
    setHl(null); setZoom(null);
  };
  const release = () => {
    send({ t: 'release' }); tookRef.current = false; setWho('agent'); speak(tl('work.live.agentResumes'));
    kb.current?.blur();
    requestAnimationFrame(() => takeBtn.current?.focus({ preventScroll: true }));
  };
  const checkTook = useRef<string | null>(null);
  const checkRef = useRef(check);
  checkRef.current = check;
  const checkTake = () => {
    const c = checkRef.current;
    if (!c || checkTook.current === c.id || !gotState.current) return;
    checkTook.current = c.id;
    if (whoRef.current !== 'user') take();
  };
  useEffect(() => { if (mode === 'live' && conn === 'on') checkTake(); }, [check?.id, mode, conn]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkLeft = useLeft(check?.until);
  const checkDone = () => {
    release();
    onCheckDone?.();
    if (mobileRef.current) onClose();
  };
  useEffect(() => {
    if (!frame) return;
    if (who === 'user' && stage.current && mobileRef.current) {
      const s = baseS(), free = stage.current.clientHeight - chrome.current.top - chrome.current.bottom;
      applyCam({ s, x: 0, y: chrome.current.top + Math.max(0, (free - frame.h * s) / 2) }, false); return;
    }
    if (!manualRef.current) camTo(0, 0, baseS(), false);
  }, [who, frame?.w]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ x0: number; y0: number; t0: number; moved: boolean; c0: { s: number; x: number; y: number }; d0: number; mx: number; my: number; ly: number; acc: number; raf: number } | null>(null);
  const lastTap = useRef(0);
  const pageXY = (cx: number, cy: number) => {
    const st = stage.current, f = frameRef.current;
    if (!st || !f) return null;
    const r = st.getBoundingClientRect(), c = camS.current;
    const x = (cx - r.left - c.x) / c.s, y = (cy - r.top - c.y) / c.s;
    return x >= 0 && y >= 0 && x <= f.w && y <= f.h ? { x: Math.round(x), y: Math.round(y) } : null;
  };
  const swallow = useRef(false);
  const bounds = (s: number) => {
    const st = stage.current, f = frameRef.current;
    if (!st || !f) return { x0: 0, x1: 0, y0: 0, y1: 0 };
    const W = st.clientWidth, H = st.clientHeight, top = chrome.current.top, bot = chrome.current.bottom;
    const cx = f.w * s <= W ? (W - f.w * s) / 2 : null, cy = f.h * s <= H - top - bot ? top + (H - top - bot - f.h * s) / 2 : null;
    return { x0: cx ?? W - f.w * s, x1: cx ?? 0, y0: cy ?? Math.min(top, H - bot - f.h * s), y1: cy ?? top };
  };
  const rubber = (v: number, lo: number, hi: number) => (v < lo ? lo - (lo - v) * 0.35 : v > hi ? hi + (v - hi) * 0.35 : v);
  const inertia = useRef(0);
  const settle = (vx: number, vy: number) => {
    cancelAnimationFrame(inertia.current);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last); last = now;
      const c = camS.current, b = bounds(c.s);
      let x = c.x + vx * dt, y = c.y + vy * dt;
      const k = Math.pow(0.94, dt / 16); vx *= k; vy *= k;
      const outX = x < b.x0 || x > b.x1, outY = y < b.y0 || y > b.y1;
      if (outX) { vx *= 0.5; x = rubber(x, b.x0, b.x1); }
      if (outY) { vy *= 0.5; y = rubber(y, b.y0, b.y1); }
      if (Math.hypot(vx, vy) < 0.02 || (reduce.current)) {
        const cx = Math.min(b.x1, Math.max(b.x0, x)), cy = Math.min(b.y1, Math.max(b.y0, y));
        applyCam({ s: c.s, x: cx, y: cy }, !reduce.current && (cx !== x || cy !== y));
        return;
      }
      applyCam({ s: c.s, x, y }, false);
      inertia.current = requestAnimationFrame(step);
    };
    inertia.current = requestAnimationFrame(step);
  };
  const track = useRef<{ t: number; x: number; y: number }[]>([]);
  const onDown = (e: React.PointerEvent) => {
    if (open) { sheet(false); swallow.current = true; return; }
    swallow.current = false;
    cancelAnimationFrame(inertia.current);
    if (who !== 'user' && mode === 'live') markManual();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = { ...camS.current };
    track.current = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      g.current = { x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, t0: Date.now(), moved: true, c0: c, d0: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ly: 0, acc: 0, raf: 0 };
    } else g.current = { x0: e.clientX, y0: e.clientY, t0: Date.now(), moved: false, c0: c, d0: 0, mx: e.clientX, my: e.clientY, ly: e.clientY, acc: 0, raf: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s0 = g.current, st = stage.current, f = frameRef.current;
    if (!s0 || !st || !f) return;
    const r = st.getBoundingClientRect();
    if (pts.current.size >= 2 && s0.d0) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      const s = Math.max(fitW() * 0.92, Math.min(3.3, s0.c0.s * (d / s0.d0)));
      const px = (s0.x0 - r.left - s0.c0.x) / s0.c0.s, py = (s0.y0 - r.top - s0.c0.y) / s0.c0.s;
      applyCam({ s, x: mx - px * s, y: my - py * s }, false);
      markManual();
      return;
    }
    if (Math.hypot(e.clientX - s0.x0, e.clientY - s0.y0) > 8) s0.moved = true;
    if (!s0.moved) return;
    if (who === 'user' && e.pointerType === 'touch') {
      s0.acc += (s0.ly - e.clientY) / (camS.current.s || 1); s0.ly = e.clientY;
      if (!s0.raf) s0.raf = requestAnimationFrame(() => { const p = pageXY(s0.x0, s0.y0); if (s0.acc) send({ t: 'scroll', dy: Math.round(s0.acc), ...(p ?? {}) }); s0.acc = 0; s0.raf = 0; });
      return;
    }
    const c = s0.c0, b = bounds(c.s);
    applyCam({ s: c.s, x: rubber(c.x + e.clientX - s0.x0, b.x0, b.x1), y: rubber(c.y + e.clientY - s0.y0, b.y0, b.y1) }, false);
    const tr = track.current; tr.push({ t: performance.now(), x: e.clientX, y: e.clientY }); while (tr.length > 6) tr.shift();
    markManual();
  };
  const onUp = (e: React.PointerEvent) => {
    if (swallow.current) { swallow.current = false; return; }
    const wasPinch = pts.current.size >= 2;
    pts.current.delete(e.pointerId);
    const s0 = g.current;
    if (pts.current.size > 0) { if (wasPinch && g.current) { const [p] = [...pts.current.values()]; g.current = { ...g.current, x0: p.x, y0: p.y, c0: { ...camS.current }, d0: 0, moved: true }; } return; }
    g.current = null;
    if (!s0) return;
    if (s0.moved && who !== 'user') {
      const c = camS.current, fit = fitW();
      if (c.s < fit || c.s > 3) {
        const st = stage.current, ns = Math.max(fit, Math.min(3, c.s));
        if (st) camTo((st.clientWidth / 2 - c.x) / c.s, (st.clientHeight / 2 - c.y) / c.s, ns);
        return;
      }
      const tr = track.current, z = tr[tr.length - 1], a = z && (tr.find((p) => p.t >= z.t - 100) ?? tr[0]);
      const dt = z && a ? z.t - a.t : 0, fresh = z && performance.now() - z.t < 90;
      settle(fresh && dt > 0 ? (z.x - a.x) / dt : 0, fresh && dt > 0 ? (z.y - a.y) / dt : 0);
      return;
    }
    if (s0.moved) return;
    const now = Date.now();
    if (who === 'user') {
      const p = pageXY(e.clientX, e.clientY);
      if (!p) return;
      send({ t: 'click', x: p.x, y: p.y }); ring(p.x, p.y);
      const kbEl = kb.current, sr = stage.current?.getBoundingClientRect();
      if (kbEl && sr) { kbEl.style.left = `${e.clientX - sr.left}px`; kbEl.style.top = `${e.clientY - sr.top}px`; }
      return;
    }
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      const p = pageXY(e.clientX, e.clientY), f = frameRef.current;
      if (!p || !f) return;
      const fit = fitW();
      camTo(p.x, p.y, Math.abs(camS.current.s - fit) < 0.05 ? fit * 2 : fit);
      markManual();
      return;
    }
    lastTap.current = now;
  };
  const wholePage = () => {
    const st = stage.current, c = camS.current;
    if (!st || !frameRef.current) return;
    markManual();
    camTo(0, (chrome.current.top + (st.clientHeight - chrome.current.top - chrome.current.bottom) / 2 - c.y) / (c.s || 1), fitW());
  };
  const onWheel = (e: React.WheelEvent) => {
    if (who === 'user') { const p = pageXY(e.clientX, e.clientY); send({ t: 'scroll', dy: Math.round(e.deltaY), dx: Math.round(e.deltaX), ...(p ?? {}) }); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    const st = stage.current, f = frameRef.current; if (!st || !f) return;
    const r = st.getBoundingClientRect(), c = camS.current, s = Math.max(fitW(), Math.min(2.4, c.s * Math.exp(-e.deltaY / 300)));
    const px = (e.clientX - r.left - c.x) / c.s, py = (e.clientY - r.top - c.y) / c.s;
    applyCam({ s, x: e.clientX - r.left - px * s, y: e.clientY - r.top - py * s }, false);
  };

  const close = async () => {
    if (whoRef.current === 'user' && mode === 'live' && !check) {
      if (!(await ask({ title: tl('work.live.giveBackTitle'), message: tl('work.live.giveBackMsg'), action: tl('work.live.giveBack') }))) return;
      send({ t: 'release' });
    }
    onClose();
  };

  const escAt = useRef(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.k-dlg-scrim')) return;
      if ((e.target as HTMLElement | null)?.closest?.('.blv-chat-in')) { if (e.key === 'Escape') { (e.target as HTMLElement).blur(); if (open) sheet(false); } return; }
      if (who === 'user' && mode === 'live') { if (e.key === 'Escape') { if (Date.now() - escAt.current < 600) { if (check) checkDone(); else release(); } escAt.current = Date.now(); } return; }
      if (e.key === 'Escape' && open) { e.preventDefault(); sheet(false); return; }
      if (e.key === 'Escape') { e.preventDefault(); void close(); }
      if (mode === 'rec' && e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (mode === 'rec' && e.key === 'ArrowRight') setIdx((i) => Math.min(shots.length - 1, i + 1));
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    if (mobile) return;
    const de = document.documentElement;
    const fit = () => {
      if (de.classList.contains('blv-resizing')) return;
      const win = window.innerWidth, left = document.querySelector('.main')?.getBoundingClientRect().left ?? 0;
      let saved = 0; try { saved = Number(localStorage.getItem(LVW_KEY)) || 0; } catch {  }
      const want = saved || Math.max(480, Math.min(720, win * 0.42));
      const room = Math.min(win * 0.7, win - left - 420);
      const o = room < 360;
      de.style.setProperty('--lv-w', `${Math.round(o ? Math.min(want, win - 48) : Math.max(360, Math.min(want, room)))}px`);
      de.classList.toggle('blv-over', o); setOver(o);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); de.style.removeProperty('--lv-w'); de.classList.remove('blv-over'); };
  }, [mobile]);
  const [resizing, setResizing] = useState(false);
  const retallT = useRef(0);
  const lastLand = useRef(false);
  const lastDown = useRef({ t: 0, x: 0 });
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const now = Date.now(), ld = lastDown.current; lastDown.current = { t: now, x: e.clientX };
    if (now - ld.t < 400 && Math.abs(e.clientX - ld.x) < 5) { resetWidth(); lastDown.current = { t: 0, x: 0 }; return; }
    const el = e.currentTarget; el.setPointerCapture?.(e.pointerId);
    const de = document.documentElement; de.classList.add('blv-resizing'); setResizing(true);
    let raf = 0, w = 0;
    const move = (ev: PointerEvent) => {
      w = panelW(window.innerWidth - ev.clientX);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; de.style.setProperty('--lv-w', `${w}px`); });
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      de.classList.remove('blv-resizing'); setResizing(false);
      if (w) try { localStorage.setItem(LVW_KEY, String(w)); } catch {  }
      window.setTimeout(retall, 300);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const resetWidth = () => {
    try { localStorage.removeItem(LVW_KEY); } catch {  }
    const win = window.innerWidth;
    document.documentElement.style.setProperty('--lv-w', `${panelW(Math.max(480, Math.min(720, win * 0.42)))}px`);
    window.setTimeout(retall, 300);
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = root.current?.getBoundingClientRect().width ?? 560, w = panelW(cur + (e.key === 'ArrowLeft' ? 32 : -32));
    document.documentElement.style.setProperty('--lv-w', `${w}px`);
    try { localStorage.setItem(LVW_KEY, String(w)); } catch {  }
    window.clearTimeout(retallT.current); retallT.current = window.setTimeout(retall, 300);
  };
  useEffect(() => {
    const st = stage.current;
    if (!st || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    lastLand.current = st.clientWidth > st.clientHeight;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const f = frameRef.current, c = camS.current;
        if (!f || !c.s) return;
        const fit = st.clientWidth / f.w, land = st.clientWidth > st.clientHeight;
        if (land !== lastLand.current) { lastLand.current = land; camTo(0, 0, baseS(), false); }
        else {
          const s = manualRef.current ? Math.max(fit, Math.min(3, c.s)) : baseS();
          camTo((st.clientWidth / 2 - c.x) / c.s, (chrome.current.top + (st.clientHeight - chrome.current.top - chrome.current.bottom) / 2 - c.y) / c.s, s, false);
        }
        if (mobileRef.current) { window.clearTimeout(retallT.current); retallT.current = window.setTimeout(retall, 300); }
      });
    });
    ro.observe(st);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [camTo, baseS]);

  const root = useRef<HTMLDivElement>(null);
  const topEl = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = root.current;
    if (!mobile || !el) return;
    return attachSheetDrag(el, null, () => { void closeRef.current(); }, { handle: '.blv-head[data-swipe]' });
  }, [mobile]);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('blv-open');
    root.current?.querySelector<HTMLElement>('[data-lv-close]')?.focus({ preventScroll: true });
    return () => { document.documentElement.classList.remove('blv-open'); back?.focus?.({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const st = stage.current;
    const m = () => {
      if (st && topEl.current) { const tt = mobileRef.current ? '' : `${topEl.current.offsetHeight}px`; if (st.style.top !== tt) st.style.top = tt; }
      const r = st?.getBoundingClientRect();
      if (!r) return;
      const hb = head.current?.getBoundingClientRect(), fb = foot.current?.getBoundingClientRect();
      chrome.current = { top: hb ? Math.max(0, hb.bottom - r.top) : 0, bottom: fb ? Math.max(0, r.bottom - fb.top) : 0 };
    };
    m();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(m) : null;
    if (head.current) ro?.observe(head.current); if (foot.current) ro?.observe(foot.current); if (st) ro?.observe(st); if (topEl.current) ro?.observe(topEl.current);
    return () => ro?.disconnect();
  });

  const cur = mode === 'rec' ? shots[idx] : null;
  const [recBlank, setRecBlank] = useState(false);
  useEffect(() => {
    setRecBlank(false);
    if (!cur) return;
    let off = false;
    const im = new Image(); im.onload = () => { if (!off) setRecBlank(blankImage(im)); }; im.src = cur.a.url;
    return () => { off = true; };
  }, [cur?.a.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== 'rec' || !cur) return;
    const f = { src: cur.a.url, w: cur.a.w ?? 1280, h: cur.a.h ?? 800 };
    setFrame(f); setZoom(null); setHl(null);
    requestAnimationFrame(() => rest(false));
  }, [mode, cur?.a.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => (msg ? buildFeed(msg.reasoning ?? '', msg.steps ?? [], !!msg.streaming && !!msg.rStartedAt, !msg.streaming, tl.lang) : []), [msg, tl.lang]);
  const working = !!msg?.streaming;
  const all2 = useMemo(() => convLines(conv?.length ? conv : msg ? [msg] : [], tl.lang), [conv, msg, tl.lang]);
  const lastStep = useMemo(() => [...items].reverse().flatMap((it) => (it.t === 'step' ? [it.step] : it.t === 'group' ? [...it.steps].reverse() : [])).find((s) => s.kind !== 'steer'), [items]);
  const stepAt = useMemo(() => Date.now(), [lastStep?.id, lastStep?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeTab = tabs.find((x) => x.active);
  const capOk = !!cap && (!tabs.length || cap.tab === undefined || cap.tab === activeTab?.id);
  const capNow = capOk ? cap : null;
  const headStep0 = working && lastStep && !(capNow && (capNow.at > stepAt || (capNow.found && stepAt - capNow.at < 2500))) ? lastStep : null;
  const headStep = headStep0 && (!activeTab?.url || !headStep0.host || hostName(activeTab.url) === headStep0.host || stepLine(headStep0).includes(hostName(activeTab.url))) ? headStep0 : null;
  const [sent, setSent] = useState<Line[]>([]);
  const [kbOpen, setKbOpen] = useState(false);
  const lines = useMemo(() => {
    const base = chatLines(items, working ? '' : msg?.content ?? '', 4, working ? lastStep?.id : undefined).filter((l) => l.who !== 'now');
    const extra = sent.filter((x) => !all2.some((b) => b.who === 'you' && b.text === x.text)).map((x) => ({ ...x, pending: true }));
    return [...base, ...extra].slice(kbOpen ? -3 : -2);
  }, [items, msg, sent, kbOpen, working, lastStep?.id, all2]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const say = async () => {
    const t = draft.trim();
    if (!t || !onSay || sending) return;
    setSending(true); setDraft('');
    setSent((s) => [...s, { id: `u${Date.now()}`, who: 'you', text: t }]);
    const ok = await onSay(t).catch(() => false);
    if (!ok) { setDraft(t); setSent((s) => s.filter((x) => x.text !== t)); }
    setSending(false);
  };
  const [open, setOpen] = useState(false);
  const chatEl = useRef<HTMLDivElement>(null);
  const convEl = useRef<HTMLOListElement>(null);
  const flipFrom = useRef<number | null>(null);
  const shutH = useRef(120);
  const convAll = useMemo(() => [...all2, ...sent.filter((x) => !all2.some((b) => b.who === 'you' && b.text === x.text)).map((x) => ({ ...x, pending: true }))], [all2, sent]);
  const sheet = useCallback((v: boolean) => {
    const el = chatEl.current;
    if (!el || reduce.current) { setOpen(v); return; }
    if (v) { flipFrom.current = el.getBoundingClientRect().top; setOpen(true); return; }
    const r = el.getBoundingClientRect();
    el.style.transition = 'transform 260ms cubic-bezier(.32,.72,0,1)';
    el.style.transform = `translateY(${Math.max(0, r.height - shutH.current)}px)`;
    window.setTimeout(() => { el.style.transition = 'none'; el.style.transform = ''; setOpen(false); }, 260);
  }, []);
  useLayoutEffect(() => {
    const el = chatEl.current;
    if (!el) return;
    if (!open) { shutH.current = el.getBoundingClientRect().height; return; }
    const list = convEl.current;
    if (list) list.scrollTop = list.scrollHeight;
    if (flipFrom.current !== null) {
      const d = flipFrom.current - el.getBoundingClientRect().top; flipFrom.current = null;
      el.style.transition = 'none'; el.style.transform = `translateY(${d}px)`;
      void el.getBoundingClientRect();
      el.style.transition = 'transform 420ms cubic-bezier(.32,.72,0,1)'; el.style.transform = '';
    }
  }, [open]);
  useLayoutEffect(() => {
    const list = convEl.current;
    if (open && list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) list.scrollTop = list.scrollHeight;
  }, [convAll.length, open]);
  const ansKey = msg && !msg.streaming && msg.content?.trim() ? `${msg.id}:${msg.content.length}` : '';
  const [seen, setSeen] = useState(ansKey);
  useEffect(() => { if (open) setSeen(ansKey); }, [open, ansKey]);
  const unread = !!ansKey && ansKey !== seen && !open;
  const sw = useRef<{ y: number; dy: number; id: number } | null>(null);
  const swDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.blv-grab') && t.closest('input, button, a, .blv-conv')) return;
    sw.current = { y: e.clientY, dy: 0, id: e.pointerId };
  };
  const swMove = (e: React.PointerEvent) => {
    const g0 = sw.current; if (!g0 || g0.id !== e.pointerId) return;
    g0.dy = e.clientY - g0.y;
    if (open && g0.dy > 0 && chatEl.current) { chatEl.current.style.transition = 'none'; chatEl.current.style.transform = `translateY(${g0.dy}px)`; }
  };
  const swUp = (e: React.PointerEvent) => {
    const g0 = sw.current; sw.current = null;
    if (!g0 || g0.id !== e.pointerId) return;
    if (!open && g0.dy < -24) { sheet(true); return; }
    if (open) {
      if (g0.dy > 64) sheet(false);
      else if (chatEl.current) { chatEl.current.style.transition = 'transform 260ms cubic-bezier(.32,.72,0,1)'; chatEl.current.style.transform = ''; }
      return;
    }
    if (Math.abs(g0.dy) < 8 && !(e.target as HTMLElement).closest('input, button, a')) sheet(true);
  };

  useEffect(() => { if (ansKey && ansKey !== seen && msg?.content) speak(tl('work.live.agentReplied', { text: answerLine(msg.content).slice(0, 300) })); }, [ansKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (conn === 'off') speak(tl('work.live.interrupted')); else if (conn === 'closed') speak(tl('work.live.closed')); }, [conn]); // eslint-disable-line react-hooks/exhaustive-deps

  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working && frameRef.current && mode === 'live' && whoRef.current === 'agent') {
      window.setTimeout(() => { if (whoRef.current === 'agent') { setHl(null); if (cursor.current) cursor.current.style.opacity = '0'; if (!manualRef.current) rest(); } }, 1200);
    }
    wasWorking.current = working;
  }, [working]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteName = mode === 'rec' && cur?.step.host ? cur.step.host : activeTab?.url ? hostName(activeTab.url) : url ? hostName(url) : host ?? tl('work.kind.browser');
  const done = !!msg && !msg.streaming;
  const subline = mode === 'rec'
    ? `${tl('work.live.rec')} · ${shots.length ? tl('work.iv.count', { i: idx + 1, n: shots.length }) : tl('work.live.noShots')}${cur ? ' · ' + stepLine(cur.step) : ''}`
    : conn === 'closed' ? tl('work.live.closed')
    : who === 'user' && check ? `${tl('work.check.solve')} · ${tl('work.check.wait', { t: leftText(checkLeft, tl.lang) })}`
    : who === 'user' ? tl('work.live.agentWaits')
    : conn !== 'on' ? (conn === 'connecting' ? tl('work.live.connecting') : tl('work.live.interrupted'))
    : done ? tl('common.done')
    : headStep ? stepLine(headStep) : capNow?.text || (activeTab?.loading ? tl('work.act.open', { host: hostName(activeTab.url) }) : activeTab?.title || tl('work.live.agentWorking'));
  const user = mode === 'live' && who === 'user';

  const view = (
    <div ref={root} className={`blv${mobile ? ' blv--full' : ' blv--side'}${user ? ' is-user' : ''}`} role="dialog" aria-modal={mobile ? true : undefined}
      aria-label={tl('work.live.aria', { site: siteName })} data-testid="live-view" data-mode={mode} data-who={who} data-noswipe="" data-nodrag="">
      <div className="blv-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} data-testid="live-stage">
        <div className="blv-cam" ref={cam} style={frame ? { width: frame.w, height: frame.h } : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {frame && <img className={`blv-frame${mode === 'rec' && recBlank ? ' is-blank' : ''}`} src={frame.src} alt={mode === 'rec' && cur ? `${cur.step.title}${cur.step.sub ? ' ' + cur.step.sub : ''}` : tl('work.live.screenAlt')} draggable={false} data-testid="live-frame" data-cw={frame.w} data-ch={frame.h} />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {zoom && mode === 'live' && <img className="blv-zoom" src={zoom.src} alt="" aria-hidden="true" style={{ left: zoom.rect.x, top: zoom.rect.y, width: zoom.rect.w, height: zoom.rect.h }} />}
          {hl && !user && <i className="blv-hl" style={{ left: hl.x - 4, top: hl.y - 4, width: hl.w + 8, height: hl.h + 8 }} aria-hidden="true" />}
          <div className="blv-fx" ref={fx} aria-hidden="true" />
          {mode === 'live' && <div className="blv-cursor" ref={cursor} aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 1.2 13.8 7 8.6 8.6 6.6 14.2Z" /></svg></div>}
        </div>
        {mode === 'live' && !frame && conn !== 'closed' && <p className="blv-wait">{conn === 'off' ? tl('work.live.unavailable') : tl('work.live.connectingBrowser')}</p>}
        {mode === 'rec' && !cur && <p className="blv-wait">{tl('work.live.stepNoShots')}</p>}
        {mode === 'rec' && cur && recBlank && (
          <div className="blv-miss" data-testid="live-miss"><p>{cur.step.http && cur.step.http >= 400 ? tl('work.live.siteFail', { code: cur.step.http }) : tl('work.live.emptyPage')}</p>
            {cur.step.host && <span>{cur.step.host}</span>}</div>
        )}
        {mode === 'live' && conn === 'closed' && (
          <div className="blv-closed" data-testid="live-closed"><p>{tl('work.live.closedWhy')}</p>
            <button type="button" className="btn" onClick={() => { setFrame(null); setConn('connecting'); setNonce((n) => n + 1); }} data-testid="live-reconnect">{tl('work.live.reconnect')}</button></div>
        )}
        <input ref={kb} className="blv-kbin" aria-label={tl('work.live.pageInput')} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} tabIndex={user ? 0 : -1}
          onKeyDown={(e) => { if (['Enter', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); send({ t: 'key', key: e.key }); } }}
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) { send({ t: 'type', text: v }); (e.target as HTMLInputElement).value = ''; } }} />
      </div>

      <div className="blv-top" ref={topEl}>
      <header className={`blv-head${mobile ? ' blv-glass' : ''}`} ref={head} data-swipe={mobile && (!user || check) ? '' : undefined} data-testid="live-head">
        {}
        {mobile && <button type="button" className="blv-ib" aria-label={tl('work.live.minimize')} data-lv-close="" onClick={() => void close()} data-testid="live-close"><Icon n="chev-down" /></button>}
        <div className="blv-title">
          <b>{user ? tl('work.live.youControlHead') : siteName}</b>
          <span className="blv-status" data-testid="live-status" key={user && check ? 'check' : subline}>
            {mode === 'live' && !user && conn === 'on' && !done && <i className="wk-dot" aria-hidden="true" />}{done && mode === 'live' && !user && <Icon n="check" sm />}<span className="blv-status-t" data-testid={user && check ? 'live-check-left' : undefined}>{user && !check ? `${subline} · ${siteName}` : subline}</span>
          </span>
        </div>
        {loading && mode === 'live' && !user && <i className="blv-load" aria-hidden="true" data-testid="live-loading" />}
        {mode === 'live' && !user && frame && (
          <button type="button" className="blv-ib blv-whole" onClick={wholePage} aria-label={tl('work.live.wholeAria')} title={tl('work.live.whole')} data-testid="live-whole">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        {manual && !user && (
          <button type="button" className="blv-chip blv-chip--follow" onClick={() => { unManual(); camS.current.moved = 0; const p = curPos.current; if (p) camTo(p.x, p.y, baseS()); else rest(); }} data-testid="live-follow"
            aria-label={tl('work.live.followAria')}>
            <Icon n="eye" sm />{tl('work.live.follow')}</button>
        )}
        {mobile && mode === 'live' && tabs.length > 1 && (
          <button type="button" className="blv-chip blv-tabchip" onClick={() => setTabsOpen(true)} aria-haspopup="dialog" data-testid="live-tabs-chip" key={tabs.length}>
            {tabs.some((x) => x.loading) && <i className="blv-spin" aria-hidden="true" />}{tabsWord(tabs.length, tl.lang)}</button>
        )}
        {}
        {!mobile && !user && mode === 'live' && conn === 'on' && (
          <button type="button" ref={takeBtn} className="blv-ib blv-ib--fill blv-take" onClick={take} aria-label={tl('work.live.takeAria')} title={tl('work.live.take')} data-testid="live-take"><Icon n="hand" /></button>
        )}
        {!mobile && mode === 'rec' && step.live && (
          <button type="button" className="blv-ib blv-ib--fill blv-golive" onClick={() => { setConn('connecting'); setMode('live'); }} aria-label={tl('work.live.goLiveAria')} title={tl('work.live.goLive')} data-testid="live-golive"><i aria-hidden="true" /></button>
        )}
        {mode === 'rec' && shots.length > 1 && (
          <>
            <button type="button" className="blv-ib" aria-label={tl('work.live.prevShot')} disabled={idx === 0} onClick={() => setIdx(idx - 1)} data-testid="live-prev"><Icon n="chev-right" className="flip" /></button>
            <button type="button" className="blv-ib" aria-label={tl('work.live.nextShot')} disabled={idx >= shots.length - 1} onClick={() => setIdx(idx + 1)} data-testid="live-next"><Icon n="chev-right" /></button>
          </>
        )}
        {!mobile && <button type="button" className="blv-ib" aria-label={tl('work.live.closeAria')} title={tl('work.live.closeTitle')} data-lv-close="" onClick={() => void close()} data-testid="live-close"><Icon n="x" /></button>}
      </header>
      {}
      {!mobile && mode === 'live' && tabs.length > 0 && (
        <div className="blv-tabs" role="tablist" aria-label={tl('work.live.tabsAria')} data-testid="live-tabs">
          {tabs.map((tb) => (
            <button key={tb.id} type="button" role="tab" aria-selected={!!tb.active} className={`blv-tab${tb.active ? ' is-on' : ''}`} title={tb.title || pagePath(tb.url)}
              aria-disabled={!user || undefined} onClick={() => { if (user && !tb.active) send({ t: 'tab', id: tb.id }); }} data-testid="live-tab" data-id={tb.id}>
              {tb.loading ? <i className="blv-spin" aria-label={tl('work.live.loading')} /> : tb.favicon ? <img src={tb.favicon} alt="" width={16} height={16} /> : <Icon n="globe" sm />}
              <span>{tb.title || hostName(tb.url)}</span>
            </button>
          ))}
        </div>
      )}
      {!mobile && mode === 'live' && (activeTab?.url || url) && (
        <div className="blv-addr" data-testid="live-addr" aria-label={tl('work.live.addr')}>
          <Icon n={/^https:/i.test(activeTab?.url || url || '') ? 'lock' : 'globe'} sm /><span>{pagePath(activeTab?.url || url || '')}</span>
        </div>
      )}
      </div>
      {!mobile && (
        <div className={`blv-resize${resizing ? ' is-on' : ''}`} role="separator" aria-orientation="vertical" aria-label={tl('work.live.resize')} tabIndex={0}
          onPointerDown={onResizeDown} onDoubleClick={resetWidth} onKeyDown={onResizeKey} data-testid="live-resize" />
      )}

      {(mobile || user) && <div className={`blv-foot${open && !user ? ' is-open' : ''}`} ref={foot}>
        {user ? (
          <div className="blv-ctl blv-glass" data-testid="live-ctl">
            <button type="button" className="blv-ib blv-ib--fill" onClick={() => kb.current?.focus()} aria-label={tl('work.live.kbAria')} title={tl('work.live.kb')} data-testid="live-kb"><Icon n="keyboard" /></button>
            <button type="button" className="blv-ib blv-ib--fill" onClick={() => send({ t: 'back' })} aria-label={tl('work.live.backAria')} title={tl('common.back')} data-testid="live-back"><Icon n="chev-right" className="flip" /></button>
            {check
              ? <button type="button" className="btn btn--primary blv-release" onClick={checkDone} data-testid="live-check-done">{tl('work.check.done')}</button>
              : <button type="button" className="btn btn--primary blv-release" onClick={release} data-testid="live-release">{tl('work.live.giveBack')}</button>}
          </div>
        ) : (
          <div className={`blv-chat blv-glass${open ? ' is-open' : ''}`} ref={chatEl} data-testid="live-chat" onPointerDown={swDown} onPointerMove={swMove} onPointerUp={swUp} onPointerCancel={() => { sw.current = null; }}>
            <button type="button" className="blv-grab" aria-expanded={open} aria-label={tl(open ? 'work.live.collapseConv' : 'work.live.expandConv')} onClick={() => sheet(!open)} data-testid="live-grab"><i aria-hidden="true" /></button>
            {open ? (
              <ol className="blv-conv blv-conv-scroll" ref={convEl} aria-label={tl('work.live.conv')} data-testid="live-conv">
                {convAll.map((l) => (
                  <li key={l.id} className={`blv-cl is-${l.who}`} data-who={l.who}>
                    {l.who === 'you' ? <span className={`blv-you${l.pending ? ' is-pending' : ''}`}><span className="sr">{tl('work.live.you')}: </span>{l.text}{l.pending && <span className="sr"> ({tl('work.live.pending')})</span>}</span>
                      : l.who === 'reply' ? <div className="blv-ans"><b className="blv-ans-who">{tl('work.live.agent')}</b>{(l as CLine).md ? <Markdown text={(l as CLine).md!} /> : <p>{l.text}</p>}</div>
                      : <span className="blv-step">{l.who === 'now' && <i className="wk-dot" aria-hidden="true" />}{l.text}</span>}
                  </li>
                ))}
              </ol>
            ) : lines.length > 0 && (
              <ol className="blv-lines" aria-label={tl('work.live.lines')}>
                {lines.map((l) => (
                  <li key={l.id} className={`blv-line is-${l.who}`} data-who={l.who}>
                    {l.who === 'you' ? <span className={`blv-you${l.pending ? ' is-pending' : ''}`}><span className="sr">{tl('work.live.you')}: </span>{l.text}{l.pending && <span className="sr"> ({tl('work.live.pending')})</span>}</span>
                      : l.who === 'reply' ? <>{unread && <span className="blv-new" data-testid="live-unread">{tl('work.live.new')}<span className="sr">: {tl('work.live.agentAnswer')}</span></span>}<Clamp text={l.text} lead={`${tl('work.live.agent')}: `} /></>
                      : <span>{l.text}</span>}
                  </li>
                ))}
              </ol>
            )}
            <form className="blv-chat-row" onSubmit={(e) => { e.preventDefault(); void say(); }}>
              {mode === 'live' && conn === 'on' && (
                <button type="button" ref={takeBtn} className="blv-ib blv-ib--fill blv-take" onClick={take} aria-label={tl('work.live.takeAria')} title={tl('work.live.take')} data-testid="live-take"><Icon n="hand" /></button>
              )}
              {mode === 'rec' && step.live && (
                <button type="button" className="blv-ib blv-ib--fill blv-golive" onClick={() => { setConn('connecting'); setMode('live'); }} aria-label={tl('work.live.goLiveAria')} title={tl('work.live.goLive')} data-testid="live-golive"><i aria-hidden="true" /></button>
              )}
              <label className="blv-chat-in">
                <span className="sr">{tl(working ? 'work.live.sayNow' : 'work.live.say')}</span>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tl('work.live.sayPh')} enterKeyHint="send" data-testid="live-say" disabled={!onSay}
                  onFocus={() => setKbOpen(true)} onBlur={() => setKbOpen(false)} />
                <button type="submit" className="blv-send" aria-label={tl('work.live.send')} disabled={!draft.trim() || sending || !onSay} data-testid="live-say-send"><Icon n="arrow-up" sm /></button>
              </label>
            </form>
          </div>
        )}
      </div>}
      {mobile && tabsOpen && (
        <div className="blv-tabsheet-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) setTabsOpen(false); }} data-testid="live-tabsheet">
          <div className="blv-tabsheet blv-glass" role="dialog" aria-label={tl('work.live.tabsAria')}>
            <div className="blv-tabsheet-h"><b>{tabsWord(tabs.length, tl.lang)}</b><span>{tl(user ? 'work.live.tapSwitch' : 'work.live.agentTab')}</span>
              <button type="button" className="blv-ib" aria-label={tl('work.live.closeTabs')} onClick={() => setTabsOpen(false)}><Icon n="x" /></button></div>
            <ul className="blv-tablist">
              {tabs.map((tb) => (
                <li key={tb.id}>
                  <button type="button" className={`blv-tabrow${tb.active ? ' is-on' : ''}`} aria-current={tb.active ? 'true' : undefined} aria-disabled={!user || undefined}
                    onClick={() => { if (user && !tb.active) { send({ t: 'tab', id: tb.id }); setTabsOpen(false); } }}>
                    <span className="blv-tabrow-ic">{tb.loading ? <i className="blv-spin" aria-label={tl('work.live.loading')} /> : tb.favicon ? <img src={tb.favicon} alt="" width={20} height={20} /> : <Icon n="globe" sm />}</span>
                    <span className="blv-tabrow-t"><b>{tb.title || hostName(tb.url)}</b><span>{pagePath(tb.url)}</span></span>
                    {tb.active && <Icon n="check" sm />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="sr" role="status" aria-live="polite" aria-atomic="true" data-testid="live-sr">{mode === 'rec' && cur ? `${tl('work.live.shot', { i: idx + 1, n: shots.length })}: ${cur.step.title}` : srCap}</div>
      {user && !mobile && !check && <p className="blv-hint">{tl('work.live.escHint')}</p>}
      {confirmUi}
    </div>
  );
  return createPortal(<>{over && !mobile && <div className="blv-scrim" onClick={() => void close()} aria-hidden="true" data-testid="live-scrim" />}{view}</>, document.body);
}

function tallOf(st: HTMLElement): { tall: number } {
  return { tall: Math.min(3000, Math.max(800, Math.ceil((st.clientHeight * 1280) / Math.max(1, st.clientWidth)))) };
}

function blankImage(im: HTMLImageElement): boolean {
  try {
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const c = cv.getContext('2d'); if (!c) return false;
    c.drawImage(im, 0, 0, 16, 16);
    const d = c.getImageData(0, 0, 16, 16).data;
    let s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; }
    const n = d.length / 4, m = s / n;
    return Math.sqrt(Math.max(0, s2 / n - m * m)) < 2.5;
  } catch { return false; }
}

async function sameAs(zoomSrc: string, f: Frame, r: Rect): Promise<boolean> {
  try {
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    const [z, fr] = await Promise.all([load(zoomSrc), load(f.src)]);
    const N = 32;
    const px = (draw: (c: CanvasRenderingContext2D) => void) => {
      const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
      const c = cv.getContext('2d'); if (!c) return null;
      draw(c); return c.getImageData(0, 0, N, N).data;
    };
    const k = fr.naturalWidth / f.w;
    const a = px((c) => c.drawImage(z, 0, 0, N, N));
    const b = px((c) => c.drawImage(fr, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, N, N));
    if (!a || !b) return true;
    const lum = (p: Uint8ClampedArray) => { const v: number[] = []; for (let i = 0; i < p.length; i += 4) v.push((p[i] + p[i + 1] + p[i + 2]) / 3); return v; };
    const la = lum(a), lb = lum(b);
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    const ma = mean(la), mb = mean(lb);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < la.length; i++) { const x = la[i] - ma, y = lb[i] - mb; num += x * y; da += x * x; db += y * y; }
    const sa = Math.sqrt(da / la.length), sb = Math.sqrt(db / lb.length);
    (window as unknown as { __kxDbg?: unknown[] }).__kxDbg?.push({ ncc: sa >= 3 && sb >= 3 ? +(num / Math.sqrt(da * db)).toFixed(3) : null, ma: Math.round(ma), mb: Math.round(mb), sa: Math.round(sa), sb: Math.round(sb), nw: fr.naturalWidth, zw: z.naturalWidth });
    if (sa < 3 && sb < 3) return Math.abs(ma - mb) < 20;
    if (sa < 3 || sb < 3) return false;
    return num / Math.sqrt(da * db) > 0.75 && Math.abs(ma - mb) < 30;
  } catch { return true; }
}

function demoDriver(step: WStep, shots: Shot[], h: { showFrame: (f: Frame) => void; act: (a: LiveAct) => void; setConn: (c: 'on') => void; setWho: (w: 'agent') => void; setTabs: (t: LiveTab[]) => void; who: () => 'agent' | 'user' }) {
  const a = step.thumb ?? shots[shots.length - 1]?.a;
  if (!a) return () => {};
  const w = a.w ?? 1280, ht = a.h ?? 800;
  h.setConn('on'); h.setWho('agent');
  h.showFrame({ src: a.url, w, h: ht });
  const k = w / 1280, R = (x: number, y: number, rw: number, rh: number): Rect => ({ x: x * k, y: y * (ht / 800), w: rw * k, h: rh * (ht / 800) });
  const script: LiveAct[] = [
    { type: 'nav', url: `https://${step.host ?? 'example.com'}/currency_base/daily/` },
    { type: 'click', x: 946 * k, y: 707 * (ht / 800), label: 'Подтвердить', rect: R(878, 687, 136, 40) },
    { type: 'find', label: 'Австралийский доллар', rect: R(496, 684, 134, 20), box: R(488, 676, 330, 38) },
    { type: 'click', x: 108 * k, y: 440 * (ht / 800), label: '31.10.2026', rect: R(51, 420, 115, 39) },
    { type: 'scroll', y: 1 },
  ];
  const t1: LiveTab = { id: 't1', url: `https://www.${step.host ?? 'example.com'}/currency_base/daily/`, title: 'Официальные курсы валют на заданную дату, устанавливаемые ежедневно', favicon: null, active: true };
  const t2: LiveTab = { id: 't2', url: 'https://www.dns-shop.ru/', title: 'DNS – интернет магазин цифровой и бытовой техники', favicon: null };
  h.setTabs([t1]);
  const tabsAt: Record<number, () => void> = {
    2: () => { h.act({ type: 'tab', action: 'new', id: 't2', url: t2.url }); h.setTabs([{ ...t1, active: false }, { ...t2, active: true, loading: true }]); },
    3: () => h.setTabs([{ ...t1, active: false }, { ...t2, active: true, loading: false }]),
    4: () => { h.act({ type: 'tab', action: 'select', id: 't1', url: t1.url }); h.setTabs([{ ...t1, active: true }, { ...t2, active: false }]); },
  };
  let i = 0;
  const t = window.setInterval(() => { if (h.who() === 'user') return; tabsAt[i]?.(); if (!tabsAt[i] || i > 4) h.act(script[i % script.length]); i++; }, 1400);
  return () => window.clearInterval(t);
}
