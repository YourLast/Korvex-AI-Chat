import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { introView, openIntro, restartIntro, sendIntro } from '@/lib/intro';
import { TurnError } from '@/lib/turn';
import { ext } from '@/ext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json(introView(a.user.id));
}

const Body = z.union([
  z.object({ action: z.enum(['open', 'restart']), timezone: z.string().max(64).optional() }),
  z.object({ text: z.string().trim().max(4000), fileIds: z.array(z.string()).max(5).default([]), timezone: z.string().max(64).optional() }).refine((x) => x.text.length > 0 || x.fileIds.length > 0),
]);

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  try {
    if ('action' in p.data) {
      if (p.data.action === 'restart') return json(await restartIntro(a.user.id, { timezone: p.data.timezone }));
      const v = openIntro(a.user.id, { timezone: p.data.timezone });
      if (v.waiting) ext.introOpened?.(a.user.id, p.data.timezone);
      return json(v);
    }
    const s = sendIntro(a.user.id, p.data.text, p.data.timezone, p.data.fileIds);
    return json({ ...introView(a.user.id), jobId: s.jobId, userMessageId: s.userMessageId, assistantMessageId: s.assistantMessageId }, 202);
  } catch (e) {
    if (e instanceof TurnError) return e.code ? NextResponse.json({ error: e.message, code: e.code, alt: e.alt ?? null }, { status: e.status }) : fail(e.status, e.message);
    throw e;
  }
}
