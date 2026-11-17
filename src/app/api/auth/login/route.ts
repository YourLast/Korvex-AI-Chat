import { ext } from '@/ext';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { fail, json } from '@/lib/api';
import { reqLang } from '@/lib/i18n/server';
import { seatAutoUnblock, seatPauseText } from '@/lib/seat';
import { resolveUserTz } from '@/lib/usertz';
import { deviceUser, loginBlocked, loginDelayMs, loginFailed, loginKeys, loginOk, sameOrigin, setDeviceCookie, startSession, verifyPassword } from '@/lib/auth';

export const runtime = 'nodejs';
const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(500), timezone: z.string().max(64).optional() });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'bad origin');
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const email = p.data.email.trim().toLowerCase();
  const key = loginKeys(req, email);
  const u = getDb().select().from(schema.users).where(eq(schema.users.email, email)).get();
  const own = !!u && (await deviceUser()) === u.id;
  if (!own) {
    if (loginBlocked(key)) return fail(429, 'Слишком много попыток с этого устройства. Подождите 15 минут.');
    const d = loginDelayMs(key);
    if (d) await new Promise((r) => setTimeout(r, d));
  }
  const ok = await verifyPassword(u?.passwordHash ?? null, p.data.password);
  let me = u;
  if (u && ok && u.disabled && seatAutoUnblock(u.id)) me = getDb().select().from(schema.users).where(eq(schema.users.id, u.id)).get() ?? u;
  const seat = me && ok && me.disabled ? seatPauseText(me, reqLang(req, me.lang)) : null;
  if (seat) return fail(403, seat);
  if (!me || !ok || me.disabled) {
    loginFailed(key);
    return fail(401, 'Неверная почта или пароль');
  }
  loginOk(key);
  await startSession(me.id);
  await setDeviceCookie(me.id);
  if (p.data.timezone) resolveUserTz(me.id, p.data.timezone);
  ext.userArrived?.(me.id, 'login');
  return json({ ok: true });
}
