import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { publish } from '@/lib/bus';
import { setVote } from '@/lib/compare';

export const runtime = 'nodejs';

export async function PUT(req: Request) {
  const u = await authed(req, true);
  if ('res' in u) return u.res;
  const p = z.object({ a: z.string().min(1), b: z.string().min(1), winner: z.enum(['a', 'b', 'tie', 'bad']).nullable() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const r = setVote(u.user.id, p.data.a, p.data.b, p.data.winner);
  if (r === 'not-found') return fail(404, 'message not found');
  publish(u.user.id, { t: 'vote', a: p.data.a, b: p.data.b, winner: r?.winner ?? null });
  return json({ winner: r?.winner ?? null });
}
