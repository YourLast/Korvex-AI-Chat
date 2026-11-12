import { z } from 'zod';
import { authed, fail, jsonz } from '@/lib/api';
import { loadThread } from '@/lib/load';
import { allMessages, deepestLatest, setLeaf } from '@/lib/tree';
import { publish } from '@/lib/bus';
import { getDb, schema } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { laneOf, pairOf } from '@/lib/pairs';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = z.object({ messageId: z.string(), turns: z.number().int().min(0).max(500).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const thread = getDb().select().from(schema.threads).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, a.user.id))).get();
  if (!thread) return fail(404, 'not found');
  const d = { thread };
  const all = allMessages(d.thread.id);
  const target = all.find((m) => m.id === p.data.messageId);
  if (!target) return fail(404, 'message not found');
  const lane = laneOf(target);
  if (lane) {
    const u = all.find((m) => m.id === target.parentId);
    const pr = pairOf(u);
    if (!u || !pr || pr.pick) return fail(400, 'pair is closed');
    getDb().update(schema.messages).set({ meta: { ...(u.meta ?? {}), pair: { ...pr, [lane]: target.id } } }).where(eq(schema.messages.id, u.id)).run();
    if (lane === 'a') setLeaf(d.thread, deepestLatest(all, target.id));
  } else setLeaf(d.thread, deepestLatest(all, p.data.messageId));
  publish(a.user.id, { t: 'msg', th: d.thread.id, gid: d.thread.groupId });
  const fresh = loadThread(a.user.id, id, { turns: p.data.turns ?? 0, include: p.data.messageId })!;
  return jsonz(req, { messages: fresh.messages, hasMore: fresh.hasMore, fileNames: fresh.fileNames });
}
