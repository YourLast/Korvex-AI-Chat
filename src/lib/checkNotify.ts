import { eq } from 'drizzle-orm';
import { presenceOf, publish } from './bus';
import { getDb, schema } from './db';
import { pickDevice, sendPush, subsOf, type PushPayload } from './push';
import { inQuiet } from './quiet';
import { tr, type Lang } from './i18n/core';
import { userLang } from './userLang';

type Presence = ReturnType<typeof presenceOf>[number];
export type CheckNotice = 'none' | 'toast' | 'push';

export function checkNotice(chat: string[], ctx: { presence: Presence[]; muted: boolean; quiet: boolean }): CheckNotice {
  const visible = ctx.presence.filter((p) => p.visible);
  if (visible.some((p) => p.threads.some((t) => chat.includes(t)))) return 'none';
  if (ctx.muted) return 'none';
  if (visible.some((p) => p.active !== false)) return 'toast';
  if (ctx.quiet) return 'none';
  return 'push';
}

export function checkPayload(o: { threadId: string; groupId?: string | null; messageId?: string | null; title?: string | null; host: string }, lang: Lang): PushPayload {
  const url = (o.groupId ? `/g/${o.groupId}` : `/c/${o.threadId}`) + (o.messageId ? `#m-${o.messageId}` : '');
  return { title: tr(lang, 'shell.n.check'), body: tr(lang, 'shell.n.checkBody', { host: o.host, title: o.title || tr(lang, 'shell.newChat') }), url, tag: o.groupId ?? o.threadId };
}

export async function notifyCheck(o: { userId: string; threadId: string; messageId: string | null; host: string }, send = sendPush): Promise<CheckNotice> {
  const db = getDb();
  const t = db.select({ title: schema.threads.title, groupId: schema.threads.groupId, muted: schema.threads.muted }).from(schema.threads).where(eq(schema.threads.id, o.threadId)).get();
  if (!t) return 'none';
  const chat = t.groupId ? db.select({ id: schema.threads.id }).from(schema.threads).where(eq(schema.threads.groupId, t.groupId)).all().map((r) => r.id) : [o.threadId];
  const u = db.select({ tz: schema.users.timezone, quiet: schema.users.notifyQuiet }).from(schema.users).where(eq(schema.users.id, o.userId)).get();
  const n = checkNotice(chat, { presence: presenceOf(o.userId), muted: !!t.muted, quiet: inQuiet(u?.quiet, u?.tz ?? 'Europe/Moscow') });
  publish(o.userId, { t: 'check', th: o.threadId, gid: t.groupId, m: o.messageId, title: t.title, host: o.host, notice: n });
  if (n === 'push') {
    const to = pickDevice(subsOf(o.userId));
    if (to) await send(to, checkPayload({ ...o, groupId: t.groupId, title: t.title }, userLang(o.userId)));
  }
  return n;
}
