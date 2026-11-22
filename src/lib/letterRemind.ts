import { and, eq, isNull, lte } from 'drizzle-orm';
import { getDb, schema } from './db';
import { tr } from './i18n/core';
import { userLang } from './userLang';
import { pickDevice, sendPush, subsOf } from './push';
import { publish } from './bus';
import { inQuiet } from './quiet';
import { isDraining } from './instance';
import { unreadCount } from './notify';
import { letterTag } from './letterTag';

export const REMIND_MS = 3 * 24 * 3600_000;
const KIND = 'letter';

export { letterTag };
const keyOf = (messageId: string, tag: string) => `${messageId}:${tag}`;

type Owned = { threadId: string; content: string; temporary: number };
function owned(userId: string, messageId: string): Owned | null {
  const r = getDb().select({ threadId: schema.messages.threadId, content: schema.messages.content, role: schema.messages.role, userId: schema.threads.userId, temporary: schema.threads.temporary })
    .from(schema.messages).innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId)).where(eq(schema.messages.id, messageId)).get();
  if (!r || r.userId !== userId || r.role !== 'assistant' || r.temporary) return null;
  return { threadId: r.threadId, content: r.content ?? '', temporary: r.temporary };
}

export function remindersOf(userId: string, messageId: string): Record<string, number> {
  const rows = getDb().select({ key: schema.userNotices.key, at: schema.userNotices.at }).from(schema.userNotices)
    .where(and(eq(schema.userNotices.userId, userId), eq(schema.userNotices.kind, KIND), isNull(schema.userNotices.seenAt))).all();
  const out: Record<string, number> = {};
  for (const r of rows) if (r.key.startsWith(`${messageId}:`)) out[r.key.slice(messageId.length + 1)] = r.at;
  return out;
}

export function setReminder(userId: string, messageId: string, tag: string, on: boolean, now = Date.now()): number | null | false {
  if (!owned(userId, messageId)) return false;
  const db = getDb();
  const key = keyOf(messageId, tag);
  db.delete(schema.userNotices).where(and(eq(schema.userNotices.userId, userId), eq(schema.userNotices.kind, KIND), eq(schema.userNotices.key, key))).run();
  if (!on) return null;
  const at = now + REMIND_MS;
  db.insert(schema.userNotices).values({ id: crypto.randomUUID(), userId, kind: KIND, key, at, seenAt: null }).run();
  return at;
}

function letterIn(content: string, tag: string): { to: string; subject: string } | null {
  for (const m of content.matchAll(/```letter[^\n]*\n([\s\S]*?)```/g)) {
    try {
      const j = JSON.parse(m[1].trim()) as { to?: unknown; subject?: unknown };
      const to = typeof j.to === 'string' ? j.to.trim() : '', subject = typeof j.subject === 'string' ? j.subject.trim() : '';
      if (letterTag(to, subject) === tag) return { to, subject };
    } catch {  }
  }
  return null;
}

export async function remindTick(now = Date.now(), send = sendPush): Promise<string[]> {
  if (isDraining()) return [];
  const db = getDb();
  const due = db.select().from(schema.userNotices).where(and(eq(schema.userNotices.kind, KIND), isNull(schema.userNotices.seenAt), lte(schema.userNotices.at, now))).all();
  const done: string[] = [];
  for (const n of due) {
    const u = db.select({ tz: schema.users.timezone, quiet: schema.users.notifyQuiet, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.id, n.userId)).get();
    if (!u || u.disabled) continue;
    if (inQuiet(u.quiet, u.tz ?? 'Europe/Moscow', now)) continue;
    const claim = db.update(schema.userNotices).set({ seenAt: now }).where(and(eq(schema.userNotices.id, n.id), isNull(schema.userNotices.seenAt))).run();
    if (!claim.changes) continue;
    const [messageId, tag] = [n.key.slice(0, n.key.lastIndexOf(':')), n.key.slice(n.key.lastIndexOf(':') + 1)];
    const m = owned(n.userId, messageId);
    if (!m) continue;
    const l = letterIn(m.content, tag);
    const lang = userLang(n.userId);
    db.update(schema.threads).set({ answeredAt: now }).where(eq(schema.threads.id, m.threadId)).run();
    const badge = unreadCount(n.userId);
    publish(n.userId, { t: 'thread', th: m.threadId, badge });
    const to = pickDevice(subsOf(n.userId));
    if (to) {
      await send(to, {
        title: l?.to ? tr(lang, 'letter.remindTitle', { to: l.to }) : tr(lang, 'letter.title'),
        body: tr(lang, 'letter.remindBody'),
        url: `/c/${m.threadId}#m-${messageId}`,
        tag: `letter-${n.key}`,
      }).catch(() => 'error');
    }
    done.push(n.key);
  }
  return done;
}

const g = globalThis as unknown as { __kxRemind?: NodeJS.Timeout };
export function startReminders(ms = 10 * 60_000) {
  if (g.__kxRemind || process.env.KX_LETTER_REMIND === '0') return;
  g.__kxRemind = setInterval(() => { void remindTick().catch((e) => console.error('[remind]', (e as Error).message)); }, ms);
  g.__kxRemind.unref?.();
}
