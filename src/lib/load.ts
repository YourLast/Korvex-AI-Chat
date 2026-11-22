import { estTokens } from '@/lib/tokest';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { Message } from './db/schema';
import { activePath, messageSkeleton, messagesById } from './tree';
import { expandPairs, laneOf, pairOf } from './pairs';
import { compareOf, votesFor } from './compare';
import type { FileChip, MsgView, AssistantMeta } from './types';
import { ratingsFor } from './ratings';
import { liveOfMessage } from './jobs';

export const TAIL_TURNS = 8;

export type LoadOpts = { turns?: number; before?: string; include?: string;  leaf?: string | null };

export function sliceTail(rows: Message[], opts: LoadOpts): { rows: Message[]; hasMore: boolean } {
  let end = rows.length;
  if (opts.before) {
    const i = rows.findIndex((m) => m.id === opts.before);
    end = i < 0 ? rows.length : i;
  }
  const head = rows.slice(0, end);
  if (!opts.turns || opts.turns <= 0) return { rows: head, hasMore: false };
  let seen = 0, start = 0;
  for (let i = head.length - 1; i >= 0; i--) {
    if (head[i].role === 'user' && ++seen === opts.turns) { start = i; break; }
  }
  if (seen < opts.turns) start = 0;
  if (opts.include) {
    let j = head.findIndex((m) => m.id === opts.include);
    while (j > 0 && head[j].role !== 'user') j--;
    if (j >= 0 && j < start) start = j;
  }
  return { rows: head.slice(start), hasMore: start > 0 };
}

export function loadThread(userId: string, threadId: string, opts: LoadOpts = {}) {
  let open: Set<string> | null = null;
  const openGuesses = () => (open ??= new Set(getDb().select({ id: schema.userMemory.id }).from(schema.userMemory)
    .where(and(eq(schema.userMemory.userId, userId), eq(schema.userMemory.sure, 0))).all().map((r) => r.id)));
  const db = getDb();
  const thread = db.select().from(schema.threads).where(and(eq(schema.threads.id, threadId), eq(schema.threads.userId, userId))).get();
  if (!thread) return null;
  const all = messageSkeleton(thread.id);
  const path = activePath(all, opts.leaf ?? thread.leafId);
  const tail = sliceTail(path, opts);
  const rows = messagesById(expandPairs(all, tail.rows).map((m) => m.id));
  const hasMore = tail.hasMore;
  const sibKey = (m: Message) => `${m.role}|${m.parentId ?? ''}|${laneOf(m) ?? ''}`;
  const sibs = new Map<string, Message[]>();
  for (const m of all) {
    const k = sibKey(m);
    const arr = sibs.get(k);
    if (arr) arr.push(m); else sibs.set(k, [m]);
  }
  const pairs = rows.map((m) => pairOf(m)).filter((p): p is NonNullable<typeof p> => !!p);
  const votes = votesFor(userId, pairs);
  const files = db.select().from(schema.files).where(eq(schema.files.threadId, thread.id)).all();
  const chip = (f: (typeof files)[number]): FileChip => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, tokens: estTokens(f.text), info: f.info ?? undefined });
  const byId = new Map(files.map((f) => [f.id, chip(f)]));
  const rates = ratingsFor(userId, rows.filter((m) => m.role === 'assistant').map((m) => m.id));
  const shown = rows.filter((m) => !(m.role === 'user' && (m.meta as { hidden?: unknown } | null)?.hidden));
  const messages: MsgView[] = shown.map((m) => {
    const sib = sibs.get(sibKey(m)) ?? [m];
    const siblings = sib.length > 1 ? { ids: sib.map((x) => x.id), index: sib.findIndex((x) => x.id === m.id) } : undefined;
    if (m.role === 'user') {
      const ids = ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []).filter((id) => byId.has(id));
      const p = pairOf(m);
      return { id: m.id, role: 'user', content: m.content, files: ids.map((id) => byId.get(id)!), siblings, auto: (m.meta as { auto?: { id: string; name: string } } | null)?.auto,
        ...((m.meta as { from?: MsgView['from'] } | null)?.from ? { from: (m.meta as { from: MsgView['from'] }).from } : {}),
        ...((m.meta as { memUpd?: MsgView['memUpd'] } | null)?.memUpd?.length ? { memUpd: (m.meta as { memUpd: MsgView['memUpd'] }).memUpd } : {}),
        ...(p ? { pair: { a: p.a, b: p.b, pick: p.pick ?? null, vote: votes.get(`${p.a}|${p.b}`) ?? null } } : {}) };
    }
    const steps = (m.meta as { steps?: MsgView['steps'] } | null)?.steps;
    const gs = (m.meta as { guesses?: { id: string; text: string }[] } | null)?.guesses;
    const liveGuesses = gs?.length ? gs.filter((g) => openGuesses().has(g.id)) : null;
    const v: MsgView = { id: m.id, role: 'assistant', content: m.content, reasoning: m.reasoning, reasoningMs: m.reasoningMs, meta: liveGuesses ? { ...viewMeta(m.meta), guesses: liveGuesses.length ? liveGuesses : undefined } : viewMeta(m.meta), siblings, rating: rates.get(m.id) ?? null, ...(steps?.length ? { steps } : {}) };
    const lv = liveOfMessage(m.id);
    if (lv) {
      Object.assign(v, {
        content: lv.content, reasoning: lv.reasoning, reasoningMs: lv.rMs || null, streaming: true, jobId: lv.jobId, ahead: lv.ahead, eta: lv.eta, squeue: lv.sq ?? null,
        phase: lv.status === 'queued' ? 'queued' : lv.content ? 'answer' : lv.reasoning ? 'think' : 'wait',
        startedAt: lv.startedAt ?? lv.createdAt, rStartedAt: lv.rStart, liveGen: lv.gen, ...(lv.steps ? { steps: lv.steps } : {}),
      });
      v.meta = { ...v.meta, error: null, errorUser: null, stopped: false };
    }
    return v;
  });
  const usedFiles = new Set(path.flatMap((m) => ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? [])));
  return { thread, messages, hasMore, compare: compareOf(thread), fileNames: files.filter((f) => usedFiles.has(f.id) && !f.mime.startsWith('image/')).map((f) => f.name) };
}

export function groupThreads(userId: string, groupId: string) {
  const rows = getDb().select({ id: schema.threads.id, side: schema.threads.side }).from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), eq(schema.threads.groupId, groupId))).all();
  const a = rows.find((r) => r.side === 'a');
  const b = rows.find((r) => r.side === 'b');
  return a && b ? { a: a.id, b: b.id } : null;
}

export function loadGroup(userId: string, groupId: string, opts: LoadOpts = { turns: TAIL_TURNS }) {
  const g = groupThreads(userId, groupId);
  if (!g) return null;
  const a = loadThread(userId, g.a, opts), b = loadThread(userId, g.b, opts);
  if (!a || !b) return null;
  return {
    groupId,
    a: { id: g.a, modelId: a.thread.modelId, effort: a.thread.effort, title: a.thread.title },
    b: { id: g.b, modelId: b.thread.modelId, effort: b.thread.effort },
    msgsA: a.messages, msgsB: b.messages, fileNames: a.fileNames, hasMore: a.hasMore || b.hasMore,
    votes: groupVotes(userId, a.messages, b.messages),
  };
}
export type GroupInit = NonNullable<ReturnType<typeof loadGroup>>;

function groupVotes(userId: string, ma: MsgView[], mb: MsgView[]): Record<string, string> {
  const ans = (ms: MsgView[]) => { const out: (string | null)[] = []; for (const m of ms) { if (m.role === 'user') out.push(null); else if (out.length && out[out.length - 1] === null) out[out.length - 1] = m.id; else out.push(m.id); } return out; };
  const xa = ans(ma), xb = ans(mb);
  const pairs = xa.map((a, i) => ({ a: a ?? '', b: xb[i] ?? '' })).filter((p) => p.a && p.b);
  return Object.fromEntries(votesFor(userId, pairs));
}

export { inArray };

function viewMeta(meta: Record<string, unknown> | null): AssistantMeta {
  if (!meta || (!('agent' in meta) && !('steps' in meta))) return (meta ?? {}) as AssistantMeta;
  const { agent: _a, steps: _s, ...rest } = meta; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest as AssistantMeta;
}
