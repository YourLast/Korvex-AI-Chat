import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { ownFolder } from '@/lib/orgDocs';
import { orgCard, setOrgCard, libraryFile, TAXES, VATS } from '@/lib/orgCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = (userId: string, id: string) => {
  const c = orgCard(id);
  const pol = c.policyFileId ? libraryFile(userId, id, c.policyFileId) : null;
  return { card: { inn: c.inn ?? '', kpp: c.kpp ?? '', tax: c.tax ?? null, vat: c.vat ?? null, policyFileId: pol ? pol.id : null, policyName: pol?.name ?? null } };
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!ownFolder(a.user.id, id)) return fail(404, 'Нет такой организации');
  return json(view(a.user.id, id));
}

const Body = z.object({
  inn: z.string().max(20).optional(), kpp: z.string().max(20).optional(),
  tax: z.enum(TAXES).nullable().optional(), vat: z.enum(VATS).nullable().optional(), policyFileId: z.string().max(64).nullable().optional(),
});
const ERR: Record<string, string> = { inn: 'ИНН — 10 или 12 цифр', kpp: 'КПП — 9 знаков', tax: 'Неизвестная система налогообложения', vat: 'Неизвестная ставка НДС', policy: 'Файл не из библиотеки организации', folder: 'Нет такой организации' };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!ownFolder(a.user.id, id)) return fail(404, 'Нет такой организации');
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  const r = setOrgCard(a.user.id, id, p.data);
  if (typeof r === 'string') return fail(400, ERR[r] ?? 'Неверные данные');
  return json(view(a.user.id, id));
}
