import { authed, fail, jsonz } from '@/lib/api';
import { loadThread } from '@/lib/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const turns = Math.min(500, Math.max(0, Number(sp.get('turns')) || 0));
  const d = loadThread(a.user.id, id, { turns, before: sp.get('before') ?? undefined });
  if (!d) return fail(404, 'not found');
  return jsonz(req, { messages: d.messages, hasMore: d.hasMore, fileNames: d.fileNames, title: d.thread.title, modelId: d.thread.modelId, effort: d.thread.effort, groupId: d.thread.groupId, compare: d.compare, now: Date.now() });
}
