import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { brand, logoUrl, setBrand } from '@/lib/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => { const b = brand(); return { name: b.name, short: b.short, footer: b.footer, accent: b.accent, logoUrl: logoUrl(b) }; };

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(view());
}

const Body = z.object({
  name: z.string().max(60).optional(),
  short: z.string().max(30).optional(),
  footer: z.string().max(200).nullable().optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'цвет — #rrggbb').nullable().optional(),
});

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  setBrand(p.data, a.user.id);
  return json({ ok: true, ...view() });
}
