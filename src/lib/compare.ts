import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import type { Message, Thread, ThreadCompare, CompareSide } from './db/schema';
import { getModel } from './models';
import { nearestLevel } from './levels';
import { activePath, allMessages, setLeaf } from './tree';
import { defaultLane, laneOf, openPairs, pairOf, resolvePlan, type Lane, type PairRef, type Winner } from './pairs';

export const WINNERS: Winner[] = ['a', 'b', 'tie', 'bad'];

export function cleanSide(s: Partial<CompareSide> | null | undefined): CompareSide | null {
  const m = s?.modelId ? getModel(s.modelId) : undefined;
  if (!m) return null;
  const lv = s?.levelId && m.levels.some((l) => l.id === s.levelId) ? s.levelId : nearestLevel(m, s?.levelId ?? m.defaultLevel);
  return { modelId: m.id, levelId: lv };
}

export function compareOf(t: Pick<Thread, 'compare'>): ThreadCompare | null {
  const c = t.compare;
  if (!c || typeof c !== 'object') return null;
  const a = cleanSide(c.a), b = cleanSide(c.b);
  return a && b ? { on: !!c.on, a, b } : null;
}

export function votesFor(userId: string, pairs: { a: string; b: string }[]): Map<string, Winner> {
  if (!pairs.length) return new Map();
  const ids = [...new Set(pairs.map((p) => p.a))];
  const rows = getDb().select().from(schema.compareVotes).where(and(eq(schema.compareVotes.userId, userId), inArray(schema.compareVotes.messageA, ids))).all();
  return new Map(rows.map((r) => [`${r.messageA}|${r.messageB}`, r.winner as Winner]));
}

export function resolveOpen(userId: string, thread: Thread, lane: Lane | null): { lane: Lane; changed: boolean } {
  const db = getDb();
  const all = allMessages(thread.id);
  const fresh = db.select({ leafId: schema.threads.leafId }).from(schema.threads).where(eq(schema.threads.id, thread.id)).get();
  const leaf = fresh?.leafId ?? thread.leafId;
  const path = activePath(all, leaf);
  const open = openPairs(path);
  if (!open.length) return { lane: lane ?? 'a', changed: false };
  const refs = open.map((u) => pairOf(u)!);
  const votes = votesFor(userId, refs);
  const pick = lane ?? defaultLane(refs, (p) => votes.get(`${p.a}|${p.b}`));
  const plan = resolvePlan(all, path, pick, leaf);
  db.transaction((tx) => {
    for (const p of plan.picks) {
      const u = all.find((m) => m.id === p.questionId)!;
      tx.update(schema.messages).set({ meta: { ...(u.meta ?? {}), pair: p.pair } }).where(eq(schema.messages.id, u.id)).run();
    }
    for (const mv of plan.moves) tx.update(schema.messages).set({ parentId: mv.to }).where(and(eq(schema.messages.threadId, thread.id), eq(schema.messages.parentId, mv.from))).run();
    if (plan.leaf) tx.update(schema.threads).set({ leafId: plan.leaf }).where(eq(schema.threads.id, thread.id)).run();
  });
  return { lane: pick, changed: true };
}

export function setCompare(userId: string, thread: Thread, next: { on: boolean; a?: Partial<CompareSide>; b?: Partial<CompareSide> }, lane: Lane | null = null): { compare: ThreadCompare; resolved: { lane: Lane; changed: boolean } | null } | null {
  const cur = compareOf(thread);
  const a = cleanSide(next.a ?? cur?.a), b = cleanSide(next.b ?? cur?.b);
  if (!a || !b) return null;
  const compare: ThreadCompare = { on: next.on, a, b };
  const resolved = next.on ? null : resolveOpen(userId, thread, lane);
  getDb().update(schema.threads).set({ compare }).where(eq(schema.threads.id, thread.id)).run();
  return { compare, resolved };
}

export function pickAnswer(userId: string, thread: Thread, messageId: string): { lane: Lane; sel: CompareSide; compare: ThreadCompare | null } | 'not-found' | 'not-pair' {
  const db = getDb();
  const m = db.select().from(schema.messages).where(and(eq(schema.messages.id, messageId), eq(schema.messages.threadId, thread.id))).get();
  if (!m || m.role !== 'assistant') return 'not-found';
  const lane = laneOf(m);
  if (!lane) return 'not-pair';
  const meta = (m.meta ?? {}) as { modelId?: string; levelId?: string };
  const sel = cleanSide({ modelId: meta.modelId, levelId: meta.levelId }) ?? { modelId: thread.modelId, levelId: thread.effort };
  const u = m.parentId ? db.select().from(schema.messages).where(eq(schema.messages.id, m.parentId)).get() : undefined;
  const p = pairOf(u);
  if (u && p && !p.pick && p[lane] !== m.id) db.update(schema.messages).set({ meta: { ...(u.meta ?? {}), pair: { ...p, [lane]: m.id } } }).where(eq(schema.messages.id, u.id)).run();
  const t2 = db.select().from(schema.threads).where(eq(schema.threads.id, thread.id)).get()!;
  resolveOpen(userId, t2, lane);
  const cur = compareOf(t2);
  const compare = cur ? { ...cur, on: false } : null;
  db.update(schema.threads).set({ modelId: sel.modelId, effort: sel.levelId, ...(compare ? { compare } : {}) }).where(eq(schema.threads.id, thread.id)).run();
  return { lane, sel, compare };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export function setVote(userId: string, aId: string, bId: string, winner: Winner | null): { winner: Winner } | null | 'not-found' {
  const db = getDb();
  const rows = db.select({ m: schema.messages, t: schema.threads }).from(schema.messages).innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(inArray(schema.messages.id, [aId, bId]), eq(schema.threads.userId, userId))).all();
  const a = rows.find((r) => r.m.id === aId), b = rows.find((r) => r.m.id === bId);
  if (!a || !b || aId === bId || a.m.role !== 'assistant' || b.m.role !== 'assistant') return 'not-found';
  const old = db.select().from(schema.compareVotes).where(and(eq(schema.compareVotes.userId, userId), eq(schema.compareVotes.messageA, aId), eq(schema.compareVotes.messageB, bId))).get();
  if (!winner) { if (old) db.delete(schema.compareVotes).where(eq(schema.compareVotes.id, old.id)).run(); return null; }
  const ma = (a.m.meta ?? {}) as { modelId?: string; levelId?: string; durationMs?: number }, mb = (b.m.meta ?? {}) as typeof ma;
  const now = Date.now();
  const snap = {
    threadId: a.m.threadId, questionId: a.m.parentId, winner,
    modelA: ma.modelId ?? a.t.modelId, levelA: ma.levelId ?? null, modelB: mb.modelId ?? b.t.modelId, levelB: mb.levelId ?? null,
    durationA: num(ma.durationMs), durationB: num(mb.durationMs),
  };
  if (old) db.update(schema.compareVotes).set({ ...snap, updatedAt: now }).where(eq(schema.compareVotes.id, old.id)).run();
  else db.insert(schema.compareVotes).values({ id: randomUUID(), userId, messageA: aId, messageB: bId, ...snap, createdAt: now, updatedAt: now }).run();
  return { winner };
}

export type { Lane, PairRef, Winner, Message };
