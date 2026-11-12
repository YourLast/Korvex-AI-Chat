import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from '../db';
import type { FileRow, Thread } from '../db/schema';
import { activePath, allMessages } from '../tree';
import { searchChats } from '../search';
import { outRoot, isToken } from '../outfiles';
import { findFolderByName, createFolder, moveThreads, getFolder } from '../folders';
import { publish } from '../bus';
import { registerTool } from './registry';
import { saveAttachment } from '../agentLoop';
import type { ToolCtx } from './types';

export const READ_MAX = 20_000;
export const FILE_PART = 20_000;
export const ASK_WAIT_DEFAULT = 90;
export const ASK_WAIT_MAX = 900;
export const MAX_DEPTH = 2;
export const MAX_PER_TURN = 8;
export const MAX_PER_PAIR = 20;
const PAIR_WINDOW_MS = 10 * 60_000;


const norm = (s: string) => s.replace(/[«»"„“”']/g, '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const fmtDate = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + `…[ещё ${s.length - n} симв.]`);
const q = (s: string) => `«${s}»`;

type Found = { t: Thread | null; candidates: Thread[] };

export const THIS_RE = /^(this|current|этот|этот чат|текущий|текущий чат|здесь|сюда)$/i;

export function resolveChat(userId: string, ref: string, here?: string): Found {
  const db = getDb();
  const r = String(ref ?? '').trim().replace(/^[«"„“]|[»"”]$/g, '');
  if (!r) return { t: null, candidates: [] };
  if (here && THIS_RE.test(r)) {
    const t = db.select().from(schema.threads).where(and(eq(schema.threads.id, here), eq(schema.threads.userId, userId))).get();
    if (t) return { t, candidates: [t] };
  }
  if (/^[0-9a-f-]{8,36}$/i.test(r)) {
    const t = db.select().from(schema.threads).where(and(eq(schema.threads.userId, userId), sql`${schema.threads.id} LIKE ${r.toLowerCase() + '%'}`)).orderBy(desc(schema.threads.updatedAt)).get();
    if (t) return { t, candidates: [t] };
  }
  const all = db.select().from(schema.threads).where(eq(schema.threads.userId, userId)).orderBy(desc(schema.threads.updatedAt)).all().filter((t) => t.side !== 'b' && !t.temporary);
  const n = norm(r);
  const exact = all.filter((t) => norm(t.title) === n);
  if (exact.length) return { t: exact[0], candidates: exact };
  const part = all.filter((t) => norm(t.title).includes(n) || (n.length >= 4 && n.includes(norm(t.title)) && norm(t.title).length >= 4));
  return { t: part[0] ?? null, candidates: part.slice(0, 8) };
}

const chatName = (userId: string | undefined, ref: unknown, here?: string) => { const r = String(ref ?? ''); if (!userId) return r; try { return resolveChat(userId, r, here).t?.title ?? r; } catch { return r; } };

function notFound(userId: string, ref: string, f: Found): string {
  const sug = f.candidates.length ? f.candidates : resolveChat(userId, ref.split(/\s+/)[0] ?? '').candidates;
  return `Чат ${q(ref)} не найден.${sug.length ? ` Похожие: ${sug.slice(0, 5).map((t) => `${q(t.title)} (id ${t.id})`).join(', ')}.` : ' Посмотри список: chat_list.'}`;
}

const sameFolder = (ctx: Pick<ToolCtx, 'folderId'>, t: Thread) => !!ctx.folderId && t.folderId === ctx.folderId;
const folderName = (userId: string, id: string | null) => (id ? getFolder(userId, id)?.name ?? null : null);

type Line = { id: string; role: 'user' | 'assistant'; at: number; text: string };

function chatLines(t: Thread): Line[] {
  const all = allMessages(t.id);
  return activePath(all, t.leafId).filter((m) => m.content.trim()).map((m) => ({ id: m.id, role: m.role, at: m.createdAt, text: m.content.replace(/⁠‌⁠/g, '') }));
}

function render(lines: Line[], perMsg = 4000): string {
  return lines.map((l) => `[${l.role === 'user' ? 'Пользователь' : 'Ответ модели'}, ${fmtDate(l.at)}]\n${clip(l.text, perMsg)}`).join('\n\n');
}

function matchLines(lines: Line[], query: string): Line[] {
  const stems = norm(query).split(/[^\p{L}\p{N}.,]+/u).filter((w) => w.length >= 2).map((w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w));
  if (!stems.length) return lines;
  const score = lines.map((l) => { const x = norm(l.text); return stems.filter((s) => x.includes(s)).length; });
  const best = Math.max(0, ...score);
  if (!best) return [];
  const keep = new Set<number>();
  score.forEach((s, i) => { if (s >= Math.max(1, best - 1)) { keep.add(i); if (lines[i].role === 'user' && i + 1 < lines.length) keep.add(i + 1); if (lines[i].role === 'assistant' && i > 0) keep.add(i - 1); } });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]);
}

function chatFiles(userId: string, threadId: string): FileRow[] {
  return getDb().select().from(schema.files).where(and(eq(schema.files.userId, userId), eq(schema.files.threadId, threadId))).all();
}

registerTool<{ query?: string; folder?: string; limit?: number }>({
  name: 'chat_list', kind: 'chat',
  description: 'List the user\'s chats (newest first) or search all of them by words. Returns titles, ids, folders.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, folder: { type: 'string' }, limit: { type: 'integer' } } },
  enabled: (c) => !!c.threadId,
  title: (a) => (a.query ? `Ищет в чатах ${q(a.query)}` : a.folder ? `Смотрит чаты папки ${q(a.folder)}` : 'Смотрит список чатов'),
  run: async (a, ctx) => {
    const db = getDb();
    const limit = Math.min(100, Math.max(1, Number(a.limit) || 30));
    const folders = db.select().from(schema.folders).where(eq(schema.folders.userId, ctx.userId)).all();
    const fname = new Map(folders.map((f) => [f.id, f.name]));
    let only: string | null = null;
    if (a.folder) {
      const f = findFolderByName(ctx.userId, a.folder);
      if (!f) return { content: `Папки ${q(a.folder)} нет. Папки: ${folders.map((x) => q(x.name)).join(', ') || 'нет'}.`, error: true };
      only = f.id;
    }
    const counts = new Map(db.select({ f: schema.threads.folderId, n: sql<number>`count(*)` }).from(schema.threads).where(eq(schema.threads.userId, ctx.userId)).groupBy(schema.threads.folderId).all().map((r) => [r.f, Number(r.n)]));
    const head = folders.length ? `Папки пользователя: ${folders.map((f) => `${q(f.name)} — чатов: ${counts.get(f.id) ?? 0}`).join('; ')}. Чат без пометки «папка …» — вне папок.\n` : '';
    const mark = (t: { id: string; folderId: string | null }) => [t.id === ctx.threadId ? 'этот чат' : '', t.folderId ? `папка ${q(fname.get(t.folderId) ?? '?')}` : ''].filter(Boolean).join(', ');
    if (a.query && a.query.trim()) {
      const r = searchChats(ctx.userId, a.query, limit);
      const ids = r.hits.map((h) => /\/c\/([0-9a-f-]{36})/.exec(h.href)?.[1] ?? null);
      const rows = ids.filter((x): x is string => !!x).length ? db.select().from(schema.threads).where(and(eq(schema.threads.userId, ctx.userId), inArray(schema.threads.id, ids.filter((x): x is string => !!x)))).all() : [];
      const byId = new Map(rows.map((t) => [t.id, t]));
      const out = r.hits.map((h, i) => {
        const t = ids[i] ? byId.get(ids[i]!) : undefined;
        if (only && t?.folderId !== only) return null;
        const title = h.title.map(([s]) => s).join('');
        const snip = h.snippet ? h.snippet.map(([s]) => s).join('').replace(/\s+/g, ' ').trim() : '';
        const m = t ? mark(t) : '';
        return `- ${q(title)} (id ${t?.id ?? h.key}${m ? ', ' + m : ''}, ${fmtDate(h.at)})${snip ? `\n  найдено: ${clip(snip, 300)}` : ''}`;
      }).filter(Boolean);
      ctx.emit({ detail: out.length ? `Найдено чатов: ${out.length}` : 'Ничего не найдено' });
      return { content: out.length ? `${head}Чаты по запросу ${q(a.query)} (${out.length}):\n${out.join('\n')}` : `${head}По запросу ${q(a.query)} ничего не найдено в чатах пользователя.` };
    }
    const where = only ? and(eq(schema.threads.userId, ctx.userId), eq(schema.threads.folderId, only)) : eq(schema.threads.userId, ctx.userId);
    const rows = db.select().from(schema.threads).where(where).orderBy(desc(schema.threads.updatedAt)).limit(limit * 2).all().filter((t) => t.side !== 'b' && !t.temporary).slice(0, limit);
    ctx.emit({ detail: `Чатов: ${rows.length}` });
    return { content: `${head}Чаты пользователя (${rows.length}, новые первыми):\n` + rows.map((t) => { const m = mark(t); return `- ${q(t.title)} (id ${t.id}${m ? ', ' + m : ''}, ${fmtDate(t.updatedAt)})`; }).join('\n') };
  },
});

registerTool<{ chat: string; query?: string; last?: number }>({
  name: 'chat_read', kind: 'chat',
  description: 'Read another chat of the user (id or title): latest messages or only those about query, and its files.',
  parameters: { type: 'object', properties: { chat: { type: 'string' }, query: { type: 'string' }, last: { type: 'integer' } }, required: ['chat'] },
  enabled: (c) => !!c.threadId,
  title: (a, c) => `Читает чат ${q(chatName(c?.userId, a.chat, c?.threadId))}`,
  run: async (a, ctx) => {
    const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
    if (!f.t) return { content: notFound(ctx.userId, a.chat, f), error: true };
    const t = f.t;
    ctx.emit({ title: `Читает чат ${q(t.title)}` });
    const lines = chatLines(t);
    let pick = a.query?.trim() ? matchLines(lines, a.query) : lines.slice(-Math.min(200, Math.max(1, Number(a.last) || 20)));
    let body = render(pick);
    if (body.length > READ_MAX) {
      while (pick.length > 1 && render(pick).length > READ_MAX) pick = pick.slice(1);
      body = clip(render(pick), READ_MAX);
    }
    const files = chatFiles(ctx.userId, t.id);
    const fl = files.length ? `\n\nФайлы чата: ${files.map((x) => `${x.name} (id ${x.id})`).join(', ')}` : '';
    const fld = folderName(ctx.userId, t.folderId);
    ctx.emit({ detail: a.query?.trim() ? `Найдено сообщений: ${pick.length}` : `Сообщений: ${pick.length} из ${lines.length}` });
    if (!pick.length) return { content: `В чате ${q(t.title)} (id ${t.id}) нет сообщений${a.query ? ` про ${q(a.query)}` : ''}.${fl}` };
    return { content: `Чат ${q(t.title)} (id ${t.id}${fld ? `, папка ${q(fld)}` : ''}), ${a.query?.trim() ? `сообщения про ${q(a.query)}` : `последние ${pick.length} из ${lines.length}`}:\n\n${body}${fl}` };
  },
});

type Peer = { t: Thread; rowId: string; queued: boolean; jobId?: string; messageId?: string };

async function postToChat(ctx: ToolCtx, t: Thread, text: string, kind: 'agent' | 'send'): Promise<Peer | string> {
  if (t.id === ctx.threadId) return 'Это этот же чат: писать в него не нужно.';
  if (ctx.depth >= MAX_DEPTH) return 'Слишком длинная цепочка переписки агентов: этот ход сам вызван агентом другого чата.';
  const db0 = getDb();
  const perTurn = db0.select({ n: sql<number>`count(*)` }).from(schema.agentMsgs).where(and(eq(schema.agentMsgs.userId, ctx.userId), eq(schema.agentMsgs.fromJob, ctx.jobId))).get();
  if (Number(perTurn?.n ?? 0) >= MAX_PER_TURN) return `Предел переписки в одном ходе: уже ${MAX_PER_TURN} сообщений в другие чаты. Ответь пользователю тем, что есть.`;
  const pair = db0.select({ n: sql<number>`count(*)` }).from(schema.agentMsgs).where(and(eq(schema.agentMsgs.userId, ctx.userId), sql`${schema.agentMsgs.createdAt} > ${Date.now() - PAIR_WINDOW_MS}`,
    sql`((${schema.agentMsgs.fromThread} = ${ctx.threadId} AND ${schema.agentMsgs.toThread} = ${t.id}) OR (${schema.agentMsgs.fromThread} = ${t.id} AND ${schema.agentMsgs.toThread} = ${ctx.threadId}))`)).get();
  if (Number(pair?.n ?? 0) >= MAX_PER_PAIR) return `Чаты ${q(t.title)} и этот уже обменялись ${MAX_PER_PAIR} сообщениями за 10 минут: похоже на зацикливание, остановись и ответь пользователю.`;
  const { jobOfThread } = await import('../jobs');
  const busy = !!jobOfThread(t.id);
  if (busy && ctx.depth >= 1) return `В чате ${q(t.title)} сейчас идёт ответ: попробуй позже.`;
  const rowId = randomUUID();
  db0.insert(schema.agentMsgs).values({ id: rowId, userId: ctx.userId, kind: kind === 'agent' ? 'ask' : 'send', fromThread: ctx.threadId, toThread: t.id, fromJob: ctx.jobId,
    question: text.slice(0, 20_000), status: 'queued', depth: ctx.depth + 1, createdAt: Date.now() }).run();
  const M = await import('../agentMail');
  void M.startMail();
  if (busy) return { t, rowId, queued: true };
  const r = await M.sendLetter(rowId, kind === 'agent' ? 'asking' : 'sent');
  if (r === 'busy') return { t, rowId, queued: true };
  if (typeof r === 'string') return r;
  return { t, rowId, queued: false, jobId: r.jobId, messageId: r.messageId };
}

registerTool<{ chat: string; text: string }>({
  name: 'chat_send', kind: 'chat',
  description: 'Post a message into another chat as the user; that chat\'s agent answers there.',
  parameters: { type: 'object', properties: { chat: { type: 'string' }, text: { type: 'string' } }, required: ['chat', 'text'] },
  enabled: (c) => !!c.threadId && c.depth < MAX_DEPTH,
  title: (a, c) => `Пишет в чат ${q(chatName(c?.userId, a.chat, c?.threadId))}`,
  confirm: (a, ctx) => {
    const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
    if (!f.t) return null;
    return `Написать в чат ${q(f.t.title)}: ${q(clip(String(a.text ?? ''), 200))}?`;
  },
  run: async (a, ctx) => {
    if (!String(a.text ?? '').trim()) return { content: 'Пустое сообщение.', error: true };
    const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
    if (!f.t) return { content: notFound(ctx.userId, a.chat, f), error: true };
    ctx.emit({ title: `Пишет в чат ${q(f.t.title)}` });
    const p = await postToChat(ctx, f.t, String(a.text), 'send');
    if (typeof p === 'string') return { content: p, error: true };
    if (p.queued) { ctx.emit({ detail: `В очереди: в чате идёт ответ. ${clip(String(a.text), 300)}` }); return { content: `В чате ${q(p.t.title)} сейчас идёт ответ: сообщение поставлено в очередь и уйдёт туда, когда ответ закончится.` }; }
    ctx.emit({ detail: `Отправлено: ${clip(String(a.text), 300)}` });
    return { content: `Сообщение отправлено в чат ${q(p.t.title)} (id ${p.t.id}); агент того чата отвечает там.` };
  },
});

registerTool<{ chat: string; message: string; wait_seconds?: number }>({
  name: 'agent_message', kind: 'agent',
  description: 'Ask another chat\'s agent (id or title) and get its answer; a late answer comes here as a new message.',
  parameters: { type: 'object', properties: { chat: { type: 'string' }, message: { type: 'string' }, wait_seconds: { type: 'integer' } }, required: ['chat', 'message'] },
  enabled: (c) => !!c.threadId && c.depth < MAX_DEPTH,
  title: (a, c) => `Спрашивает чат ${q(chatName(c?.userId, a.chat, c?.threadId))}`,
  confirm: (a, ctx) => {
    const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
    if (!f.t || f.t.id === ctx.threadId || sameFolder(ctx, f.t)) return null;
    return `Спросить агента чата ${q(f.t.title)}: ${q(clip(String(a.message ?? ''), 200))}?`;
  },
  run: async (a, ctx) => {
    const msg = String(a.message ?? '').trim();
    if (!msg) return { content: 'Пустое сообщение.', error: true };
    const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
    if (!f.t) return { content: notFound(ctx.userId, a.chat, f), error: true };
    const t = f.t;
    const ex = { threadId: t.id, threadTitle: t.title, question: msg };
    ctx.emit({ title: `Спрашивает чат ${q(t.title)}`, agent: { ...ex, state: 'asking' } });
    const p = await postToChat(ctx, t, msg, 'agent');
    if (typeof p === 'string') { ctx.emit({ agent: { ...ex, state: 'error' }, detail: p }); return { content: p, error: true }; }
    const later = `Ответ агента чата ${q(t.title)} придёт в этот чат отдельным сообщением. Скажи пользователю, что вопрос передан и ответ придёт позже; не жди и не спрашивай снова.`;
    if (p.queued) {
      ctx.emit({ agent: { ...ex, state: 'queued' }, detail: 'Чат занят: вопрос в очереди, ответ придёт сюда отдельным сообщением' });
      return { content: `Чат ${q(t.title)} сейчас занят (там идёт ответ): вопрос поставлен в очередь. ${later}` };
    }
    const { waitJob } = await import('../jobs');
    const wait = Math.min(ASK_WAIT_MAX, Math.max(5, Number(a.wait_seconds) || ASK_WAIT_DEFAULT)) * 1000;
    const w = waitJob(p.jobId!);
    const res = w ? await Promise.race([w, new Promise<null>((r) => setTimeout(() => r(null), wait)), new Promise<null>((r) => ctx.signal.addEventListener('abort', () => r(null), { once: true }))]) : null;
    const db = getDb();
    if (!res) {
      db.update(schema.agentMsgs).set({ status: 'pending' }).where(and(eq(schema.agentMsgs.id, p.rowId), eq(schema.agentMsgs.status, 'asking'))).run();
      void (await import('../agentMail')).mailPump();
      if (ctx.signal.aborted) return { content: 'Остановлено.' };
      ctx.emit({ agent: { ...ex, state: 'queued', messageId: p.messageId }, detail: 'Ответ придёт сюда отдельным сообщением' });
      return { content: `Агент чата ${q(t.title)} ещё отвечает. ${later}` };
    }
    const answer = res.content.trim();
    if (res.status !== 'done' || !answer) {
      db.update(schema.agentMsgs).set({ status: 'error', answer: answer || null, answeredAt: Date.now() }).where(eq(schema.agentMsgs.id, p.rowId)).run();
      ctx.emit({ agent: { ...ex, state: 'error', answer: answer || undefined, messageId: p.messageId } });
      return { content: `Агент чата ${q(t.title)} не смог ответить${res.error ? `: ${res.error}` : ''}.${answer ? `\nЧастичный ответ:\n${clip(answer, 4000)}` : ''}`, error: true };
    }
    db.update(schema.agentMsgs).set({ status: 'answered', answer: answer.slice(0, 50_000), answeredAt: Date.now() }).where(eq(schema.agentMsgs.id, p.rowId)).run();
    ctx.emit({ agent: { ...ex, state: 'answered', answer: clip(answer, 2000), messageId: p.messageId } });
    return { content: `Ответ агента чата ${q(t.title)} (id ${t.id}):\n${clip(answer, 12_000)}` };
  },
});

registerTool<{ chats: string[]; folder: string; create?: boolean }>({
  name: 'chat_move', kind: 'chat',
  description: 'Move chats (ids/titles, "этот" = this) into a folder by name; created if missing; "" = out of folders.',
  parameters: { type: 'object', properties: { chats: { type: 'array', items: { type: 'string' } }, folder: { type: 'string' } }, required: ['chats', 'folder'] },
  enabled: (c) => !!c.threadId,
  title: (a) => (String(a.folder ?? '').trim() ? `Переносит чаты в папку ${q(String(a.folder))}` : 'Убирает чаты из папки'),
  run: async (a, ctx) => {
    const refs = (Array.isArray(a.chats) ? a.chats : [a.chats]).map(String).filter((x) => x.trim()).slice(0, 100);
    if (!refs.length) return { content: 'Не указаны чаты.', error: true };
    const name = String(a.folder ?? '').trim();
    let folderId: string | null = null;
    let created = false;
    if (name) {
      let f = findFolderByName(ctx.userId, name);
      if (!f) {
        if (a.create === false) return { content: `Папки ${q(name)} нет.`, error: true };
        f = createFolder(ctx.userId, name); created = true;
      }
      folderId = f.id;
    }
    const ids: string[] = [], titles: string[] = [], missing: string[] = [];
    for (const r of refs) {
      const f = resolveChat(ctx.userId, r, ctx.threadId);
      if (f.t) { ids.push(f.t.groupId ?? f.t.id); titles.push(f.t.title); } else missing.push(r);
    }
    const moved = ids.length ? moveThreads(ctx.userId, ids, folderId) : [];
    for (const id of moved) publish(ctx.userId, { t: 'thread', id, gid: null });
    ctx.emit({ title: name ? `Переносит ${titles.length} ${titles.length === 1 ? 'чат' : titles.length < 5 ? 'чата' : 'чатов'} в папку ${q(name)}` : 'Убирает чаты из папки',
      detail: titles.map((t) => `• ${t}`).join('\n') + (missing.length ? `\nНе найдены: ${missing.join(', ')}` : '') });
    const head = name ? `${created ? `Создана папка ${q(name)}. ` : ''}В папку ${q(name)} перенесено чатов: ${moved.length}` : `Из папки убрано чатов: ${moved.length}`;
    return { content: `${head}${titles.length ? ` (${titles.map(q).join(', ')})` : ''}.${missing.length ? ` Не найдены: ${missing.map(q).join(', ')} — уточни через chat_list.` : ''}`, error: !moved.length };
  },
});

type CloudFile = { id: string; name: string; size: number; at: number; threadId: string | null; source: 'upload' | 'model' | 'tool'; mime: string };

function listOut(userId: string, threadId?: string | null): CloudFile[] {
  const rows = getDb().select().from(schema.outFiles).where(threadId ? and(eq(schema.outFiles.userId, userId), eq(schema.outFiles.threadId, threadId)) : eq(schema.outFiles.userId, userId)).all();
  const out: CloudFile[] = [];
  for (const r of rows) {
    if (!isToken(r.token)) continue;
    const dir = path.join(outRoot(), r.token);
    let names: string[] = [];
    try { if (!fs.lstatSync(dir).isDirectory()) continue; names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      try {
        const st = fs.lstatSync(path.join(dir, n));
        if (!st.isFile()) continue;
        out.push({ id: `out:${r.token}/${n}`, name: n, size: st.size, at: st.mtimeMs, threadId: r.threadId, source: 'model', mime: mimeOf(n) });
      } catch {  }
    }
  }
  return out;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.html': 'text/html', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.zip': 'application/zip' };
const mimeOf = (n: string) => MIME[path.extname(n).toLowerCase()] ?? 'application/octet-stream';
const TEXTY = /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|log|py|js|ts|sql|ini|toml)$/i;
const kb = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);
const SRC = { upload: 'загрузил пользователь', model: 'сделала модель', tool: 'сделал инструмент' } as const;

registerTool<{ chat?: string; query?: string; limit?: number }>({
  name: 'files_list', kind: 'file',
  description: 'List files of the user\'s chats (uploads and model-made), filter by chat or words. Returns ids.',
  parameters: { type: 'object', properties: { chat: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer' } } },
  enabled: (c) => !!c.threadId,
  title: (a, c) => (a.chat ? `Смотрит файлы чата ${q(chatName(c?.userId, a.chat, c?.threadId))}` : a.query ? `Ищет файл ${q(a.query)}` : 'Смотрит файлы чатов'),
  run: async (a, ctx) => {
    const db = getDb();
    let tid: string | null = null;
    if (a.chat) {
      const f = resolveChat(ctx.userId, a.chat, ctx.threadId);
      if (!f.t) return { content: notFound(ctx.userId, a.chat, f), error: true };
      tid = f.t.id;
    }
    const up = db.select().from(schema.files).where(tid ? and(eq(schema.files.userId, ctx.userId), eq(schema.files.threadId, tid)) : eq(schema.files.userId, ctx.userId)).all()
      .filter((f) => f.threadId).map((f): CloudFile => ({ id: f.id, name: f.name, size: f.size, at: f.createdAt, threadId: f.threadId, source: (f.info as { source?: string } | null)?.source === 'tool' ? 'tool' : 'upload', mime: f.mime }));
    let all = [...up, ...listOut(ctx.userId, tid)];
    const titles = new Map(db.select({ id: schema.threads.id, title: schema.threads.title }).from(schema.threads).where(eq(schema.threads.userId, ctx.userId)).all().map((t) => [t.id, t.title]));
    if (a.query?.trim()) { const w = norm(a.query).split(' ').filter(Boolean); all = all.filter((f) => { const hay = `${norm(f.name)} ${norm(f.threadId ? titles.get(f.threadId) ?? '' : '')}`; return w.every((x) => hay.includes(x)); }); }
    const seen = new Set<string>();
    all = all.sort((x, y) => y.at - x.at).filter((f) => { const k = `${f.name}|${f.size}|${f.threadId}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const limit = Math.min(200, Math.max(1, Number(a.limit) || 40));
    const shown = all.slice(0, limit);
    ctx.emit({ detail: `Файлов: ${all.length}` });
    if (!shown.length) return { content: a.chat || a.query ? 'Таких файлов нет.' : 'В чатах пользователя файлов нет.' };
    return { content: `Файлы (${shown.length}${all.length > shown.length ? ` из ${all.length}` : ''}, новые первыми):\n` + shown.map((f) =>
      `- ${f.name} — ${kb(f.size)}, ${SRC[f.source]}, чат ${q(f.threadId ? titles.get(f.threadId) ?? '?' : '—')}${f.threadId === ctx.threadId ? ' (этот чат)' : ''}, ${fmtDate(f.at)} (id ${f.id})`).join('\n') };
  },
});

function cloudFile(userId: string, id: string): { name: string; mime: string; size: number; threadId: string | null; data: () => Buffer; text: () => Promise<string>; row?: FileRow } | null {
  if (id.startsWith('out:')) {
    const m = /^out:([0-9a-f]{32})\/(.+)$/.exec(id);
    if (!m || !isToken(m[1]) || m[2].includes('/') || m[2].includes('..')) return null;
    const own = getDb().select().from(schema.outFiles).where(and(eq(schema.outFiles.token, m[1]), eq(schema.outFiles.userId, userId))).get();
    if (!own) return null;
    const dir = path.join(outRoot(), m[1]);
    const file = path.join(dir, m[2]);
    if (path.dirname(file) !== dir) return null;
    let st: fs.Stats;
    try { if (!fs.lstatSync(dir).isDirectory()) return null; st = fs.lstatSync(file); if (!st.isFile()) return null; } catch { return null; }
    const data = () => fs.readFileSync(file);
    return { name: m[2], mime: mimeOf(m[2]), size: st.size, threadId: own.threadId, data,
      text: async () => (TEXTY.test(m[2]) ? data().toString('utf8') : /\.(xlsx|xls|docx|pptx|pdf|odt|ods|rtf)$/i.test(m[2]) ? (await (await import('../extract')).extractText(data(), m[2])).text : '') };
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const f = getDb().select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, userId))).get();
  if (!f) return null;
  const dir = path.join(dataDir(), 'files', f.id);
  const data = () => { const n = fs.readdirSync(dir).find((x) => x.startsWith('original')); if (!n) throw new Error('файл не найден на диске'); return fs.readFileSync(path.join(dir, n)); };
  return { name: f.name, mime: f.mime, size: f.size, threadId: f.threadId, data, text: async () => f.text, row: f };
}

registerTool<{ id: string; part?: number; attach?: boolean }>({
  name: 'files_get', kind: 'file',
  description: 'Get a file by id: text (part=N if long) and a copy attached here — give its link, do not recreate the file.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, part: { type: 'integer' }, attach: { type: 'boolean' } }, required: ['id'] },
  enabled: (c) => !!c.threadId,
  title: (a, c) => { const f = c ? cloudFile(c.userId, String(a.id ?? '').trim()) : null; return f ? `Берёт файл ${q(f.name)}` : 'Берёт файл из облака'; },
  run: async (a, ctx) => {
    const f = cloudFile(ctx.userId, String(a.id ?? '').trim());
    if (!f) return { content: `Файла с id ${q(String(a.id))} нет. Посмотри files_list.`, error: true };
    ctx.emit({ title: `Берёт файл ${q(f.name)}` });
    const attach = a.attach ?? f.threadId !== ctx.threadId;
    const atts = [];
    let link = '';
    if (attach) {
      const at = await saveAttachment(ctx.userId, ctx.threadId, { name: f.name, mime: f.mime, data: f.data(), tool: 'files_get', jobId: ctx.jobId, text: f.row?.text });
      atts.push(at);
      link = `\nКопия в этом чате: [${f.name}](${at.url})`;
      ctx.emit({ attachments: [at], ...(at.kind === 'image' ? { thumb: at } : {}) });
    }
    if (f.mime.startsWith('image/')) return { content: `Картинка ${q(f.name)}, ${kb(f.size)}.${link || ' (текста нет)'}`, attachments: atts };
    let text = '';
    try { text = await f.text(); } catch (e) { text = ''; ctx.emit({ detail: `Текст не прочитан: ${(e as Error).message.slice(0, 200)}` }); }
    const parts = Math.max(1, Math.ceil(text.length / FILE_PART));
    const part = Math.min(parts, Math.max(1, Number(a.part) || 1));
    const chunk = text.slice((part - 1) * FILE_PART, part * FILE_PART);
    ctx.emit({ detail: text ? `Текст: ${kb(Buffer.byteLength(text))}${parts > 1 ? `, часть ${part} из ${parts}` : ''}` : 'Текста нет' });
    return { content: `Файл ${q(f.name)}, ${kb(f.size)}.${link}\n${text ? `${parts > 1 ? `Часть ${part} из ${parts}:\n` : 'Текст:\n'}${chunk}` : 'Текст из файла не извлечён.'}`, attachments: atts };
  },
});
