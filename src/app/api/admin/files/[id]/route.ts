import { adminOnly, fail, json } from '@/lib/api';
import { logView, uploadText } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const f = uploadText(id);
  if (!f) return fail(404, 'Нет такого файла');
  logView({ adminId: a.user.id, ownerId: f.userId, kind: 'file', target: f.id, threadId: f.threadId });
  return json(f);
}
