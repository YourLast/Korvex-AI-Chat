import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { adminSnapshot, setLoad, StatusError } from '@/lib/status';
import { parseUntil } from '@/lib/announce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(adminSnapshot());
}

const Body = z.object({
  state: z.enum(['normal', 'training', 'down']),
  model: z.string().max(64).nullish(),
  until: z.union([z.string(), z.number(), z.null()]).optional(),
  minutes: z.number().positive().max(60 * 24 * 30).optional(),
});

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'state — normal | training | down; model — id модели или не указывать');
  const until = parseUntil(p.data.until, p.data.minutes);
  if (until === 'bad') return fail(400, 'until — время в формате ISO или миллисекунды');
  try {
    setLoad({ state: p.data.state, model: p.data.model || null, until: until ?? null });
  } catch (e) {
    if (e instanceof StatusError) return fail(e.status, e.message);
    throw e;
  }
  return json({ ok: true, ...adminSnapshot() });
}
