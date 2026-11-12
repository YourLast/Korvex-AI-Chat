import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { dismissNotice, pendingNotices } from '@/lib/seat';
import { supportInfo } from '@/lib/support';
import { weekState } from '@/lib/week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const w = weekState(a.user);
  return json({ notices: pendingNotices(a.user.id), week: w.limited ? { pct: w.pct, phase: w.phase, resetAt: w.resetAt } : null, support: supportInfo() });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ dismiss: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  return json({ ok: dismissNotice(a.user.id, p.data.dismiss) });
}
