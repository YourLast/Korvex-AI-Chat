import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { authed, fail, json } from '@/lib/api';
import { publish } from '@/lib/bus';
import { compareOf, pickAnswer, setCompare } from '@/lib/compare';
import { usableModel } from '@/lib/models';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };
const Side = z.object({ modelId: z.string().min(1), levelId: z.string().min(1) });

function own(userId: string, id: string) {
  return getDb().select().from(schema.threads).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId))).get();
}

export async function PUT(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('compare', a.user.id)) return fail(403, FEATURE_OFF);
  const { id } = await params;
  const p = z.object({ on: z.boolean(), a: Side.optional(), b: Side.optional(), lane: z.enum(['a', 'b']).optional(), src: z.string().max(40).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const t = own(a.user.id, id);
  if (!t) return fail(404, 'thread not found');
  if (t.groupId) return fail(400, 'old compare chat');
  if ((p.data.a && !usableModel(p.data.a.modelId, a.user.role, a.user.id)) || (p.data.b && !usableModel(p.data.b.modelId, a.user.role, a.user.id))) return fail(400, 'unknown model/level');
  const r = setCompare(a.user.id, t, p.data, p.data.lane ?? null);
  if (!r) return fail(400, 'unknown model/level');
  let sel = null as null | { modelId: string; levelId: string };
  if (!p.data.on) {
    sel = r.compare[r.resolved?.lane ?? p.data.lane ?? 'a'];
    getDb().update(schema.threads).set({ modelId: sel.modelId, effort: sel.levelId }).where(eq(schema.threads.id, t.id)).run();
    publish(a.user.id, { t: 'sel', th: t.id, modelId: sel.modelId, levelId: sel.levelId });
  }
  publish(a.user.id, { t: 'cmp', th: t.id, on: r.compare.on, a: r.compare.a, b: r.compare.b, lane: r.resolved?.lane ?? null, src: p.data.src ?? null });
  if (r.resolved?.changed) publish(a.user.id, { t: 'msg', th: t.id, gid: null });
  return json({ compare: r.compare, lane: r.resolved?.lane ?? null, changed: !!r.resolved?.changed, sel });
}

export async function POST(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('compare', a.user.id)) return fail(403, FEATURE_OFF);
  const { id } = await params;
  const p = z.object({ pick: z.string().min(1), src: z.string().max(40).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const t = own(a.user.id, id);
  if (!t) return fail(404, 'thread not found');
  const r = pickAnswer(a.user.id, t, p.data.pick);
  if (r === 'not-found') return fail(404, 'message not found');
  if (r === 'not-pair') return fail(400, 'not a compare answer');
  const c = r.compare ?? compareOf(t);
  publish(a.user.id, { t: 'sel', th: t.id, modelId: r.sel.modelId, levelId: r.sel.levelId });
  if (c) publish(a.user.id, { t: 'cmp', th: t.id, on: false, a: c.a, b: c.b, lane: r.lane, src: p.data.src ?? null });
  publish(a.user.id, { t: 'msg', th: t.id, gid: null });
  return json({ lane: r.lane, sel: r.sel, compare: c ?? null });
}
