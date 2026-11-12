import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from '@/lib/db';
import { authed, fail } from '@/lib/api';
import { logView } from '@/lib/adminView';
import type { FileRow } from '@/lib/db/schema';
import type { Lang } from '@/lib/i18n/core';
import { reqLang } from '@/lib/i18n/server';

export type Owned = { f: FileRow; file: string; st: fs.Stats; userId: string; lang: Lang };

export async function ownedFile(req: Request, id: string, o: { log?: boolean } = {}): Promise<{ ok: true; v: Owned } | { ok: false; res: Response }> {
  const a = await authed(req);
  if ('res' in a) return { ok: false, res: a.res };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, res: fail(404, 'not found') };
  let f = getDb().select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, a.user.id))).get();
  if (!f && a.user.role === 'admin') {
    f = getDb().select().from(schema.files).where(eq(schema.files.id, id)).get();
    if (f && o.log) logView({ adminId: a.user.id, ownerId: f.userId, kind: 'file', target: f.id, threadId: f.threadId });
  }
  if (!f) return { ok: false, res: fail(404, 'not found') };
  const dir = path.join(dataDir(), 'files', f.id);
  let name: string | undefined;
  try { name = fs.readdirSync(dir).find((n) => n.startsWith('original')); } catch {  }
  if (!name) return { ok: false, res: fail(404, 'not found') };
  const file = path.join(dir, name);
  let st: fs.Stats;
  try { st = fs.lstatSync(file); if (!st.isFile()) throw new Error('x'); } catch { return { ok: false, res: fail(404, 'not found') }; }
  return { ok: true, v: { f, file, st, userId: f.userId, lang: reqLang(req, a.user.lang) } };
}

export const VIEW_HDR = { 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } as const;
