import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { SEARCH_KINDS, runSearch, searchConf } from '@/lib/webSearch';
import { getSetting } from '@/lib/settings';
import { open } from '@/lib/github/secret';
import { cfg } from '@/lib/cfg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ kind: z.enum(SEARCH_KINDS), url: z.string().max(500).optional(), key: z.string().max(500).optional() });
const ENV: Record<string, string> = { brave: 'KX_BRAVE_API_KEY', tavily: 'KX_TAVILY_API_KEY' };

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const { kind } = p.data;
  let key = p.data.key?.trim() || null;
  if (!key && kind !== 'searxng') {
    const enc = getSetting<string | null>(`webSearch.key.${kind}`, null);
    try { key = enc ? open(enc, `websearch:${kind}`) : null; } catch { key = null; }
    key ||= cfg(ENV[kind]).trim() || null;
  }
  const url = (p.data.url ?? '').trim() || (kind === 'searxng' ? searchConf()?.url ?? '' : '');
  if (kind === 'searxng' ? !url : !key) return json({ ok: false, error: kind === 'searxng' ? 'нет адреса' : 'нет ключа' });
  try {
    const hits = await runSearch({ kind, url, key }, 'open source chat');
    return json({ ok: true, results: hits.length });
  } catch (e) { return json({ ok: false, error: (e as Error).message }); }
}
