import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { authed, fail } from '@/lib/api';
import { dataDir } from '@/lib/db';
import { thumbOf, thumbResponse, thumbWidth } from '@/lib/thumbs';
import { createHash } from 'node:crypto';
import { outRoot, ownsToken } from '@/lib/outfiles';
import { logView, outOwner } from '@/lib/adminView';
import { previewResponse } from '@/lib/preview';


const IMG: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MIME: Record<string, string> = { '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.zip': 'application/zip',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

const decodeSafe = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export async function GET(req: Request, { params }: { params: Promise<{ token: string; name: string[] }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { token, name } = await params;
  const nav = req.headers.get('sec-fetch-mode') === 'navigate' || /text\/html/.test(req.headers.get('accept') ?? '');
  const gone = () => (nav ? new Response(null, { status: 303, headers: { Location: `/file-gone?name=${encodeURIComponent(decodeSafe(name.at(-1) ?? ''))}` } }) : fail(404, 'not found'));
  if (!/^[0-9a-f]{32}$/.test(token) || name.length !== 1) return gone();
  const fname = name[0];
  if (fname.includes('/') || fname.includes('\\') || fname.startsWith('.')) return gone();
  const sp = new URL(req.url).searchParams;
  if (!ownsToken(a.user.id, token)) {
    const owner = a.user.role === 'admin' ? outOwner(token) : null;
    if (!owner) return gone();
    if (!sp.has('page')) logView({ adminId: a.user.id, ownerId: owner, kind: 'file', target: token });
  }
  const ROOT = outRoot();
  const file = path.resolve(ROOT, token, fname);
  if (!file.startsWith(path.resolve(ROOT, token) + path.sep)) return gone();
  let st: fs.Stats;
  try { st = fs.lstatSync(file); if (!st.isFile()) throw new Error('x'); } catch { return gone(); }
  if (sp.has('preview')) return previewResponse(sp, file, fname, st);
  const ext = path.extname(fname).toLowerCase();
  const inline = ext in IMG;
  const w = inline && ext !== '.gif' ? thumbWidth(sp.get('w')) : null;
  if (w) {
    const t = await thumbOf(file, path.join(dataDir(), 'thumbs', token, `${w}-${createHash('sha1').update(fname).digest('hex').slice(0, 16)}.webp`), w);
    if (t) return thumbResponse(t, { 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
  }
  const headers = new Headers({
    'Content-Type': IMG[ext] || MIME[ext] || 'application/octet-stream',
    'Content-Length': String(st.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': inline ? 'private, max-age=604800' : 'private, max-age=0',
    Vary: 'Cookie',
  });
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers });
}
