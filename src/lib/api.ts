import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { currentUser, sameOrigin } from './auth';
import type { User } from './db/schema';
import { AGENTS_ONLY, canAgents } from './roles';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export function jsonz(req: Request, data: unknown, opts: { status?: number; etag?: boolean } = {}): Response {
  const buf = Buffer.from(JSON.stringify(data));
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Vary: 'Accept-Encoding' };
  if (opts.etag) {
    const tag = `W/"${createHash('sha1').update(buf).digest('base64url').slice(0, 27)}"`;
    headers.ETag = tag;
    headers['Cache-Control'] = 'private, no-cache';
    if ((req.headers.get('if-none-match') ?? '').split(',').some((t) => t.trim() === tag)) return new Response(null, { status: 304, headers });
  }
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
    headers['Content-Encoding'] = 'gzip';
    return new Response(new Uint8Array(gzipSync(buf, { level: 6 })), { status: opts.status ?? 200, headers });
  }
  return new Response(new Uint8Array(buf), { status: opts.status ?? 200, headers });
}

export async function authed(req: Request, mutating = false): Promise<{ user: User } | { res: NextResponse }> {
  if (mutating && !sameOrigin(req)) return { res: fail(403, 'bad origin') };
  const user = await currentUser();
  if (!user) return { res: fail(401, 'unauthorized') };
  return { user };
}

export async function agentsOnly(req: Request, mutating = false): Promise<{ user: User } | { res: NextResponse }> {
  const a = await authed(req, mutating);
  if ('res' in a) return a;
  if (!canAgents(a.user.role)) return { res: fail(403, AGENTS_ONLY) };
  return a;
}

export async function adminOnly(req: Request, mutating = false): Promise<{ user: User } | { res: NextResponse }> {
  const a = await authed(req, mutating);
  if ('res' in a) return a;
  if (a.user.role !== 'admin') return { res: fail(403, 'Только для администратора') };
  return a;
}

export async function lateJson(work: () => Promise<{ status: number; body: Record<string, unknown> }>, afterMs = 20_000, everyMs = 15_000): Promise<Response> {
  const job = work().catch((e): { status: number; body: Record<string, unknown> } => ({ status: 500, body: { error: (e as Error).message || 'Ошибка сервера' } }));
  const first = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), afterMs))]);
  if (first) return json(first.body, first.status);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const t = setInterval(() => { try { ctl.enqueue(enc.encode(' ')); } catch {  } }, everyMs);
      try {
        const r = await job;
        ctl.enqueue(enc.encode(JSON.stringify(r.status >= 400 ? { ...r.body, status: r.status } : r.body)));
      } finally { clearInterval(t); try { ctl.close(); } catch {  } }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
