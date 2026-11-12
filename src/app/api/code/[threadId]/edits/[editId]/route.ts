import { z } from 'zod';
import { agentsOnly, fail, json } from '@/lib/api';
import { editOf, revertEdit } from '@/lib/code/session';
import { udiff } from '@/lib/code/fsx';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string; editId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { threadId, editId } = await params;
  const e = editOf(a.user.id, threadId, editId);
  if (!e) return fail(404, 'not found');
  const d = await udiff(e.path, e.before, e.after);
  return json({ id: e.id, path: e.path, source: e.source, added: e.added, removed: e.removed, revertedAt: e.revertedAt, createdAt: e.createdAt, callId: e.callId, messageId: e.messageId, diff: d.diff });
}

export async function POST(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { threadId, editId } = await params;
  const p = z.object({ action: z.literal('revert') }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if (!editOf(a.user.id, threadId, editId)) return fail(404, 'not found');
  try {
    const r = await revertEdit(a.user.id, threadId, editId);
    return json({ ok: true, diff: r?.diff ?? '' });
  } catch (e) { return codeFail(e); }
}
