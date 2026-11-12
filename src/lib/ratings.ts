import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import { REASON_IDS, type RatingView } from './rating';

export type RatingInput = { value: 1 | -1 | 0; reasons?: string[]; comment?: string };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export function setRating(userId: string, messageId: string, inp: RatingInput): RatingView | null | 'not-found' {
  const db = getDb();
  const row = db.select({ m: schema.messages, t: schema.threads }).from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.messages.id, messageId), eq(schema.threads.userId, userId))).get();
  if (!row || row.m.role !== 'assistant') return 'not-found';
  const old = db.select().from(schema.ratings).where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.messageId, messageId))).get();
  if (inp.value === 0) {
    if (old) db.delete(schema.ratings).where(eq(schema.ratings.id, old.id)).run();
    return null;
  }
  const reasons = inp.reasons ? [...new Set(inp.reasons.filter((r) => REASON_IDS.includes(r)))] : undefined;
  const comment = inp.comment !== undefined ? inp.comment.trim().slice(0, 2000) : undefined;
  const same = old && old.value === inp.value;
  const nextReasons = inp.value === -1 ? (reasons ?? (same ? old!.reasons ?? [] : [])) : [];
  const nextComment = comment ?? (same ? old!.comment ?? '' : '');
  const meta = (row.m.meta ?? {}) as { modelId?: string; levelId?: string; durationMs?: number; usage?: { prompt_tokens?: number; completion_tokens?: number } | null };
  const now = Date.now();
  const snap = {
    threadId: row.m.threadId, modelId: meta.modelId ?? row.t.modelId, levelId: meta.levelId ?? null, durationMs: num(meta.durationMs),
    promptTokens: num(meta.usage?.prompt_tokens), completionTokens: num(meta.usage?.completion_tokens),
  };
  if (old) {
    db.update(schema.ratings).set({ value: inp.value, reasons: nextReasons, comment: nextComment || null, ...snap, updatedAt: now }).where(eq(schema.ratings.id, old.id)).run();
  } else {
    db.insert(schema.ratings).values({ id: randomUUID(), userId, messageId, value: inp.value, reasons: nextReasons, comment: nextComment || null, ...snap, createdAt: now, updatedAt: now }).run();
  }
  return { value: inp.value, reasons: nextReasons, comment: nextComment };
}

export function ratingsFor(userId: string, messageIds: string[]): Map<string, RatingView> {
  if (!messageIds.length) return new Map();
  const rows = getDb().select().from(schema.ratings).where(and(eq(schema.ratings.userId, userId), inArray(schema.ratings.messageId, messageIds))).all();
  return new Map(rows.map((r) => [r.messageId, { value: (r.value > 0 ? 1 : -1) as 1 | -1, reasons: r.reasons ?? [], comment: r.comment ?? '' }]));
}
