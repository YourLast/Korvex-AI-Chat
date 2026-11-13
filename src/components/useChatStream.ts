'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileChip, MsgView } from '@/lib/types';
import type { StepEvent } from '@/lib/tools/types';
import { serverNow, setServerNow } from '@/lib/clock';
import { useLive, type LiveEv } from '@/lib/live';
import { browserTimeZone } from '@/lib/tz';
import { serveQueueOf } from '@/lib/queueEta';

export type TurnMode = 'send' | 'regenerate' | 'edit' | 'continue';
export type SendArgs = {
  threadId: string;
  text: string;
  fileIds?: string[];
  files?: FileChip[];
  modelId: string;
  levelId: string;
  mode?: TurnMode;
  editId?: string;
  replaceFiles?: boolean;
  pair?: { a: { modelId: string; levelId: string }; b: { modelId: string; levelId: string } };
  lane?: 'a' | 'b';
  messageId?: string;
  wrap?: (apply: () => void) => void;
};
type Delta = { t: 'd'; th: string; m: string; k: 'c' | 'r'; o: number; d: string; g?: { n: number; ms: number } };

export function keepTop(shown: readonly MsgView[], snap: MsgView[], hasMore: boolean): { messages: MsgView[]; hasMore: boolean } {
  const first = shown[0]?.id;
  const k = first ? snap.findIndex((m) => m.id === first) : -1;
  return k > 0 ? { messages: snap.slice(k), hasMore: true } : { messages: snap, hasMore };
}

export function useChatStream(initial: MsgView[], initialHasMore = false, threadId: string | null = null, opts: { quiet?: boolean } = {}) {
  const [msgs, setState] = useState<MsgView[]>(initial);
  const ref = useRef<MsgView[]>(initial);
  const setMsgs = useCallback((fn: MsgView[] | ((m: MsgView[]) => MsgView[])) => {
    const next = typeof fn === 'function' ? fn(ref.current) : fn;
    ref.current = next;
    setState(next);
  }, []);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const tid = useRef<string | null>(threadId);
  tid.current = threadId ?? tid.current;
  const st = useRef({ hasMore: initialHasMore, loadingOlder: false, reloading: null as Promise<void> | null, again: false, buffer: null as Delta[] | null, steps: [] as [string, StepEvent][], stopAsked: false, failed: 0, retry: 0, msgAt: 0 });
  st.current.hasMore = hasMore;
  const shownTurns = () => Math.max(8, ref.current.filter((m) => m.role === 'user').length + 1);

  const applyStep = useCallback((mid: string, sv: StepEvent) => {
    setMsgs((all) => all.map((m) => {
      if (m.id !== mid) return m;
      const list = m.steps ?? [];
      const i = list.findIndex((x) => x.id === sv.id);
      if (i >= 0 && ['ok', 'err', 'denied', 'stopped'].includes(list[i].status) && !['ok', 'err', 'denied', 'stopped'].includes(sv.status)) return m;
      return { ...m, steps: i < 0 ? [...list, sv] : list.map((x, j) => (j === i ? sv : x)) };
    }));
  }, [setMsgs]);

  const applyDelta = useCallback((e: Delta): boolean => {
    const i = ref.current.findIndex((m) => m.id === e.m);
    if (i < 0) return false;
    const m = ref.current[i];
    const cur = e.k === 'c' ? m.content : (m.reasoning ?? '');
    if (e.o > cur.length) return false;
    if (e.o + e.d.length <= cur.length) return true;
    const add = e.d.slice(cur.length - e.o);
    const g = e.g ?? m.liveGen;
    const next: MsgView = e.k === 'c'
      ? { ...m, content: cur + add, phase: 'answer', streaming: true, liveGen: g }
      : { ...m, reasoning: cur + add, phase: m.content ? m.phase : 'think', rStartedAt: m.rStartedAt ?? serverNow(), streaming: true, liveGen: g };
    setMsgs((all) => all.map((x, j) => (j === i ? next : x)));
    return true;
  }, [setMsgs]);

  const reload = useCallback(async (threadId?: string): Promise<void> => {
    const id = threadId ?? tid.current;
    if (!id) return;
    const s = st.current;
    if (s.reloading) { s.again = true; return s.reloading; }
    s.buffer = [];
    const p = (async () => {
      try {
        const r = await fetch(`/api/threads/${id}/path?turns=${shownTurns()}`, { cache: 'no-store' });
        if (!r.ok) { if (r.status >= 500) throw new Error(String(r.status)); return; }
        s.failed = 0;
        const j = (await r.json()) as { messages: MsgView[]; hasMore: boolean; now?: number };
        if (j.now) setServerNow(j.now);
        if (id !== tid.current) return;
        const v = keepTop(ref.current, j.messages, j.hasMore);
        setMsgs(v.messages);
        setHasMore(v.hasMore);
        const buf = s.buffer ?? [];
        s.buffer = null;
        for (const e of buf) applyDelta(e);
        for (const [mid, sv] of s.steps.splice(0)) applyStep(mid, sv);
      } catch {
        s.failed++;
        window.clearTimeout(s.retry);
        if (s.failed <= 20) s.retry = window.setTimeout(() => { void reload(id); }, Math.min(10_000, 1000 * s.failed));
      } finally {
        s.buffer = null;
        s.reloading = null;
      }
    })();
    s.reloading = p;
    await p;
    if (s.again) { s.again = false; await reload(id); }
  }, [applyDelta, applyStep, setMsgs]);

  useLive((e: LiveEv) => {
    const id = tid.current;
    if (!id) return;
    if (e.t === 'sync') { void reload(id); return; }
    if (e.t === 'hello') { if (st.current.failed || ref.current.some((m) => m.streaming)) void reload(id); return; }
    if (e.th !== id) return;
    if (e.t === 'd') {
      const d = e as unknown as Delta;
      if (st.current.buffer) { st.current.buffer.push(d); applyDelta(d); return; }
      if (!applyDelta(d)) void reload(id);
    } else if (e.t === 'msg') {
      st.current.msgAt = Date.now();
      void reload(id);
    } else if (e.t === 'step') {
      const sv = e.s as StepEvent;
      const mid = String(e.m);
      if (st.current.reloading) { st.current.steps.push([mid, sv]); return; }
      if (!ref.current.some((m) => m.id === mid)) { void reload(id); return; }
      applyStep(mid, sv);
    } else if (e.t === 'rend') {
      setMsgs((all) => all.map((m) => (m.id === e.m ? { ...m, reasoningMs: Number(e.ms) || m.reasoningMs, rStartedAt: null } : m)));
    } else if (e.t === 'job') {
      const status = String(e.status);
      if (status === 'queued' || status === 'running') {
        if (!ref.current.some((m) => m.id === e.m)) { void reload(id); return; }
        setMsgs((all) => all.map((m) => (m.id === e.m ? {
          ...m, streaming: true, jobId: String(e.job),
          ...(status === 'queued' ? { phase: 'queued' as const, ahead: Number(e.ahead) || 0, eta: Number(e.eta) || 0, squeue: null } : { phase: m.content ? 'answer' as const : m.reasoning ? 'think' as const : 'wait' as const, ahead: 0, eta: 0, startedAt: Number(e.startedAt) || m.startedAt,
            squeue: serveQueueOf(e.sq) }),
        } : m)));
      } else {
        void reload(id);
      }
    }
  });

  const cancelAll = useCallback(() => {
    let any = false;
    for (const m of ref.current) if (m.streaming && m.jobId) { any = true; void fetch(`/api/jobs/${m.jobId}/cancel`, { method: 'POST' }).catch(() => {}); }
    return any;
  }, []);
  const stop = useCallback(() => { if (!cancelAll()) st.current.stopAsked = true; }, [cancelAll]);

  const send = useCallback(async (a: SendArgs, onTitle?: (t: string) => void) => {
    tid.current = a.threadId;
    setSending(true);
    st.current.stopAsked = false;
    const startedAt = serverNow();
    const mode: TurnMode = a.mode ?? 'send';
    const draft: MsgView = { id: 'a-' + startedAt, role: 'assistant', content: '', reasoning: '', streaming: true, phase: 'wait', startedAt, rStartedAt: null, meta: { modelId: a.modelId, levelId: a.levelId } };
    const pairDrafts = a.pair && (mode === 'send' || mode === 'edit')
      ? (['a', 'b'] as const).map((l) => ({ ...draft, id: `${draft.id}-${l}`, meta: { modelId: a.pair![l].modelId, levelId: a.pair![l].levelId, lane: l } }))
      : null;
    const laneDraft = a.lane && mode === 'regenerate' ? { ...draft, meta: { ...draft.meta, lane: a.lane } } : null;
    const draftIds = new Set([draft.id, ...(pairDrafts ?? []).map((d) => d.id)]);
    const apply = () => setMsgs((m) => {
      if (pairDrafts) {
        const pv = { a: pairDrafts[0].id, b: pairDrafts[1].id, pick: null, vote: null };
        if (mode === 'edit') {
          const i = m.findIndex((x) => x.id === a.editId);
          return [...(i < 0 ? m : m.slice(0, i)), { id: 'u-' + startedAt, role: 'user', content: a.text, files: a.replaceFiles ? a.files : m[i]?.files, pair: pv }, ...pairDrafts];
        }
        return [...m, { id: 'u-' + startedAt, role: 'user', content: a.text, files: a.files, pair: pv }, ...pairDrafts];
      }
      if (a.lane && (mode === 'regenerate' || mode === 'continue')) {
        return m.map((x) => (x.id !== a.messageId ? x : mode === 'continue'
          ? { ...x, streaming: true, phase: 'answer' as const, startedAt, meta: { ...x.meta, stopped: undefined, error: undefined } }
          : laneDraft!));
      }
      if (mode === 'continue') {
        const last = m[m.length - 1];
        if (last?.role !== 'assistant') return m;
        return [...m.slice(0, -1), { ...last, streaming: true, phase: 'answer', startedAt, meta: { ...last.meta, stopped: undefined, error: undefined } }];
      }
      if (mode === 'regenerate') return [...(m[m.length - 1]?.role === 'assistant' ? m.slice(0, -1) : m), draft];
      if (mode === 'edit') {
        const i = m.findIndex((x) => x.id === a.editId);
        const old = m[i];
        return [...(i < 0 ? m : m.slice(0, i)), { id: 'u-' + startedAt, role: 'user', content: a.text, files: a.replaceFiles ? a.files : old?.files }, draft];
      }
      return [...m, { id: 'u-' + startedAt, role: 'user', content: a.text, files: a.files }, draft];
    });
    if (a.wrap) a.wrap(apply); else apply();
    const sentAt = Date.now();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: a.threadId, mode, editId: a.editId, text: a.text, fileIds: a.fileIds ?? [], modelId: a.modelId, levelId: a.levelId, timezone: browserTimeZone(),
          ...(mode === 'edit' && a.replaceFiles ? { replaceFiles: true } : {}),
          ...(pairDrafts ? { compare: a.pair } : {}), ...(a.lane ? { lane: a.lane, messageId: a.messageId } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string; jobIds?: string[]; title?: string; code?: string; alt?: { id: string; name: string } | null; userMessageId?: string | null; assistantMessageId?: string };
      if (!res.ok || !j.jobId) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code, alt: j.alt });
      if (j.title) onTitle?.(j.title);
      if (st.current.stopAsked) { st.current.stopAsked = false; for (const id of j.jobIds ?? [j.jobId]) void fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => {}); }
      if (!pairDrafts && !a.lane && j.assistantMessageId) {
        const uid = j.userMessageId, aid = j.assistantMessageId, job = j.jobId;
        setMsgs((all) => (all.some((m) => m.id === aid) ? all : all.map((m) => {
          if (m.id === draft.id) return { ...m, id: aid, jobId: job };
          if (uid && m.id === 'u-' + startedAt) return { ...m, id: uid };
          return m;
        })));
      }
      const s = st.current;
      if (s.msgAt >= sentAt) { if (s.reloading) await s.reloading; }
      else await reload(a.threadId);
    } catch (e) {
      const x = e as Error & { code?: string; alt?: { id: string; name: string } | null };
      const kind = x.code === 'model_down' || x.code === 'week_limit';
      const down = kind ? { errorUser: x.message, altModel: x.alt ?? undefined } : {};
      setMsgs((all) => all.map((m) => (draftIds.has(m.id) || (mode === 'continue' && m.streaming) ? { ...m, streaming: false, rStartedAt: null, meta: { ...m.meta, ...(kind ? {} : { error: x.message }), ...down } } : m)));
    } finally {
      setSending(false);
    }
  }, [reload, setMsgs]);

  const older = useCallback(async (threadId: string): Promise<boolean> => {
    const first = ref.current[0];
    if (st.current.loadingOlder || !st.current.hasMore || !first || first.id.startsWith('u-')) return false;
    st.current.loadingOlder = true; setLoadingOlder(true);
    try {
      const r = await fetch(`/api/threads/${threadId}/path?turns=8&before=${encodeURIComponent(first.id)}`, { cache: 'no-store' });
      if (!r.ok) return false;
      const j = (await r.json()) as { messages: MsgView[]; hasMore: boolean };
      setMsgs((m) => (m[0]?.id === first.id ? [...j.messages, ...m] : m));
      setHasMore(j.hasMore);
      return true;
    } catch { return false; } finally { st.current.loadingOlder = false; setLoadingOlder(false); }
  }, [setMsgs]);

  const switchTo = useCallback(async (threadId: string, messageId: string) => {
    const r = await fetch(`/api/threads/${threadId}/branch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, turns: shownTurns() }) });
    if (r.ok) { const j = (await r.json()) as { messages: MsgView[]; hasMore: boolean }; setMsgs(j.messages); setHasMore(j.hasMore); }
  }, [setMsgs]);

  const busy = sending || msgs.some((m) => m.streaming);
  const busyAt = useRef<number | null>(null);
  const quietR = useRef(!!opts.quiet); quietR.current = !!opts.quiet;
  useEffect(() => {
    if (busy) { busyAt.current ??= Date.now(); return; }
    if (busyAt.current === null) return;
    const ms = Date.now() - busyAt.current;
    busyAt.current = null;
    const last = ref.current[ref.current.length - 1];
    if (!quietR.current && last?.role === 'assistant' && !last.meta?.error && !last.meta?.stopped) window.dispatchEvent(new CustomEvent('kx:answer', { detail: { ms } }));
  }, [busy]);
  return { msgs, setMsgs, busy, send, stop, switchTo, reload, hasMore, older, loadingOlder };
}
