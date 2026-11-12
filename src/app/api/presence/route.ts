import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { presenceGet, presenceUpdate } from '@/lib/bus';
import { touchDevice } from '@/lib/push';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ conn: z.string().max(64), visible: z.boolean(), active: z.boolean().optional(), threads: z.array(z.string().max(64)).max(4) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if (!presenceUpdate(p.data.conn, a.user.id, { visible: p.data.visible, active: p.data.active ?? true, threads: p.data.threads })) return fail(404, 'no such connection');
  const me = presenceGet(p.data.conn);
  if (p.data.visible && p.data.active !== false && me) touchDevice(a.user.id, me.device);
  return json({ ok: true });
}
