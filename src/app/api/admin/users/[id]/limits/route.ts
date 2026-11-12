import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { adminOnly, fail, json } from '@/lib/api';
import { logAudit } from '@/lib/moderation';
import { clearSeat, seatStats } from '@/lib/seat';
import { weekState } from '@/lib/week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = (id: string) => {
  const u = getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!u) return null;
  const w = weekState(u);
  return { seat: seatStats(u), week: { mode: w.mode, limited: w.limited, used: w.used, limit: w.limit, hard: w.hard, pct: w.pct, phase: w.phase, resetAt: w.resetAt, mult: u.weekMult, resetMark: u.weekResetAt ?? null } };
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const v = view((await params).id);
  return v ? json(v) : fail(404, 'not found');
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seat_clear') }),
  z.object({ action: z.literal('week_mult'), mult: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(5)]) }),
  z.object({ action: z.literal('week_reset') }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const db = getDb();
  const u = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!u) return fail(404, 'not found');
  const target = { id: u.id, name: u.name, email: u.email };
  const now = Date.now();
  if (p.data.action === 'seat_clear') clearSeat(a.user.id, id, now);
  else if (p.data.action === 'week_mult') {
    db.update(schema.users).set({ weekMult: p.data.mult }).where(eq(schema.users.id, id)).run();
    logAudit({ adminId: a.user.id, action: 'week_limit', target, detail: `недельный лимит: ${p.data.mult === 0 ? 'без лимита' : p.data.mult === 1 ? 'обычный' : `×${p.data.mult}`} (было ${u.weekMult === 0 ? 'без лимита' : u.weekMult === 1 ? 'обычный' : `×${u.weekMult}`})` }, now);
  } else {
    db.update(schema.users).set({ weekResetAt: now }).where(eq(schema.users.id, id)).run();
    logAudit({ adminId: a.user.id, action: 'week_limit', target, detail: 'сброшена эта неделя (ходы до этого момента не считаются)' }, now);
  }
  return json({ ok: true, ...view(id) });
}
