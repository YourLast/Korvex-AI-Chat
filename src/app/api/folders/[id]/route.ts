import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { deleteFolder, FolderError, updateFolder } from '@/lib/folders';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = z.object({ name: z.string().min(1).max(200).optional(), instruction: z.string().max(20000).optional(), collapsed: z.boolean().optional(), sort: z.number().int().optional(), color: z.string().max(16).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try { return json({ folder: updateFolder(a.user.id, id, p.data) }); }
  catch (e) { if (e instanceof FolderError) return fail(e.status, e.message); throw e; }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  try { deleteFolder(a.user.id, id); return json({ ok: true }); }
  catch (e) { if (e instanceof FolderError) return fail(e.status, e.message); throw e; }
}
