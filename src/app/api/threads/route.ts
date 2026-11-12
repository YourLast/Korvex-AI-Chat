import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from '@/lib/db';
import { authed, fail, json, jsonz } from '@/lib/api';
import { usableModel } from '@/lib/models';
import { threadList } from '@/lib/threadlist';
import { publish } from '@/lib/bus';
import { cleanSide } from '@/lib/compare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const list = threadList(a.user.id);
  return jsonz(req, { threads: list }, { etag: true });
}

const Side = z.object({ modelId: z.string(), levelId: z.string() });
const Single = Side.extend({ compare: z.object({ on: z.boolean(), a: Side, b: Side }).optional(), temporary: z.boolean().optional() });
const Body = z.union([Single, z.object({ compare: z.object({ a: Side, b: Side }) })]);

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const now = Date.now();
  const mk = (s: { modelId: string; levelId: string }, extra: { groupId?: string; side?: string; title?: string; temporary?: boolean; compare?: { on: boolean; a: { modelId: string; levelId: string }; b: { modelId: string; levelId: string } } }) => {
    const m = usableModel(s.modelId, a.user.role, a.user.id);
    if (!m || !m.levels.some((l) => l.id === s.levelId)) return null;
    if (extra.compare && (!usableModel(extra.compare.a.modelId, a.user.role, a.user.id) || !usableModel(extra.compare.b.modelId, a.user.role, a.user.id))) return null;
    const ca = extra.compare ? cleanSide(extra.compare.a) : null, cb = extra.compare ? cleanSide(extra.compare.b) : null;
    const compare = ca && cb ? { on: extra.compare!.on, a: ca, b: cb } : null;
    const t = { id: randomUUID(), userId: a.user.id, title: extra.title ?? 'Новый чат', modelId: s.modelId, effort: s.levelId, groupId: extra.groupId ?? null, side: extra.side ?? null, compare, temporary: extra.temporary ? 1 : 0, createdAt: now, updatedAt: now };
    getDb().insert(schema.threads).values(t).run();
    publish(a.user.id, { t: 'thread', id: t.id, gid: t.groupId, title: t.title, updatedAt: now });
    return t;
  };
  if (!('modelId' in p.data)) {
    const gid = randomUUID();
    const ta = mk(p.data.compare.a, { groupId: gid, side: 'a' });
    const tb = mk(p.data.compare.b, { groupId: gid, side: 'b' });
    if (!ta || !tb) return fail(400, 'unknown model/level');
    return json({ groupId: gid, threads: [ta.id, tb.id] });
  }
  const t = mk(p.data, { compare: p.data.compare, temporary: p.data.temporary });
  if (!t) return fail(400, 'unknown model/level');
  return json({ id: t.id });
}
