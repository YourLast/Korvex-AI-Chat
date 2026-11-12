import { z } from 'zod';
import { and, eq, inArray, or } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from '@/lib/db';
import { authed, fail, json } from '@/lib/api';
import { usableModel } from '@/lib/models';
import { capLevel } from '@/lib/levelPolicy';
import { publish } from '@/lib/bus';
import { cancelThreadJobs } from '@/lib/jobs';
import { ext } from '@/ext';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const scope = (id: string, userId: string) =>
  and(eq(schema.threads.userId, userId), or(eq(schema.threads.id, id), eq(schema.threads.groupId, id)));

export async function PATCH(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = z.union([
    z.object({ title: z.string().min(1).max(120) }),
    z.object({ muted: z.boolean() }),
    z.object({ modelId: z.string().min(1), levelId: z.string().min(1) }),
  ]).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if ('muted' in p.data) {
    if (!getDb().update(schema.threads).set({ muted: p.data.muted ? 1 : 0 }).where(scope(id, a.user.id)).run().changes) return fail(404, 'thread not found');
    for (const t of getDb().select({ id: schema.threads.id, groupId: schema.threads.groupId }).from(schema.threads).where(scope(id, a.user.id)).all()) publish(a.user.id, { t: 'mute', th: t.id, gid: t.groupId, muted: p.data.muted });
    return json({ ok: true });
  }
  if ('title' in p.data) {
    if (!getDb().update(schema.threads).set({ title: p.data.title, titleManual: 1 }).where(scope(id, a.user.id)).run().changes) return fail(404, 'thread not found');
    for (const t of getDb().select({ id: schema.threads.id, groupId: schema.threads.groupId, updatedAt: schema.threads.updatedAt }).from(schema.threads).where(scope(id, a.user.id)).all()) {
      publish(a.user.id, { t: 'thread', id: t.id, gid: t.groupId, title: p.data.title, updatedAt: t.updatedAt });
    }
    return json({ ok: true });
  }
  const { modelId, levelId: asked } = p.data;
  const m = usableModel(modelId, a.user.role, a.user.id);
  if (!m || !m.levels.some((l) => l.id === asked)) return fail(400, 'unknown model/level');
  const levelId = capLevel(m, m.levels.find((l) => l.id === asked)!, a.user.id).id;
  const t = getDb().select({ id: schema.threads.id, groupId: schema.threads.groupId, modelId: schema.threads.modelId }).from(schema.threads).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, a.user.id))).get();
  if (!t) return fail(404, 'thread not found');
  if (t.groupId && t.modelId !== modelId) return fail(400, 'model of a compare side is fixed');
  getDb().update(schema.threads).set(t.groupId ? { effort: levelId } : { modelId, effort: levelId }).where(eq(schema.threads.id, t.id)).run();
  publish(a.user.id, { t: 'sel', th: t.id, modelId: t.groupId ? t.modelId : modelId, levelId });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const db = getDb();
  const ts = db.select({ id: schema.threads.id }).from(schema.threads).where(scope(id, a.user.id)).all();
  if (!ts.length) return fail(404, 'thread not found');
  const used = ts.length ? db.select({ name: schema.automations.name, target: schema.automations.targetThreadId }).from(schema.automations).where(inArray(schema.automations.targetThreadId, ts.map((t) => t.id))).all() : [];
  if (used.length) return fail(409, `Чат используется автоматизацией «${used[0].name}»: сначала измените или удалите её`);
  cancelThreadJobs(ts.map((t) => t.id));
  for (const t of ts) {
    for (const f of db.select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.threadId, t.id)).all()) {
      fs.rmSync(path.join(dataDir(), 'files', f.id), { recursive: true, force: true });
    }
  }
  ext.beforeThreadsGone?.(ts.map((t) => t.id));
  db.delete(schema.threads).where(scope(id, a.user.id)).run();
  ext.afterThreadsGone?.(a.user.id, ts.map((t) => t.id));
  publish(a.user.id, { t: 'thread-del', ids: ts.map((t) => t.id), gid: id });
  return json({ ok: true });
}
