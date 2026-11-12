import fs from 'node:fs';
import { Readable } from 'node:stream';
import { json } from '@/lib/api';
import { ownedFile, VIEW_HDR } from '@/lib/fileAccess';
import { pdfCopyOf } from '@/lib/pdfcopy';
import { viewKind } from '@/lib/viewKind';
import { etagMatches } from '@/lib/etag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function streamPdf(req: Request, file: string, size: number, name: string, etag: string, cache: string): Response {
  const base = { ...VIEW_HDR, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name.replace(/\.[^.]+$/, '') + '.pdf')}`, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ETag: etag };
  if (etagMatches(req.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers: { 'Cache-Control': cache, ETag: etag, Vary: 'Cookie' } });
  const ifRange = req.headers.get('if-range');
  const m = ifRange && ifRange !== etag ? null : /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (m && (m[1] || m[2])) {
    let a = m[1] ? Number(m[1]) : size - Number(m[2]);
    let b = m[1] && m[2] ? Number(m[2]) : size - 1;
    a = Math.max(0, a); b = Math.min(size - 1, b);
    if (a > b) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start: a, end: b })) as ReadableStream, { status: 206, headers: { ...base, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...base, 'Content-Length': String(size) } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await ownedFile(req, id);
  if (!o.ok) return o.res;
  const { f, file, st } = o.v;
  const kind = viewKind(f.name);
  if (kind === 'pdf') return streamPdf(req, file, st.size, f.name, `"${f.sha256}"`, 'private, max-age=31536000, immutable');
  if (kind !== 'convert') return json({ state: 'error', code: 'unsupported' }, 415);
  const wait = Math.min(25_000, Math.max(0, Number(new URL(req.url).searchParams.get('wait') ?? 15_000) || 0));
  const r = await pdfCopyOf(file, st, f.name, { waitMs: wait });
  if (r.state === 'pending') return json({ state: 'pending' }, 202);
  if (r.state === 'error') return json({ state: 'error', code: r.code }, 422);
  return streamPdf(req, r.path, fs.statSync(r.path).size, f.name, `"${f.sha256}-pdf"`, 'private, max-age=3600');
}
