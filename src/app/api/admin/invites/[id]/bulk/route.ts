import { z } from 'zod';
import { adminOnly, fail, json } from '@/lib/api';
import { alphaByInvite, blockByInvite } from '@/lib/moderation';

export const runtime = 'nodejs';

const Body = z.object({ action: z.enum(['ban', 'alpha']), reason: z.string().max(500).optional(), revoke: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.action === 'alpha') {
    const g = alphaByInvite(a.user.id, id);
    return g.ok ? json(g) : fail(g.status, g.error);
  }
  const r = blockByInvite(a.user.id, id, { reason: p.data.reason, revoke: p.data.revoke });
  if (!r.ok) return fail(r.status, r.error);
  return json(r);
}
