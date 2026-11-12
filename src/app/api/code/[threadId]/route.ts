import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { agentsOnly, fail, json } from '@/lib/api';
import { openRepo, stateOf } from '@/lib/code/session';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  try {
    const s = await stateOf(a.user.id, threadId);
    return s ? json(s) : fail(404, 'not found');
  } catch (e) { return codeFail(e); }
}

export async function POST(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  const p = z.object({ repo: z.string().min(3).max(201), branch: z.string().max(200).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const t = getDb().select({ id: schema.threads.id }).from(schema.threads).where(and(eq(schema.threads.id, threadId), eq(schema.threads.userId, a.user.id))).get();
  if (!t) return fail(404, 'thread not found');
  try {
    const s = await openRepo({ userId: a.user.id, threadId, repo: p.data.repo, branch: p.data.branch || null, origin: 'code' });
    return json({ repo: s.repo, baseBranch: s.baseBranch, status: s.status }, 202);
  } catch (e) { return codeFail(e); }
}
