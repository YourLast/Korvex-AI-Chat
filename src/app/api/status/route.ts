import { authed, json } from '@/lib/api';
import { statusFor, startProbe } from '@/lib/status';
import { startBusyWatch } from '@/lib/busy';
import { cleanTz, DEFAULT_TZ } from '@/lib/tz';
import { reqLang } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  startProbe();
  startBusyWatch();
  const tz = cleanTz(new URL(req.url).searchParams.get('tz')) ?? cleanTz(a.user.lastTz) ?? cleanTz(a.user.timezone) ?? DEFAULT_TZ;
  return json(statusFor(tz, Date.now(), reqLang(req, a.user.lang)));
}
