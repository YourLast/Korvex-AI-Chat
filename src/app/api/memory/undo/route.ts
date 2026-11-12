import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { authed, fail, json } from '@/lib/api';
import { getDb, schema } from '@/lib/db';
import { publish } from '@/lib/bus';
import { undoMemUpd } from '@/lib/memoryUndo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ messageId: z.string().min(1).max(64), index: z.number().int().min(0).max(20).optional() });

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const db = getDb();
  const m = db.select({ id: schema.messages.id, threadId: schema.messages.threadId }).from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.messages.id, p.data.messageId), eq(schema.threads.userId, a.user.id))).get();
  if (!m) return fail(404, 'not found');
  const r = undoMemUpd(a.user.id, m.id, p.data.index);
  if (!r) return fail(404, 'nothing to undo');
  publish(a.user.id, { t: 'memupd', th: m.threadId, m: m.id, items: r.items });
  publish(a.user.id, { t: 'memory', action: 'undo' });
  return json({ items: r.items, undone: r.undone });
}
