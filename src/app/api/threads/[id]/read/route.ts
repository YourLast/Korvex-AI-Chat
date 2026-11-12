import { and, eq, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { authed, fail, json } from '@/lib/api';
import { markRead } from '@/lib/notify';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const rows = getDb().select({ id: schema.threads.id, groupId: schema.threads.groupId, answeredAt: schema.threads.answeredAt, readAt: schema.threads.readAt }).from(schema.threads)
    .where(and(eq(schema.threads.userId, a.user.id), or(eq(schema.threads.id, id), eq(schema.threads.groupId, id)))).all();
  if (!rows.length) return fail(404, 'not found');
  const gid = rows[0].groupId;
  const all = gid ? getDb().select({ id: schema.threads.id }).from(schema.threads).where(and(eq(schema.threads.userId, a.user.id), eq(schema.threads.groupId, gid))).all().map((r) => r.id) : rows.map((r) => r.id);
  markRead(a.user.id, all, gid);
  return json({ ok: true });
}
