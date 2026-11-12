import { agentsOnly, fail, json } from '@/lib/api';
import { branchDiff, ownSession } from '@/lib/code/session';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  if (!ownSession(a.user.id, threadId)) return fail(404, 'not found');
  const path = new URL(req.url).searchParams.get('path') ?? undefined;
  try { return json(await branchDiff(a.user.id, threadId, { path, cap: 1_000_000 })); } catch (e) { return codeFail(e); }
}
