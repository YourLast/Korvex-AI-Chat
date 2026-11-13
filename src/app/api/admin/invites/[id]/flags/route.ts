import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { adminOnly, fail, json } from '@/lib/api';
import { getDb, schema } from '@/lib/db';
import { inviteFlags, setInviteFlags } from '@/lib/inviteFlags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exists = (id: string) => !!getDb().select({ id: schema.invites.id }).from(schema.invites).where(eq(schema.invites.id, id)).get();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!exists(id)) return fail(404, 'Приглашение не найдено');
  return json({ flags: inviteFlags(id) });
}

const Body = z.object({ max: z.boolean().optional(), orgs: z.boolean().optional(), weekMult: z.number().min(0).max(100).nullable().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!exists(id)) return fail(404, 'Приглашение не найдено');
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  return json({ ok: true, flags: setInviteFlags(id, p.data, a.user.id) });
}
