import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';

const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function countBlock(kind: string, provider = '', n = 1, now = Date.now()) {
  try {
    getDb().insert(schema.blockUsage).values({ day: day(now), kind, provider, n })
      .onConflictDoUpdate({ target: [schema.blockUsage.day, schema.blockUsage.kind, schema.blockUsage.provider], set: { n: sql`${schema.blockUsage.n} + ${n}` } }).run();
  } catch {  }
}

export function usageSince(days = 7, now = Date.now()) {
  const from = day(now - (days - 1) * 86400_000);
  return getDb().select().from(schema.blockUsage).where(gte(schema.blockUsage.day, from)).all();
}
export function usedToday(kind: string, provider = '', now = Date.now()): number {
  return getDb().select({ n: schema.blockUsage.n }).from(schema.blockUsage)
    .where(and(eq(schema.blockUsage.day, day(now)), eq(schema.blockUsage.kind, kind), eq(schema.blockUsage.provider, provider))).get()?.n ?? 0;
}
