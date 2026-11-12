import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { maxAdminOnly, setMaxAdminOnly } from '@/lib/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json({ maxAdminOnly: maxAdminOnly() });
}

const Body = z.object({ maxAdminOnly: z.boolean() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'maxAdminOnly — true | false');
  return json({ ok: true, maxAdminOnly: setMaxAdminOnly(p.data.maxAdminOnly) });
}
