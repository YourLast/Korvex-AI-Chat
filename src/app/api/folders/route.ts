import { z } from 'zod';
import { authed, fail, json, jsonz } from '@/lib/api';
import { createFolder, FolderError, listFolders } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return jsonz(req, { folders: listFolders(a.user.id) }, { etag: true });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ name: z.string().min(1).max(200), instruction: z.string().max(20000).optional(), color: z.string().max(16).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try { return json({ folder: createFolder(a.user.id, p.data.name, p.data.instruction ?? '', p.data.color ?? '') }); }
  catch (e) { if (e instanceof FolderError) return fail(e.status, e.message); throw e; }
}
