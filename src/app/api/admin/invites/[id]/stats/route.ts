import { adminOnly, fail, json } from '@/lib/api';
import { inviteStats } from '@/lib/inviteStats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const s = inviteStats(id, a.user.timezone || 'Europe/Moscow');
  if (!s) return fail(404, 'Приглашение не найдено');
  return json(s);
}
