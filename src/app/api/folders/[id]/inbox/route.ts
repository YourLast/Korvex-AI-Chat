import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { ownFolder } from '@/lib/orgDocs';
import { inboxView, issueKey, reissueTag, revokeKey, setSenders } from '@/lib/orgIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!ownFolder(a.user.id, id)) return fail(404, 'Нет такой организации');
  return json(inboxView(a.user.id, id));
}

const Body = z.object({ senders: z.array(z.string().max(200)).max(100).optional(), reissueTag: z.boolean().optional(), issueKey: z.boolean().optional(), revokeKey: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!ownFolder(a.user.id, id)) return fail(404, 'Нет такой организации');
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.senders) setSenders(a.user.id, id, p.data.senders);
  if (p.data.reissueTag) reissueTag(a.user.id, id);
  if (p.data.revokeKey) revokeKey(a.user.id, id);
  const key = p.data.issueKey ? issueKey(a.user.id, id) : undefined;
  return json({ ...inboxView(a.user.id, id), ...(key ? { key } : {}) });
}
