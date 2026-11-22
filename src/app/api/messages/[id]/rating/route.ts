import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { setRating } from '@/lib/ratings';
import { onRating } from '@/lib/ratingSignals';

export const runtime = 'nodejs';

const Body = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  reasons: z.array(z.string().max(32)).max(12).optional(),
  comment: z.string().max(4000).optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const r = setRating(a.user.id, id, p.data);
  if (r === 'not-found') return fail(404, 'message not found');
  try { onRating(a.user.id, id, r); } catch (e) { console.error('[rating] memory', (e as Error).message); }
  return json({ rating: r });
}
