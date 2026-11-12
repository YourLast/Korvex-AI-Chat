import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { activePath, messageSkeleton } from './tree';
import { loadThread } from './load';
import { estTokens } from './tokest';
import { isToken, outRoot } from './outfiles';
import { sourceMap } from './moderation';
import { SRC_NONE, type BlockKind } from './moderationTypes';
import { INTRO, listMemory, MAYBE_TTL_MS, memoryBlockInfo, memoryMeta, memoryPrefs, profileName, ruleConflict } from './memory';
import { nameOf } from './memoryView';
import type { Message, User } from './db/schema';
import type { AdminChatData, AdminMemory, ChatRow, Mark, OutItem, PersonRow, RatingItem, RatingsPage, UploadItem, ViewKind, ViewLogItem } from './adminTypes';
import { OUT_PREFIX } from '@/ext/client';

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const parseList = (s: string | null): string[] => { try { const v = s ? (JSON.parse(s) as unknown) : []; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
const flat = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const plain = (s: string | null | undefined, max: number) =>
  flat((s ?? '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/```[a-z]*/gi, ' ').replace(/^\s*[-+*]\s+/gm, '').replace(/[#*`>|~_]+/g, ' '), max);


export const VIEW_DEDUPE_MS = 5 * 60_000;

export function logView(p: { adminId: string; ownerId: string; kind: ViewKind; target?: string | null; threadId?: string | null }, now = Date.now()): boolean {
  if (p.adminId === p.ownerId) return false;
  const db = getDb();
  const target = p.target ?? null;
  const last = db.get<{ at: number }>(sql`select created_at at from admin_views where admin_id = ${p.adminId} and owner_id = ${p.ownerId} and kind = ${p.kind}
    and coalesce(target, '') = ${target ?? ''} order by created_at desc limit 1`);
  if (last && now - n(last.at) < VIEW_DEDUPE_MS) return false;
  db.insert(schema.adminViews).values({ id: randomUUID(), adminId: p.adminId, ownerId: p.ownerId, kind: p.kind, target, threadId: p.threadId ?? null, createdAt: now }).run();
  return true;
}

export function viewLog(limit = 50, ownerId?: string): ViewLogItem[] {
  type R = { id: string; aid: string; aname: string | null; oid: string; oname: string | null; kind: string; target: string | null; tid: string | null; ttitle: string | null; at: number };
  const where = ownerId ? sql`where v.owner_id = ${ownerId}` : sql``;
  return getDb().all<R>(sql`select v.id id, v.admin_id aid, a.name aname, v.owner_id oid, o.name oname, v.kind kind, v.target target, v.thread_id tid, t.title ttitle, v.created_at at
    from admin_views v left join users a on a.id = v.admin_id left join users o on o.id = v.owner_id left join threads t on t.id = v.thread_id
    ${where} order by v.created_at desc, v.id desc limit ${Math.min(500, Math.max(1, limit))}`)
    .map((r) => ({ id: r.id, adminId: r.aid, adminName: r.aname ?? 'удалён', ownerId: r.oid, ownerName: r.oname ?? 'удалён', kind: r.kind, target: r.target, threadId: r.tid, threadTitle: r.ttitle, at: n(r.at) }));
}


export function people(): PersonRow[] {
  const db = getDb();
  const users = db.select().from(schema.users).all();
  const by = <T extends { uid: string }>(rows: T[]) => new Map(rows.map((r) => [r.uid, r]));
  const chats = by(db.all<{ uid: string; c: number; last: number | null }>(sql`select user_id uid, count(*) c, max(updated_at) last from threads group by user_id`));
  const msgs = by(db.all<{ uid: string; c: number }>(sql`select t.user_id uid, count(*) c from messages m join threads t on t.id = m.thread_id where m.role = 'user' group by t.user_id`));
  const files = by(db.all<{ uid: string; c: number }>(sql`select user_id uid, count(*) c from files group by user_id`));
  const outs = by(db.all<{ uid: string; c: number }>(sql`select user_id uid, count(*) c from out_files group by user_id`));
  const rates = by(db.all<{ uid: string; up: number; down: number; last: number | null }>(sql`select user_id uid, coalesce(sum(value > 0), 0) up, coalesce(sum(value < 0), 0) down, max(updated_at) last from ratings group by user_id`));
  const src = sourceMap();
  const rows = users.map((u): PersonRow => {
    const c = chats.get(u.id), r = rates.get(u.id);
    const last = Math.max(n(c?.last), n(r?.last));
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt,
      chats: n(c?.c), messages: n(msgs.get(u.id)?.c), files: n(files.get(u.id)?.c) + n(outs.get(u.id)?.c), up: n(r?.up), down: n(r?.down), lastAt: last || null,
      blockKind: (u.blockKind as BlockKind) || (u.disabled ? 'pause' : ''), blockReason: u.blockReason, blockedAt: u.blockedAt ?? null, source: src.get(u.id) ?? SRC_NONE,
    };
  });
  return rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.name.localeCompare(b.name, 'ru'));
}

export function personById(id: string): PersonRow | null {
  return people().find((p) => p.id === id) ?? null;
}


export type ChatFilter = 'all' | 'down' | 'up';
export const CHAT_PAGE = 50;

export function userChats(userId: string, opts: { q?: string; filter?: ChatFilter; limit?: number; offset?: number } = {}): { rows: ChatRow[]; total: number } {
  const db = getDb();
  const threads = db.select({ t: schema.threads, folder: schema.folders.name }).from(schema.threads)
    .leftJoin(schema.folders, eq(schema.folders.id, schema.threads.folderId))
    .where(eq(schema.threads.userId, userId)).all();
  const msgs = new Map(db.all<{ tid: string; c: number }>(sql`select m.thread_id tid, count(*) c from messages m where m.thread_id in (select id from threads where user_id = ${userId}) group by m.thread_id`).map((r) => [r.tid, n(r.c)]));
  const rates = new Map(db.all<{ tid: string; up: number; down: number }>(sql`select thread_id tid, sum(value > 0) up, sum(value < 0) down from ratings where user_id = ${userId} group by thread_id`).map((r) => [r.tid, r]));
  const q = (opts.q ?? '').trim().toLocaleLowerCase('ru');
  let rows = threads.map(({ t, folder }): ChatRow => ({
    id: t.id, title: t.title, modelId: t.modelId, createdAt: t.createdAt, updatedAt: t.updatedAt, messages: msgs.get(t.id) ?? 0,
    up: n(rates.get(t.id)?.up), down: n(rates.get(t.id)?.down), folder, compare: !!t.groupId, temporary: t.temporary === 1,
  }));
  if (q) rows = rows.filter((r) => r.title.toLocaleLowerCase('ru').includes(q));
  if (opts.filter === 'down') rows = rows.filter((r) => r.down > 0);
  if (opts.filter === 'up') rows = rows.filter((r) => r.up > 0);
  rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const off = Math.max(0, opts.offset ?? 0), lim = Math.min(200, Math.max(1, opts.limit ?? CHAT_PAGE));
  return { rows: rows.slice(off, off + lim), total: rows.length };
}


export function userMemory(userId: string, now = Date.now()): AdminMemory {
  const rows = listMemory(userId).filter((r) => !(r.sure === 0 && r.updatedAt < now - MAYBE_TTL_MS));
  const ids = [...new Set(rows.map((r) => r.threadId).filter((x): x is string => !!x))];
  const ths = ids.length ? getDb().select({ id: schema.threads.id, title: schema.threads.title, temporary: schema.threads.temporary }).from(schema.threads)
    .where(and(inArray(schema.threads.id, ids), eq(schema.threads.userId, userId))).all() : [];
  const byId = new Map(ths.map((t) => [t.id, t]));
  const prefs = memoryPrefs(userId);
  const meta = memoryMeta(userId);
  const nameRow = rows.find((r) => r.key === 'name');
  const prof = nameRow ? null : profileName(userId);
  const b = prefs.on ? memoryBlockInfo(userId, null, now) : null;
  return {
    on: prefs.on, auto: prefs.auto,
    callName: nameRow ? { value: nameOf(nameRow.text), fromProfile: false } : { value: prof ?? '', fromProfile: !!prof },
    items: rows.map((r) => {
      const t = r.threadId ? byId.get(r.threadId) : undefined;
      return { id: r.id, section: r.section, key: r.key, text: r.text, origin: r.origin, sure: r.sure !== 0, createdAt: r.createdAt, updatedAt: r.updatedAt,
        chat: t ? { id: t.id, title: t.title, intro: t.temporary === INTRO } : null, blocked: ruleConflict(r.text) };
    }),
    prompt: b?.stats ? { used: b.stats.used, dropped: b.stats.dropped, blocked: b.stats.blocked, tokens: b.stats.tokens, body: b.body ?? '' } : null,
    askedName: meta.askedName ?? null, introAt: meta.introAt ?? null, introDone: !!meta.introDone,
  };
}


export function userUploads(userId: string, limit = 500): UploadItem[] {
  type R = { id: string; name: string; mime: string; size: number; at: number; tid: string | null; ttitle: string | null; len: number };
  return getDb().all<R>(sql`select f.id id, f.name name, f.mime mime, f.size size, f.created_at at, f.thread_id tid, t.title ttitle, length(f.text) len
    from files f left join threads t on t.id = f.thread_id where f.user_id = ${userId} order by f.created_at desc limit ${limit}`)
    .map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: n(r.size), createdAt: n(r.at), threadId: r.tid, threadTitle: r.ttitle, tokens: Math.round(n(r.len) / 3.5) }));
}

export function userOutFiles(userId: string, limit = 200, root = outRoot()): OutItem[] {
  type R = { token: string; tid: string | null; mid: string | null; at: number; ttitle: string | null };
  const rows = getDb().all<R>(sql`select o.token token, o.thread_id tid, o.message_id mid, o.created_at at, t.title ttitle
    from out_files o left join threads t on t.id = o.thread_id where o.user_id = ${userId} order by o.created_at desc limit ${limit}`);
  const out: OutItem[] = [];
  for (const r of rows) {
    if (!isToken(r.token)) continue;
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(root, r.token)); } catch { continue; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      try {
        const st = fs.lstatSync(path.join(root, r.token, name));
        if (!st.isFile()) continue;
        out.push({ token: r.token, name, size: st.size, createdAt: n(r.at), threadId: r.tid, threadTitle: r.ttitle, messageId: r.mid, url: `${OUT_PREFIX}${r.token}/${encodeURIComponent(name)}` });
      } catch {  }
    }
  }
  return out;
}

export function uploadText(fileId: string, cap = 60_000) {
  const f = getDb().select().from(schema.files).where(eq(schema.files.id, fileId)).get();
  if (!f) return null;
  const t = f.threadId ? getDb().select({ title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, f.threadId)).get() : undefined;
  return {
    id: f.id, userId: f.userId, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt, threadId: f.threadId, threadTitle: t?.title ?? null,
    tokens: estTokens(f.text), text: f.text.slice(0, cap), truncated: f.text.length > cap, info: f.info ?? null,
  };
}

export function outOwner(token: string): string | null {
  if (!isToken(token)) return null;
  return getDb().select({ u: schema.outFiles.userId }).from(schema.outFiles).where(eq(schema.outFiles.token, token)).get()?.u ?? null;
}


export type RatingQuery = { value?: 1 | -1; userId?: string; modelId?: string; days?: number; before?: string | null; limit?: number; now?: number };

export function ratingsFeed(q: RatingQuery = {}): RatingsPage {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, q.limit ?? 30));
  const base = [sql`1 = 1`];
  if (q.userId) base.push(sql`r.user_id = ${q.userId}`);
  if (q.modelId) base.push(sql`r.model_id = ${q.modelId}`);
  if (q.days && q.days > 0) base.push(sql`r.updated_at >= ${(q.now ?? Date.now()) - q.days * 864e5}`);
  const where = [...base];
  if (q.value) where.push(q.value > 0 ? sql`r.value > 0` : sql`r.value < 0`);
  if (q.before) {
    const [at, id] = q.before.split(':');
    if (Number.isFinite(Number(at)) && id) where.push(sql`(r.updated_at < ${Number(at)} or (r.updated_at = ${Number(at)} and r.id < ${id}))`);
  }
  type R = { id: string; uid: string; uname: string | null; tid: string; ttitle: string | null; mid: string; value: number; reasons: string | null; comment: string | null; model: string | null; level: string | null; dur: number | null; at: number; ex: string | null; ans: string | null; qst: string | null };
  const rows = db.all<R>(sql`select r.id id, r.user_id uid, u.name uname, r.thread_id tid, t.title ttitle, r.message_id mid, r.value value, r.reasons reasons, r.comment comment,
      r.model_id model, r.level_id level, r.duration_ms dur, r.updated_at at, m.id ex, substr(m.content, 1, 400) ans,
      (select substr(q.content, 1, 300) from messages q where q.id = m.parent_id) qst
    from ratings r left join users u on u.id = r.user_id left join threads t on t.id = r.thread_id left join messages m on m.id = r.message_id
    where ${sql.join(where, sql` and `)} order by r.updated_at desc, r.id desc limit ${limit + 1}`);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const cnt = db.get<{ up: number | null; down: number | null }>(sql`select sum(r.value > 0) up, sum(r.value < 0) down from ratings r where ${sql.join(base, sql` and `)}`);
  const users = db.all<{ id: string; name: string | null; c: number }>(sql`select r.user_id id, u.name name, count(*) c from ratings r left join users u on u.id = r.user_id group by r.user_id order by c desc`)
    .map((x) => ({ id: x.id, name: x.name ?? 'удалён', n: n(x.c) }));
  const models = db.all<{ id: string | null; c: number }>(sql`select model_id id, count(*) c from ratings where model_id is not null group by model_id order by c desc`)
    .map((x) => ({ id: x.id as string, n: n(x.c) }));
  const items: RatingItem[] = page.map((r) => ({
    id: r.id, userId: r.uid, userName: r.uname ?? 'удалён', threadId: r.tid, threadTitle: r.ttitle, messageId: r.mid, value: r.value > 0 ? 1 : -1,
    reasons: parseList(r.reasons), comment: r.comment ?? '', modelId: r.model, levelId: r.level, durationMs: r.dur, at: n(r.at), exists: !!r.ex && !!r.ttitle,
    question: plain(r.qst, 120), answer: plain(r.ans, 160),
  }));
  const last = page[page.length - 1];
  return { rows: items, up: n(cnt?.up), down: n(cnt?.down), next: more && last ? `${n(last.at)}:${last.id}` : null, users, models };
}


export function branchLeaf(all: Message[], fromId: string): string {
  const kids = new Map<string, Message[]>();
  for (const m of all) if (m.parentId) { const a = kids.get(m.parentId); if (a) a.push(m); else kids.set(m.parentId, [m]); }
  let cur = fromId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const c = kids.get(cur);
    if (!c?.length) break;
    cur = c.reduce((a, b) => (b.seq > a.seq ? b : a)).id;
  }
  return cur;
}

export function loadAdminChat(threadId: string, focus?: string | null): AdminChatData | null {
  const db = getDb();
  const thread = db.select().from(schema.threads).where(eq(schema.threads.id, threadId)).get();
  if (!thread) return null;
  const owner = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, thread.userId)).get();
  if (!owner) return null;
  const all = messageSkeleton(thread.id);
  let leaf: string | undefined;
  if (focus && all.some((m) => m.id === focus) && !activePath(all, thread.leafId).some((m) => m.id === focus)) leaf = branchLeaf(all, focus);
  const d = loadThread(thread.userId, thread.id, { turns: 0, leaf });
  if (!d) return null;
  const onPath = new Set(d.messages.map((m) => m.id));
  const exists = new Set(all.map((m) => m.id));
  const times: Record<string, number> = {};
  for (const r of db.all<{ id: string; at: number }>(sql`select id, created_at at from messages where thread_id = ${thread.id}`)) if (onPath.has(r.id)) times[r.id] = n(r.at);
  const marks: Mark[] = db.select().from(schema.ratings).where(and(eq(schema.ratings.threadId, thread.id), eq(schema.ratings.userId, thread.userId))).all()
    .map((r) => ({ id: r.id, messageId: r.messageId, value: (r.value > 0 ? 1 : -1) as 1 | -1, reasons: r.reasons ?? [], comment: r.comment ?? '', at: r.updatedAt, onPath: onPath.has(r.messageId), model: r.modelId }))
    .filter((r) => exists.has(r.messageId))
    .sort((a, b) => a.at - b.at);
  const folder = thread.folderId ? db.select({ name: schema.folders.name }).from(schema.folders).where(eq(schema.folders.id, thread.folderId)).get()?.name ?? null : null;
  return {
    thread: { id: thread.id, title: thread.title, modelId: thread.modelId, effort: thread.effort, createdAt: thread.createdAt, updatedAt: thread.updatedAt, temporary: thread.temporary === 1, compareGroup: !!thread.groupId, folder },
    owner, messages: d.messages, times, marks, compare: d.compare, fileNames: d.fileNames, otherBranch: leaf !== undefined,
  };
}

export function threadOwner(threadId: string): { userId: string; title: string } | null {
  const t = getDb().select({ userId: schema.threads.userId, title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.id, threadId)).get();
  return t ?? null;
}

export const isAdmin = (u: Pick<User, 'role'>) => u.role === 'admin';
