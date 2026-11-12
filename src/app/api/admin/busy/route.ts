import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { adminBusy, startBusyWatch } from '@/lib/busy';
import { setBusyMode, StatusError } from '@/lib/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  startBusyWatch();
  return json(adminBusy());
}

const Body = z.object({ mode: z.enum(['auto', 'off', 'on']) });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'mode — auto | off | on');
  try {
    setBusyMode(p.data.mode);
  } catch (e) {
    if (e instanceof StatusError) return fail(e.status, e.message);
    throw e;
  }
  return json({ ok: true, ...adminBusy() });
}
