import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { getDb, schema } from '@/lib/db';
import { getModels } from '@/lib/models';
import { PRESETS, PROVIDER_KINDS, deleteProvider, listProviders, saveProvider } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view() {
  const admin = getDb().select().from(schema.adminModels).all();
  const adminIds = new Set(admin.map((m) => m.id));
  return {
    providers: listProviders(), presets: PRESETS, models: admin,
    configModels: getModels().filter((m) => !adminIds.has(m.id) && !m.providerId).map((m) => ({ id: m.id, name: m.name, hidden: !!m.hidden })),
  };
}

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(view());
}

const Body = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(PROVIDER_KINDS),
  baseUrl: z.string().trim().max(500).refine((u) => !u || /^https?:\/\/[^\s]+$/.test(u), 'адрес — http(s)://…').optional(),
  key: z.string().max(4000).nullable().optional(),
});

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  const id = saveProvider(p.data);
  return json({ ok: true, id, ...view() });
}

export async function DELETE(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail(400, 'id');
  deleteProvider(id);
  return json({ ok: true, ...view() });
}
