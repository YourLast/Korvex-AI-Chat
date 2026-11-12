import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { startBusyWatch } from '@/lib/busy';
import { adminAlerts } from '@/lib/loadAlerts';
import { setLoadAlerts } from '@/lib/status';
import { userLang } from '@/lib/userLang';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  startBusyWatch();
  return json(adminAlerts(userLang(a.user.id)));
}

const Body = z.object({ on: z.boolean() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'on — true | false');
  setLoadAlerts(p.data.on);
  return json({ ok: true, ...adminAlerts(userLang(a.user.id)) });
}
