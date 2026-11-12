import { z } from 'zod';
import { agentsOnly, fail, json } from '@/lib/api';
import { ownSession, revertFile } from '@/lib/code/session';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  if (!ownSession(a.user.id, threadId)) return fail(404, 'not found');
  const p = z.object({ path: z.string().min(1).max(1000) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try { const r = await revertFile(a.user.id, threadId, p.data.path); return json({ ok: true, diff: r?.diff ?? '' }); } catch (e) { return codeFail(e); }
}
