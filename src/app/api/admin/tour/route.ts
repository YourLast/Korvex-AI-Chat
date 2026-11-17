import { z } from 'zod';
import { adminOnly, fail, json } from '@/lib/api';
import { deleteSetting, setSetting } from '@/lib/settings';
import { tourKey } from '@/lib/adminTour';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.done) setSetting(tourKey(a.user.id), Date.now(), a.user.id); else deleteSetting(tourKey(a.user.id));
  return json({ ok: true });
}
