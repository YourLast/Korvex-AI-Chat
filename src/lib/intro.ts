import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import { cfg } from './cfg';
import { getModels } from './models';
import type { Thread } from './db/schema';
import { INTRO, lateIntroEnd, introMarked, introProgress, introRemembered, isSecret, listMemory, memoryAllowed, memoryMeta, ruleConflict, setMemoryMeta, threadAnswers, threadUserTexts } from './memory';
import { cancelThreadJobs, jobOfThread, submitTurn, type Submitted } from './jobs';
import { considerIntro } from './curator';
import { activePath, allMessages } from './tree';
import { userLang } from './userLang';
import { tr } from './i18n/core';
import { loadThread } from './load';
import { purgeTemp } from './tempChat';
import type { MsgView } from './types';

export const introModel = () => cfg('KX_INTRO_MODEL') || (getModels().find((m) => !m.hidden)?.id ?? '');
export const introLevel = () => process.env.KX_INTRO_LEVEL || 'xhigh';

export function introThread(userId: string): Thread | undefined {
  return getDb().select().from(schema.threads).where(and(eq(schema.threads.userId, userId), eq(schema.threads.temporary, INTRO))).orderBy(desc(schema.threads.createdAt)).limit(1).get();
}

function ensureThread(userId: string): Thread {
  const have = introThread(userId);
  if (have) return have;
  return newThread(userId);
}
function newThread(userId: string): Thread {
  const now = Date.now();
  const t = { id: randomUUID(), userId, title: 'Знакомство', modelId: introModel(), effort: introLevel(), temporary: INTRO, titleManual: 1, createdAt: now, updatedAt: now };
  getDb().insert(schema.threads).values(t).run();
  return getDb().select().from(schema.threads).where(eq(schema.threads.id, t.id)).get()!;
}

export type IntroView = { threadId: string | null; messages: MsgView[]; busy: boolean; off?: boolean; progress?: { left: number; tail: boolean }; done?: boolean;
   remembered?: { id: string; text: string }[] };

export function introView(userId: string): IntroView {
  if (!memoryAllowed(userId, null)) return { threadId: null, messages: [], busy: false, off: true };
  lateIntroEnd(userId);
  const t = introThread(userId);
  if (!t) return { threadId: null, messages: [], busy: false };
  const v = loadThread(userId, t.id, { turns: 200 });
  const rows = listMemory(userId).filter((r) => !ruleConflict(r.text) && !isSecret(r.text));
  const p = introProgress(rows, threadAnswers(t.id), threadUserTexts(t.id), true, introMarked(userId, t.id));
  const done = !!memoryMeta(userId).introEnd;
  return { threadId: t.id, messages: v?.messages ?? [], busy: !!jobOfThread(t.id), progress: { left: p.left, tail: p.tail }, done,
    ...(done ? { remembered: introRemembered(userId, t.id).map((r) => ({ id: r.id, text: r.text })) } : {}) };
}

export function introTurn(userId: string, t: Thread, o: { text: string; mode?: 'send' | 'regenerate'; hidden?: boolean; timezone?: string; fileIds?: string[] }): Submitted {
  const mode = o.mode ?? 'send';
  const s = submitTurn({ thread: t, userId, mode, text: mode === 'send' ? o.text : '', ...(mode === 'send' && o.fileIds?.length ? { fileIds: o.fileIds } : {}), modelId: introModel(), levelId: introLevel(), timezone: o.timezone, ...(o.hidden ? { userMeta: { hidden: true } } : {}) });
  if (mode === 'send' && !o.hidden && s.userMessageId) {
    considerIntro(userId, t.id, s.userMessageId, s.assistantMessageId);
    if (!memoryMeta(userId).introDone) setMemoryMeta(userId, { introDone: Date.now() });
  }
  return s;
}

function needsAnswer(t: Thread): boolean {
  const last = activePath(allMessages(t.id), t.leafId).at(-1);
  if (!last) return false;
  if (last.role === 'user') return true;
  if (last.role !== 'assistant') return false;
  const meta = (last.meta ?? {}) as { status?: string; stopped?: boolean };
  if (meta.stopped) return false;
  return meta.status === 'error' || (meta.status !== 'running' && meta.status !== 'queued' && !last.content.trim());
}

export function openIntro(userId: string, o: { timezone?: string; now?: number } = {}): IntroView & { started: boolean; waiting: boolean } {
  if (!memoryAllowed(userId, null)) return { ...introView(userId), started: false, waiting: false };
  const now = o.now ?? Date.now();
  const t = ensureThread(userId);
  setMemoryMeta(userId, { introAt: now });
  let started = false;
  if (!jobOfThread(t.id)) {
    const has = activePath(allMessages(t.id), t.leafId).length > 0;
    if (!has) { introTurn(userId, t, { text: tr(userLang(userId), 'srv.introStart'), hidden: true, timezone: o.timezone }); started = true; }
    else if (needsAnswer(t)) { introTurn(userId, getDb().select().from(schema.threads).where(eq(schema.threads.id, t.id)).get()!, { text: '', mode: 'regenerate', timezone: o.timezone }); started = true; }
  }
  const v = introView(userId);
  return { ...v, started, waiting: !started && !v.busy && v.messages.at(-1)?.role === 'assistant' };
}

export function sendIntro(userId: string, text: string, timezone?: string, fileIds?: string[]): Submitted {
  return introTurn(userId, ensureThread(userId), { text, timezone, fileIds });
}

export async function restartIntro(userId: string, o: { timezone?: string } = {}): Promise<IntroView & { started: boolean }> {
  if (!memoryAllowed(userId, null)) return { ...introView(userId), started: false };
  const old = introThread(userId);
  if (old) {
    cancelThreadJobs([old.id]);
    for (let i = 0; i < 100 && jobOfThread(old.id); i++) await new Promise((r) => setTimeout(r, 30));
  }
  const t = newThread(userId);
  setMemoryMeta(userId, { introEnd: undefined });
  if (old) {
    const db = getDb();
    db.update(schema.userMemory).set({ threadId: t.id, messageId: null }).where(and(eq(schema.userMemory.userId, userId), eq(schema.userMemory.threadId, old.id))).run();
    const r = purgeTemp(userId, old.id);
    if (!r.ok && r.why === 'busy') {
      for (let i = 0; i < 50; i++) { await new Promise((res) => setTimeout(res, 100)); if (purgeTemp(userId, old.id).ok) break; }
    }
  }
  introTurn(userId, t, { text: tr(userLang(userId), 'srv.introStart'), hidden: true, timezone: o.timezone });
  return { ...introView(userId), started: true };
}
