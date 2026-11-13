import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { SEARCH_KINDS, saveSearch, searchView } from '@/lib/webSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(searchView());
}

const Body = z.object({ kind: z.enum(SEARCH_KINDS), url: z.string().max(500).optional(), key: z.string().max(500).nullable().optional() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, `kind — ${SEARCH_KINDS.join(' | ')}`);
  if (p.data.kind === 'searxng' && p.data.url && !/^https?:\/\/[^\s]+$/.test(p.data.url.trim())) return fail(400, 'Адрес SearXNG — http(s)://…');
  saveSearch(p.data, a.user.id);
  return json({ ok: true, ...searchView() });
}
