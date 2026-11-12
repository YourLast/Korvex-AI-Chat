import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { sendPush, subsOf } from '@/lib/push';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ device: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const subs = subsOf(a.user.id).filter((s) => s.device === p.data.device);
  if (!subs.length) return fail(404, 'На этом устройстве уведомления не включены');
  const r = await Promise.all(subs.map((s) => sendPush(s, { title: 'Korvex AI', body: 'Уведомления включены: сообщим, когда модель ответит.', url: '/settings', tag: 'kx-test' })));
  return r.includes('ok') ? json({ ok: true }) : fail(502, 'Служба уведомлений не приняла сообщение. Выключите и включите уведомления снова.');
}
