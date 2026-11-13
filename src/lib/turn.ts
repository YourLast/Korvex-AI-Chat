import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from './db';
import type { Message, Thread } from './db/schema';
import { getModel, isClaude, modelAllowed, systemPrompt } from './models';
import { nearestLevel } from './levels';
import { accessRoleOf, capLevel } from './levelPolicy';
import { withFiles, type ChatFile } from './chatFiles';
import { ext } from '@/ext';
import { stripMarkers } from './srcmark';
import { activePath, allMessages, sessionOfPath, setLeaf } from './tree';
import type { ChatMsg, ChatPart } from './upstream';
import { tr } from './i18n/core';
import { userLang } from './userLang';

export const MARKER = '⁠‌⁠';

export type Mode = 'send' | 'regenerate' | 'edit' | 'continue';

export type TurnInput = {
  thread: Thread;
  userId: string;
  mode: Mode;
  text?: string;
  fileIds?: string[];
  editId?: string;
  replaceFiles?: boolean;
  userMeta?: Record<string, unknown>;
  modelId: string;
  levelId: string;
  signal?: AbortSignal;
  timezone?: string;
};
export type TurnResult = { assistantId: string; content: string; error: string | null; finish: string | null; stopped: boolean; durationMs: number };

export class TurnError extends Error {
  constructor(public status: number, message: string, public code?: string, public alt?: { id: string; name: string } | null) { super(message); }
}

export type Prepared = {
  histPath: Message[];
  userMsg: Message | null;
  assistantParent: string | null;
  continueRow: Message | null;
  session: string;
  title?: string;
  fileIds: string[];
};

export function prepare(inp: TurnInput): Prepared {
  const db = getDb();
  const { thread } = inp;
  const all = allMessages(thread.id);
  const path0 = activePath(all, thread.leafId);
  const now = Date.now();
  const text = inp.text ?? '';
  let seq = (all[all.length - 1]?.seq ?? 0);

  const addFiles = (ids: string[]): string[] => {
    if (!ids.length) return [];
    const own = db.select().from(schema.files).where(and(inArray(schema.files.id, ids), eq(schema.files.userId, inp.userId))).all();
    if (own.length !== new Set(ids).size) throw new TurnError(400, 'bad files');
    const at = new Map(ids.map((id, i) => [id, i] as const));
    own.sort((x, y) => (at.get(x.id) ?? 0) - (at.get(y.id) ?? 0));
    return own.map((f) => {
      if (!f.threadId && !f.folderId) { db.update(schema.files).set({ threadId: thread.id }).where(eq(schema.files.id, f.id)).run(); return f.id; }
      if (f.threadId === thread.id) return f.id;
      const id = randomUUID();
      db.insert(schema.files).values({ ...f, id, threadId: thread.id, folderId: null }).run();
      try { fs.cpSync(path.join(dataDir(), 'files', f.id), path.join(dataDir(), 'files', id), { recursive: true }); } catch {  }
      return id;
    });
  };

  const makeUser = (parentId: string | null, session: string, ids: string[]): Message => {
    const row: Message = { id: randomUUID(), threadId: thread.id, seq: ++seq, parentId, session, role: 'user', content: text, reasoning: null, reasoningMs: null, meta: ids.length || inp.userMeta ? { ...(ids.length ? { fileIds: ids } : {}), ...(inp.userMeta ?? {}) } : null, createdAt: now };
    db.insert(schema.messages).values(row).run();
    setLeaf(thread, row.id);
    return row;
  };
  const visible = text.split(MARKER).join('').trim();

  if (inp.mode === 'send') {
    const ids = inp.fileIds ?? [];
    if (!visible && !ids.length) throw new TurnError(400, 'empty message');
    const fids = addFiles(ids);
    const u = makeUser(path0[path0.length - 1]?.id ?? null, sessionOfPath(path0, thread.id), fids);
    const first = all.length === 0;
    const title = first && thread.title === 'Новый чат' ? shortTitle(text) : undefined;
    return { histPath: [...path0, u], userMsg: u, assistantParent: u.id, continueRow: null, session: u.session!, title, fileIds: fids };
  }
  if (inp.mode === 'edit') {
    const target = all.find((m) => m.id === inp.editId && m.role === 'user');
    if (!target) throw new TurnError(404, 'message not found');
    const ids = inp.replaceFiles ? (inp.fileIds ?? []) : ((target.meta as { fileIds?: string[] } | null)?.fileIds ?? []);
    if (!visible && !ids.length) throw new TurnError(400, 'empty message');
    const parentPath = activePath(all, target.parentId);
    const session = `${thread.id}:${randomUUID().slice(0, 8)}`;
    const fids = inp.replaceFiles ? addFiles(ids) : ids.slice();
    const u = makeUser(target.parentId, session, fids);
    const title = !target.parentId && thread.title === shortTitle(target.content) ? shortTitle(text) : undefined;
    return { histPath: [...parentPath, u], userMsg: u, assistantParent: u.id, continueRow: null, session, title, fileIds: fids };
  }
  if (inp.mode === 'regenerate') {
    const last = path0[path0.length - 1];
    if (!last) throw new TurnError(400, 'nothing to regenerate');
    const u = last.role === 'assistant' ? path0[path0.length - 2] : last;
    if (!u) throw new TurnError(400, 'nothing to regenerate');
    const hp = last.role === 'assistant' ? path0.slice(0, -1) : path0;
    setLeaf(thread, u.id);
    return { histPath: hp, userMsg: u, assistantParent: u.id, continueRow: null, session: sessionOfPath(hp, thread.id), fileIds: [] };
  }
  const last = path0[path0.length - 1];
  if (!last || last.role !== 'assistant' || !last.content.trim()) throw new TurnError(400, 'nothing to continue');
  return { histPath: path0, userMsg: null, assistantParent: last.parentId, continueRow: last, session: sessionOfPath(path0, thread.id), fileIds: [] };
}

export function shortTitle(text: string): string {
  const t = (text.split(MARKER).join('') || 'Файл').replace(/\s+/g, ' ').trim();
  return t.length > 52 ? t.slice(0, 50).trimEnd() + '…' : t;
}

export function buildMessages(hist: Message[], model: NonNullable<ReturnType<typeof getModel>>, userId: string, tz?: string | null, extraSystem?: string | null, memory?: string | null): ChatMsg[] {
  const db = getDb();
  const fileIds = hist.flatMap((m) => ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []));
  const rows = fileIds.length ? db.select().from(schema.files).where(and(inArray(schema.files.id, fileIds), eq(schema.files.userId, userId))).all() : [];
  const byId = new Map(rows.map((f) => [f.id, f]));
  const order = fileIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
  const docs: ChatFile[] = order.filter((f) => !f.mime.startsWith('image/')).map((f) => ({ id: f.id, name: f.name, text: f.text }));
  let lastUser = -1;
  hist.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  const out: ChatMsg[] = [];
  hist.forEach((m, i) => {
    if (m.role === 'assistant' && !m.content.trim()) return;
    if (i !== lastUser) { out.push({ role: m.role, content: m.role === 'assistant' ? stripMarkers(m.content) : m.content }); return; }
    const ids = ((m.meta as { fileIds?: string[] } | null)?.fileIds ?? []);
    const imgs = ids.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f && f.mime.startsWith('image/'));
    let c = m.content;
    if (!c.split(MARKER).join('').trim()) c = tr(userLang(userId), imgs.length && imgs.length === ids.length ? 'srv.whatPic' : 'srv.readFile');
    c = (ext.filesInMessage ?? withFiles)(c, docs);
    if (!imgs.length) { out.push({ role: 'user', content: c }); return; }
    if (!model.images) throw new TurnError(400, 'Эта модель не принимает картинки');
    const parts: ChatPart[] = [{ type: 'text', text: c }];
    for (const f of imgs) {
      const img = readOriginal(f.id) ?? sameContentOriginal(f);
      if (!img) throw new TurnError(400, `Картинка «${f.name}» не найдена на диске`);
      parts.push({ type: 'image', image: img, mediaType: f.mime });
    }
    out.push({ role: 'user', content: parts });
  });
  const sys = [systemPrompt(model, tz), extraSystem, memory].filter((x): x is string => !!x && !!x.trim()).join('\n\n');
  if (sys) out.unshift({ role: 'system', content: sys });
  return out;
}

export function resolveLevel(modelId: string, levelId: string, userId?: string | null) {
  const model = getModel(modelId);
  if (!model) throw new TurnError(400, 'unknown model/level');
  if (model.hidden) throw new TurnError(400, 'Эта модель больше недоступна. Выберите другую.', 'model_hidden');
  if (!modelAllowed(model, accessRoleOf(userId), userId)) throw new TurnError(403, `${model.name} недоступна в вашей роли`, 'model_forbidden');
  if (isClaude(model) && userId) {
    const cap = Number(process.env.KX_CLAUDE_DAILY_USD);
    if (cap > 0) {
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      const spent = getDb().select({ s: sql<number>`coalesce(sum(${schema.jobs.costUsd}), 0)` }).from(schema.jobs).where(and(eq(schema.jobs.userId, userId), gte(schema.jobs.createdAt, day.getTime()))).get()?.s ?? 0;
      if (spent >= cap) throw new TurnError(429, `Дневной лимит ${model.name} исчерпан — попробуйте завтра.`, 'claude_daily_cap');
    }
  }
  const level = model.levels.find((l) => l.id === levelId) ?? model.levels.find((l) => l.id === nearestLevel(model, levelId));
  if (!level) throw new TurnError(400, 'unknown model/level');
  return { model, level: capLevel(model, level, userId) };
}


export function readOriginal(id: string): Buffer | null {
  try {
    const dir = path.join(dataDir(), 'files', id);
    const file = fs.readdirSync(dir).find((n) => n.startsWith('original'));
    return file ? fs.readFileSync(path.join(dir, file)) : null;
  } catch { return null; }
}

export function sameContentOriginal(f: { id: string; userId: string; sha256: string | null }): Buffer | null {
  if (!f.sha256) return null;
  const twins = getDb().select({ id: schema.files.id }).from(schema.files)
    .where(and(eq(schema.files.userId, f.userId), eq(schema.files.sha256, f.sha256))).all();
  for (const t of twins) {
    if (t.id === f.id) continue;
    const b = readOriginal(t.id);
    if (b) return b;
  }
  return null;
}
