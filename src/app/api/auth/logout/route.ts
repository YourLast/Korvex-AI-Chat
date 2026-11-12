import { fail, json } from '@/lib/api';
import { currentUser, endSession, sameOrigin } from '@/lib/auth';
import { removeDevice } from '@/lib/push';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'bad origin');
  const body = (await req.json().catch(() => null)) as { device?: unknown } | null;
  const u = await currentUser();
  if (u && typeof body?.device === 'string' && body.device) removeDevice(u.id, body.device.slice(0, 64));
  await endSession();
  const r = json({ ok: true });
  r.headers.set('Clear-Site-Data', '"cache"');
  return r;
}
