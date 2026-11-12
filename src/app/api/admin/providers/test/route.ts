import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { getDb, schema } from '@/lib/db';
import { PROVIDER_KINDS, providerKey, testProvider, type ProviderKind } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ id: z.string().optional(), kind: z.enum(PROVIDER_KINDS).optional(), baseUrl: z.string().max(500).optional(), key: z.string().max(4000).optional() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const saved = p.data.id ? getDb().select().from(schema.providers).where(eq(schema.providers.id, p.data.id)).get() : undefined;
  const kind = (p.data.kind ?? saved?.kind) as ProviderKind | undefined;
  if (!kind) return fail(400, 'kind');
  const key = p.data.key?.trim() || (saved ? providerKey(saved.id) : null);
  return json(await testProvider({ kind, baseUrl: p.data.baseUrl ?? saved?.baseUrl ?? '', key }));
}
