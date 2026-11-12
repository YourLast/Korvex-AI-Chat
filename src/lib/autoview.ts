import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { Automation } from './db/schema';
import { isRunning } from './automations';

export type AutoView = {
  id: string; name: string; description: string; prompt: string; modelId: string; levelId: string; cron: string; timezone: string;
  targetThreadId: string; targetTitle: string; enabled: boolean; nextRunAt: number | null; lastRunAt: number | null;
  lastStatus: string | null; lastError: string | null; running: boolean;
};

export function autoView(a: Automation): AutoView {
  const t = getDb().select({ title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, a.targetThreadId)).get();
  return {
    id: a.id, name: a.name, description: a.description, prompt: a.prompt, modelId: a.modelId, levelId: a.levelId, cron: a.cron, timezone: a.timezone,
    targetThreadId: a.targetThreadId, targetTitle: t?.title ?? '(чат удалён)', enabled: !!a.enabled, nextRunAt: a.nextRunAt, lastRunAt: a.lastRunAt,
    lastStatus: isRunning(a.id) ? 'running' : a.lastStatus, lastError: a.lastError, running: isRunning(a.id),
  };
}
