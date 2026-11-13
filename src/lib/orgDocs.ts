import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from './db';
import type { FileRow } from './db/schema';
import { classifyDoc, inPeriod, type DocInfo, type DocType, DOC_TYPES } from './docType';

export type OrgDoc = {
  id: string; name: string; size: number; mime: string; type: DocType; date: string | null; from: string | null; to: string | null;
  number: string | null; sum: number | null; inn: string[]; library: boolean; threadId: string | null; createdAt: number;
};

export function docFields(name: string, text: string, info: Record<string, unknown> | null | undefined) {
  const d: DocInfo = classifyDoc(name, text);
  return {
    docType: d.type, docDate: d.date, docFrom: d.from, docTo: d.to,
    info: { ...(info ?? {}), doc: { number: d.number, inn: d.inn, sum: d.sum } } as Record<string, unknown>,
  };
}

export function ownFolder(userId: string, id: string | null | undefined) {
  if (!id) return null;
  return getDb().select().from(schema.folders).where(and(eq(schema.folders.id, id), eq(schema.folders.userId, userId))).get() ?? null;
}

const view = (f: FileRow): OrgDoc => {
  const doc = ((f.info as { doc?: { number?: string | null; inn?: string[]; sum?: number | null } } | null)?.doc) ?? {};
  return {
    id: f.id, name: f.name, size: f.size, mime: f.mime, type: (DOC_TYPES as readonly string[]).includes(f.docType ?? '') ? (f.docType as DocType) : 'other',
    date: f.docDate, from: f.docFrom, to: f.docTo, number: doc.number ?? null, sum: doc.sum ?? null, inn: doc.inn ?? [],
    library: !f.threadId && !!f.folderId, threadId: f.threadId, createdAt: f.createdAt,
  };
};

export type DocFilter = { type?: DocType | null; from?: string | null; to?: string | null; q?: string | null };

export function listOrgDocs(userId: string, folderId: string | null, f: DocFilter = {}): OrgDoc[] {
  const db = getDb();
  let rows: FileRow[];
  if (folderId) {
    const tids = db.select({ id: schema.threads.id }).from(schema.threads).where(and(eq(schema.threads.userId, userId), eq(schema.threads.folderId, folderId))).all().map((t) => t.id);
    rows = db.select().from(schema.files).where(and(eq(schema.files.userId, userId), or(
      and(eq(schema.files.folderId, folderId), isNull(schema.files.threadId)),
      ...(tids.length ? [inArray(schema.files.threadId, tids)] : []),
    ))).all();
  } else {
    rows = db.select().from(schema.files).where(eq(schema.files.userId, userId)).all().filter((x) => x.threadId || x.folderId);
  }
  for (const r of rows) {
    if (r.docType) continue;
    const d = docFields(r.name, r.text ?? '', r.info);
    db.update(schema.files).set(d).where(eq(schema.files.id, r.id)).run();
    Object.assign(r, d);
  }
  const seen = new Map<string, FileRow>();
  for (const r of rows.sort((a, b) => Number(!!a.threadId) - Number(!!b.threadId) || a.createdAt - b.createdAt)) if (!seen.has(r.sha256)) seen.set(r.sha256, r);
  const q = (f.q ?? '').trim().toLowerCase();
  return [...seen.values()].map(view)
    .filter((d) => (!f.type || d.type === f.type) && inPeriod(d, f.from, f.to) && (!q || d.name.toLowerCase().includes(q) || (d.number ?? '').toLowerCase() === q || d.inn.includes(q)))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt - a.createdAt);
}

export function countByType(docs: OrgDoc[]): Record<DocType, number> {
  const out = Object.fromEntries(DOC_TYPES.map((t) => [t, 0])) as Record<DocType, number>;
  for (const d of docs) out[d.type]++;
  return out;
}

export function removeLibraryDoc(userId: string, id: string): boolean {
  const db = getDb();
  const f = db.select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, userId))).get();
  if (!f || f.threadId || !f.folderId) return false;
  db.delete(schema.files).where(eq(schema.files.id, id)).run();
  try { fs.rmSync(path.join(dataDir(), 'files', id), { recursive: true, force: true }); } catch {  }
  return true;
}
