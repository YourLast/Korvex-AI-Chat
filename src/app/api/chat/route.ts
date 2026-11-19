import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { authed, fail, json } from '@/lib/api';
import { submitLane, submitPair, submitTurn } from '@/lib/jobs';
import { TurnError } from '@/lib/turn';
import { isIntro } from '@/lib/memory';
import { introTurn } from '@/lib/intro';
import { reqLang } from '@/lib/i18n/server';
import { tr } from '@/lib/i18n/core';
import { addNotice, recordTurn } from '@/lib/seat';
import { weekState } from '@/lib/week';
import { withSupport } from '@/lib/support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  threadId: z.string().min(1),
  mode: z.enum(['send', 'regenerate', 'edit', 'continue']).default('send'),
  text: z.string().max(400_000).default(''),
  fileIds: z.array(z.string()).max(2000).default([]),
  editId: z.string().optional(),
  replaceFiles: z.boolean().optional(),
  modelId: z.string(),
  levelId: z.string(),
  timezone: z.string().max(64).optional(),
  compare: z.object({ a: z.object({ modelId: z.string(), levelId: z.string() }), b: z.object({ modelId: z.string(), levelId: z.string() }) }).optional(),
  lane: z.enum(['a', 'b']).optional(),
  messageId: z.string().optional(),
});

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const b = p.data;
  const thread = getDb().select().from(schema.threads).where(and(eq(schema.threads.id, b.threadId), eq(schema.threads.userId, a.user.id))).get();
  if (!thread) return fail(404, 'thread not found');
  try {
    if (isIntro(thread)) {
      if (b.mode !== 'send' && b.mode !== 'regenerate') return fail(400, 'bad mode');
      if (b.mode === 'send' && !b.text.trim() && !b.fileIds.length) return fail(400, 'empty message');
      return json(introTurn(a.user.id, thread, { text: b.text, mode: b.mode, timezone: b.timezone, fileIds: b.fileIds }), 202);
    }
    const wk = weekState(a.user);
    if (wk.phase === 'blocked') {
      return NextResponse.json({ error: withSupport(reqLang(req, a.user.lang), tr(reqLang(req, a.user.lang), 'week.hard')), code: 'week_limit', resetAt: wk.resetAt }, { status: 429 });
    }
    const over = wk.phase === 'over';
    const after = async (jobs: (string | null | undefined)[]) => {
      await recordTurn(a.user, req, jobs);
      try {
        const w2 = weekState(a.user);
        if (w2.limited && w2.phase === 'over') addNotice(a.user.id, 'week_soft', w2.key);
        else if (w2.limited && w2.phase === 'warn') addNotice(a.user.id, 'week80', w2.key);
      } catch (e) { console.error('[week]', (e as Error).message); }
    };
    if (b.lane && (b.mode === 'regenerate' || b.mode === 'continue')) {
      const s = submitLane({ thread, userId: a.user.id, lane: b.lane, mode: b.mode, modelId: b.modelId, levelId: b.levelId, messageId: b.messageId, timezone: b.timezone, over });
      await after([s.jobId]);
      return json(s, 202);
    }
    if (b.compare && (b.mode === 'send' || b.mode === 'edit')) {
      const s = submitPair({ thread, userId: a.user.id, mode: b.mode, text: b.text, fileIds: b.fileIds, editId: b.editId, replaceFiles: b.replaceFiles, pair: b.compare, timezone: b.timezone, over });
      await after(s.jobIds);
      return json({ ...s, jobId: s.jobIds[0] ?? null, pair: true }, 202);
    }
    const s = submitTurn({ thread, userId: a.user.id, mode: b.mode, text: b.text, fileIds: b.fileIds, editId: b.editId, replaceFiles: b.replaceFiles, modelId: b.modelId, levelId: b.levelId, timezone: b.timezone, over });
    await after([s.jobId]);
    return json(s, 202);
  } catch (e) {
    if (e instanceof TurnError) return e.code ? NextResponse.json({ error: e.message, code: e.code, alt: e.alt ?? null }, { status: e.status }) : fail(e.status, e.message);
    throw e;
  }
}
