import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import type { Automation } from './db/schema';
import { nextRun } from './cron';
import { TurnError } from './turn';
import { runTurn } from './jobs';
import { instanceId, otherInstances, ownerAlive, registerBusy } from './instance';

const g = globalThis as unknown as { __kxAutoRunning?: Map<string, string> };
const running = () => (g.__kxAutoRunning ??= new Map());
export const modelBusy = (modelId: string) => running().has(modelId) || (otherInstances().length > 0 && foreignBusy(modelId));
function foreignBusy(modelId: string): boolean {
  try {
    return getDb().select({ owner: schema.automationRuns.owner }).from(schema.automationRuns)
      .innerJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
      .where(and(eq(schema.automationRuns.status, 'running'), eq(schema.automations.modelId, modelId))).all()
      .some((r) => r.owner !== instanceId() && ownerAlive(r.owner));
  } catch { return false; }
}
registerBusy('automations', () => running().size);
export const isRunning = (autoId: string) => [...running().values()].includes(autoId);

const RUN_TIMEOUT_MS = 30 * 60_000;

export type RunOutcome = { runId: string; status: 'ok' | 'error' | 'skipped'; error?: string };

export async function runAutomation(a: Automation, trigger: 'schedule' | 'manual', deps: { run?: typeof runTurn } = {}): Promise<RunOutcome> {
  const db = getDb();
  const runId = randomUUID();
  if (modelBusy(a.modelId)) return { runId, status: 'skipped', error: 'Модель занята другой автоматизацией' };
  running().set(a.modelId, a.id);
  const started = Date.now();
  db.insert(schema.automationRuns).values({ id: runId, automationId: a.id, startedAt: started, status: 'running', trigger, owner: instanceId() }).run();
  db.update(schema.automations).set({ lastStatus: 'running', lastRunAt: started, lastError: null }).where(eq(schema.automations.id, a.id)).run();
  let status: 'ok' | 'error' = 'ok';
  let error: string | null = null;
  let messageId: string | null = null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RUN_TIMEOUT_MS);
  try {
    const thread = db.select().from(schema.threads).where(and(eq(schema.threads.id, a.targetThreadId), eq(schema.threads.userId, a.userId))).get();
    if (!thread) throw new TurnError(404, 'Чат для результата удалён');
    const r = await (deps.run ?? runTurn)({ thread, userId: a.userId, mode: 'send', text: a.prompt, userMeta: { auto: { id: a.id, name: a.name, runId } }, modelId: a.modelId, levelId: a.levelId, signal: ac.signal });
    messageId = r.assistantId;
    if (ac.signal.aborted) { status = 'error'; error = 'Превышено время выполнения (30 минут)'; }
    else if (r.error) { status = 'error'; error = r.error; }
    else if (!r.content.trim()) { status = 'error'; error = 'Модель вернула пустой ответ'; }
  } catch (e) {
    status = 'error';
    error = (e as Error).message;
  } finally {
    clearTimeout(timer);
    running().delete(a.modelId);
  }
  const fin = Date.now();
  db.update(schema.automationRuns).set({ finishedAt: fin, status, error, messageId, durationMs: fin - started }).where(eq(schema.automationRuns.id, runId)).run();
  const fresh = db.select().from(schema.automations).where(eq(schema.automations.id, a.id)).get();
  let next: number | null = null;
  if (fresh && fresh.enabled) { try { next = nextRun(fresh.cron, fresh.timezone, fin); } catch { next = null; } }
  db.update(schema.automations).set({ lastStatus: status, lastError: error, nextRunAt: fresh?.enabled ? next : null }).where(eq(schema.automations.id, a.id)).run();
  return { runId, status, error: error ?? undefined };
}

export function listRuns(autoId: string, limit = 12) {
  return getDb().select().from(schema.automationRuns).where(eq(schema.automationRuns.automationId, autoId)).orderBy(desc(schema.automationRuns.startedAt)).limit(limit).all();
}
