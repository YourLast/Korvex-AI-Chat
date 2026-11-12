import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { adminOnly, fail, json } from '@/lib/api';
import { createUser, EmailTaken } from '@/lib/auth';
import { ROLES } from '@/lib/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = (u: typeof schema.users.$inferSelect) => ({ id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt });

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  return json({ users: getDb().select().from(schema.users).all().map(view) });
}

const Body = z.object({ email: z.string().email().max(200), name: z.string().max(100).default(''), password: z.string().min(8, 'Пароль — не короче 8 символов').max(500), role: z.enum(ROLES).default('user') });

export async function POST(req: Request) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  const email = p.data.email.trim().toLowerCase();
  if (getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) return fail(409, 'Такая почта уже есть');
  let u;
  try { u = await createUser(email, p.data.name, p.data.password, p.data.role, { source: 'admin' }); }
  catch (e) { if (e instanceof EmailTaken) return fail(409, 'Такая почта уже есть'); throw e; }
  return json({ user: view(u) });
}
