import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { ThreadLite } from './types';

export function threadList(userId: string): ThreadLite[] {
  const rows = getDb()
    .select({ id: schema.threads.id, title: schema.threads.title, modelId: schema.threads.modelId, groupId: schema.threads.groupId, side: schema.threads.side, updatedAt: schema.threads.updatedAt,
      answeredAt: schema.threads.answeredAt, readAt: schema.threads.readAt, muted: schema.threads.muted, compare: schema.threads.compare, folderId: schema.threads.folderId })
    .from(schema.threads).where(and(eq(schema.threads.userId, userId), eq(schema.threads.temporary, 0))).orderBy(desc(schema.threads.updatedAt)).limit(300).all();
  if (rows.length === 300) {
    const have = new Set(rows.map((r) => r.id));
    const more = getDb().select({ id: schema.threads.id, title: schema.threads.title, modelId: schema.threads.modelId, groupId: schema.threads.groupId, side: schema.threads.side, updatedAt: schema.threads.updatedAt,
      answeredAt: schema.threads.answeredAt, readAt: schema.threads.readAt, muted: schema.threads.muted, compare: schema.threads.compare, folderId: schema.threads.folderId })
      .from(schema.threads).where(and(eq(schema.threads.userId, userId), isNotNull(schema.threads.folderId), eq(schema.threads.temporary, 0))).orderBy(desc(schema.threads.updatedAt)).limit(2000).all();
    for (const r of more) if (!have.has(r.id)) rows.push(r);
  }
  const busyThreads = new Set(getDb().select({ th: schema.jobs.threadId }).from(schema.jobs)
    .where(and(eq(schema.jobs.userId, userId), inArray(schema.jobs.status, ['queued', 'running']))).all().map((r) => r.th).filter((x): x is string => !!x));
  const busyGroups = new Set(rows.filter((r) => r.groupId && busyThreads.has(r.id)).map((r) => r.groupId!));
  const unreadGroups = new Set(rows.filter((r) => r.groupId && r.answeredAt && r.answeredAt > (r.readAt ?? 0)).map((r) => r.groupId!));
  const seen = new Set<string>();
  const out: ThreadLite[] = [];
  for (const r of rows) {
    if (r.groupId) { if (seen.has(r.groupId)) continue; seen.add(r.groupId); }
    const unread = r.groupId ? unreadGroups.has(r.groupId) : !!r.answeredAt && r.answeredAt > (r.readAt ?? 0);
    out.push({ id: r.id, title: r.title, modelId: r.modelId, groupId: r.groupId, side: r.side, updatedAt: r.updatedAt, unread, muted: !!r.muted, busy: r.groupId ? busyGroups.has(r.groupId) : busyThreads.has(r.id), ...(r.compare?.on ? { cmp: true } : {}), folderId: r.folderId ?? null });
  }
  return out;
}
