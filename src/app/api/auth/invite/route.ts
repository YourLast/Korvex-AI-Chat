import { ext } from '@/ext';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { json } from '@/lib/api';
import { createUser, EmailTaken, sameOrigin, startSession } from '@/lib/auth';
import { asLang } from '@/lib/i18n/core';
import { reqLang } from '@/lib/i18n/server';
import { giveBackInvite, inviteState, recordInviteUse, takeInvite, type InviteState } from '@/lib/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Body = z.object({ token: z.string().min(10).max(100), email: z.string().email().max(200), name: z.string().max(100).default(''), password: z.string().min(8, 'Пароль — не короче 8 символов').max(500), lang: z.string().max(8).optional() });

const BAD: Record<Exclude<InviteState, 'ok'>, string> = {
  unknown: 'Приглашение недействительно или уже использовано', expired: 'Срок приглашения истёк', used_up: 'Лимит регистраций по этой ссылке исчерпан', revoked: 'Приглашение отозвано',
};
const bad = (s: Exclude<InviteState, 'ok'>) => json({ error: BAD[s], code: s }, 410);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'bad origin' }, 403);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message || 'Неверные данные', code: 'bad_input' }, 400);
  const db = getDb();
  const st = inviteState(p.data.token);
  if (st.state !== 'ok' || !st.invite) return bad(st.state === 'ok' ? 'unknown' : st.state);
  const inv = st.invite;
  const email = p.data.email.trim().toLowerCase();
  if (db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) return json({ error: 'Такая почта уже есть', code: 'email_taken' }, 409);
  if (!takeInvite(inv.id)) { const s = inviteState(p.data.token).state; return bad(s === 'ok' ? 'used_up' : s); }
  let u;
  try { u = await createUser(email, p.data.name, p.data.password, inv.role, { lang: asLang(p.data.lang) ?? reqLang(req) }); }
  catch (e) {
    giveBackInvite(inv.id);
    if (e instanceof EmailTaken) return json({ error: 'Такая почта уже есть', code: 'email_taken' }, 409);
    throw e;
  }
  recordInviteUse(inv.id, u);
  await startSession(u.id);
  ext.userArrived?.(u.id, 'login');
  return json({ ok: true });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (token.length < 10 || token.length > 100) return json({ state: 'unknown' });
  const s = inviteState(token);
  return json({ state: s.state, left: s.left ?? 0, max: s.invite?.maxUses ?? 0 });
}
