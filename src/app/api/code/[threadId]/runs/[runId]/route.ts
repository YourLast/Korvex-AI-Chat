import { agentsOnly, fail, json } from '@/lib/api';
import { runOf } from '@/lib/code/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string; runId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { threadId, runId } = await params;
  const r = runOf(a.user.id, threadId, runId);
  return r ? json(r) : fail(404, 'not found');
}
