import { z } from 'zod';
import { adminOnly, fail, json } from '@/lib/api';
import { ROLES } from '@/lib/roles';
import { createInvite, listInvites, MAX_DAYS, MAX_GROUP } from '@/lib/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  return json({ invites: listInvites() });
}

const Body = z.object({ role: z.enum(ROLES).default('user'), note: z.string().max(100).default(''), days: z.number().int().min(1).max(MAX_DAYS).default(7), maxUses: z.number().int().min(1).max(MAX_GROUP).default(1) });

export async function POST(req: Request) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const { token } = createInvite({ ...p.data, by: a.user.id });
  return json({ path: `/invite/${token}` });
}
