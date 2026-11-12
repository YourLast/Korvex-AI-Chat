import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { FolderError, moveThreads } from '@/lib/folders';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500), folderId: z.string().min(1).max(64).nullable() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try {
    const moved = moveThreads(a.user.id, p.data.ids, p.data.folderId);
    if (!moved.length) return fail(404, 'thread not found');
    return json({ ok: true, moved: moved.length });
  } catch (e) { if (e instanceof FolderError) return fail(e.status, e.message); throw e; }
}
