import { and, eq, gt, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { AgentMsg } from './db/schema';
import { isDraining } from './instance';

const q = (s: string) => `«${s}»`;
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + '…');
const HOLD_MS = 24 * 3600_000;

export function letterText(kind: string, fromTitle: string, text: string): string {
  return kind === 'ask' ? `[Вопрос от агента чата «${fromTitle}»] ${text}\n\n(Ответь по делу: твой ответ вернётся агенту чата «${fromTitle}».)` : text;
}

type Submitted = { jobId: string; messageId: string };

export async function sendLetter(rowId: string, next: 'asking' | 'pending' | 'sent'): Promise<Submitted | 'busy' | string> {
  const db = getDb();
  const { submitTurn, jobOfThread, TurnError } = await import('./jobs');
  const row = db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.id, rowId)).get();
  if (!row) return 'нет письма';
  if (jobOfThread(row.toThread)) return 'busy';
  const to = db.select().from(schema.threads).where(and(eq(schema.threads.id, row.toThread), eq(schema.threads.userId, row.userId))).get();
  if (!to) { db.update(schema.agentMsgs).set({ status: 'error', answer: 'чат удалён' }).where(eq(schema.agentMsgs.id, rowId)).run(); return 'Чат удалён.'; }
  const from = db.select({ title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, row.fromThread)).get();
  const fromTitle = from?.title ?? 'чат';
  try {
    const s = submitTurn({ thread: to, userId: row.userId, mode: 'send', text: letterText(row.kind, fromTitle, row.question), modelId: to.modelId, levelId: to.effort, kind: 'chat',
      userMeta: { from: { threadId: row.fromThread, title: fromTitle, kind: row.kind === 'ask' ? 'agent' : 'send', depth: row.depth, jobId: row.fromJob } } });
    db.update(schema.agentMsgs).set({ status: next, toJob: s.jobId, userMessageId: s.userMessageId, answerMessageId: s.assistantMessageId }).where(eq(schema.agentMsgs.id, rowId)).run();
    return { jobId: s.jobId, messageId: s.assistantMessageId };
  } catch (e) {
    if (e instanceof TurnError) {
      if (e.status === 409) return 'busy';
      db.update(schema.agentMsgs).set({ status: 'error', answer: e.message }).where(eq(schema.agentMsgs.id, rowId)).run();
      return `Не удалось написать в чат ${q(to.title)}: ${e.message}`;
    }
    throw e;
  }
}

async function replyBack(row: AgentMsg, answer: string): Promise<boolean> {
  const db = getDb();
  const { submitTurn, jobOfThread, TurnError } = await import('./jobs');
  if (jobOfThread(row.fromThread)) return false;
  const from = db.select().from(schema.threads).where(and(eq(schema.threads.id, row.fromThread), eq(schema.threads.userId, row.userId))).get();
  const to = db.select({ title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, row.toThread)).get();
  if (!from) { db.update(schema.agentMsgs).set({ status: 'error' }).where(eq(schema.agentMsgs.id, row.id)).run(); return true; }
  const title = to?.title ?? 'чат';
  try {
    submitTurn({ thread: from, userId: row.userId, mode: 'send', modelId: from.modelId, levelId: from.effort, kind: 'chat',
      text: `[Ответ агента чата «${title}» на вопрос «${clip(row.question, 300)}»]\n${answer}`,
      userMeta: { from: { threadId: row.toThread, title, kind: 'reply', depth: row.depth, jobId: row.toJob } } });
    db.update(schema.agentMsgs).set({ status: 'delivered', answer: answer.slice(0, 50_000), answeredAt: Date.now() }).where(eq(schema.agentMsgs.id, row.id)).run();
    return true;
  } catch (e) {
    if (e instanceof TurnError && e.status === 409) return false;
    console.error('[mail] reply', (e as Error).message);
    return false;
  }
}

type Mail = { running: Promise<void> | null; again: boolean; started: boolean; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __kxMail?: Mail };
const st = () => (g.__kxMail ??= { running: null, again: false, started: false });

export function mailPump(): Promise<void> {
  const s = st();
  if (isDraining()) return Promise.resolve();
  if (s.running) { s.again = true; return s.running; }
  s.running = (async () => {
    try {
      do {
        s.again = false;
        await pumpOnce();
      } while (s.again);
    } catch (e) { console.error('[mail] pump', (e as Error).message); } finally { s.running = null; }
  })();
  return s.running;
}

async function pumpOnce() {
  const db = getDb();
  const rows = db.select().from(schema.agentMsgs).where(and(inArray(schema.agentMsgs.status, ['queued', 'pending']), gt(schema.agentMsgs.createdAt, Date.now() - HOLD_MS)))
    .orderBy(schema.agentMsgs.createdAt).limit(100).all();
  for (const row of rows) {
    if (row.status === 'queued') { await sendLetter(row.id, row.kind === 'ask' ? 'pending' : 'sent'); continue; }
    if (!row.toJob) continue;
    const job = db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, row.toJob)).get();
    if (!job || job.status === 'queued' || job.status === 'running') continue;
    const msg = row.answerMessageId ? db.select({ content: schema.messages.content }).from(schema.messages).where(eq(schema.messages.id, row.answerMessageId)).get() : undefined;
    const answer = (msg?.content ?? '').trim();
    if (job.status !== 'done' || !answer) {
      db.update(schema.agentMsgs).set({ status: 'error', answer: answer || null, answeredAt: Date.now() }).where(eq(schema.agentMsgs.id, row.id)).run();
      continue;
    }
    await replyBack(row, answer);
  }
}

export async function startMail() {
  const s = st();
  if (s.started) return;
  s.started = true;
  const { onJobFinished } = await import('./jobs');
  onJobFinished(() => { setImmediate(() => { void mailPump(); }); });
  s.timer = setInterval(() => { void mailPump(); }, Number(process.env.KX_MAIL_TICK_MS) || 30_000);
  s.timer.unref?.();
  void mailPump();
}
