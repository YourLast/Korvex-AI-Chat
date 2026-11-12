import { adminOnly, fail, json } from '@/lib/api';
import { logView, personById, userMemory } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!personById(id)) return fail(404, 'Нет такого человека');
  logView({ adminId: a.user.id, ownerId: id, kind: 'memory' });
  return json(userMemory(id));
}
