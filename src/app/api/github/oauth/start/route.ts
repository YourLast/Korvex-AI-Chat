import { NextResponse } from 'next/server';
import { agentsOnly, fail } from '@/lib/api';
import { authorizeUrl } from '@/lib/github/oauth';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  if (!featureFor('code', a.user.id)) return fail(403, FEATURE_OFF);
  const origin = new URL(req.url).origin;
  const url = authorizeUrl(a.user.id, req.headers.get('x-forwarded-host') ? `https://${req.headers.get('x-forwarded-host')}` : origin);
  if (!url) return fail(404, 'Вход через GitHub не настроен');
  return NextResponse.redirect(url, 302);
}
