import { z } from 'zod';
import { agentsOnly, authed, fail, json } from '@/lib/api';
import { connect, disconnect, setCoAuthors, status } from '@/lib/github/account';
import { newTokenUrl, webBase } from '@/lib/github/api';
import { oauthConfig } from '@/lib/github/oauth';
import { sandboxAvailable } from '@/lib/code/sandbox';
import { netMode } from '@/lib/code/netproxy';
import { codeFail } from '@/lib/code/http';
import { publish } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  return json({ ...status(a.user.id), oauth: !!oauthConfig(), tokenUrl: newTokenUrl(), web: webBase(), sandbox: await sandboxAvailable(), net: netMode() });
}

export async function POST(req: Request) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ token: z.string().min(1).max(300) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try {
    const r = await connect(a.user.id, p.data.token, 'pat');
    publish(a.user.id, { t: 'github', connected: true });
    return json({ ...r.status, repos: r.repos.length, sample: r.repos.slice(0, 8).map((x) => ({ fullName: x.fullName, private: x.private, push: x.push })) });
  } catch (e) { return codeFail(e); }
}

export async function PATCH(req: Request) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ coAuthors: z.array(z.string().max(300)).max(10) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if (!status(a.user.id).connected) return fail(409, 'GitHub не подключён');
  try { return json({ coAuthors: setCoAuthors(a.user.id, p.data.coAuthors) }); } catch (e) { return codeFail(e); }
}

export async function DELETE(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  disconnect(a.user.id);
  publish(a.user.id, { t: 'github', connected: false });
  return json({ ok: true });
}
