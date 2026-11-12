import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { getDb, schema } from '@/lib/db';
import { deleteAdminModel, saveAdminModel } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Level = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,20}$/), label: z.string().max(40), effort: z.string().max(20).nullable(), hint: z.string().max(120).optional() });
const Body = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/, 'id — латиница, цифры, «.», «_», «-»'),
  providerId: z.string().min(1),
  upstreamModel: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(60),
  fullName: z.string().max(120).optional(),
  blurb: z.string().max(120).optional(),
  levels: z.array(Level).max(10).optional(),
  defaultLevel: z.string().max(20).optional(),
  images: z.boolean().optional(),
  tools: z.boolean().optional(),
  contextTokens: z.number().int().min(1024).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(64).max(1_000_000).optional(),
  maxConcurrent: z.number().int().min(1).max(256).optional(),
  hidden: z.boolean().optional(),
  sort: z.number().int().optional(),
});

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  if (!getDb().select({ id: schema.providers.id }).from(schema.providers).where(eq(schema.providers.id, p.data.providerId)).get()) return fail(400, 'Нет такого провайдера');
  saveAdminModel(p.data);
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail(400, 'id');
  deleteAdminModel(id);
  return json({ ok: true });
}
