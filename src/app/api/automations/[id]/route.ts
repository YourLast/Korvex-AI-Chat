import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { agentsOnly, fail, json } from '@/lib/api';
import { getModel, usableModel } from '@/lib/models';
import { nextRun, validateCron } from '@/lib/cron';
import { autoView } from '@/lib/autoview';
import { AutoBody } from '@/lib/autoschema';

export const runtime = 'nodejs';

const own = (id: string, userId: string) => getDb().select().from(schema.automations).where(and(eq(schema.automations.id, id), eq(schema.automations.userId, userId))).get();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const cur = own(id, a.user.id);
  if (!cur) return fail(404, 'not found');
  const p = AutoBody.partial().extend({ enabled: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  const b = p.data;
  const modelId = b.modelId ?? cur.modelId, levelId = b.levelId ?? cur.levelId;
  const model = b.modelId !== undefined || b.levelId !== undefined || b.enabled === true ? usableModel(modelId, a.user.role, a.user.id) : getModel(modelId);
  if (!model || !model.levels.some((l) => l.id === levelId)) return fail(400, 'Неизвестная модель или уровень');
  const cron = b.cron ?? cur.cron, tz = b.timezone ?? cur.timezone;
  const bad = validateCron(cron, tz);
  if (bad) return fail(400, bad);
  if (b.targetThreadId) {
    const t = getDb().select().from(schema.threads).where(eq(schema.threads.id, b.targetThreadId)).get();
    if (!t || t.userId !== a.user.id) return fail(400, 'Чат не найден');
  }
  const enabled = b.enabled ?? !!cur.enabled;
  const set = {
    name: b.name ?? cur.name, description: b.description ?? cur.description, prompt: b.prompt ?? cur.prompt, modelId, levelId, cron, timezone: tz,
    targetThreadId: b.targetThreadId ?? cur.targetThreadId, enabled: enabled ? 1 : 0,
    nextRunAt: enabled ? (b.cron || b.timezone || b.enabled !== undefined || !cur.nextRunAt ? nextRun(cron, tz) : cur.nextRunAt) : null,
  };
  getDb().update(schema.automations).set(set).where(eq(schema.automations.id, id)).run();
  return json({ automation: autoView(own(id, a.user.id)!) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!own(id, a.user.id)) return fail(404, 'not found');
  getDb().delete(schema.automations).where(eq(schema.automations.id, id)).run();
  return json({ ok: true });
}
