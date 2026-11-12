import { adminOnly, fail, json } from '@/lib/api';
import { CHAT_PAGE, logView, personById, userChats, type ChatFilter } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = personById(id);
  if (!p) return fail(404, 'Нет такого человека');
  const q = new URL(req.url).searchParams;
  const f = q.get('filter');
  const filter: ChatFilter = f === 'down' || f === 'up' ? f : 'all';
  logView({ adminId: a.user.id, ownerId: id, kind: 'user' });
  return json(userChats(id, { q: (q.get('q') ?? '').slice(0, 200), filter, offset: Number(q.get('offset')) || 0, limit: Number(q.get('limit')) || CHAT_PAGE }));
}
