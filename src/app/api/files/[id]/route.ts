import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { dataDir, getDb, schema } from '@/lib/db';
import { authed, fail } from '@/lib/api';
import { thumbOf, thumbResponse, thumbWidth } from '@/lib/thumbs';
import { logView } from '@/lib/adminView';
import { previewResponse } from '@/lib/preview';
import { etagMatches } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(404, 'not found');
  let f = getDb().select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, a.user.id))).get();
  if (!f && a.user.role === 'admin') {
    f = getDb().select().from(schema.files).where(eq(schema.files.id, id)).get();
    if (f && !sp.has('page')) logView({ adminId: a.user.id, ownerId: f.userId, kind: 'file', target: f.id, threadId: f.threadId });
  }
  if (!f) return fail(404, 'not found');
  const dir = path.join(dataDir(), 'files', f.id);
  let file: string | undefined;
  try { file = fs.readdirSync(dir).find((n) => n.startsWith('original')); } catch {  }
  if (!file) return fail(404, 'not found');
  if (sp.has('preview')) {
    const p = path.join(dir, file);
    let st: fs.Stats;
    try { st = fs.lstatSync(p); if (!st.isFile()) throw new Error('x'); } catch { return fail(404, 'not found'); }
    return previewResponse(sp, p, f.name, st);
  }
  const image = f.mime.startsWith('image/');
  const w = image ? thumbWidth(sp.get('w')) : null;
  if (w) {
    const t = await thumbOf(path.join(dir, file), path.join(dir, `thumb-${w}.webp`), w);
    if (t) return thumbResponse(t, { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name.replace(/\.[^.]+$/, '') + '.webp')}`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
  }
  const etag = `"${f.sha256}"`, cache = 'private, max-age=31536000, immutable';
  if (etagMatches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cache, Vary: 'Cookie' } });
  const buf = fs.readFileSync(path.join(dir, file));
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': image ? f.mime : 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': cache,
      ETag: etag,
      Vary: 'Cookie',
    },
  });
}
