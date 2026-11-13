import { authed, fail, json } from '@/lib/api';
import { removeLibraryDoc } from '@/lib/orgDocs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!removeLibraryDoc(a.user.id, id)) return fail(404, 'Нет такого файла');
  return json({ ok: true });
}
