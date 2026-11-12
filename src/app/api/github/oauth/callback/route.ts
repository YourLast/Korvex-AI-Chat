import { NextResponse } from 'next/server';
import { agentsOnly } from '@/lib/api';
import { exchangeCode, takeState } from '@/lib/github/oauth';
import { connect } from '@/lib/github/account';
import { publish } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const u = new URL(req.url);
  const origin = req.headers.get('x-forwarded-host') ? `https://${req.headers.get('x-forwarded-host')}` : u.origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?github=${q}#github`, origin), 302);
  const st = takeState(u.searchParams.get('state') ?? '', a.user.id);
  if (!st) return back('state');
  if (u.searchParams.get('error')) return back('denied');
  const code = u.searchParams.get('code');
  if (!code) return back('error');
  try {
    const t = await exchangeCode(code, origin);
    await connect(a.user.id, t.t, 'oauth', { refresh: t.r, exp: t.exp, rexp: t.rexp });
    publish(a.user.id, { t: 'github', connected: true });
    return back('ok');
  } catch (e) {
    console.error('[github-oauth]', (e as Error).message.slice(0, 200));
    return back('error');
  }
}
