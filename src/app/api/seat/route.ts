import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { dismissNotice, pendingNotices } from '@/lib/seat';
import { supportInfo } from '@/lib/support';
import { resetDay, tzOf, weekState } from '@/lib/week';
import { localeOf } from '@/lib/i18n/core';
import { reqLang } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const w = weekState(a.user);
  const date = w.limited ? resetDay(w.resetAt, tzOf(a.user), localeOf(reqLang(req, a.user.lang))) : null;
  return json({ notices: pendingNotices(a.user.id), week: w.limited ? { pct: w.pct, phase: w.phase, resetAt: w.resetAt, date } : null, support: supportInfo() });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ dismiss: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  return json({ ok: dismissNotice(a.user.id, p.data.dismiss) });
}
