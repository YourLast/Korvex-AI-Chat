import { and, eq, sql } from 'drizzle-orm';
import { authed, json } from '@/lib/api';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const db = getDb();
  const own = db.select({ id: schema.messages.id }).from(schema.messages).innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.messages.id, id), eq(schema.threads.userId, a.user.id), eq(schema.messages.role, 'assistant'))).get();
  if (own) db.run(sql`update messages set meta = json_set(coalesce(meta, '{}'), '$.copies', coalesce(json_extract(meta, '$.copies'), 0) + 1) where id = ${id}`);
  return json({ ok: true });
}
