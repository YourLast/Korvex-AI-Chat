import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@/lib/db';
import { agentsOnly, fail, json } from '@/lib/api';
import { usableModel } from '@/lib/models';
import { nextRun, validateCron } from '@/lib/cron';
import { autoView } from '@/lib/autoview';
import { AutoBody } from '@/lib/autoschema';
import { publish } from '@/lib/bus';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_PER_USER = 20;

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const rows = getDb().select().from(schema.automations).where(eq(schema.automations.userId, a.user.id)).orderBy(desc(schema.automations.createdAt)).all();
  return json({ automations: rows.map(autoView), timezone: a.user.timezone });
}

export async function POST(req: Request) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('automations', a.user.id)) return fail(403, FEATURE_OFF);
  const p = AutoBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  const b = p.data;
  const db = getDb();
  const model = usableModel(b.modelId, a.user.role, a.user.id);
  if (!model || !model.levels.some((l) => l.id === b.levelId)) return fail(400, 'Неизвестная модель или уровень');
  const tz = b.timezone || a.user.timezone;
  const bad = validateCron(b.cron, tz);
  if (bad) return fail(400, bad);
  if (db.select({ id: schema.automations.id }).from(schema.automations).where(eq(schema.automations.userId, a.user.id)).all().length >= MAX_PER_USER) return fail(409, `Не больше ${MAX_PER_USER} автоматизаций на пользователя`);
  const now = Date.now();
  let threadId = b.targetThreadId ?? null;
  if (threadId) {
    const t = db.select().from(schema.threads).where(eq(schema.threads.id, threadId)).get();
    if (!t || t.userId !== a.user.id) return fail(400, 'Чат не найден');
  } else {
    threadId = randomUUID();
    db.insert(schema.threads).values({ id: threadId, userId: a.user.id, title: b.name, modelId: b.modelId, effort: b.levelId, createdAt: now, updatedAt: now }).run();
    publish(a.user.id, { t: 'thread', id: threadId, gid: null, title: b.name, updatedAt: now });
  }
  const row = { id: randomUUID(), userId: a.user.id, name: b.name, description: b.description, prompt: b.prompt, modelId: b.modelId, levelId: b.levelId, cron: b.cron, timezone: tz, targetThreadId: threadId, enabled: 1, nextRunAt: nextRun(b.cron, tz, now), lastRunAt: null, lastStatus: null, lastError: null, createdAt: now };
  db.insert(schema.automations).values(row).run();
  return json({ automation: autoView(row) });
}
