import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, schema } from './db';
import type { Folder } from './db/schema';
import { publish } from './bus';
import type { FolderView } from './types';

export const FOLDER_NAME_MAX = 80;
export const FOLDER_INSTR_MAX = 8000;
export const FOLDER_COLORS = ['', 'blue', 'violet', 'green', 'yellow', 'coral'] as const;
const colorOf = (c: unknown) => (typeof c === 'string' && (FOLDER_COLORS as readonly string[]).includes(c) ? c : '');

export function listFolders(userId: string): FolderView[] {
  const db = getDb();
  const rows = db.select().from(schema.folders).where(eq(schema.folders.userId, userId)).orderBy(asc(schema.folders.sort), asc(schema.folders.createdAt)).all();
  const counts = new Map(db.select({ f: schema.threads.folderId, n: sql<number>`count(*)` }).from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), sql`${schema.threads.folderId} IS NOT NULL`)).groupBy(schema.threads.folderId).all().map((r) => [r.f, Number(r.n)]));
  return rows.map((f) => ({ id: f.id, name: f.name, instruction: f.instruction, collapsed: !!f.collapsed, sort: f.sort, count: counts.get(f.id) ?? 0, color: f.color ?? '' }));
}

export function getFolder(userId: string, id: string): Folder | undefined {
  return getDb().select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.userId, userId))).get();
}

export function findFolderByName(userId: string, name: string): Folder | undefined {
  const n = norm(name);
  return getDb().select().from(schema.folders).where(eq(schema.folders.userId, userId)).all().find((f) => norm(f.name) === n);
}
const norm = (s: string) => s.replace(/[«»"„“”']/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

export class FolderError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function createFolder(userId: string, name: string, instruction = '', color = ''): Folder {
  const n = name.trim().slice(0, FOLDER_NAME_MAX);
  if (!n) throw new FolderError(400, 'Пустое название проекта');
  if (findFolderByName(userId, n)) throw new FolderError(409, `Проект «${n}» уже есть`);
  const db = getDb();
  const max = db.select({ s: sql<number>`coalesce(max(${schema.folders.sort}), 0)` }).from(schema.folders).where(eq(schema.folders.userId, userId)).get();
  const now = Date.now();
  const f: Folder = { id: randomUUID(), userId, name: n, instruction: instruction.slice(0, FOLDER_INSTR_MAX), collapsed: 0, sort: Number(max?.s ?? 0) + 1, createdAt: now, updatedAt: now, color: colorOf(color) };
  db.insert(schema.folders).values(f).run();
  publish(userId, { t: 'folders' });
  return f;
}

export function updateFolder(userId: string, id: string, p: { name?: string; instruction?: string; collapsed?: boolean; sort?: number; color?: string }): Folder {
  const f = getFolder(userId, id);
  if (!f) throw new FolderError(404, 'folder not found');
  const set: Partial<Folder> = { updatedAt: Date.now() };
  if (p.name !== undefined) {
    const n = p.name.trim().slice(0, FOLDER_NAME_MAX);
    if (!n) throw new FolderError(400, 'Пустое название проекта');
    const other = findFolderByName(userId, n);
    if (other && other.id !== id) throw new FolderError(409, `Проект «${n}» уже есть`);
    set.name = n;
  }
  if (p.instruction !== undefined) set.instruction = p.instruction.slice(0, FOLDER_INSTR_MAX);
  if (p.collapsed !== undefined) set.collapsed = p.collapsed ? 1 : 0;
  if (p.sort !== undefined && Number.isFinite(p.sort)) set.sort = Math.trunc(p.sort);
  if (p.color !== undefined) set.color = colorOf(p.color);
  getDb().update(schema.folders).set(set).where(and(eq(schema.folders.id, id), eq(schema.folders.userId, userId))).run();
  publish(userId, { t: 'folders' });
  return { ...f, ...set } as Folder;
}

export function deleteFolder(userId: string, id: string): void {
  const db = getDb();
  if (!getFolder(userId, id)) throw new FolderError(404, 'folder not found');
  db.transaction((tx) => {
    tx.update(schema.threads).set({ folderId: null }).where(and(eq(schema.threads.userId, userId), eq(schema.threads.folderId, id))).run();
    tx.delete(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.userId, userId))).run();
  });
  publish(userId, { t: 'folders' });
}

export function moveThreads(userId: string, ids: string[], folderId: string | null): string[] {
  const db = getDb();
  if (folderId && !getFolder(userId, folderId)) throw new FolderError(404, 'folder not found');
  const uniq = [...new Set(ids)].slice(0, 500);
  if (!uniq.length) return [];
  const rows = db.select({ id: schema.threads.id }).from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), or(inArray(schema.threads.id, uniq), inArray(schema.threads.groupId, uniq)))).all();
  if (!rows.length) return [];
  const moved = rows.map((r) => r.id);
  db.update(schema.threads).set({ folderId }).where(and(eq(schema.threads.userId, userId), inArray(schema.threads.id, moved))).run();
  publish(userId, { t: 'folders' });
  return moved;
}
