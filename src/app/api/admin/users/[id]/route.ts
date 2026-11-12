import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { adminOnly, fail, json } from '@/lib/api';
import { hashPassword } from '@/lib/auth';
import { blockUser, cutOff, logAudit, unblockUser, type Cut } from '@/lib/moderation';
import { ROLES, roleKey } from '@/lib/roles';
import { tr } from '@/lib/i18n/core';

export const runtime = 'nodejs';

const Body = z.object({ role: z.enum(ROLES).optional(), confirmSelf: z.boolean().optional(), disabled: z.boolean().optional(), password: z.string().min(8).max(500).optional(), reason: z.string().max(500).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const db = getDb();
  const u = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!u) return fail(404, 'not found');
  if (u.role === 'admin' && p.data.role && p.data.role !== 'admin') {
    const others = db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, 0))).all().filter((x) => x.id !== u.id);
    if (!others.length) return fail(409, 'Должен остаться хотя бы один администратор');
    if (u.id === a.user.id && p.data.confirmSelf !== true) return fail(409, 'Свою роль можно понизить только с подтверждением');
  }
  let cut: Cut | null = null;
  if (p.data.disabled === true) {
    const r = blockUser(a.user.id, id, { kind: 'pause', reason: p.data.reason });
    if (!r.ok) return fail(r.status, r.error);
    cut = r.cut;
  } else if (p.data.disabled === false) {
    const r = unblockUser(a.user.id, id);
    if (!r.ok) return fail(r.status, r.error);
  }
  const target = { id: u.id, name: u.name, email: u.email };
  if (p.data.role && p.data.role !== u.role) {
    db.update(schema.users).set({ role: p.data.role }).where(eq(schema.users.id, id)).run();
    logAudit({ adminId: a.user.id, action: 'role', target, detail: `${tr('ru', roleKey(u.role))} → ${tr('ru', roleKey(p.data.role))}` });
  }
  if (p.data.password) {
    db.update(schema.users).set({ passwordHash: await hashPassword(p.data.password) }).where(eq(schema.users.id, id)).run();
    cut = cutOff(id);
    logAudit({ adminId: a.user.id, action: 'password', target });
  }
  return json({ ok: true, revoked: { sessions: cut?.sessions ?? 0, apiKeys: cut?.apiKeys ?? 0, pushSubs: cut?.pushSubs ?? 0 } });
}
