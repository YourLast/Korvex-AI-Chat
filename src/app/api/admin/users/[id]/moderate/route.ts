import { z } from 'zod';
import { adminOnly, fail, json } from '@/lib/api';
import { blockUser, deleteUser, unblockUser } from '@/lib/moderation';

export const runtime = 'nodejs';

const Body = z.object({ action: z.enum(['ban', 'pause', 'unblock', 'delete']), reason: z.string().max(500).optional(), confirm: z.string().max(300).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const { action, reason, confirm } = p.data;
  const r = action === 'ban' || action === 'pause' ? blockUser(a.user.id, id, { kind: action, reason })
    : action === 'unblock' ? unblockUser(a.user.id, id)
    : deleteUser(a.user.id, id, { confirm: confirm ?? '', reason });
  if (!r.ok) return fail(r.status, r.error);
  return json(r);
}
