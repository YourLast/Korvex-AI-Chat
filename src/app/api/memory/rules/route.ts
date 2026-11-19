import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { rulesAction, rulesView } from '@/lib/memoryRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json(rulesView(a.user.id));
}

const Body = z.object({ action: z.enum(['now', 'later', 'seen']) });

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  return json(rulesAction(a.user.id, p.data.action));
}
