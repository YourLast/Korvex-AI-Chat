import { agentsOnly, fail, json } from '@/lib/api';
import { tokenOf } from '@/lib/github/account';
import { listRepos, type GhRepo } from '@/lib/github/api';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const g = globalThis as unknown as { __kxRepos?: Map<string, { at: number; list: GhRepo[] }> };
const cache = () => (g.__kxRepos ??= new Map());

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const token = await tokenOf(a.user.id).catch(() => null);
  if (!token) return fail(409, 'GitHub не подключён');
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') ?? '').toLowerCase().trim();
  try {
    let c: { at: number; list: GhRepo[] } | undefined = cache().get(a.user.id);
    if (!c || Date.now() - c.at > 60_000 || u.searchParams.get('fresh')) { c = { at: Date.now(), list: await listRepos(token, 300) }; cache().set(a.user.id, c); }
    const list = (q ? c.list.filter((r: GhRepo) => r.fullName.toLowerCase().includes(q)) : c.list).slice(0, 100);
    return json({ repos: list, total: c.list.length });
  } catch (e) { return codeFail(e); }
}
