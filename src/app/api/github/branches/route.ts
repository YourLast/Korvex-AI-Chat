import { agentsOnly, fail, json } from '@/lib/api';
import { tokenOf } from '@/lib/github/account';
import { listBranches, validRepo } from '@/lib/github/api';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const repo = new URL(req.url).searchParams.get('repo') ?? '';
  if (!validRepo(repo)) return fail(400, 'bad repo');
  const token = await tokenOf(a.user.id).catch(() => null);
  if (!token) return fail(409, 'GitHub не подключён');
  try { return json({ branches: (await listBranches(token, repo)).map((b) => ({ name: b.name, protected: b.protected })) }); } catch (e) { return codeFail(e); }
}
