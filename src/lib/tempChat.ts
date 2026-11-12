import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { publish } from './bus';
import { cancelThreadJobs, jobOfThread } from './jobs';
import { isToken, outRoot } from './outfiles';
import { syncIndex } from './search';
import { ext } from '@/ext';

export const TEMP_IDLE_MS = 15 * 60_000;
const idleMs = () => Number(process.env.KX_TEMP_IDLE_MS) || TEMP_IDLE_MS;
export const CLOSE_GRACE_MS = () => Number(process.env.KX_TEMP_GRACE_MS) || 10_000;
const TICK_MS = () => Number(process.env.KX_TEMP_TICK_MS) || 5_000;
const IDLE_EVERY_MS = () => Math.min(30_000, TICK_MS() * 6);

type State = { closing: Map<string, number>; seen: Map<string, number>; boot: number; lastIdle: number; stats: { closed: number; swept: number; failed: number }; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __kxTemp?: State };
const S = (): State => (g.__kxTemp ??= { closing: new Map(), seen: new Map(), boot: Date.now(), lastIdle: 0, stats: { closed: 0, swept: 0, failed: 0 } });

type Row = { id: string; userId: string; temporary: number };
const threadOf = (userId: string, id: string): Row | undefined =>
  getDb().select({ id: schema.threads.id, userId: schema.threads.userId, temporary: schema.threads.temporary }).from(schema.threads)
    .where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId))).get();

export function tempBusy(id: string): boolean {
  if (jobOfThread(id)) return true;
  return !!getDb().select({ id: schema.jobs.id }).from(schema.jobs)
    .where(and(eq(schema.jobs.threadId, id), inArray(schema.jobs.status, ['queued', 'running']))).limit(1).get();
}

export type CloseResult = 'ok' | 'none' | 'normal';
export function closeTemp(userId: string, id: string, now = Date.now()): CloseResult {
  const t = threadOf(userId, id);
  if (!t) return 'none';
  if (!t.temporary) return 'normal';
  S().closing.set(id, now);
  return 'ok';
}

export function reopenTemp(userId: string, id: string, now = Date.now()): CloseResult {
  const t = threadOf(userId, id);
  if (!t) return 'none';
  if (!t.temporary) return 'normal';
  const s = S();
  s.closing.delete(id);
  s.seen.set(id, now);
  return 'ok';
}

export function lastActivity(id: string): number {
  const r = getDb().get<{ at: number | null }>(sql`select max(
      coalesce((select updated_at from threads where id = ${id}), 0),
      coalesce((select max(created_at) from messages where thread_id = ${id}), 0),
      coalesce((select max(coalesce(finished_at, started_at, created_at)) from jobs where thread_id = ${id}), 0)) as at`);
  const s = S();
  return Math.max(Number(r?.at ?? 0), s.seen.get(id) ?? 0);
}

export type PurgeResult = { ok: true; messages: number; files: number; outFiles: number } | { ok: false; why: 'none' | 'normal' | 'busy' | 'automation' };

const rm = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {  } };

export function purgeTemp(userId: string, id: string): PurgeResult {
  const t = threadOf(userId, id);
  if (!t) return { ok: false, why: 'none' };
  if (!t.temporary) return { ok: false, why: 'normal' };
  if (tempBusy(id)) return { ok: false, why: 'busy' };
  const db = getDb();
  if (db.select({ id: schema.automations.id }).from(schema.automations).where(eq(schema.automations.targetThreadId, id)).get()) return { ok: false, why: 'automation' };
  cancelThreadJobs([id]);
  const fileIds = db.select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.threadId, id)).all().map((f) => f.id);
  const tokens = db.select({ token: schema.outFiles.token }).from(schema.outFiles).where(and(eq(schema.outFiles.threadId, id), eq(schema.outFiles.userId, userId))).all().map((r) => r.token).filter(isToken);
  const messages = Number(db.get<{ c: number }>(sql`select count(*) c from messages where thread_id = ${id}`)?.c ?? 0);
  ext.beforeThreadsGone?.([id]);
  db.transaction((tx) => {
    tx.delete(schema.ratings).where(eq(schema.ratings.threadId, id)).run();
    tx.delete(schema.compareVotes).where(eq(schema.compareVotes.threadId, id)).run();
    tx.delete(schema.outFiles).where(eq(schema.outFiles.threadId, id)).run();
    tx.delete(schema.agentMsgs).where(or(eq(schema.agentMsgs.fromThread, id), eq(schema.agentMsgs.toThread, id))).run();
    tx.delete(schema.adminViews).where(or(eq(schema.adminViews.threadId, id), and(eq(schema.adminViews.kind, 'chat'), eq(schema.adminViews.target, id)))).run();
    tx.delete(schema.threads).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId))).run();
  });
  for (const f of fileIds) rm(path.join(dataDir(), 'files', f));
  for (const tk of tokens) { rm(path.join(outRoot(), tk)); rm(path.join(dataDir(), 'thumbs', tk)); }
  ext.afterThreadsGone?.(userId, [id]);
  try { syncIndex(); } catch {  }
  const s = S();
  s.closing.delete(id); s.seen.delete(id);
  publish(userId, { t: 'thread-del', ids: [id], gid: null });
  return { ok: true, messages, files: fileIds.length, outFiles: tokens.length };
}

export type SweepResult = { closed: string[]; swept: string[]; waiting: number; failed: number };

export function sweepTemp(now = Date.now(), opts: { idle?: boolean } = {}): SweepResult {
  const s = S();
  const res: SweepResult = { closed: [], swept: [], waiting: 0, failed: 0 };
  const grace = CLOSE_GRACE_MS();
  const drop = (id: string, userId: string, how: 'closed' | 'swept') => {
    try {
      const r = purgeTemp(userId, id);
      if (r.ok) {
        res[how].push(id); s.stats[how === 'closed' ? 'closed' : 'swept']++;
        console.log(`[temp] удалён чат ${id.slice(0, 8)} (${how === 'closed' ? 'закрыт' : 'простой 15 мин'}): сообщений ${r.messages}, файлов ${r.files}, файлов модели ${r.outFiles}; всего закрыто ${s.stats.closed}, подметено ${s.stats.swept}`);
      } else if (r.why === 'busy') res.waiting++;
      else { s.closing.delete(id); if (r.why === 'automation') res.failed++; }
    } catch (e) { s.stats.failed++; res.failed++; console.error('[temp] не удалось удалить', id.slice(0, 8), (e as Error).message); }
  };
  for (const [id, at] of [...s.closing]) {
    if (now - at < grace) continue;
    const t = getDb().select({ userId: schema.threads.userId }).from(schema.threads).where(eq(schema.threads.id, id)).get();
    if (!t) { s.closing.delete(id); continue; }
    drop(id, t.userId, 'closed');
  }
  if (opts.idle !== false) {
    const rows = getDb().select({ id: schema.threads.id, userId: schema.threads.userId }).from(schema.threads).where(eq(schema.threads.temporary, 1)).all();
    const live = new Set(rows.map((r) => r.id));
    for (const id of [...s.seen.keys()]) if (!live.has(id)) s.seen.delete(id);
    for (const r of rows) {
      if (now - Math.max(lastActivity(r.id), s.boot) < idleMs()) continue;
      drop(r.id, r.userId, 'swept');
    }
  }
  return res;
}

export function startTempSweeper() {
  const s = S();
  if (s.timer) return;
  s.timer = setInterval(() => {
    try {
      const now = Date.now();
      const idle = now - s.lastIdle >= IDLE_EVERY_MS();
      if (idle) s.lastIdle = now;
      sweepTemp(now, { idle });
    } catch (e) { console.error('[temp] подметание', (e as Error).message); }
  }, TICK_MS());
  s.timer.unref?.();
}

export const tempStats = () => ({ ...S().stats, closing: S().closing.size });
export const _resetTemp = () => { const s = S(); s.closing.clear(); s.seen.clear(); s.boot = 0; s.lastIdle = 0; s.stats = { closed: 0, swept: 0, failed: 0 }; };
