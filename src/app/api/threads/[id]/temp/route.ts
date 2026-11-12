import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { closeTemp, reopenTemp } from '@/lib/tempChat';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = z.object({ op: z.enum(['close', 'open']) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const r = p.data.op === 'close' ? closeTemp(a.user.id, id) : reopenTemp(a.user.id, id);
  if (r === 'none') return fail(404, 'thread not found');
  if (r === 'normal') return fail(409, 'not a temporary chat');
  return json({ ok: true });
}
