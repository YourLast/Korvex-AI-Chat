import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { getDb, schema } from './db';
import { isRunning, modelBusy, runAutomation } from './automations';
import { nextRun } from './cron';
import { canAgents } from './roles';
import { isDraining, onDrain, ownerAlive } from './instance';
import { featureOn } from './features';

const g = globalThis as unknown as { __kxSched?: { timer: NodeJS.Timeout } };

export function tick(now = Date.now(), deps: { run?: typeof runAutomation } = {}): string[] {
  if (!featureOn('automations')) return [];
  if (isDraining()) return [];
  const db = getDb();
  const due = db.select().from(schema.automations).where(and(eq(schema.automations.enabled, 1), isNotNull(schema.automations.nextRunAt), lte(schema.automations.nextRunAt, now))).orderBy(schema.automations.nextRunAt).all();
  const started: string[] = [];
  const off = new Set(due.length ? db.select({ id: schema.users.id, role: schema.users.role, disabled: schema.users.disabled }).from(schema.users).all()
    .filter((u) => u.disabled === 1 || !canAgents(u.role)).map((u) => u.id) : []);
  for (const a of due) {
    if (off.has(a.userId)) continue;
    if (isRunning(a.id) || modelBusy(a.modelId)) continue;
    const claim = db.update(schema.automations).set({ nextRunAt: null })
      .where(and(eq(schema.automations.id, a.id), eq(schema.automations.nextRunAt, a.nextRunAt!))).run();
    if (!claim.changes) continue;
    started.push(a.id);
    void (deps.run ?? runAutomation)(a, 'schedule').catch((e) => console.error('[automation] run failed', (e as Error).message));
  }
  return started;
}

export function startScheduler(tickMs = Number(process.env.SCHEDULER_TICK_MS) || 15_000) {
  if (g.__kxSched) return;
  const db = getDb();
  const now = Date.now();
  const dead = db.select({ id: schema.automationRuns.id, automationId: schema.automationRuns.automationId, owner: schema.automationRuns.owner }).from(schema.automationRuns)
    .where(eq(schema.automationRuns.status, 'running')).all().filter((r) => !ownerAlive(r.owner, now));
  for (const r of dead) {
    db.update(schema.automationRuns).set({ status: 'error', error: 'Прервано перезапуском сервера', finishedAt: now }).where(eq(schema.automationRuns.id, r.id)).run();
    db.update(schema.automations).set({ lastStatus: 'error', lastError: 'Прервано перезапуском сервера' }).where(and(eq(schema.automations.id, r.automationId), eq(schema.automations.lastStatus, 'running'))).run();
  }
  for (const a of db.select().from(schema.automations).where(eq(schema.automations.enabled, 1)).all()) {
    if (a.nextRunAt == null) { try { db.update(schema.automations).set({ nextRunAt: nextRun(a.cron, a.timezone, now) }).where(eq(schema.automations.id, a.id)).run(); } catch {  } }
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { console.error('[scheduler]', (e as Error).message); } }, tickMs);
  timer.unref?.();
  g.__kxSched = { timer };
  onDrain(() => clearInterval(timer));
  console.log(`[scheduler] started, tick ${tickMs} ms`);
}
