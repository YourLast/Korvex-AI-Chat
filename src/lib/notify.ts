import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getModel, pairNames, variantLabel as noticeName } from './models';
import { presenceOf } from './bus';
import { onJobFinished, setNoticePolicy, type FinishedJob, type Notice } from './jobs';
import { pickDevice, sendPush, subsOf, type PushPayload } from './push';
import { getDb, schema } from './db';
import { tr, type Lang } from './i18n/core';
import { userLang } from './userLang';
import { publish } from './bus';
import { inQuiet } from './quiet';

type Presence = ReturnType<typeof presenceOf>[number];

export const FAST_MS = Number(process.env.KX_NOTIFY_FAST_MS) || 20_000;

export { inQuiet } from './quiet';

export function decide(j: Pick<FinishedJob, 'threadId' | 'kind' | 'status' | 'createdAt'>, ctx: { presence: Presence[]; chat: string[]; muted: boolean; quiet: boolean; now?: number }): Notice {
  if (j.kind === 'api' || j.status === 'cancelled' || !j.threadId) return 'none';
  const chat = new Set(ctx.chat.length ? ctx.chat : [j.threadId]);
  const visible = ctx.presence.filter((p) => p.visible);
  if (visible.some((p) => p.threads.some((t) => chat.has(t)))) return 'none';
  if (ctx.muted) return 'quiet';
  if (visible.some((p) => p.active !== false)) return j.status === 'done' && (ctx.now ?? Date.now()) - j.createdAt < FAST_MS ? 'quiet' : 'toast';
  if (ctx.quiet) return 'quiet';
  return 'push';
}

export { pickDevice };

export { noticeName };
export function pairPayload(j: Pick<FinishedJob, 'title' | 'threadId' | 'groupId' | 'pair'>, badge?: number, lang: Lang = 'ru'): PushPayload & { badge?: number } {
  const parts = j.pair!.both;
  const title = j.title || tr(lang, 'shell.newChat');
  const and = tr(lang, 'shell.n.and');
  const inChat = tr(lang, 'shell.n.inChat', { title });
  const ok = parts.filter((x) => x.status === 'done');
  const names = pairNames(parts);
  const first = ok.find((x) => x.lane === 'a') ?? ok[0];
  const url = (j.groupId ? `/g/${j.groupId}` : `/c/${j.threadId}`) + (first?.messageId ? `#m-${first.messageId}` : '');
  const tag = j.groupId ?? j.threadId ?? undefined;
  const b = badge ? { badge } : {};
  if (!ok.length) return { title: tr(lang, 'shell.n.fail') + inChat, body: tr(lang, 'shell.n.reopen', { model: names.join(and) }), url, tag, ...b };
  if (ok.length < parts.length) {
    const bad = parts.find((x) => x.status !== 'done')!;
    return { title: tr(lang, 'shell.n.one') + inChat, body: `${names[parts.indexOf(first)]}: ${first.preview || tr(lang, 'shell.n.readyLc')} · ${names[parts.indexOf(bad)]} ${tr(lang, 'shell.n.notYet')}`, url, tag, ...b };
  }
  return { title: tr(lang, 'shell.n.both') + inChat, body: `${names.join(and)}${first.preview ? ` · ${first.preview}` : ''}`, url, tag, ...b };
}

export function payloadOf(j: Pick<FinishedJob, 'modelId' | 'title' | 'preview' | 'status' | 'threadId' | 'groupId' | 'messageId'> & { autoName?: string | null; pair?: FinishedJob['pair'] }, badge?: number, lang: Lang = 'ru'): PushPayload & { badge?: number } {
  if (j.pair && !j.pair.waiting && j.pair.both.length > 1 && j.pair.both.some((x) => x.status !== 'cancelled')) return pairPayload(j, badge, lang);
  const model = getModel(j.modelId)?.name ?? j.modelId;
  const title = j.title || tr(lang, 'shell.newChat');
  const url = (j.groupId ? `/g/${j.groupId}` : `/c/${j.threadId}`) + (j.messageId && j.status === 'done' ? `#m-${j.messageId}` : '');
  const tag = j.groupId ?? j.threadId ?? undefined;
  const b = badge ? { badge } : {};
  if (j.status === 'error') return { title: j.autoName ? tr(lang, 'shell.n.autoFail', { name: j.autoName }) : tr(lang, 'shell.n.fail') + tr(lang, 'shell.n.inChat', { title }), body: tr(lang, 'shell.n.reopen', { model }), url, tag, ...b };
  if (j.autoName) return { title: tr(lang, 'shell.n.auto', { name: j.autoName }) + tr(lang, 'shell.n.autoDone'), body: `${model}: ${j.preview || tr(lang, 'shell.n.autoResult')}`, url, tag, ...b };
  return { title: tr(lang, 'shell.n.answered', { model }) + tr(lang, 'shell.n.inChat', { title }), body: j.preview || tr(lang, 'shell.n.ready'), url, tag, ...b };
}

function chatOf(j: FinishedJob): string[] {
  if (!j.groupId) return j.threadId ? [j.threadId] : [];
  return getDb().select({ id: schema.threads.id }).from(schema.threads).where(eq(schema.threads.groupId, j.groupId)).all().map((r) => r.id);
}

export function unreadCount(userId: string): number {
  const r = getDb().get<{ c: number }>(sql`select count(distinct coalesce(group_id, id)) c from threads where user_id = ${userId} and temporary = 0 and answered_at is not null and answered_at > coalesce(read_at, 0)`);
  return Number(r?.c ?? 0);
}

export function markRead(userId: string, threadIds: string[], groupId: string | null) {
  if (!threadIds.length) return;
  const db = getDb();
  const now = Date.now();
  for (const id of threadIds) db.update(schema.threads).set({ readAt: now }).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId))).run();
  publish(userId, { t: 'read', th: threadIds[0], gid: groupId, ids: threadIds, badge: unreadCount(userId) });
}

export function policy(j: FinishedJob): Notice {
  if (!j.threadId) return 'none';
  const db = getDb();
  const chat = chatOf(j);
  const t = db.select({ muted: schema.threads.muted, temporary: schema.threads.temporary }).from(schema.threads).where(eq(schema.threads.id, j.threadId)).get();
  if (t?.temporary) return 'none';
  const u = db.select({ tz: schema.users.timezone, quiet: schema.users.notifyQuiet }).from(schema.users).where(eq(schema.users.id, j.userId)).get();
  const n = decide(j, { presence: presenceOf(j.userId), chat, muted: !!t?.muted, quiet: inQuiet(u?.quiet, u?.tz ?? 'Europe/Moscow') });
  if (n === 'none' && j.kind !== 'api' && j.status !== 'cancelled') markRead(j.userId, chat, j.groupId);
  return n;
}

export async function notifyFinished(j: FinishedJob, send = sendPush) {
  if (j.notice !== 'push') return [];
  const subs = subsOf(j.userId);
  const to = pickDevice(subs);
  if (!to) return [];
  return [await send(to, payloadOf(j, unreadCount(j.userId), userLang(j.userId)))];
}

const g = globalThis as unknown as { __kxNotify?: () => void };
export function registerNotify() {
  if (g.__kxNotify) return;
  setNoticePolicy(policy);
  g.__kxNotify = onJobFinished((j) => { void notifyFinished(j).catch((e) => console.error('[notify]', (e as Error).message)); });
}

export { isNotNull };
