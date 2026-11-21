import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import type { Message, Thread } from './db/schema';
import { getModel, getModels, isClaude, isClaudeDirect, pairNames, queueLimit, queueMembers, queueOf, type Level, type ModelCfg } from './models';
import { ETA_START_S, etaFor, etaNextFor, ewma } from './queueEta';
import { upstreamEffort } from './levels';
import { activePath, allMessages, lastSeq, sessionOfPath, setLeaf } from './tree';
import { laneOf, laneSessions, laneView, lastOpenPair, openPairs, pairOf, sessionMeta, type Lane } from './pairs';
import { compareOf, resolveOpen } from './compare';
import { capLevel } from './levelPolicy';
import { armJobTimeout, timeoutPlan, withUpstreamActivity, type JobGuard } from './jobTimeout';
import { buildMessages, MARKER, prepare, resolveLevel, TurnError, type Mode, type TurnInput, type TurnResult } from './turn';
import { streamChat, type AgentReq, type ChatMsg, type Memory, type UpEvent } from './upstream';
import { genTick, genView, newGen, type Gen } from './genspeed';
import { publish } from './bus';
import { summarize } from './summary';
import { resolveUserTz } from './usertz';
import { cardSeconds } from './week';
import { modelUnavailable } from './status';
import { userLang } from './userLang';
import { tr } from './i18n/core';
import { brokenText, unavailableText } from './unavailable';
import { OutClaimer } from './outfiles';
import { hasCodeSession } from './code/flag';
import { agentToolsOn, answerStep, runAgentLoop, servStepsIn, toolsPath, UpRetry, type Steer } from './agentLoop';
import { orgHeader } from './orgCard';
import { blocksFor } from './blocks/config';
import { agentHistory, chatToOai, folderInstruction, transcriptForMeta, withExtra } from './agentHistory';
import type { StepEvent } from './tools/types';
import type { MemoryInfo } from './types';
import { fileSnapshots, hasBlocks, snapshotRates } from './blocks/snapshot';
import { INTRO, hasIntroMarks, introAfterTurn, markIntroEnd, memoryAllowed, memoryBlockInfo, stripIntroMarks } from './memory';
import { turnNotes } from './introInvite';
import { runClaude } from './anthropic/run';
import { isClaudeUsage, sumClaudeUsage } from './anthropic/price';
import type { ClaudeRecord } from './anthropic/history';
import { promptPartsScoped } from './tools/registry';
import { instanceId, isDraining, onDrain, otherInstances, ownerAlive, registerBusy } from './instance';
import { EXTRA_KEY } from '@/ext/client';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export type JobKind = 'chat' | 'automation' | 'api';
export type JobResult = TurnResult & { status: JobStatus; usage: Record<string, unknown> | null; memory: Memory | null; reasoning: string };

export type InlineInput = { messages: ChatMsg[]; session: string; agent?: AgentReq };

type Live = {
  id: string; userId: string; threadId: string | null; groupId: string | null; kind: JobKind; mode: Mode;
  messageId: string | null; userMessageId: string | null; modelId: string; levelId: string; apiKeyId: string | null;
  status: JobStatus; createdAt: number; startedAt: number | null; ac: AbortController; timer?: NodeJS.Timeout; guard?: JobGuard;
  base: { content: string; reasoning: string; reasoningMs: number; meta: Record<string, unknown>; durationMs: number };
  content: string; reasoning: string; rStart: number | null; rMs: number;
  memory: Memory | null; usage: Record<string, unknown> | null; finish: string | null; error: string | null; unreachable: boolean; tz: string | null; durationMs: number;
  dirty: boolean; flushT: NodeJS.Timeout | null;
  out: { c: { o: number; d: string } | null; r: { o: number; d: string } | null; t: NodeJS.Timeout | null };
  inline: InlineInput | null; title: string; autoName: string | null;
  lane: Lane | null; session: string | null; pairKey: string | null;
  gen: Gen;
  claimer?: OutClaimer;
  steps: Map<string, StepEvent>; stepsDirty: boolean; steers: Steer[]; interrupt: (() => void) | null; depth: number; folderId: string | null;
  agent: { transcript: unknown[]; final: string; rounds: number } | null; rBase: number; sepR: boolean; sepC: boolean;
  over?: boolean;
  sq?: { ahead: number; eta: number | null; at: number; reason?: string | null } | null;
  claude: ClaudeRecord | null; errorUser: string | null;
  listeners: Set<(e: UpEvent | { t: 'state'; status: JobStatus; ahead?: number; position?: number; eta?: number }) => void>;
  done: Promise<JobResult>; resolve: (r: JobResult) => void;
};
type Exec = { live: Map<string, Live>; byMsg: Map<string, string>; queues: Map<string, string[]>; active: Map<string, number>; avg: Map<string, number>; booted: boolean; onFinish: Set<(j: FinishedJob) => void>;
  decide: ((j: FinishedJob) => Notice) | null; parts: Map<string, PairPart[]>; arrivals?: { t: number; key: string }[] };
export type FinishedJob = { id: string; userId: string; threadId: string | null; groupId: string | null; kind: JobKind; messageId: string | null; modelId: string; levelId: string; status: JobStatus; title: string; preview: string; error: string | null;
  createdAt: number; autoName: string | null; notice?: Notice; apiKeyId?: string | null; usage?: Record<string, unknown> | null;
  pair?: { waiting: boolean; both: PairPart[] } };
export type PairPart = { lane: Lane | null; modelId: string; levelId?: string; status: JobStatus; preview: string; messageId: string | null };
export type Notice = 'none' | 'quiet' | 'toast' | 'push';

const FLUSH_MS = 300;
const DELTA_MS = 60;
const MAX_PER_USER = 6;

const g = globalThis as unknown as { __kxExec?: Exec };
function ex(): Exec {
  const e = (g.__kxExec ??= { live: new Map(), byMsg: new Map(), queues: new Map(), active: new Map(), avg: new Map(), booted: false, onFinish: new Set(), decide: null, parts: new Map() });
  e.parts ??= new Map();
  e.avg ??= new Map();
  return e;
}

export function setNoticePolicy(fn: ((j: FinishedJob) => Notice) | null) { ex().decide = fn; }
export function onJobFinished(fn: (j: FinishedJob) => void): () => void { ex().onFinish.add(fn); return () => ex().onFinish.delete(fn); }

const modelName = (id: string) => getModel(id)?.name ?? id;

function jobEvent(j: Live, extra: Record<string, unknown> = {}) {
  publish(j.userId, {
    t: 'job', job: j.id, th: j.threadId, gid: j.groupId, m: j.messageId, kind: j.kind, status: j.status, model: j.modelId, level: j.levelId,
    modelName: modelName(j.modelId), startedAt: j.startedAt, ...(j.lane ? { lane: j.lane, pair: j.pairKey } : {}),
    ...(j.sq && j.status === 'running' ? { sq: { ahead: j.sq.ahead, eta: j.sq.eta, ...(j.sq.reason ? { reason: j.sq.reason } : {}) } } : {}), ...extra,
  });
}

function serveQueue(j: Live, ev: Extract<UpEvent, { t: 'q' }>) {
  if (ev.state === 'started') { endServeQueue(j); return; }
  const now = Date.now();
  const prev = j.sq;
  if (prev) j.guard?.hold(now - prev.at);
  j.sq = { ahead: ev.ahead, eta: ev.eta, at: now, reason: ev.reason ?? null };
  if (!prev || prev.ahead !== ev.ahead || prev.eta !== ev.eta || (prev.reason ?? null) !== (ev.reason ?? null)) jobEvent(j);
}
function endServeQueue(j: Live) {
  const q = j.sq;
  if (!q) return;
  j.sq = null;
  j.guard?.hold(Date.now() - q.at);
  if (j.status === 'running') jobEvent(j);
}

function queue(key: string) { const e = ex(); let q = e.queues.get(key); if (!q) e.queues.set(key, (q = [])); return q; }
function aheadOf(j: Live) { return Math.max(0, queue(queueOf(j.modelId)).indexOf(j.id)); }
const avgOf = (key: string) => ex().avg.get(key) ?? ETA_START_S;
function placeOf(j: Live) {
  const key = queueOf(j.modelId), ahead = aheadOf(j);
  return { ahead, position: ahead + 1, eta: etaFor(ahead, queueLimit(key), avgOf(key)) };
}

const QUEUE_PRIORITY = () => process.env.KX_QUEUE_PRIORITY !== '0';
const QUEUE_AGE_MS = () => Number(process.env.KX_QUEUE_AGE_MS) || 90_000;
const HUMAN_EXTRA = () => { const v = Number(process.env.KX_HUMAN_EXTRA ?? '0'); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; };
export function queueClass(j: Pick<Live, 'kind' | 'depth' | 'apiKeyId'> & { over?: boolean }): number {
  if (j.kind === 'automation' || j.depth > 0) return 2;
  if (j.kind === 'api' || j.apiKeyId) return 1;
  if (j.over) return 1;
  return 0;
}
type QItem = Pick<Live, 'id' | 'kind' | 'depth' | 'apiKeyId' | 'createdAt'> & { over?: boolean };
export function orderQueue(items: QItem[], now: number, ageMs = QUEUE_AGE_MS()): string[] {
  const rank = (j: QItem) => Math.max(0, queueClass(j) - Math.floor((now - j.createdAt) / ageMs));
  return items.map((j) => ({ j, r: rank(j) })).sort((x, y) => x.r - y.r || x.j.createdAt - y.j.createdAt).map((x) => x.j.id);
}
function reorder(key: string) {
  if (!QUEUE_PRIORITY()) return;
  const e = ex(), q = queue(key);
  const items = q.map((id) => e.live.get(id)).filter((j): j is Live => !!j);
  if (items.length < 2 || items.length !== q.length) return;
  const next = orderQueue(items, Date.now());
  q.splice(0, q.length, ...next);
}

function announceQueue(key: string) {
  const e = ex();
  queue(key).forEach((id, i) => {
    const j = e.live.get(id);
    if (!j) return;
    const p = placeOf(j);
    jobEvent(j, p);
    j.listeners.forEach((f) => f({ t: 'state', status: 'queued', ...p }));
  });
}

function foreignRunning(key: string): number {
  if (!otherInstances().length) return 0;
  const members = queueMembers(key).map((m) => m.id);
  if (!members.length) return 0;
  try {
    return getDb().select({ id: schema.jobs.id, owner: schema.jobs.owner }).from(schema.jobs)
      .where(and(eq(schema.jobs.status, 'running'), inArray(schema.jobs.modelId, members))).all()
      .filter((r) => r.owner !== instanceId() && ownerAlive(r.owner)).length;
  } catch { return 0; }
}

function pump() {
  const e = ex();
  if (isDraining()) return;
  for (const [key, q] of e.queues) {
    const limit = queueLimit(key);
    let moved = false;
    const foreign = q.length ? foreignRunning(key) : 0;
    const extra = limit >= 2 ? HUMAN_EXTRA() : 0;
    if (q.length && (e.active.get(key) ?? 0) + foreign < limit + extra) reorder(key);
    while (q.length) {
      const act = (e.active.get(key) ?? 0) + foreign;
      let at = 0;
      if (act >= limit) {
        if (!extra || act >= limit + extra) break;
        at = q.findIndex((id) => { const x = e.live.get(id); return !!x && x.status === 'queued' && queueClass(x) === 0; });
        if (at < 0) break;
      }
      const id = q.splice(at, 1)[0];
      const j = e.live.get(id);
      if (!j || j.status !== 'queued') continue;
      e.active.set(key, (e.active.get(key) ?? 0) + 1);
      moved = true;
      void run(j);
    }
    if (moved) announceQueue(key);
  }
}

function statsOfKey(k: string) {
  const active = ex().active.get(k) ?? 0, queued = queue(k).length, limit = queueLimit(k), avg = avgOf(k);
  return { active, queued, limit, avg: Math.round(avg * 10) / 10, etaNext: etaNextFor(active, queued, limit, avg) };
}
export function queueStats(modelId: string) { return statsOfKey(queueOf(modelId)); }
export function queuesStats() {
  const keys = [...new Set(getModels().filter((m) => !m.hidden).map((m) => queueOf(m.id)))];
  return keys.map((key) => ({ key, name: [...new Set(queueMembers(key).filter((m) => !m.hidden).map((m) => m.name))].join(' / ') || key, claude: queueMembers(key).some(isClaude), ...statsOfKey(key) }));
}

function noteArrival(key: string, now = Date.now()) {
  const a = (ex().arrivals ??= []);
  a.push({ t: now, key });
  while (a.length && now - a[0].t > 120_000) a.shift();
}
export function arrivalsIn(keys: string[], windowMs = 60_000, now = Date.now()): number {
  return (ex().arrivals ?? []).filter((x) => now - x.t <= windowMs && keys.includes(x.key)).length;
}
export function waitingJobs(keys: string[], now = Date.now()): { userId: string; kind: JobKind; sinceMs: number }[] {
  const e = ex();
  const out: { userId: string; kind: JobKind; sinceMs: number }[] = [];
  for (const key of keys) for (const id of queue(key)) {
    const j = e.live.get(id);
    if (j && j.status === 'queued') out.push({ userId: j.userId, kind: j.kind, sinceMs: Math.max(0, now - j.createdAt) });
  }
  return out;
}

export type SubmitInput = Omit<TurnInput, 'signal'> & { kind?: JobKind; apiKeyId?: string | null; over?: boolean };
export type Submitted = { jobId: string; userMessageId: string | null; assistantMessageId: string; title?: string; fileIds: string[] };

export const userBusy = (userId: string): boolean => liveCount(userId) > 0;
export function liveTotal(): number { let n = 0; for (const j of ex().live.values()) if (j.status === 'queued' || j.status === 'running') n++; return n; }
function liveCount(userId: string) { let n = 0; for (const j of ex().live.values()) if (j.userId === userId && (j.status === 'queued' || j.status === 'running')) n++; return n; }

function newLive(p: Partial<Live> & Pick<Live, 'id' | 'userId' | 'modelId' | 'levelId' | 'kind' | 'mode'>): Live {
  let resolve!: (r: JobResult) => void;
  const done = new Promise<JobResult>((r) => (resolve = r));
  return {
    threadId: null, groupId: null, messageId: null, userMessageId: null, apiKeyId: null, status: 'queued', createdAt: Date.now(), startedAt: null,
    ac: new AbortController(), base: { content: '', reasoning: '', reasoningMs: 0, meta: {}, durationMs: 0 }, content: '', reasoning: '', rStart: null, rMs: 0,
    memory: null, usage: null, finish: null, error: null, unreachable: false, tz: null, durationMs: 0, dirty: false, flushT: null, out: { c: null, r: null, t: null },
    inline: null, title: '', autoName: null, lane: null, session: null, pairKey: null, gen: newGen(), listeners: new Set(), done, resolve,
    steps: new Map(), stepsDirty: false, steers: [], interrupt: null, depth: 0, folderId: null, agent: null, rBase: 0, sepR: false, sepC: false, claude: null, errorUser: null, ...p,
  } as Live;
}

function enqueue(j: Live) {
  const e = ex();
  e.live.set(j.id, j);
  if (j.messageId) e.byMsg.set(j.messageId, j.id);
  const key = queueOf(j.modelId);
  noteArrival(key);
  queue(key).push(j.id);
  const before = queue(key).slice();
  reorder(key);
  jobEvent(j, placeOf(j));
  if (queue(key).some((id, i) => before[i] !== id)) announceQueue(key);
  pump();
}

export function submitTurn(inp: SubmitInput): Submitted {
  boot();
  const db = getDb();
  const { model, level } = resolveLevel(inp.modelId, inp.levelId, inp.userId);
  const tz = resolveUserTz(inp.userId, inp.timezone);
  const down = modelUnavailable(model.id, tz, Date.now(), userLang(inp.userId));
  if (down) throw new TurnError(503, down.text, 'model_down', down.alt);
  if (liveCount(inp.userId) >= MAX_PER_USER) throw new TurnError(429, 'Слишком много запросов сразу: дождитесь ответа на предыдущие');
  if ((inp.kind ?? 'chat') === 'chat') {
    if (threadBusy(inp.thread.id)) throw new TurnError(409, 'В этом чате уже идёт ответ');
  }
  inp = { ...inp, thread: singleFromPairs(inp.userId, inp.thread, inp.mode) };
  const prep = prepare({ ...inp, signal: undefined });
  const now = Date.now();
  const keepSel = inp.mode === 'continue' ? {} : { modelId: model.id, effort: level.id };
  db.update(schema.threads).set({ ...keepSel, updatedAt: now, ...(prep.title ? { title: prep.title } : {}) }).where(eq(schema.threads.id, inp.thread.id)).run();
  const id = randomUUID();
  let messageId: string;
  const base = { content: '', reasoning: '', reasoningMs: 0, meta: {} as Record<string, unknown>, durationMs: 0 };
  const useModel = inp.mode === 'continue' ? ((prep.continueRow?.meta as { modelId?: string } | null)?.modelId ?? model.id) : model.id;
  if (prep.continueRow) {
    const r = prep.continueRow;
    messageId = r.id;
    Object.assign(base, { content: r.content, reasoning: r.reasoning ?? '', reasoningMs: r.reasoningMs ?? 0, meta: (r.meta ?? {}) as Record<string, unknown>, durationMs: ((r.meta as { durationMs?: number } | null)?.durationMs) ?? 0 });
    db.update(schema.messages).set({ meta: { ...base.meta, status: 'queued', jobId: id, stopped: false, error: null, errorUser: null } }).where(eq(schema.messages.id, r.id)).run();
  } else {
    messageId = randomUUID();
    const seq = lastSeq(inp.thread.id) + 1;
    db.insert(schema.messages).values({
      id: messageId, threadId: inp.thread.id, seq, parentId: prep.assistantParent, session: null, role: 'assistant', content: '', reasoning: null, reasoningMs: null,
      meta: { modelId: model.id, levelId: level.id, status: 'queued', jobId: id }, createdAt: now,
    }).run();
    setLeaf(inp.thread, messageId);
  }
  db.insert(schema.jobs).values({ id, userId: inp.userId, threadId: inp.thread.id, kind: inp.kind ?? 'chat', mode: inp.mode, userMessageId: prep.userMsg?.id ?? null, messageId,
    modelId: useModel, levelId: level.id, status: 'queued', apiKeyId: inp.apiKeyId ?? null, createdAt: now }).run();
  console.log(`[turn] model=${model.id} level=${level.id}${level.id !== inp.levelId ? ` (asked ${inp.levelId})` : ''} reasoning_effort=${upstreamEffort(level) ?? '-'} mode=${inp.mode} thread=${inp.thread.id} job=${id}`);
  const j = newLive({ id, userId: inp.userId, threadId: inp.thread.id, groupId: inp.thread.groupId, kind: inp.kind ?? 'chat', mode: inp.mode, messageId, userMessageId: prep.userMsg?.id ?? null,
    modelId: model.id, levelId: level.id, apiKeyId: inp.apiKeyId ?? null, base, content: base.content, reasoning: base.reasoning, rMs: base.reasoningMs,
    title: prep.title ?? inp.thread.title, autoName: ((inp.userMeta as { auto?: { name?: string } } | undefined)?.auto?.name) ?? null, tz,
    depth: Number((inp.userMeta as { from?: { depth?: number } } | undefined)?.from?.depth) || 0, folderId: inp.thread.folderId ?? null, over: inp.over });
  publish(inp.userId, { t: 'msg', th: inp.thread.id, gid: inp.thread.groupId });
  publish(inp.userId, { t: 'thread', id: inp.thread.id, gid: inp.thread.groupId, title: prep.title ?? inp.thread.title, updatedAt: now });
  enqueue(j);
  return { jobId: id, userMessageId: prep.userMsg?.id ?? null, assistantMessageId: messageId, title: prep.title, fileIds: prep.fileIds };
}

function threadBusy(threadId: string) {
  for (const j of ex().live.values()) if (j.threadId === threadId && (j.status === 'queued' || j.status === 'running')) return true;
  return false;
}
const freshSession = (threadId: string) => `${threadId}:${randomUUID().slice(0, 8)}`;
const reread = (id: string) => getDb().select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;

function singleFromPairs(userId: string, thread: Thread, mode: Mode): Thread {
  const all = allMessages(thread.id);
  const path = activePath(all, thread.leafId);
  if (mode === 'regenerate' || mode === 'continue') {
    const last = path[path.length - 1];
    const u = last?.role === 'assistant' ? path[path.length - 2] : last;
    if (mode === 'regenerate' && pairOf(u)) throw new TurnError(400, 'Это ответ сравнения: повторите ответ одной из моделей');
    if (mode === 'continue' && laneOf(last)) throw new TurnError(400, 'Это ответ сравнения: продолжите его в паре');
    return thread;
  }
  if (!openPairs(path).length) return thread;
  const r = resolveOpen(userId, thread, null);
  const c = compareOf(thread);
  if (c?.on) getDb().update(schema.threads).set({ compare: { ...c, on: false } }).where(eq(schema.threads.id, thread.id)).run();
  if (r.changed || c?.on) publish(userId, { t: 'cmp', th: thread.id, on: false, lane: r.lane, ...(c ? { a: c.a, b: c.b } : {}) });
  return reread(thread.id);
}

export type Sel2 = { modelId: string; levelId: string };
export type SubmittedPair = { jobIds: string[]; userMessageId: string; a: string; b: string; title?: string; fileIds: string[] };

export function submitPair(inp: Omit<SubmitInput, 'modelId' | 'levelId'> & { pair: { a: Sel2; b: Sel2 } }): SubmittedPair {
  boot();
  const db = getDb();
  if (inp.mode !== 'send' && inp.mode !== 'edit') throw new TurnError(400, 'bad mode');
  const A = resolveLevel(inp.pair.a.modelId, inp.pair.a.levelId, inp.userId), B = resolveLevel(inp.pair.b.modelId, inp.pair.b.levelId, inp.userId);
  const tz = resolveUserTz(inp.userId, inp.timezone);
  const lng = userLang(inp.userId);
  const down = { a: modelUnavailable(A.model.id, tz, Date.now(), lng), b: modelUnavailable(B.model.id, tz, Date.now(), lng) };
  if (down.a && down.b) throw new TurnError(503, A.model.id === B.model.id || A.model.queue && A.model.queue === B.model.queue ? down.a.text : tr(lng, 'srv.bothDown', { a: A.model.name, b: B.model.name }), 'model_down', null);
  if (liveCount(inp.userId) + 2 > MAX_PER_USER) throw new TurnError(429, 'Слишком много запросов сразу: дождитесь ответа на предыдущие');
  if (threadBusy(inp.thread.id)) throw new TurnError(409, 'В этом чате уже идёт ответ');
  const all0 = allMessages(inp.thread.id);
  const path0 = activePath(all0, inp.thread.leafId);
  const prep = prepare({ ...inp, modelId: A.model.id, levelId: A.level.id, signal: undefined });
  const u = prep.userMsg!;
  const now = Date.now();
  const sessions = laneSessions(all0, path0, u.session ?? sessionOfPath(prep.histPath, inp.thread.id), () => freshSession(inp.thread.id), inp.mode);
  const pair = { a: { modelId: A.model.id, levelId: A.level.id }, b: { modelId: B.model.id, levelId: B.level.id } };
  db.update(schema.threads).set({ compare: { on: true, ...pair }, updatedAt: now, ...(prep.title ? { title: prep.title } : {}) }).where(eq(schema.threads.id, inp.thread.id)).run();
  let seq = lastSeq(inp.thread.id);
  const ids = { a: randomUUID(), b: randomUUID() };
  const lives: Live[] = [];
  for (const lane of ['a', 'b'] as const) {
    const { model, level } = lane === 'a' ? A : B;
    const dn = down[lane];
    const id = randomUUID();
    const meta: Record<string, unknown> = { modelId: model.id, levelId: level.id, lane, session: sessions[lane] };
    if (dn) Object.assign(meta, { status: 'error', error: `${model.name}: недоступна при отправке`, errorUser: dn.text, durationMs: 0 });
    else Object.assign(meta, { status: 'queued', jobId: id });
    db.insert(schema.messages).values({ id: ids[lane], threadId: inp.thread.id, seq: ++seq, parentId: u.id, session: null, role: 'assistant', content: '', reasoning: null, reasoningMs: null, meta, createdAt: now }).run();
    if (dn) continue;
    db.insert(schema.jobs).values({ id, userId: inp.userId, threadId: inp.thread.id, kind: inp.kind ?? 'chat', mode: inp.mode, userMessageId: u.id, messageId: ids[lane],
      modelId: model.id, levelId: level.id, status: 'queued', apiKeyId: inp.apiKeyId ?? null, createdAt: now }).run();
    console.log(`[turn] model=${model.id} level=${level.id} reasoning_effort=${upstreamEffort(level) ?? '-'} mode=${inp.mode} lane=${lane} thread=${inp.thread.id} job=${id}`);
    lives.push(newLive({ id, userId: inp.userId, threadId: inp.thread.id, groupId: null, kind: inp.kind ?? 'chat', mode: inp.mode, messageId: ids[lane], userMessageId: u.id,
      modelId: model.id, levelId: level.id, apiKeyId: inp.apiKeyId ?? null, title: prep.title ?? inp.thread.title, tz, lane, session: sessions[lane], pairKey: u.id, folderId: inp.thread.folderId ?? null, over: inp.over }));
  }
  db.update(schema.messages).set({ meta: { ...(u.meta ?? {}), pair: { a: ids.a, b: ids.b } } }).where(eq(schema.messages.id, u.id)).run();
  setLeaf(inp.thread, ids.a);
  publish(inp.userId, { t: 'msg', th: inp.thread.id, gid: null });
  publish(inp.userId, { t: 'thread', id: inp.thread.id, gid: null, title: prep.title ?? inp.thread.title, updatedAt: now });
  for (const j of lives) enqueue(j);
  return { jobIds: lives.map((j) => j.id), userMessageId: u.id, a: ids.a, b: ids.b, title: prep.title, fileIds: prep.fileIds };
}

export function submitLane(inp: { thread: Thread; userId: string; lane: Lane; mode: 'regenerate' | 'continue'; modelId: string; levelId: string; messageId?: string; timezone?: string; over?: boolean }): Submitted {
  boot();
  const db = getDb();
  const { model, level } = resolveLevel(inp.modelId, inp.levelId, inp.userId);
  const tz = resolveUserTz(inp.userId, inp.timezone);
  if (liveCount(inp.userId) >= MAX_PER_USER) throw new TurnError(429, 'Слишком много запросов сразу: дождитесь ответа на предыдущие');
  if (threadBusy(inp.thread.id)) throw new TurnError(409, 'В этом чате уже идёт ответ');
  const all = allMessages(inp.thread.id);
  const path = activePath(all, inp.thread.leafId);
  const u = lastOpenPair(path);
  const p = pairOf(u);
  if (!u || !p) throw new TurnError(400, 'Сравнение уже выключено: повторить можно ответ последнего вопроса пары');
  const cur = all.find((m) => m.id === (inp.messageId ?? p[inp.lane]));
  if (!cur || cur.parentId !== u.id || laneOf(cur) !== inp.lane) throw new TurnError(404, 'message not found');
  const now = Date.now();
  const id = randomUUID();
  let messageId: string;
  const base = { content: '', reasoning: '', reasoningMs: 0, meta: {} as Record<string, unknown>, durationMs: 0 };
  let useModel = model, useLevel = level;
  const session = sessionMeta(cur) ?? (inp.lane === 'a' ? u.session ?? sessionOfPath(path, inp.thread.id) : freshSession(inp.thread.id));
  if (inp.mode === 'continue') {
    if (!cur.content.trim()) throw new TurnError(400, 'nothing to continue');
    const m0 = (cur.meta ?? {}) as { modelId?: string; levelId?: string; durationMs?: number };
    const r0 = resolveLevel(m0.modelId ?? model.id, m0.levelId ?? level.id, inp.userId);
    useModel = r0.model; useLevel = r0.level;
    { const d = modelUnavailable(useModel.id, tz, Date.now(), userLang(inp.userId)); if (d) throw new TurnError(503, d.text, 'model_down', null); }
    messageId = cur.id;
    Object.assign(base, { content: cur.content, reasoning: cur.reasoning ?? '', reasoningMs: cur.reasoningMs ?? 0, meta: (cur.meta ?? {}) as Record<string, unknown>, durationMs: m0.durationMs ?? 0 });
    db.update(schema.messages).set({ meta: { ...base.meta, status: 'queued', jobId: id, stopped: false, error: null, errorUser: null } }).where(eq(schema.messages.id, cur.id)).run();
  } else {
    const down = modelUnavailable(model.id, tz, Date.now(), userLang(inp.userId));
    if (down) throw new TurnError(503, down.text, 'model_down', down.alt);
    messageId = randomUUID();
    const seq = (all.at(-1)?.seq ?? 0) + 1;
    db.insert(schema.messages).values({ id: messageId, threadId: inp.thread.id, seq, parentId: u.id, session: null, role: 'assistant', content: '', reasoning: null, reasoningMs: null,
      meta: { modelId: model.id, levelId: level.id, lane: inp.lane, session, status: 'queued', jobId: id }, createdAt: now }).run();
    db.update(schema.messages).set({ meta: { ...(u.meta ?? {}), pair: { ...p, [inp.lane]: messageId } } }).where(eq(schema.messages.id, u.id)).run();
    if (inp.thread.leafId === cur.id) setLeaf(inp.thread, messageId);
    const c = compareOf(inp.thread);
    if (c) db.update(schema.threads).set({ compare: { ...c, [inp.lane]: { modelId: model.id, levelId: level.id } } }).where(eq(schema.threads.id, inp.thread.id)).run();
  }
  db.update(schema.threads).set({ updatedAt: now }).where(eq(schema.threads.id, inp.thread.id)).run();
  db.insert(schema.jobs).values({ id, userId: inp.userId, threadId: inp.thread.id, kind: 'chat', mode: inp.mode, userMessageId: u.id, messageId, modelId: useModel.id, levelId: useLevel.id,
    status: 'queued', createdAt: now }).run();
  console.log(`[turn] model=${useModel.id} level=${useLevel.id} reasoning_effort=${upstreamEffort(useLevel) ?? '-'} mode=${inp.mode} lane=${inp.lane} thread=${inp.thread.id} job=${id}`);
  const j = newLive({ id, userId: inp.userId, threadId: inp.thread.id, groupId: null, kind: 'chat', mode: inp.mode, messageId, userMessageId: u.id, modelId: useModel.id, levelId: useLevel.id,
    base, content: base.content, reasoning: base.reasoning, rMs: base.reasoningMs, title: inp.thread.title, tz, lane: inp.lane, session, pairKey: u.id, folderId: inp.thread.folderId ?? null, over: inp.over });
  publish(inp.userId, { t: 'msg', th: inp.thread.id, gid: null });
  enqueue(j);
  return { jobId: id, userMessageId: u.id, assistantMessageId: messageId, fileIds: [] };
}

export function submitInline(p: { userId: string; modelId: string; levelId: string; input: InlineInput; apiKeyId: string | null; timezone?: string | null }): { jobId: string; job: Live } {
  boot();
  const { model, level } = resolveLevel(p.modelId, p.levelId, p.userId);
  if (isClaude(model)) throw new TurnError(400, `${model.name} недоступна через API`, 'model_not_in_api');
  const tz = p.timezone || resolveUserTz(p.userId);
  const down = modelUnavailable(model.id, tz, Date.now(), userLang(p.userId));
  if (down) throw new TurnError(503, down.text, 'model_down', down.alt);
  if (liveCount(p.userId) >= MAX_PER_USER) throw new TurnError(429, 'Слишком много запросов сразу: дождитесь ответа на предыдущие');
  const id = randomUUID();
  const now = Date.now();
  getDb().insert(schema.jobs).values({ id, userId: p.userId, threadId: null, kind: 'api', mode: 'send', modelId: model.id, levelId: level.id, status: 'queued', apiKeyId: p.apiKeyId, createdAt: now }).run();
  console.log(`[turn] model=${model.id} level=${level.id} reasoning_effort=${upstreamEffort(level) ?? '-'} mode=api job=${id}`);
  const j = newLive({ id, userId: p.userId, modelId: model.id, levelId: level.id, kind: 'api', mode: 'send', apiKeyId: p.apiKeyId, inline: p.input, tz });
  enqueue(j);
  return { jobId: id, job: j };
}

function scheduleDelta(j: Live, k: 'c' | 'r', from: number, d: string) {
  const slot = j.out[k];
  if (slot) slot.d += d; else j.out[k] = { o: from, d };
  if (!j.out.t) j.out.t = setTimeout(() => flushDeltas(j), DELTA_MS);
}
function flushDeltas(j: Live) {
  if (j.out.t) { clearTimeout(j.out.t); j.out.t = null; }
  for (const k of ['r', 'c'] as const) {
    const s = j.out[k];
    if (s && j.threadId) publish(j.userId, { t: 'd', th: j.threadId, m: j.messageId, k, o: s.o, d: s.d, g: genOf(j) });
    j.out[k] = null;
  }
}
const genOf = (j: Live) => genView(j.gen);
function persist(j: Live) {
  if (j.flushT) { clearTimeout(j.flushT); j.flushT = null; }
  if (!j.dirty || !j.messageId) return;
  j.dirty = false;
  try {
    const db = getDb();
    db.update(schema.messages).set({ content: j.content, reasoning: j.reasoning || null, reasoningMs: j.rMs || null }).where(eq(schema.messages.id, j.messageId)).run();
    if (j.stepsDirty) {
      j.stepsDirty = false;
      const row = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, j.messageId)).get();
      if (row) db.update(schema.messages).set({ meta: { ...(row.meta ?? {}), steps: stepList(j) } }).where(eq(schema.messages.id, j.messageId)).run();
    }
  } catch (e) { console.error('[jobs] persist failed', (e as Error).message); }
}
const stepList = (j: Live) => [...((j.base.meta.steps as StepEvent[] | undefined) ?? []).filter((s) => !j.steps.has(s.id)), ...j.steps.values()];
function touch(j: Live) {
  j.dirty = true;
  if (!j.flushT) j.flushT = setTimeout(() => persist(j), FLUSH_MS);
}

function historyOf(j: Live, model: ModelCfg, tz: string): { messages: ChatMsg[]; session: string; hist: Message[] | null; folderSys: string | null; mem: string | null } {
  if (j.inline) return { ...j.inline, hist: null, folderSys: null, mem: null };
  const all = allMessages(j.threadId!);
  const th = getDb().select({ id: schema.threads.id, temporary: schema.threads.temporary, createdAt: schema.threads.createdAt }).from(schema.threads).where(eq(schema.threads.id, j.threadId!)).get();
  let mem: string | null = null;
  let lastMemInfo: ReturnType<typeof memoryBlockInfo> | null = null;
  let note: string | null = null;
  try {
    const mi = memoryBlockInfo(j.userId, th);
    lastMemInfo = mi;
    mem = mi.text;
    note = mi.note ?? null;
    console.log(`[memory] block chat=${j.threadId} job=${j.id} ${mi.why}${mi.stats ? ` items=${mi.stats.used} dropped=${mi.stats.dropped} blocked=${mi.stats.blocked} tok≈${mi.stats.tokens}` : ''}`);
  } catch (e) { console.error('[memory] block', (e as Error).message); }
  const me = all.find((m) => m.id === j.messageId);
  if (!me) throw new TurnError(404, 'Сообщение удалено');
  const path: Message[] = activePath(all, j.mode === 'continue' ? me.id : me.parentId);
  try {
    if (th?.temporary === INTRO && mem !== null) { if (lastMemInfo?.end) markIntroEnd(j.userId, lastMemInfo.endHow ?? 'plan', { chat: j.threadId! }); }
    else if (th && !th.temporary && j.kind === 'chat' && !j.lane && j.mode === 'send' && memoryAllowed(j.userId, th)) {
      const u = path.at(-1);
      const extra = turnNotes(j.userId, u?.role === 'user' ? u : null, path.at(-2)?.role === 'assistant' ? path.at(-2)!.content : null, j.levelId);
      if (extra.length) note = [note, ...extra].filter(Boolean).join('\n\n');
    }
  } catch (e) { console.error('[invite]', (e as Error).message); }
  const folderSys = folderInstruction(j.folderId, j.userId);
  if (j.lane) {
    const hist = laneView(all, path, j.lane);
    return { messages: isClaudeDirect(model) ? [] : buildMessages(hist, model, j.userId, tz, folderSys, mem), session: j.session ?? sessionMeta(me) ?? sessionOfPath(hist, j.threadId!), hist, folderSys, mem };
  }
  return { messages: isClaudeDirect(model) ? [] : withNote(buildMessages(path, model, j.userId, tz, folderSys, mem), note), session: sessionOfPath(path, j.threadId!), hist: path, folderSys, mem };
}

export function withNote(msgs: ChatMsg[], note: string | null): ChatMsg[] {
  if (!note) return msgs;
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].role !== 'user') i--;
  if (i < 0) return msgs;
  const m = msgs[i];
  const c = typeof m.content === 'string' ? `${m.content}\n\n${note}` : [...m.content, { type: 'text' as const, text: note }];
  return msgs.map((x, k) => (k === i ? { ...x, content: c } : x));
}

function feed(j: Live, ev: UpEvent) {
  if (ev.t === 'q') { serveQueue(j, ev); j.listeners.forEach((f) => f(ev)); return; }
  if (j.sq) endServeQueue(j);
  if (ev.t === 'r' || ev.t === 'c') genTick(j.gen, Date.now(), ev.d);
  if (ev.t === 'r') {
    let d = ev.d;
    if (j.sepR) { j.sepR = false; if (j.reasoning.trim() && !j.reasoning.endsWith('\n\n')) d = (j.reasoning.endsWith('\n') ? '\n' : '\n\n') + d; }
    const o = j.reasoning.length; j.reasoning += d; j.claimer?.chunk(j.reasoning, o); if (!j.rStart) j.rStart = Date.now(); scheduleDelta(j, 'r', o, d); touch(j);
  } else if (ev.t === 'c') {
    let d = ev.d;
    if (j.sepC) { j.sepC = false; if (j.content.trim() && !j.content.endsWith('\n\n')) d = (j.content.endsWith('\n') ? '\n' : '\n\n') + d; }
    const o = j.content.length; j.content += d; j.claimer?.chunk(j.content, o); scheduleDelta(j, 'c', o, d); touch(j);
  } else if (ev.t === 'rend') { j.rMs = j.rBase + ev.ms; j.rStart = null; flushDeltas(j); if (j.threadId) publish(j.userId, { t: 'rend', th: j.threadId, m: j.messageId, ms: j.rMs }); touch(j); }
  else if (ev.t === 'done') {
    j.memory = ev.memory ?? j.memory; j.finish = ev.finish;
    const prev = typeof j.usage?.completion_tokens === 'number' && j.agent ? j.usage.completion_tokens : 0;
    if (ev.usage && j.agent && j.usage && isClaudeUsage(j.usage) && isClaudeUsage(ev.usage)) j.usage = sumClaudeUsage(j.usage, ev.usage);
    else if (ev.usage) j.usage = { ...ev.usage, ...(prev && typeof ev.usage.completion_tokens === 'number' ? { completion_tokens: ev.usage.completion_tokens + prev } : {}) };
    if (!j.agent) j.durationMs = ev.durationMs;
  } else if (ev.t === 'err') {
    j.error = ev.maint !== undefined ? `${ev.message} [maint retry_after=${ev.maint}]` : ev.message;
    j.unreachable = !!ev.unreachable || ev.maint !== undefined;
  }
  j.listeners.forEach((f) => f(ev));
}

function rollbackTo(j: Live, to: { r: number; c: number }) {
  flushDeltas(j);
  if (j.content.length > to.c) j.content = j.content.slice(0, to.c);
  if (j.reasoning.length > to.r) j.reasoning = j.reasoning.slice(0, to.r);
  j.rStart = null;
  touch(j);
  if (j.threadId) publish(j.userId, { t: 'msg', th: j.threadId, gid: j.groupId });
}

function stepOut(j: Live, s: StepEvent) {
  flushDeltas(j);
  j.steps.set(s.id, s); j.stepsDirty = true; touch(j);
  j.guard?.touch();
  if (j.threadId) publish(j.userId, { t: 'step', th: j.threadId, m: j.messageId, job: j.id, s });
}

export function taintStart(hist: Message[] | null): { human: string[]; ask: string; on: boolean; memBase: { web: number; files: number } } {
  const users = (hist ?? []).filter((m) => m.role === 'user');
  const fromAgent = (m: Message) => !!(m.meta as { from?: unknown } | null)?.from;
  const text = (m: Message) => m.content.split(MARKER).join('');
  const last = users.at(-1);
  const files = users.some((m) => ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []).length > 0);
  const mem = ((hist ?? []).filter((m) => m.role === 'assistant').map((m) => (m.meta as { memory?: Record<string, unknown> } | null)?.memory).filter(Boolean).at(-1) ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { human: users.filter((m) => !fromAgent(m)).map(text), ask: last && !fromAgent(last) ? text(last) : '', on: users.slice(-3).some(fromAgent) || files,
    memBase: { web: num(mem.web_tokens), files: num(mem.files_tokens) + num(mem.inline_tokens) } };
}

function usesTools(j: Live, model: ModelCfg, messages: ChatMsg[]): boolean {
  if (j.threadId && getDb().select({ t: schema.threads.temporary }).from(schema.threads).where(eq(schema.threads.id, j.threadId)).get()?.t === INTRO) return false;
  if (!(agentToolsOn() || (j.threadId && hasCodeSession(j.threadId))) || j.inline || !j.threadId || (j.kind !== 'chat' && j.kind !== 'automation') || model.tools !== true || j.mode === 'continue') return false;
  if (toolsPath() !== 'agent') return true;
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return !(last && Array.isArray(last.content) && last.content.some((p) => p.type === 'image'));
}

async function runTools(j: Live, model: ModelCfg, level: Level, tz: string, h: ReturnType<typeof historyOf>) {
  j.agent = { transcript: [], final: '', rounds: 0 };
  const path = toolsPath();
  const pctx = { userId: j.userId, threadId: j.threadId!, folderId: j.folderId, kind: j.kind === 'automation' ? 'automation' as const : 'chat' as const, modelId: j.modelId, depth: j.depth };
  const r = await runAgentLoop({
    jobId: j.id, userId: j.userId, threadId: j.threadId!, folderId: j.folderId, messageId: j.messageId, kind: j.kind === 'automation' ? 'automation' : 'chat',
    modelId: j.modelId, depth: j.depth, model, level, tz, session: h.session, signal: j.ac.signal,
    messages: path === 'agent' ? agentHistory(h.hist ?? [], model, j.userId, tz, h.folderSys, true, pctx) : chatToOai(h.messages, pctx, { model, tz, folderSys: h.folderSys }),
    chatMessages: (extra) => withExtra(h.messages, extra),
    round: () => { endServeQueue(j); j.sepR = j.sepC = true; j.rBase = j.rMs; },
    feed: (ev) => feed(j, ev),
    len: () => ({ r: j.reasoning.length, c: j.content.length }),
    step: (s) => stepOut(j, s),
    takeSteers: () => { const out = j.steers.filter((s) => !s.delivered); for (const s of out) s.delivered = true; return out; },
    onInterrupt: (fn) => { j.interrupt = fn; },
    rollback: (to) => rollbackTo(j, to),
    reasoningFrom: (r) => j.reasoning.slice(r),
    taint: taintStart(h.hist),
  });
  j.agent = { transcript: transcriptForMeta(r.transcript), final: r.final, rounds: r.rounds };
  if (r.error && !j.error) j.error = r.error;
}

export function claudeMemory(ctx: number, model: Pick<ModelCfg, 'contextTokens'>): MemoryInfo | null {
  if (!ctx) return null;
  const limit = model.contextTokens || 1_000_000;
  return { v: 1, total_tokens: ctx, limit_tokens: limit, remaining_tokens: Math.max(0, limit - ctx), chat_tokens: ctx, files_tokens: 0, files: 0, web_tokens: 0, exact: true, scope: 'claude' };
}

async function runClaudeJob(j: Live, model: ModelCfg, level: Level, tz: string, h: ReturnType<typeof historyOf>) {
  j.agent = { transcript: [], final: '', rounds: 0 };
  const kind = j.kind === 'automation' ? 'automation' as const : 'chat' as const;
  const pctx = { userId: j.userId, threadId: j.threadId!, folderId: j.folderId, kind, modelId: j.modelId, depth: j.depth };
  let chat: string | null = null;
  try { chat = promptPartsScoped(pctx).chat.join('\n\n') || null; } catch { chat = null; }
  const r = await runClaude({
    jobId: j.id, userId: j.userId, threadId: j.threadId!, folderId: j.folderId, messageId: j.messageId, kind, modelId: j.modelId, depth: j.depth,
    model, level, tz, session: h.session, signal: j.ac.signal, messages: [], chatMessages: () => [],
    round: () => { j.sepR = j.sepC = true; j.rBase = j.rMs; },
    feed: (ev) => feed(j, ev),
    len: () => ({ r: j.reasoning.length, c: j.content.length }),
    step: (s) => stepOut(j, s),
    takeSteers: () => { const out = j.steers.filter((s) => !s.delivered); for (const s of out) s.delivered = true; return out; },
    onInterrupt: (fn) => { j.interrupt = fn; },
    rollback: (to) => rollbackTo(j, to),
    reasoningFrom: (r0) => j.reasoning.slice(r0),
    taint: taintStart(h.hist),
    hist: h.hist ?? [], lang: userLang(j.userId), continuing: j.mode === 'continue',
    ctx: { folder: h.folderSys, chat, mem: h.mem },
  });
  j.claude = r.record ?? (j.base.meta.claude as ClaudeRecord | undefined) ?? null;
  j.agent = { transcript: transcriptForMeta(r.transcript as never), final: j.content, rounds: r.rounds };
  if (r.usage) feed(j, { t: 'done', finish: r.finish, usage: r.usage, memory: claudeMemory(r.ctxTokens, model), durationMs: Date.now() - (j.startedAt ?? Date.now()) });
  else j.finish = r.finish;
  if (r.error && !j.error) { j.error = r.error; j.errorUser = r.errorUser; }
}

function effectiveLevelId(j: Live): string {
  try {
    const model = getModel(j.modelId);
    const level0 = model?.levels.find((l) => l.id === j.levelId);
    if (!model || !level0) return j.levelId;
    return capLevel(model, level0, j.userId).id;
  } catch {
    return j.levelId;
  }
}

async function run(j: Live) {
  const db = getDb();
  try {
    const row = db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, j.id)).get();
    if (row && (row.status !== 'queued' || !db.update(schema.jobs).set({ owner: instanceId() }).where(and(eq(schema.jobs.id, j.id), eq(schema.jobs.status, 'queued'))).run().changes)) {
      release(j);
      return;
    }
  } catch {  }
  j.status = 'running';
  j.startedAt = Date.now();
  try {
    db.update(schema.jobs).set({ status: 'running', startedAt: j.startedAt, owner: instanceId() }).where(eq(schema.jobs.id, j.id)).run();
    if (j.messageId) {
      const row = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, j.messageId)).get();
      if (row) db.update(schema.messages).set({ meta: { ...(row.meta ?? {}), status: 'running' } }).where(eq(schema.messages.id, j.messageId)).run();
    }
  } catch {  }
  jobEvent(j);
  j.listeners.forEach((f) => f({ t: 'state', status: 'running' }));
  const onTimeout = (msg: string) => { j.error = msg; j.ac.abort(); };
  j.guard = armJobTimeout(timeoutPlan(effectiveLevelId(j), isClaudeDirect(getModel(j.modelId))), onTimeout);
  const t0 = Date.now();
  try {
    const model = getModel(j.modelId);
    const level0: Level | undefined = model?.levels.find((l) => l.id === j.levelId);
    if (!model || !level0) throw new TurnError(400, 'unknown model/level');
    const level = capLevel(model, level0, j.userId);
    const guard = j.guard;
    await withUpstreamActivity(() => guard?.touch(), async () => {
      const tz = j.tz ?? (j.tz = resolveUserTz(j.userId));
      const h = historyOf(j, model, tz);
      j.claimer = new OutClaimer({ userId: j.userId, threadId: j.threadId, messageId: j.messageId, since: () => j.startedAt ?? j.createdAt });
      j.rBase = j.base.reasoningMs;
      if (isClaudeDirect(model)) await runClaudeJob(j, model, level, tz, h);
      else if (usesTools(j, model, h.messages)) await runTools(j, model, level, tz, h);
      else {
        const mark = { r: j.reasoning.length, c: j.content.length };
        const canCut = j.kind !== 'api' && !j.inline;
        const retry = new UpRetry(canCut);
        for (;;) {
          let got = false, again = false;
          for await (const ev of streamChat({ model, level, chatId: h.session, messages: h.messages, signal: j.ac.signal, timezone: tz, agent: j.inline?.agent, sources: j.kind !== 'api' && !j.apiKeyId, blocks: j.kind !== 'api' && !j.apiKeyId ? blocksFor(j.userId, j.folderId) : null, org: orgHeader(j.userId, j.folderId) })) {
            if (ev.t === 'err' && retry.want(ev, got, () => servStepsIn(j.reasoning.slice(mark.r)))) { again = true; break; }
            if (ev.t === 'r' || ev.t === 'c' || ev.t === 'tc') got = true;
            feed(j, ev);
          }
          endServeQueue(j);
          if (!again || j.ac.signal.aborted) break;
          if (got) rollbackTo(j, mark);
          if (!(await retry.pause((s) => stepOut(j, s), { r: j.reasoning.length, c: j.content.length }, 0, j.ac.signal, 'retry', got))) break;
          j.sepR = j.sepC = false;
        }
      }
    }, (ms) => guard?.hold(ms));
  } catch (e) {
    if (!j.ac.signal.aborted || j.error) j.error = j.error ?? (e as Error).message;
  }
  if (!j.durationMs) j.durationMs = Date.now() - t0;
  const cancelled = j.ac.signal.aborted && !j.error;
  finalize(j, j.error ? 'error' : cancelled ? 'cancelled' : 'done');
}

function safeSnap(userId: string, content: string) { try { return fileSnapshots(userId, content); } catch (err) { console.error('[blocks] snapshot', (err as Error).message); return {}; } }

function finalize(j: Live, status: JobStatus) {
  const e = ex();
  if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') return;
  const wasRunning = j.status === 'running';
  if (j.timer) clearTimeout(j.timer);
  j.guard?.clear();
  j.sq = null;
  j.claimer?.finish(j.content, j.reasoning);
  flushDeltas(j);
  const followUp = status === 'done' || (status === 'cancelled' && j.steers.some((x) => !x.delivered && x.mode === 'now'));
  const left = j.steers.filter((x) => !x.delivered);
  for (const st of j.steps.values()) {
    if (st.kind === 'steer' && left.some((x) => 'steer-' + x.id === st.id)) continue;
    if (!['ok', 'err', 'denied', 'stopped'].includes(st.status)) j.steps.set(st.id, { ...st, status: status === 'error' ? 'err' : 'stopped', ask: undefined, t1: Date.now() });
  }
  for (const x of left) {
    const sid = 'steer-' + x.id, st = j.steps.get(sid);
    if (st) j.steps.set(sid, { ...st, status: followUp && !j.lane ? 'ok' : 'stopped', detail: followUp && !j.lane ? 'следующим сообщением' : 'не доставлено: ход закончился', t1: Date.now() });
  }
  if (j.threadId) for (const st of j.steps.values()) publish(j.userId, { t: 'step', th: j.threadId, m: j.messageId, job: j.id, s: st });
  persist(j);
  j.status = status;
  const db = getDb();
  const stopped = status === 'cancelled';
  let introRaw: string | null = null;
  if (j.threadId && j.kind === 'chat' && !j.lane && hasIntroMarks(j.content)) {
    const tt = db.select({ temporary: schema.threads.temporary }).from(schema.threads).where(eq(schema.threads.id, j.threadId)).get();
    if (tt?.temporary === INTRO) { introRaw = j.content; j.content = stripIntroMarks(j.content); }
  }
  const durationMs = j.base.durationMs + (j.durationMs || (j.startedAt ? Date.now() - j.startedAt : 0));
  try {
    if (j.messageId) {
      const row = db.select().from(schema.messages).where(eq(schema.messages.id, j.messageId)).get();
      const nothing = !j.content.trim() && !j.reasoning.trim() && j.mode !== 'continue';
      if (row && stopped && nothing) {
        db.delete(schema.messages).where(eq(schema.messages.id, row.id)).run();
        const t = db.select().from(schema.threads).where(eq(schema.threads.id, row.threadId)).get();
        if (t && t.leafId === row.id) setLeaf(t, row.parentId);
      } else if (row) {
        const mcfg = getModel(j.modelId);
        const hadText = j.content.length > j.base.content.length;
        const errorUser = j.error && j.errorUser ? j.errorUser : j.error && j.unreachable && mcfg ? (hadText ? brokenText(mcfg) : unavailableText(mcfg, getModels().filter((m) => !m.hidden && !m.roles))) : null;
        const meta = { ...j.base.meta, ...(j.lane ? { lane: j.lane, session: j.session ?? (j.base.meta.session as string | undefined) ?? null } : {}), modelId: (j.base.meta.modelId as string | undefined) ?? j.modelId, levelId: (j.base.meta.levelId as string | undefined) ?? j.levelId,
          memory: j.memory ?? (j.base.meta.memory as Memory | undefined) ?? null, usage: j.usage ?? (j.base.meta.usage as Record<string, unknown> | undefined) ?? null,
          durationMs, finish: j.finish, error: j.error, errorUser, stopped, status, jobId: j.id,
          ...(j.steps.size || j.base.meta.steps ? { steps: stepList(j) } : {}), ...(j.agent ? { agent: j.agent } : {}), ...(j.claude ? { claude: j.claude } : {}),
          ...(hasBlocks(j.content) ? ((files) => (Object.keys(files).length ? { blocks: { ...((j.base.meta.blocks as object | undefined) ?? {}), files } } : {}))(safeSnap(j.userId, j.content)) : {}),
          gen: j.gen.t0 ? { ms: j.gen.act, n: j.gen.n, c: j.gen.c, tps: serverTps(j.usage), tokens: typeof j.usage?.completion_tokens === 'number' ? j.usage.completion_tokens : null } : (j.base.meta.gen ?? null) };
        db.update(schema.messages).set({ content: j.content, reasoning: j.reasoning || null, reasoningMs: j.rMs || null, meta }).where(eq(schema.messages.id, row.id)).run();
      }
      if (j.threadId) db.update(schema.threads).set({ updatedAt: Date.now(), ...(status === 'done' || status === 'error' ? { answeredAt: Date.now() } : {}) }).where(eq(schema.threads.id, j.threadId)).run();
    }
    const u = (j.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cache_write_tokens?: number; cost_usd?: number };
    db.update(schema.jobs).set({ status, error: j.error, finishedAt: Date.now(), durationMs, promptTokens: u.prompt_tokens ?? null, completionTokens: u.completion_tokens ?? null,
      cacheReadTokens: u.prompt_tokens_details?.cached_tokens ?? null, cacheWriteTokens: u.cache_write_tokens ?? null, costUsd: typeof u.cost_usd === 'number' ? u.cost_usd : null,
      cardS: cardSeconds({ promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, cacheReadTokens: u.prompt_tokens_details?.cached_tokens, costUsd: u.cost_usd, browserActions: stepList(j).filter((s) => s.kind === 'browser' && !!s.tool).length }) }).where(eq(schema.jobs.id, j.id)).run();
  } catch (err) { console.error('[jobs] finalize failed', (err as Error).message); }
  const qk = queueOf(j.modelId);
  if (wasRunning) {
    e.active.set(qk, Math.max(0, (e.active.get(qk) ?? 1) - 1));
    if (status === 'done' && j.startedAt) e.avg.set(qk, ewma(avgOf(qk), (Date.now() - j.startedAt) / 1000));
  } else { const q = queue(qk); const i = q.indexOf(j.id); if (i >= 0) q.splice(i, 1); announceQueue(qk); }
  e.live.delete(j.id);
  if (j.messageId) e.byMsg.delete(j.messageId);
  const fin: FinishedJob = { id: j.id, userId: j.userId, threadId: j.threadId, groupId: j.groupId, kind: j.kind, messageId: j.messageId, modelId: j.modelId, levelId: j.levelId, status,
    title: j.title, preview: summarize(j.content.slice(j.base.content.length) || j.content), error: j.error, createdAt: j.createdAt, autoName: j.autoName, apiKeyId: j.apiKeyId, usage: j.usage };
  const pk = j.pairKey ?? j.groupId;
  if (pk) {
    const mates = [...e.live.values()].filter((x) => x !== j && x.userId === j.userId && (x.status === 'queued' || x.status === 'running')
      && (j.pairKey ? x.pairKey === j.pairKey : x.groupId === j.groupId && x.threadId !== j.threadId));
    const parts = [...(e.parts.get(pk) ?? []), { lane: j.lane, modelId: j.modelId, levelId: j.levelId, status, preview: fin.preview, messageId: j.messageId }];
    if (mates.length) e.parts.set(pk, parts); else e.parts.delete(pk);
    fin.pair = { waiting: mates.length > 0, both: parts };
  }
  try { fin.notice = e.decide ? e.decide(fin) : 'toast'; } catch (err) { console.error('[jobs] notice', (err as Error).message); fin.notice = 'toast'; }
  if (fin.pair?.waiting && (fin.notice === 'toast' || fin.notice === 'push')) fin.notice = 'quiet';
  const both = fin.pair && !fin.pair.waiting && fin.pair.both.length > 1
    ? ((names) => fin.pair!.both.map((x, i) => ({ model: names[i], status: x.status, lane: x.lane, m: x.messageId })))(pairNames(fin.pair.both)) : undefined;
  if (j.messageId && status === 'done' && hasBlocks(j.content)) { const mid = j.messageId, c = j.content; void snapshotRates(mid, c).catch((err) => console.error('[blocks] rate snapshot', (err as Error).message)); }
  if (status === 'done' && j.kind === 'chat' && j.threadId && !j.lane) { try { introAfterTurn(j.userId, j.threadId, introRaw ?? j.content); } catch (err) { console.error('[memory] intro-end', (err as Error).message); } }
  jobEvent(j, { error: j.error, title: j.title, preview: fin.preview, notice: fin.notice, autoName: j.autoName, ...(both ? { both } : {}), ...(fin.pair?.waiting ? { waiting: true } : {}) });
  j.listeners.forEach((f) => f({ t: 'state', status }));
  j.resolve({ assistantId: j.messageId ?? '', content: j.content, reasoning: j.reasoning, error: j.error, finish: j.finish, stopped, durationMs, status, usage: j.usage, memory: j.memory });
  for (const f of e.onFinish) { try { f(fin); } catch (err) { console.error('[jobs] onFinish', (err as Error).message); } }
  if (left.length && followUp && !j.lane && j.threadId) {
    const th = j.threadId, text = left.map((x) => x.text).join('\n\n');
    setImmediate(() => {
      try {
        const t = getDb().select().from(schema.threads).where(eq(schema.threads.id, th)).get();
        if (t) submitTurn({ thread: t, userId: j.userId, mode: 'send', text, modelId: j.modelId, levelId: j.levelId, kind: j.kind === 'automation' ? 'automation' : 'chat', userMeta: { steer: true } });
      } catch (err) { console.error('[jobs] steer follow-up', (err as Error).message); }
    });
  }
  pump();
}

const CMD_MS = 300;
const ADOPT_MS = 2000;
function startOverlapLoop() {
  const st = g as unknown as { __kxOverlap?: NodeJS.Timeout };
  if (st.__kxOverlap) return;
  let lastAdopt = 0;
  st.__kxOverlap = setInterval(() => {
    try {
      if (!otherInstances().length) return;
      takeCommands();
      const now = Date.now();
      if (now - lastAdopt >= ADOPT_MS) { lastAdopt = now; adoptQueued(now); }
    } catch (e) { console.error('[jobs] overlap', (e as Error).message); }
  }, CMD_MS);
  st.__kxOverlap.unref?.();
}

type CmdPayload = { userId?: string; text?: string; mode?: 'next' | 'now'; steerId?: string; stepId?: string; decision?: 'allow' | 'deny' | 'open' };
export function takeCommands(now = Date.now()): number {
  const db = getDb();
  const me = instanceId();
  const rows = db.select().from(schema.jobCommands).where(and(eq(schema.jobCommands.owner, me), isNull(schema.jobCommands.takenAt))).all();
  let n = 0;
  for (const c of rows) {
    if (!db.update(schema.jobCommands).set({ takenAt: now }).where(and(eq(schema.jobCommands.id, c.id), isNull(schema.jobCommands.takenAt))).run().changes) continue;
    const p = (c.payload ?? {}) as CmdPayload;
    const uid = p.userId ?? '';
    if (c.kind === 'cancel') cancelJob(c.jobId, uid);
    else if (c.kind === 'steer') steerJob(c.jobId, uid, p.text ?? '', p.mode ?? 'next', p.steerId);
    else if (c.kind === 'answer') answerJobStep(c.jobId, p.stepId ?? '', uid, p.decision ?? 'deny');
    n++;
  }
  return n;
}

function forward(jobId: string, userId: string, kind: 'cancel' | 'steer' | 'answer', payload: CmdPayload): boolean {
  if (!otherInstances().length) return false;
  const db = getDb();
  const r = db.select({ userId: schema.jobs.userId, status: schema.jobs.status, owner: schema.jobs.owner }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!r || r.userId !== userId || (r.status !== 'running' && r.status !== 'queued') || !r.owner || r.owner === instanceId() || !ownerAlive(r.owner)) return false;
  db.insert(schema.jobCommands).values({ id: randomUUID(), jobId, owner: r.owner, kind, payload: { ...payload, userId }, createdAt: Date.now() }).run();
  return true;
}

export function cancelJob(jobId: string, userId: string): boolean {
  const j = ex().live.get(jobId);
  if (!j) return forward(jobId, userId, 'cancel', {});
  if (j.userId !== userId) return false;
  if (j.status === 'queued') finalize(j, 'cancelled');
  else if (j.status === 'running') j.ac.abort();
  return true;
}
export function steerJob(jobId: string, userId: string, text: string, mode: 'next' | 'now' = 'next', id?: string): { id: string } | null {
  const j = ex().live.get(jobId);
  if (!j) { const sid = randomUUID().slice(0, 8); return forward(jobId, userId, 'steer', { text, mode, steerId: sid }) ? { id: sid } : null; }
  if (j.userId !== userId || (j.status !== 'queued' && j.status !== 'running') || !j.threadId) return null;
  const s: Steer = { id: id || randomUUID().slice(0, 8), text: text.trim(), mode, at: Date.now(), delivered: false };
  j.steers.push(s);
  const step: StepEvent = { id: 'steer-' + s.id, kind: 'steer', title: s.text, status: 'run', at: { r: j.reasoning.length, c: j.content.length }, round: 0, t0: s.at };
  j.steps.set(step.id, step); j.stepsDirty = true; touch(j);
  publish(j.userId, { t: 'step', th: j.threadId, m: j.messageId, job: j.id, s: step });
  if (mode === 'now') {
    if (j.agent && j.interrupt) j.interrupt();
    else if (!j.agent) { if (j.status === 'queued') finalize(j, 'cancelled'); else j.ac.abort(); }
  }
  return { id: s.id };
}

export function answerJobStep(jobId: string, stepId: string, userId: string, decision: 'allow' | 'deny' | 'open'): boolean {
  const j = ex().live.get(jobId);
  if (!j) return forward(jobId, userId, 'answer', { stepId, decision });
  if (j.userId !== userId) return false;
  return answerStep(jobId, stepId, userId, decision);
}

export function jobOfThread(threadId: string): string | null {
  for (const j of ex().live.values()) if (j.threadId === threadId && (j.status === 'queued' || j.status === 'running')) return j.id;
  return null;
}

export function cancelThreadJobs(threadIds: string[]) {
  for (const j of [...ex().live.values()]) if (j.threadId && threadIds.includes(j.threadId)) { if (j.status === 'queued') finalize(j, 'cancelled'); else j.ac.abort(); }
}
export function cancelUserJobs(userId: string): number {
  let n = 0;
  for (const j of [...ex().live.values()]) if (j.userId === userId) { n++; if (j.status === 'queued') finalize(j, 'cancelled'); else j.ac.abort(); }
  return n;
}
export function waitJob(jobId: string): Promise<JobResult> | null { return ex().live.get(jobId)?.done ?? null; }
export function jobListen(jobId: string, fn: Live['listeners'] extends Set<infer F> ? F : never): (() => void) | null {
  const j = ex().live.get(jobId);
  if (!j) return null;
  j.listeners.add(fn);
  return () => j.listeners.delete(fn);
}

export type LiveView = { jobId: string; status: JobStatus; ahead: number; position: number; eta: number; sq?: { ahead: number; eta: number | null; reason?: string | null }; startedAt: number | null; createdAt: number; content: string; reasoning: string; rStart: number | null; rMs: number; gen?: { n: number; ms: number }; steps?: StepEvent[] };
export function liveOfMessage(messageId: string): LiveView | null {
  const id = ex().byMsg.get(messageId);
  const j = id ? ex().live.get(id) : undefined;
  if (!j) return null;
  const steps = stepList(j);
  const q = j.status === 'queued' ? placeOf(j) : null;
  return { jobId: j.id, status: j.status, ahead: q?.ahead ?? 0, position: q?.position ?? 0, eta: q?.eta ?? 0, ...(j.sq && j.status === 'running' ? { sq: { ahead: j.sq.ahead, eta: j.sq.eta, ...(j.sq.reason ? { reason: j.sq.reason } : {}) } } : {}), startedAt: j.startedAt, createdAt: j.createdAt, content: j.content, reasoning: j.reasoning, rStart: j.rStart, rMs: j.rMs, gen: genOf(j), ...(steps.length ? { steps } : {}) };
}
export function activeJobs(userId: string) {
  return [...ex().live.values()].filter((j) => j.userId === userId).map((j) => ({ id: j.id, threadId: j.threadId, messageId: j.messageId, status: j.status, modelId: j.modelId }));
}

function release(j: Live) {
  const e = ex();
  const qk = queueOf(j.modelId);
  e.active.set(qk, Math.max(0, (e.active.get(qk) ?? 1) - 1));
  e.live.delete(j.id);
  if (j.messageId && e.byMsg.get(j.messageId) === j.id) e.byMsg.delete(j.messageId);
  pump();
}

function restoreQueued(rows: (typeof schema.jobs.$inferSelect)[], now: number, msg: string): number {
  const e = ex();
  const db = getDb();
  let n = 0;
  for (const r of rows) {
    if (e.live.has(r.id)) continue;
    if (!r.threadId || !r.messageId) { db.update(schema.jobs).set({ status: 'error', error: msg, finishedAt: now }).where(and(eq(schema.jobs.id, r.id), eq(schema.jobs.status, 'queued'))).run(); continue; }
    const t = db.select().from(schema.threads).where(eq(schema.threads.id, r.threadId)).get();
    const m = db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId)).get();
    if (!t || !m || !getModel(r.modelId)) { db.update(schema.jobs).set({ status: 'error', error: msg, finishedAt: now }).where(and(eq(schema.jobs.id, r.id), eq(schema.jobs.status, 'queued'))).run(); continue; }
    const base = r.mode === 'continue'
      ? { content: m.content, reasoning: m.reasoning ?? '', reasoningMs: m.reasoningMs ?? 0, meta: (m.meta ?? {}) as Record<string, unknown>, durationMs: ((m.meta as { durationMs?: number } | null)?.durationMs) ?? 0 }
      : { content: '', reasoning: '', reasoningMs: 0, meta: (m.meta ?? {}) as Record<string, unknown>, durationMs: 0 };
    const lane = laneOf(m);
    const j = newLive({ id: r.id, userId: r.userId, threadId: r.threadId, groupId: t.groupId, kind: r.kind as JobKind, mode: r.mode as Mode, messageId: r.messageId, userMessageId: r.userMessageId,
      modelId: r.modelId, levelId: r.levelId, apiKeyId: r.apiKeyId, createdAt: r.createdAt, base, content: base.content, reasoning: base.reasoning, rMs: base.reasoningMs, title: t.title,
      lane, session: lane ? sessionMeta(m) : null, pairKey: lane ? m.parentId : null, folderId: t.folderId ?? null });
    e.live.set(j.id, j); e.byMsg.set(r.messageId, j.id); queue(queueOf(j.modelId)).push(j.id);
    n++;
  }
  return n;
}

export function adoptQueued(now = Date.now()): number {
  if (isDraining()) return 0;
  const rows = getDb().select().from(schema.jobs).where(eq(schema.jobs.status, 'queued')).orderBy(schema.jobs.createdAt).all();
  const n = restoreQueued(rows, now, 'Прервано перезапуском сервера');
  if (n) { console.log(`[jobs] взято из очереди другого процесса: ${n}`); pump(); }
  return n;
}

export function boot() {
  const e = ex();
  if (e.booted) return;
  e.booted = true;
  const db = getDb();
  const now = Date.now();
  const msg = 'Прервано перезапуском сервера';
  for (const r of db.select().from(schema.jobs).where(eq(schema.jobs.status, 'running')).all()) {
    if (ownerAlive(r.owner, now)) continue;
    db.update(schema.jobs).set({ status: 'error', error: msg, finishedAt: now }).where(eq(schema.jobs.id, r.id)).run();
    if (r.messageId) {
      const m = db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId)).get();
      if (m) db.update(schema.messages).set({ meta: { ...(m.meta ?? {}), status: 'error', error: msg, finish: null } }).where(eq(schema.messages.id, m.id)).run();
    }
  }
  const queued = db.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued')).orderBy(schema.jobs.createdAt).all();
  const restored = restoreQueued(queued, now, msg);
  if (restored) console.log(`[jobs] восстановлено из очереди: ${restored}`);
  pump();
  startOverlapLoop();
  onDrain(() => {
    const ee = ex();
    for (const [key, q] of ee.queues) {
      for (const id of q.splice(0)) { const j = ee.live.get(id); if (j && j.status === 'queued') { ee.live.delete(id); if (j.messageId) ee.byMsg.delete(j.messageId); } }
      announceQueue(key);
    }
  });
  registerBusy('jobs', () => { let n = 0; for (const j of ex().live.values()) if (j.status === 'running') n++; return n; });
  void import('./agentMail').then((m) => m.startMail()).catch((e) => console.error('[mail] start', (e as Error).message));
}

export function shutdown() {
  const e = ex();
  const db = getDb();
  const msg = 'Прервано перезапуском сервера';
  for (const j of e.live.values()) {
    if (j.status !== 'running') continue;
    try {
      persist(j);
      db.update(schema.jobs).set({ status: 'error', error: msg, finishedAt: Date.now() }).where(eq(schema.jobs.id, j.id)).run();
      if (j.messageId) {
        const m = db.select().from(schema.messages).where(eq(schema.messages.id, j.messageId)).get();
        if (m) db.update(schema.messages).set({ content: j.content, reasoning: j.reasoning || null, meta: { ...(m.meta ?? {}), status: 'error', error: msg } }).where(eq(schema.messages.id, m.id)).run();
      }
    } catch {  }
  }
}

export async function runTurn(inp: TurnInput): Promise<TurnResult> {
  const s = submitTurn({ ...inp, kind: (inp.userMeta as { auto?: unknown } | undefined)?.auto ? 'automation' : 'chat' });
  const wait = waitJob(s.jobId);
  if (inp.signal) inp.signal.addEventListener('abort', () => cancelJob(s.jobId, inp.userId), { once: true });
  const r = wait ? await wait : null;
  return r ?? { assistantId: s.assistantMessageId, content: '', error: 'задача потеряна', finish: null, stopped: false, durationMs: 0 };
}

export { TurnError };
export type { Thread };
export const _test = { ex, inArray, and };


function serverTps(u: unknown): number | null {
  const v = ((u as Record<string, { decode_tps?: unknown } | undefined> | null)?.[EXTRA_KEY])?.decode_tps;
  return typeof v === 'number' && v > 0 && v < 10000 ? v : null;
}
