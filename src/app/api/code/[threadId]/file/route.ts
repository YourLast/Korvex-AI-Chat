import { z } from 'zod';
import { agentsOnly, fail, json } from '@/lib/api';
import { applyEdit, ownSession, ready } from '@/lib/code/session';
import { readText } from '@/lib/code/fsx';
import { git } from '@/lib/code/git';
import { codeFail } from '@/lib/code/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ threadId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  if (!ownSession(a.user.id, threadId)) return fail(404, 'not found');
  const rel = new URL(req.url).searchParams.get('path') ?? '';
  try {
    const s = ready(a.user.id, threadId);
    const content = readText(s.wt, rel);
    const base = await git(s.dirs, ['show', `${s.baseSha}:${rel.replace(/^\/+/, '')}`], { maxOut: 4 * 1024 * 1024 });
    return json({ path: rel, content, base: base.code === 0 ? base.out : null });
  } catch (e) { return codeFail(e); }
}

export async function PUT(req: Request, { params }: Ctx) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const { threadId } = await params;
  if (!ownSession(a.user.id, threadId)) return fail(404, 'not found');
  const p = z.object({ path: z.string().min(1).max(1000), content: z.string().max(2 * 1024 * 1024), expect: z.string().max(2 * 1024 * 1024).nullable().optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try {
    const r = await applyEdit({ userId: a.user.id, threadId, path: p.data.path, after: p.data.content, source: 'user', expectBefore: p.data.expect });
    return json(r ? { edit: { id: r.edit.id, path: r.edit.path, added: r.edit.added, removed: r.edit.removed }, diff: r.diff } : { unchanged: true });
  } catch (e) { return codeFail(e); }
}
