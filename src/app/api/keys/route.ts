import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { createKey, listKeys } from '@/lib/apikeys';
import { apiOn, API_OFF_MESSAGE } from '@/lib/apiGate';

const off = () => fail(503, API_OFF_MESSAGE);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!apiOn()) return off();
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json({ keys: listKeys(a.user) });
}

const Body = z.object({
  name: z.string().max(80).default(''),
  models: z.array(z.string().max(40)).min(1).max(10),
  levels: z.record(z.string(), z.string().max(20)).optional(),
  rpm: z.number().int().min(1).max(600).default(20),
  expiresDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export async function POST(req: Request) {
  if (!apiOn()) return off();
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'bad body');
  const r = createKey(a.user, p.data);
  if ('error' in r) return fail(400, r.error);
  return json(r, 201);
}
