import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { endpointOk, removeDevice, removeSub, saveSub, subsOf, vapid } from '@/lib/push';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const device = new URL(req.url).searchParams.get('device') ?? '';
  return json({ publicKey: vapid().publicKey, on: subsOf(a.user.id).some((s) => s.device === device) });
}

const Sub = z.object({ device: z.string().min(1).max(64), subscription: z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }) }) });

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('push', a.user.id)) return fail(403, FEATURE_OFF);
  const p = Sub.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if (!endpointOk(p.data.subscription.endpoint)) return fail(400, 'Неизвестная служба уведомлений');
  saveSub(a.user.id, p.data.device, p.data.subscription, req.headers.get('user-agent') ?? '');
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ endpoint: z.string().max(2000).optional(), device: z.string().max(64).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.endpoint && !p.data.device)) return fail(400, 'bad body');
  if (p.data.endpoint) removeSub(a.user.id, p.data.endpoint);
  if (p.data.device) removeDevice(a.user.id, p.data.device);
  return json({ ok: true });
}
