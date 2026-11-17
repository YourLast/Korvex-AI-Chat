import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { fail, json } from '@/lib/api';
import { reqLang } from '@/lib/i18n/server';
import { asLang } from '@/lib/i18n/core';
import { createUser, EmailTaken, sameOrigin, SignupClosed, startSession } from '@/lib/auth';
import { featureOn } from '@/lib/features';

export const runtime = 'nodejs';
const Body = z.object({
  email: z.string().email().max(200),
  name: z.string().max(100).default(''),
  password: z.string().min(8, 'Пароль — не короче 8 символов').max(500),
  lang: z.string().max(8).optional(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'bad origin');
  const db = getDb();
  const open = featureOn('signup');
  if (!open && db.select({ id: schema.users.id }).from(schema.users).limit(1).all().length > 0) return fail(403, CLOSED);
  if (process.env.KX_LAN === '1' && db.select({ id: schema.users.id }).from(schema.users).limit(1).all().length === 0) return fail(403, CLOSED);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  const email = p.data.email.trim().toLowerCase();
  if (db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) return fail(409, 'Такая почта уже есть');
  let u;
  try { u = await createUser(email, p.data.name, p.data.password, undefined, { onlyFirst: !open, lang: asLang(p.data.lang) ?? reqLang(req) }); }
  catch (e) {
    if (e instanceof SignupClosed) return fail(403, CLOSED);
    if (e instanceof EmailTaken) return fail(409, 'Такая почта уже есть');
    throw e;
  }
  await startSession(u.id);
  return json({ ok: true });
}
const CLOSED = 'Регистрация закрыта. Обратитесь к администратору.';
