import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { adminSnapshot, setBanner, StatusError } from '@/lib/status';
import { parseUntil } from '@/lib/announce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(adminSnapshot());
}

const Body = z.object({
  text: z.string().max(2000).optional(),
  level: z.enum(['info', 'warn', 'warning']).optional(),
  until: z.union([z.string(), z.number(), z.null()]).optional(),
  minutes: z.number().positive().max(60 * 24 * 90).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверное тело запроса');
  const until = parseUntil(p.data.until, p.data.minutes);
  if (until === 'bad') return fail(400, 'until — время в формате ISO (2026-10-30T18:00:00+03:00) или миллисекунды');
  try {
    setBanner({ text: p.data.text, level: p.data.level === undefined ? undefined : p.data.level === 'info' ? 'info' : 'warn', until, enabled: p.data.enabled });
  } catch (e) {
    if (e instanceof StatusError) return fail(e.status, e.message);
    throw e;
  }
  return json({ ok: true, ...adminSnapshot() });
}
