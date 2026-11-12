import { z } from 'zod';
import { agentsOnly, fail, json } from '@/lib/api';
import { ownSession, pushAndPr } from '@/lib/code/session';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  if (!ownSession(a.user.id, threadId)) return fail(404, 'not found');
  const p = z.object({ title: z.string().min(1).max(250), body: z.string().max(20000).optional(), draft: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try { return json(await pushAndPr({ userId: a.user.id, threadId, title: p.data.title, body: p.data.body, draft: p.data.draft })); } catch (e) { return codeFail(e); }
}
