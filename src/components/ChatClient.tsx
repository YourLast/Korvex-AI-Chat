'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { IntroInvite } from './IntroInvite';
import dynamic from 'next/dynamic';
import type { PublicModel } from '@/lib/models';
import { isImage, type CompareState, type FileChip, type MsgView, type PairView } from '@/lib/types';
import { fixPair, levelOnSwitch, normalizeSel, pairFor, readPair, readPrefs, rememberLevel, rememberPair, selFromPrefs, type PairSel } from '@/lib/levels';
import { Composer, type ComposerEdit, type ComposerHandle } from './Composer';
import { DocsButton } from './OrgDocs';
import { HeldTurn, heldVariant, type HeldView } from './HeldTurn';
import { heldMorph } from '@/lib/heldMorph';
import { AssistantMsg, UserTurn } from './Message';
import { ModelName, PickerButton, levelLabel, manyModels, pairLabels, type CompareNext, type Sel, type Side } from './ModelPicker';
import { PairTurn, type Lane, type Winner } from './PairTurn';
import { useCanAgents, useIsAdmin, useShell, Topbar } from './Shell';
import { useChatStream, type TurnMode } from './useChatStream';
import { watchTemp } from '@/lib/tempClient';
import { prepareModel as warm } from '@/ext/client';
import { Icon } from './Icon';
import { useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import { putChat } from '@/lib/tcache';
import { live, useLive, useOnline } from '@/lib/live';
import { jumpTo, takePendingFind } from '@/lib/findMark';
import { WorkBar, useFeedOffscreen } from './WorkBar';
import { WorkCtx, decideStep, steerJob, type WorkActions } from './WorkCtx';
const loadLiveView = () => import('./LiveView');
const LiveView = dynamic(() => loadLiveView().then((m) => m.LiveView), { ssr: false });
import type { LiveReq } from './WorkFeed';
import { pendingCheck, type WStep } from '@/lib/work';
import { CodeBar, CodePanel, CodeStart, ModeSwitch, prefetchGithub, useCode, type CodePick, type Tab as CodeTab } from './code/Code';
import { Seg, ToastHost, toast } from './Kit';
import { useIsMobile } from './Popover';
import { Defer } from './Defer';
import { deferredKeys, feedEst, feedKey, feedOf, type FeedItem } from '@/lib/feed';
import { stripMarker } from '@/lib/format';
import { useBackClose } from '@/lib/backClose';
import { setChatFiles } from '@/lib/fileView';
import { exactTokens, setExactTokens } from '@/lib/fileTokens';
import '@/styles/user-memory.css';
import { useFeatures } from './FeaturesCtx';

const pendingSaves = new Map<string, { timer: number; s: Sel }>();
function flushSave(threadId: string) {
  const p = pendingSaves.get(threadId);
  if (!p) return;
  window.clearTimeout(p.timer);
  pendingSaves.delete(threadId);
  void fetch(`/api/threads/${threadId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: p.s.modelId, levelId: p.s.levelId }), keepalive: true }).catch(() => {});
}
export function saveThreadSel(threadId: string, s: Sel) {
  const prev = pendingSaves.get(threadId);
  if (prev) window.clearTimeout(prev.timer);
  pendingSaves.set(threadId, { s, timer: window.setTimeout(() => flushSave(threadId), 250) });
}
export const PAGE_SRC = typeof window === 'undefined' ? '' : Math.random().toString(36).slice(2, 12);
const cmpChain = new Map<string, Promise<unknown>>();
function cmpFetch(threadId: string, method: 'PUT' | 'POST', body: Record<string, unknown>, keepalive = false): Promise<Response | null> {
  const prev = cmpChain.get(threadId) ?? Promise.resolve();
  const p = prev.catch(() => null).then(() => fetch(`/api/threads/${threadId}/compare`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, src: PAGE_SRC }), keepalive }).catch(() => null));
  cmpChain.set(threadId, p);
  void p.finally(() => { if (cmpChain.get(threadId) === p) cmpChain.delete(threadId); });
  return p;
}
const pendingPairs = new Map<string, { timer: number; c: CompareState }>();
function flushPair(threadId: string) {
  const p = pendingPairs.get(threadId);
  if (!p) return;
  window.clearTimeout(p.timer);
  pendingPairs.delete(threadId);
  void cmpFetch(threadId, 'PUT', p.c, true);
}
function dropPair(threadId: string) {
  const p = pendingPairs.get(threadId);
  if (p) window.clearTimeout(p.timer);
  pendingPairs.delete(threadId);
}
function savePair(threadId: string, c: CompareState) {
  const prev = pendingPairs.get(threadId);
  if (prev) window.clearTimeout(prev.timer);
  pendingPairs.set(threadId, { c, timer: window.setTimeout(() => flushPair(threadId), 250) });
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { for (const id of [...pendingSaves.keys()]) flushSave(id); for (const id of [...pendingPairs.keys()]) flushPair(id); });

export { feedOf, type FeedItem } from '@/lib/feed';

export function voteLane(msgs: MsgView[]): Side {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const p = msgs[i].pair;
    if (!p || p.pick) continue;
    if (p.vote === 'a' || p.vote === 'b') return p.vote;
  }
  return 'a';
}
const pickLocal = (msgs: MsgView[], lane: Side) => msgs.map((m) => (m.pair && !m.pair.pick ? { ...m, pair: { ...m.pair, pick: lane } } : m));

export function takePickerParam(): string | null {
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get('picker');
    if (v === null) return null;
    u.searchParams.delete('picker');
    window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
    return v;
  } catch { return null; }
}

export function useStick() {
  const el = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const onScroll = useCallback(() => {
    const n = el.current;
    if (n) stick.current = n.scrollHeight - n.scrollTop - n.clientHeight < 96;
  }, []);
  const tick = useCallback(() => { const n = el.current; if (n && stick.current) n.scrollTop = n.scrollHeight; }, []);
  const ref = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (stick.current) node.scrollTop = node.scrollHeight; });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { tick(); const t = setTimeout(tick, 200); return () => clearTimeout(t); }, [tick]);
  return { ref, onScroll, tick, el, stick };
}

export function useSeen(id: string | null, unread: boolean, el: RefObject<HTMLDivElement | null>, stick: RefObject<boolean>, preview: boolean) {
  useEffect(() => {
    if (!id || preview) return;
    const mark = () => { if (document.visibilityState === 'visible') void fetch(`/api/threads/${id}/read`, { method: 'POST' }).catch(() => {}); };
    if (unread) mark();
    const vis = () => { if (document.visibilityState === 'visible' && unread) mark(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [id, unread, preview]);
  useEffect(() => {
    if (preview) return;
    const go = () => {
      const h = window.location.hash;
      if (!h.startsWith('#m-')) return;
      const u = new URL(window.location.href);
      if (u.searchParams.has('m')) { u.searchParams.delete('m'); window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash); }
      const p = takePendingFind(h.slice(3));
      if (p) { stick.current = false; jumpTo(p, () => { stick.current = false; }); return; }
      const t = document.getElementById(h.slice(1));
      if (!t || !el.current) return;
      stick.current = false;
      t.scrollIntoView({ block: 'start' });
      t.classList.add('ans--hl');
      window.setTimeout(() => t.classList.remove('ans--hl'), 2200);
    };
    let tm = 0;
    const r = requestAnimationFrame(() => { tm = window.setTimeout(go, 60); });
    window.addEventListener('hashchange', go);
    return () => { cancelAnimationFrame(r); window.clearTimeout(tm); window.removeEventListener('hashchange', go); };
  }, [el, stick, preview]);
}

export function TempButton({ on, onChange, testId = 'temp-chat' }: { on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  const tx = useT();
  return (
    <button type="button" className="icon-btn temp-btn" aria-pressed={on} aria-label={on ? tx('chat.tempOff') : tx('chat.temp')} title={on ? tx('chat.tempTitleOn') : tx('chat.tempTitleOff')}
      data-testid={testId} onClick={() => onChange(!on)} style={on ? { color: 'var(--text-strong)', background: 'var(--surface-3)' } : undefined}>
      <Icon n="temp" />
    </button>
  );
}

export function MuteButton({ id, muted }: { id: string | null; muted: boolean }) {
  const tx = useT();
  const [m, setM] = useState(muted);
  useEffect(() => setM(muted), [muted]);
  if (!id) return null;
  return (
    <button type="button" className="icon-btn only-d" aria-pressed={m} aria-label={m ? tx('chat.muteOn') : tx('chat.muteOff')} title={m ? tx('chat.muteTitleOn') : tx('chat.muteTitleOff')}
      data-testid="mute" onClick={() => { const v = !m; setM(v); void fetch(`/api/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: v }) }).then((r) => { if (!r.ok) setM(!v); }); }}>
      <Icon n={m ? 'bell-off' : 'bell'} />
    </button>
  );
}

export function useOlder(el: RefObject<HTMLDivElement | null>, hasMore: boolean, load: () => Promise<boolean>, firstId: string | undefined) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ h: number; top: number; first?: string } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const s = sentinel.current, root = el.current;
    if (!s || !root || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting) || busy.current) return;
      busy.current = true;
      anchor.current = { h: root.scrollHeight, top: root.scrollTop, first: firstId };
      void load().finally(() => { busy.current = false; });
    }, { root, rootMargin: '800px 0px 0px 0px' });
    io.observe(s);
    return () => io.disconnect();
  }, [el, hasMore, load, firstId]);
  useLayoutEffect(() => {
    const a = anchor.current, root = el.current;
    if (!a || !root || a.first === firstId) return;
    root.scrollTop = a.top + (root.scrollHeight - a.h);
    anchor.current = null;
  }, [firstId, el]);
  return sentinel;
}

const SUGGEST = ['chat.sug1', 'chat.sug2', 'chat.sug3'] as const;
const SUGGEST_CODE = ['chat.cug1', 'chat.cug2', 'chat.cug3'] as const;

export function ChatClient({ models: modelsProp, thread, initial, fileNames: initialFiles, hasMore: initialMore = false, preview = false, startCompare = false, startTemp = false, startCode = false, focus = null }: {
  models: PublicModel[]; thread: { id: string; title: string; modelId: string; effort: string; compare?: CompareState | null; temporary?: boolean } | null; initial: MsgView[]; fileNames: string[];
  hasMore?: boolean; preview?: boolean;
  startCompare?: boolean;
  startTemp?: boolean;
  startCode?: boolean;
  focus?: string | null;
}) {
  const feat = useFeatures();
  const tx = useT();
  const shell = useShell();
  const { refresh } = shell;
  const models = shell?.models ?? modelsProp;
  const [threadId, setThreadId] = useState<string | null>(thread?.id ?? null);
  const [temp, setTemp] = useState<boolean>(thread ? !!thread.temporary : startTemp);
  const [title, setTitle] = useState(thread?.title ?? '');
  const [sel, setSel] = useState<Sel>(() => normalizeSel(models, thread ? { modelId: thread.modelId, levelId: thread.effort } : null));
  const [cmp, setCmp] = useState<CompareState | null>(() => {
    const p = thread?.compare ? fixPair(models, { model: '', levels: {} }, thread.compare) : null;
    return p ? { on: thread!.compare!.on, ...p } : null;
  });
  const cmpRef = useRef(cmp);
  cmpRef.current = cmp;
  const [tab, setTab] = useState<Side>('a');
  const mem = useRef<Record<string, string>>({});
  const choseAt = useRef(0);
  const [pickOpen, setPickOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const [ready, setReady] = useState(!!thread);
  const [fileNames, setFileNames] = useState(initialFiles);
  const agents = useCanAgents() && feat.code;
  const [codeMode, setCodeMode] = useState(!!startCode && !thread && agents);
  const [pick, setPick] = useState<CodePick | null>(null);
  const [panel, setPanel] = useState<{ open: boolean; tab?: CodeTab }>({ open: false });
  const switchMode = useCallback((on: boolean) => {
    setCodeMode(on);
    try {
      const u = new URL(window.location.href);
      if (on) u.searchParams.set('mode', 'code'); else u.searchParams.delete('mode');
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    } catch {  }
  }, []);
  const { msgs, setMsgs, busy, send, stop, switchTo, reload, hasMore, older, loadingOlder } = useChatStream(initial, initialMore, threadId);
  useEffect(() => {
    const by = new Map<string, FileChip>();
    for (const m of msgs) for (const f of m.files ?? []) by.set(f.id, f);
    setChatFiles([...by.values()]);
  }, [msgs]);
  useEffect(() => () => setChatFiles([]), []);
  useEffect(() => { setExactTokens(exactTokens(msgs)); }, [msgs]);
  useEffect(() => () => setExactTokens(exactTokens([])), []);
  useEffect(() => { if (!thread && ready && !preview && !startTemp) warm('new-chat', sel); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!temp || !threadId || preview) return;
    return watchTemp(threadId, () => window.location.replace('/?temp=1'));
  }, [temp, threadId, preview]);
  const [deferred] = useState(() => deferredKeys(initial, focus));
  const [liveReq, setLiveReq] = useState<(LiveReq & { msgId: string | null }) | null>(null);
  const working = [...msgs].reverse().find((m) => m.role === 'assistant' && m.streaming && !m.meta?.lane) ?? null;
  const offscreen = useFeedOffscreen(!preview && working ? working.id : null);
  const online = useOnline();
  const [net, setNet] = useState<'ok' | 'down' | 'back'>('ok');
  useEffect(() => {
    if (!online) { const t = window.setTimeout(() => setNet('down'), 1200); return () => window.clearTimeout(t); }
    setNet((n) => (n === 'down' ? 'back' : n));
    const t = window.setTimeout(() => setNet('ok'), 1600);
    return () => window.clearTimeout(t);
  }, [online]);
  const barFor = !preview && working && offscreen ? working.id : null;
  const workActions = useMemo<WorkActions>(() => ({
    openLive: (r) => setLiveReq({ ...r, msgId: null }),
    decide: async (jobId, s, allow) => {
      const ok = await decideStep(jobId, s.id, allow);
      if (!ok) toast(tx('chat.errPass'), 'error');
      return ok;
    },
    barFor,
    liveId: liveReq?.step.id ?? null,
  }), [barFor, liveReq?.step.id, tx]);
  const hasBrowser = !preview && msgs.some((m) => m.steps?.some((x) => x.kind === 'browser'));
  useEffect(() => {
    if (!hasBrowser) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const go = () => { void loadLiveView().catch(() => {}); };
    if (w.requestIdleCallback) { const h = w.requestIdleCallback(go, { timeout: 4000 }); return () => w.cancelIdleCallback?.(h); }
    const t = window.setTimeout(go, 1500); return () => window.clearTimeout(t);
  }, [hasBrowser]);
  const workJob = working?.jobId ?? null;
  const onSteer = useCallback(async (text: string) => {
    if (!workJob) { toast(tx('chat.errAgentStarting'), 'error'); return false; }
    const r = await steerJob(workJob, text);
    if (!r.ok) toast(r.status === 404 ? tx('chat.errNoSteer') : tx('chat.errSteer'), 'error');
    return r.ok;
  }, [workJob, tx]);
  const showFeed = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent('kx:work-open', { detail: { id } }));
    document.getElementById(`m-${id}`)?.querySelector('[data-work]')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  const code = useCode(preview || !agents ? null : threadId);
  const narrow = useIsMobile();
  useEffect(() => { if (!thread && !preview && agents) { const h = window.setTimeout(() => void prefetchGithub(), 0); return () => window.clearTimeout(h); } }, [thread, preview, agents]);
  const listTitle = shell?.threads.find((t) => t.id === threadId)?.title;
  const listMuted = !!shell?.threads.find((t) => t.id === threadId)?.muted;
  useEffect(() => { if (preview || !threadId) return; live?.setThreads([threadId]); return () => live?.setThreads([]); }, [preview, threadId]);
  useLive((e) => {
    if (preview) return;
    if (e.t === 'sel' && e.th === threadId) {
      if (Date.now() - choseAt.current < 3000) return;
      const s = normalizeSel(models, { modelId: String(e.modelId), levelId: String(e.levelId) });
      if (s.modelId !== sel.modelId || s.levelId !== sel.levelId) { setSel(s); mem.current[s.modelId] = s.levelId; }
    } else if (e.t === 'cmp' && e.th === threadId) {
      if (e.src && e.src === PAGE_SRC) return;
      const cur = cmpRef.current;
      const a = e.a ? normalizeSel(models, e.a as Sel) : cur?.a, b = e.b ? normalizeSel(models, e.b as Sel) : cur?.b;
      if (a && b) setCmp({ on: !!e.on, a, b });
      if (!e.on && e.lane) setMsgs((all) => pickLocal(all, e.lane as Side));
    } else if (e.t === 'memupd' && e.th === threadId) {
      setMsgs((all) => all.map((x) => (x.id === e.m ? { ...x, meta: { ...(x.meta ?? {}), memUpd: e.items as { op: string; text: string; id?: string }[] } } : x)));
    } else if (e.t === 'vote') {
      setMsgs((all) => all.map((m) => (m.pair && m.pair.a === e.a && m.pair.b === e.b ? { ...m, pair: { ...m.pair, vote: (e.winner as Winner | null) ?? null } } : m)));
    }
  });
  const { ref: scrollRef, onScroll, tick, el: scrollEl, stick } = useStick();
  const me = shell?.threads.find((t) => t.id === threadId);
  useSeen(threadId, !!me?.unread, scrollEl, stick, preview);
  const loadOlder = useCallback(() => (threadId && !preview ? older(threadId) : Promise.resolve(false)), [threadId, older, preview]);
  const sentinel = useOlder(scrollEl, hasMore && !preview, loadOlder, msgs[0]?.id);
  useEffect(() => {
    if (preview || busy || !threadId || !msgs.length) return;
    putChat({ id: threadId, title: title || tx('shell.newChat'), modelId: sel.modelId, effort: sel.levelId, compare: cmp, messages: msgs, hasMore, fileNames });
  }, [preview, busy, threadId, msgs, hasMore, title, sel, cmp, fileNames]);
  const comp = useRef<ComposerHandle>(null);
  const docOrg = (thread ? shell.threads.find((x) => x.id === thread.id)?.folderId : null) ?? shell.org ?? null;
  const docOrgName = docOrg ? shell.folders?.find((f) => f.id === docOrg)?.name ?? null : null;
  const [held, setHeld] = useState<HeldView[]>([]);
  const [heldGone, setHeldGone] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => { setHeldGone((g) => { const live = new Set(held.map((h) => h.id)); const n = new Set([...g].filter((id) => live.has(id))); return n.size === g.size ? g : n; }); }, [held]);

  useEffect(() => {
    const p = readPrefs(models);
    mem.current = { ...p.levels };
    const s = thread ? sel : selFromPrefs(models, p);
    mem.current[s.modelId] = s.levelId;
    if (!thread) setSel(s);
    if (!thread && startCompare) { const r = pairFor(models, p, s, null, readPair(models)); setCmp({ on: true, ...r.pair }); setTab(r.tab); }
    setReady(true);
    if (!preview && takePickerParam() !== null) { setInstant(true); setPickOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { tick(); });

  const cmpOn = !!cmp?.on;
  const pair: PairSel | undefined = cmp ? { a: cmp.a, b: cmp.b } : undefined;

  const choose = useCallback((s: Sel) => {
    choseAt.current = Date.now();
    setSel(s);
    mem.current[s.modelId] = s.levelId;
    rememberLevel(models, s, true);
    if (threadId) saveThreadSel(threadId, s);
  }, [models, threadId]);
  const onModel = useCallback((modelId: string) => {
    if (modelId === sel.modelId) return;
    choose({ modelId, levelId: levelOnSwitch(models, modelId, sel, mem.current) });
  }, [models, sel, choose]);
  const onLevel = useCallback((levelId: string) => choose({ ...sel, levelId }), [sel, choose]);

  const setSide = useCallback((side: Side, s: Sel) => {
    const c = cmpRef.current;
    if (!c) return;
    const next = { ...c, [side]: s };
    setCmp(next);
    rememberLevel(models, s, false);
    rememberPair(models, { a: next.a, b: next.b });
    if (threadId) savePair(threadId, next);
  }, [models, threadId]);
  const onPairLevel = useCallback((levelId: string) => { const c = cmpRef.current; if (c) setSide(tab, { ...c[tab], levelId }); }, [tab, setSide]);
  const onPairModel = useCallback((side: Side, modelId: string) => {
    const c = cmpRef.current;
    if (!c) return;
    setSide(side, { modelId, levelId: levelOnSwitch(models, modelId, c[side], readPrefs(models).levels) });
  }, [models, setSide]);

  const toggleCompare = useCallback((on: boolean, next?: CompareNext) => {
    if (preview) return;
    if (on) {
      const r = next ? { pair: next.pair, tab: next.tab } : pairFor(models, readPrefs(models), sel, pair ?? null, readPair(models));
      const c: CompareState = { on: true, a: normalizeSel(models, r.pair.a), b: normalizeSel(models, r.pair.b) };
      setCmp(c); setTab(r.tab);
      rememberPair(models, { a: c.a, b: c.b });
      rememberLevel(models, c.a, false); rememberLevel(models, c.b, false);
      if (threadId) { dropPair(threadId); void cmpFetch(threadId, 'PUT', c); }
      return;
    }
    const c = cmpRef.current;
    if (!c) return;
    const lane: Side = next?.tab ?? voteLane(msgs);
    const s = normalizeSel(models, next?.sel ?? c[lane]);
    setCmp({ ...c, on: false });
    setMsgs((all) => pickLocal(all, lane));
    setSel(s); mem.current[s.modelId] = s.levelId; rememberLevel(models, s, true);
    if (threadId) {
      dropPair(threadId);
      void cmpFetch(threadId, 'PUT', { on: false, lane, a: c.a, b: c.b })
        .then(() => { if (s.modelId !== c[lane].modelId || s.levelId !== c[lane].levelId) saveThreadSel(threadId, s); void reload(threadId); });
    }
  }, [preview, models, sel, pair, threadId, msgs, setMsgs, reload]);
  const onCompare = useCallback((on: boolean, next?: CompareNext) => toggleCompare(on, next), [toggleCompare]);

  const pickAnswer = useCallback(async (m: MsgView) => {
    if (!threadId) return;
    const c = cmpRef.current;
    const lane = (m.meta?.lane ?? 'a') as Side;
    const s = normalizeSel(models, { modelId: m.meta?.modelId, levelId: m.meta?.levelId });
    if (c) setCmp({ ...c, on: false });
    setMsgs((all) => pickLocal(all, lane));
    setSel(s); mem.current[s.modelId] = s.levelId; rememberLevel(models, s, true);
    dropPair(threadId);
    await cmpFetch(threadId, 'POST', { pick: m.id });
    void reload(threadId);
  }, [threadId, models, setMsgs, reload]);

  const doSend = useCallback(async (text: string, files: FileChip[], opts?: { mode?: TurnMode; editId?: string; use?: Sel; replaceFiles?: boolean; holdId?: string }) => {
    const s = normalizeSel(models, opts?.use ?? sel);
    const c = cmpRef.current;
    const mode = opts?.mode ?? 'send';
    const asPair = !!c?.on && (mode === 'send' || mode === 'edit');
    let id = threadId;
    if (!id && codeMode && !pick) { toast(tx('chat.pickRepo'), 'error'); return false; }
    if (!id) {
      const r = await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, ...(c && !codeMode ? { compare: c } : {}), ...(temp ? { temporary: true } : {}), ...(!temp && shell.orgMode && shell.org ? { folderId: shell.org } : {}) }) }).catch(() => null);
      if (!r?.ok) { toast(r ? tx('chat.errNoChat') : tx('chat.errOffline'), 'error'); return false; }
      id = ((await r.json()) as { id: string }).id;
      if (codeMode && pick) {
        const cr = await fetch(`/api/code/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pick) }).catch(() => null);
        if (!cr?.ok) { const ce = ((await cr?.json().catch(() => null)) as { error?: string } | null)?.error; toast(ce ? errText(tx.lang, ce) : tx('chat.errRepo'), 'error'); }
      }
      setThreadId(id);
      window.history.replaceState(null, '', `/c/${id}`);
    }
    if (!opts?.use && !asPair) rememberLevel(models, s, true);
    if (files.length) setFileNames((n) => [...new Set([...n, ...files.filter((f) => !isImage(f)).map((f) => f.name)])]);
    const holdId = opts?.holdId;
    const wrap = holdId ? (apply: () => void) => heldMorph(() => { apply(); setHeldGone((g) => new Set(g).add(holdId)); }) : undefined;
    if (asPair) {
      flushPair(id);
      await send({ threadId: id, text, files, fileIds: files.map((f) => f.id), modelId: c!.a.modelId, levelId: c!.a.levelId, mode, editId: opts?.editId, replaceFiles: opts?.replaceFiles, pair: { a: c!.a, b: c!.b }, wrap }, (t) => { setTitle(t); });
    } else {
      await send({ threadId: id, text, files, fileIds: files.map((f) => f.id), modelId: s.modelId, levelId: s.levelId, mode: opts?.mode, editId: opts?.editId, replaceFiles: opts?.replaceFiles, wrap }, (t) => { setTitle(t); });
    }
    refresh();
    return true;
  }, [threadId, sel, send, refresh, models, temp, codeMode, pick]);

  const laneTurn = useCallback(async (lane: Lane, mode: 'regenerate' | 'continue', m: MsgView) => {
    if (!threadId) return;
    const c = cmpRef.current;
    const use = mode === 'continue' || !c ? normalizeSel(models, { modelId: m.meta?.modelId, levelId: m.meta?.levelId }) : c[lane];
    await send({ threadId, text: '', modelId: use.modelId, levelId: use.levelId, mode, lane, messageId: m.id });
    refresh();
  }, [threadId, models, send, refresh]);

  const retryOn = useCallback((alt: { id: string }, userMsg: MsgView, errMsg: MsgView) => {
    setMsgs((all) => all.filter((x) => x.id !== userMsg.id && x.id !== errMsg.id));
    const s = normalizeSel(models, { modelId: alt.id, levelId: levelOnSwitch(models, alt.id, sel, mem.current) });
    choose(s);
    void doSend(userMsg.content, userMsg.files ?? [], { use: s });
  }, [models, sel, choose, doSend, setMsgs]);

  const [editing, setEditing] = useState<MsgView | null>(null);
  const editRef = useRef(editing);
  editRef.current = editing;
  const editView = useMemo<ComposerEdit | null>(() => (editing ? { id: editing.id, text: stripMarker(editing.content), files: editing.files ?? [] } : null), [editing]);
  const cancelEdit = useCallback(() => { setEditing(null); onScroll(); }, [onScroll]);
  useBackClose(!!editing, cancelEdit);
  const startEdit = useCallback((m: MsgView) => {
    if (preview || busy) return;
    stick.current = false;
    setEditing(m);
    comp.current?.focus();
  }, [preview, busy, stick]);
  const sendEdit = useCallback((text: string, files: FileChip[]) => {
    const m = editRef.current;
    if (!m) return doSend(text, files);
    setEditing(null);
    stick.current = true;
    return doSend(text, files, { mode: 'edit', editId: m.id, replaceFiles: true });
  }, [doSend, stick]);
  useEffect(() => { if (editing && !msgs.some((x) => x.id === editing.id)) setEditing(null); }, [msgs, editing]);
  useEffect(() => {
    const root = scrollEl.current;
    if (!editing || !root) return;
    let moved = false;
    const show = () => {
      const el = document.getElementById(`m-${editing.id}`);
      if (!el || moved) return;
      const r = el.getBoundingClientRect(), v = root.getBoundingClientRect();
      const top = v.top + 28, bottom = v.bottom - 12;
      const d = r.height > bottom - top ? r.bottom - bottom : r.top < top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0;
      if (Math.abs(d) > 1) root.scrollTop += d;
    };
    const user = () => { moved = true; };
    const raf = requestAnimationFrame(show);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => show());
    ro?.observe(root);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', show);
    root.addEventListener('touchmove', user, { passive: true });
    root.addEventListener('wheel', user, { passive: true });
    return () => {
      cancelAnimationFrame(raf); ro?.disconnect(); vv?.removeEventListener('resize', show);
      root.removeEventListener('touchmove', user); root.removeEventListener('wheel', user);
    };
  }, [editing, scrollEl]);
  const onThreadScroll = useCallback(() => { onScroll(); if (editRef.current) stick.current = false; }, [onScroll, stick]);

  const empty = msgs.length === 0;
  const many = manyModels(models);
  const lab = levelLabel(models, sel);
  const [la, lb] = cmp ? pairLabels(models, cmp.a, cmp.b) : [null, null];
  const openPicker = (o: boolean) => {
    if (o && cmpRef.current?.on) setTab(voteLane(msgs));
    setPickOpen(o); if (!o) setInstant(false);
  };
  const slot = (
    <PickerButton models={models} compare={cmpOn} sel={cmpOn && cmp ? cmp[tab] : sel} pair={pair} tab={tab} onTab={setTab} pairAny
      onModel={onModel} onLevel={cmpOn ? onPairLevel : onLevel} onPairModel={onPairModel} onCompare={onCompare}
      compareNote={many
        ? (cmpOn ? tx('chat.cmpNoteManyOn') : empty ? tx('chat.cmpNoteManyEmpty') : tx('chat.cmpNoteManyNext'))
        : (cmpOn ? tx('chat.cmpNoteOneOn') : empty ? tx('chat.cmpNoteOneEmpty') : tx('chat.cmpNoteOneNext'))}
      open={pickOpen} onOpenChange={openPicker} instant={instant} pending={!ready} />
  );
  const feed = feedOf(msgs);
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const lastPairU = [...feed].reverse().find((x) => x.kind === 'pair' || x.kind === 'ans');
  const answerSel = (m: MsgView): Sel | undefined => (m.meta?.modelId && m.meta?.levelId ? normalizeSel(models, { modelId: m.meta.modelId, levelId: m.meta.levelId }) : undefined);
  const imgOk = cmpOn && cmp ? models.find((m) => m.id === cmp.a.modelId)?.images !== false && models.find((m) => m.id === cmp.b.modelId)?.images !== false : models.find((m) => m.id === sel.modelId)?.images !== false;

  const item = (it: FeedItem) => {
    if (it.kind === 'user') {
      const m = it.m;
      return <UserTurn key={m.id} m={m} busy={busy} onEdit={(t) => doSend(t, [], { mode: 'edit', editId: m.id })} onSwitch={(id) => threadId && switchTo(threadId, id)}
        onEditStart={narrow && !preview ? () => startEdit(m) : undefined} marked={editing?.id === m.id} />;
    }
    if (it.kind === 'pair') {
      const isLast = it === lastPairU;
      return (
        <PairTurn key={`p-${it.u.id}`} u={it.u} a={it.a} b={it.b} models={models} fileNames={fileNames} last={isLast} open={!it.u.pair.pick && cmpOn} busy={busy}
          onRegen={(l, m) => void laneTurn(l, 'regenerate', m)} onContinue={(l, m) => void laneTurn(l, 'continue', m)} onSwitch={(id) => threadId && switchTo(threadId, id)}
          onPick={(m) => void pickAnswer(m)}
          onVoted={(w) => setMsgs((all) => all.map((x) => (x.id === it.u.id && x.pair ? { ...x, pair: { ...x.pair, vote: w } } : x)))} />
      );
    }
    const m = it.m, i = it.i;
    return (
      <AssistantMsg key={m.id} m={m} models={models} last={m === lastAssistant && !m.meta?.lane} canRegen={!busy} fileNames={fileNames}
        onRegenerate={() => doSend('', [], { mode: 'regenerate' })} onContinue={() => doSend('', [], { mode: 'continue', use: answerSel(m) })} onSwitch={(id) => threadId && switchTo(threadId, id)}
        onAlt={m.meta?.altModel && msgs[i - 1]?.role === 'user' && msgs[i - 1].id.startsWith('u-') ? (alt) => retryOn(alt, msgs[i - 1], m) : undefined} />
    );
  };

  return (
    <WorkCtx.Provider value={workActions}>
      <Topbar title={listTitle || title || tx('shell.newChat')} home={empty} mode="single" compareOn={cmpOn} onCompare={preview || (!feat.compare && !cmpOn) ? undefined : () => toggleCompare(!cmpOn)}
        chat={threadId && !preview && !empty ? { id: threadId, title: listTitle || title || tx('shell.newChat'), muted: listMuted, temporary: temp } : undefined}
        sub={ready ? (cmpOn && la && lb
          ? <><ModelName name={la.name} suffix={la.suffix} /> · {la.level}  ×  <ModelName name={lb.name} suffix={lb.suffix} /> · {lb.level}</>
          : <><ModelName name={lab.name} suffix={lab.suffix} /> · {lab.level}</>) : ' '}>
        {empty && !threadId && !preview && <TempButton on={temp} onChange={setTemp} />}
        {!empty && !preview && <MuteButton id={threadId} muted={listMuted} />}
      </Topbar>
      {net !== 'ok' && (working || net === 'back') && (
        <div className={`net-bar${net === 'back' ? ' is-back' : ''}`} role="status" aria-live="polite" data-testid="net-bar">
          {net === 'down' ? <><i className="k-spin" aria-hidden="true" />{tx('chat.netDown')}</> : <><Icon n="check" sm />{tx('chat.netBack')}</>}
        </div>
      )}
      {temp && !empty && <div className="temp-note" data-testid="temp-note"><Icon n="temp" sm /><span>{tx('chat.tempNote')}</span></div>}
      {}
      {empty && !threadId && !preview && <div className="temp-corner only-d"><TempButton on={temp} onChange={setTemp} testId="temp-chat-d" /></div>}
      {empty && !held.length ? (
        <div className="home" data-testid="home" data-compare={cmpOn || undefined} data-code={(codeMode && !cmpOn) || undefined}>
          {agents && !cmpOn && !threadId && !preview && <div className="home-mode"><ModeSwitch code={codeMode} onChange={switchMode} /></div>}
          {}
          <div className="home-panes">
            <div className="home-pane" data-pane="chat" aria-hidden={(codeMode && !cmpOn) || undefined} inert={(codeMode && !cmpOn) || undefined}>
              <div className="home-hero">
                <span className="mark" aria-hidden="true" />
                <h1 className="t-display">{cmpOn ? (many ? tx('chat.heroCmpMany') : tx('chat.heroCmpOne')) : temp ? tx('chat.temp') : tx('chat.heroHelp')}</h1>
                <p>{temp && !cmpOn ? tx('chat.heroTempText') : cmpOn
                  ? (many ? tx('chat.heroCmpManyText') : tx('chat.heroCmpOneText'))
                  : tx('chat.heroText')}</p>
              </div>
              {!cmpOn && (
                <div className="suggest">
                  <h2>{tx('chat.tryTitle')}</h2>
                  {SUGGEST.map((k) => { const s = tx(k); return (
                    <a key={k} href="#" onClick={(e) => { e.preventDefault(); comp.current?.setText(s); comp.current?.focus(); }}>
                      <Icon n="chat" sm /><span>{s}</span><Icon n="arrow-ur" sm className="go" />
                    </a>
                  ); })}
                </div>
              )}
            </div>
            {agents && !cmpOn && !threadId && !preview && (
              <div className="home-pane" data-pane="code" aria-hidden={!codeMode || undefined} inert={!codeMode || undefined}>
                <div className="home-hero">
                  <span className="mark" aria-hidden="true" />
                  <h1 className="t-display">{tx('chat.codeHero')}</h1>
                  <p>{tx('chat.codeText')}</p>
                </div>
                <CodeStart value={pick} onChange={setPick} active={codeMode} />
                {pick && (
                  <div className="suggest">
                    <h2>{tx('chat.forExample')}</h2>
                    {SUGGEST_CODE.map((k) => { const s = tx(k); return (
                      <a key={k} href="#" onClick={(e) => { e.preventDefault(); comp.current?.setText(s); comp.current?.focus(); }}>
                        <Icon n="code" sm /><span>{s}</span><Icon n="arrow-ur" sm className="go" />
                      </a>
                    ); })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
        {code.st && <CodeBar st={code.st} onOpen={(tab) => setPanel({ open: true, tab })} />}
        <div className="thread" ref={scrollRef} onScroll={onThreadScroll} data-testid="thread">
          <div className="thread-in">
            {hasMore && <div ref={sentinel} className="older" data-testid="older">{loadingOlder ? <span className="shimmer">{tx('chat.loadingOlder')}</span> : <span>{tx('chat.older')}</span>}</div>}
            {feed.map((it) => {
              const k = feedKey(it);
              if (deferred.has(k)) return <Defer key={k} est={feedEst(it)}>{item(it)}</Defer>;
              return item(it);
            })}
            {held.filter((h) => !heldGone.has(h.id)).map((h) => <HeldTurn key={h.id} h={h} variant={heldVariant()} onCancel={(id) => comp.current?.cancelHold(id)} />)}
          </div>
        </div>
        </>
      )}
      {}
      <ToastHost />
      {code.st && threadId && <CodePanel threadId={threadId} st={code.st} rev={code.rev} open={panel.open} tab={panel.tab} onClose={() => setPanel({ open: false })} reload={() => void code.reload()} />}
      {}
      <Composer ref={comp} busy={busy} onHolds={setHeld}
        docsSlot={shell.orgMode && docOrg ? <DocsButton org={docOrg} orgName={docOrgName} onAdd={(c, text) => { comp.current?.addFiles(c); if (text) { comp.current?.setText(text); comp.current?.focus(); } }} /> : undefined}
        overlay={!preview && working ? <WorkBar m={working} offscreen={offscreen} onDecide={workJob ? (st, allow) => { void workActions.decide(workJob, st, allow); } : undefined} onShowFeed={showFeed} onLive={(st, all) => workActions.openLive({ step: st, all })} /> : !preview && !temp && !busy && !cmpOn && !codeMode ? <IntroInvite /> : null}
        onSteer={!preview && working && !cmpOn ? onSteer : undefined} placeholder={cmpOn ? (many ? tx('chat.phCmpMany') : tx('chat.phCmpOne')) : codeMode || code.st ? (narrow ? tx('chat.phCodeShort') : tx('chat.phCode')) : empty ? tx('chat.phEmpty') : tx('chat.phNext')} modelSlot={slot} onStop={stop}
        onSend={(t, f, o) => (editRef.current ? sendEdit(t, f) : doSend(t, f, o?.holdId ? { holdId: o.holdId } : undefined))} edit={editView} onEditCancel={cancelEdit}
        acceptImages={imgOk} modelId={cmpOn && cmp ? cmp.a.modelId : sel.modelId} footNote={tx('chat.footNote')} />
      {liveReq && (() => {
        const lm = msgs.find((m) => m.steps?.some((x) => x.id === liveReq.step.id || x.parent === liveReq.step.id || liveReq.step.kids?.some((k) => k.id === x.id))) ?? working;
        const i0 = lm ? msgs.indexOf(lm) : -1;
        const conv = i0 >= 0 ? msgs.slice(i0 > 0 && msgs[i0 - 1].role === 'user' ? i0 - 1 : i0) : [];
        const cur = [...conv].reverse().find((m) => m.role === 'assistant') ?? lm;
        const say = async (text: string) => {
          const job = cur?.streaming ? cur.jobId ?? cur.meta?.jobId : null;
          if (job) { const r = await steerJob(job, text); if (!r.ok) toast(tx('chat.errSteer'), 'error'); return r.ok; }
          void doSend(text, []);
          return true;
        };
        const chk = !preview && working ? pendingCheck(working.steps) : null;
        const chkJob = working?.jobId ?? working?.meta?.jobId ?? null;
        const check = chk ? { ...chk.check, id: chk.id } : null;
        const onCheckDone = chk && chkJob ? () => { void workActions.decide(chkJob, { id: chk.id } as WStep, true); } : undefined;
        return <LiveView step={liveReq.step} all={liveReq.all} live={!!lm?.streaming} msg={cur} conv={conv} onSay={preview ? undefined : say} onClose={() => setLiveReq(null)} check={check} onCheckDone={onCheckDone} />;
      })()}
    </WorkCtx.Provider>
  );
}
