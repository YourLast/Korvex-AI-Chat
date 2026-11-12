import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authed, fail, lateJson } from '@/lib/api';
import { archiveKind, cleanRelPath } from '@/lib/upload/paths';
import { extractArchive, skipSummary } from '@/lib/upload/archive';
import { createStage, dropStage, sweepStaging, writeManifest } from '@/lib/upload/staging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PER_USER = 2, TOTAL = 4;
const busy = new Map<string, number>();

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  let name = '';
  try { name = decodeURIComponent(req.headers.get('x-filename') ?? ''); } catch {  }
  name = path.basename(name.replace(/\\/g, '/')).slice(0, 200);
  let prefix = '';
  try { const px = decodeURIComponent(req.headers.get('x-prefix') ?? ''); const c = px ? cleanRelPath(px) : null; if (c?.ok) prefix = c.path; } catch {  }
  const kind = archiveKind(name);
  if (!kind) return fail(415, 'Это не архив: поддерживаются .zip, .7z, .tar, .tar.gz');
  if (!req.body) return fail(400, 'Нет файла');
  const declared = Number(req.headers.get('content-length')) || 0;
  if (declared > MAX_ARCHIVE_BYTES) return fail(413, 'Архив больше 1 ГБ');
  const mine = busy.get(a.user.id) ?? 0, all = [...busy.values()].reduce((x, y) => x + y, 0);
  if (mine >= PER_USER || all >= TOTAL) return fail(429, 'Сейчас распаковываются другие архивы: подождите минуту');
  busy.set(a.user.id, mine + 1);
  const release = () => { const n = (busy.get(a.user.id) ?? 1) - 1; if (n <= 0) busy.delete(a.user.id); else busy.set(a.user.id, n); };
  sweepStaging();
  const { sid, dir } = createStage();
  const arc = path.join(dir, 'archive.bin');
  try {
    let n = 0;
    const cap = new Transform({ transform(c: Buffer, _e, cb) { n += c.length; cb(n > MAX_ARCHIVE_BYTES ? new Error('too-big') : null, c); } });
    await pipeline(Readable.fromWeb(req.body as never), cap, fs.createWriteStream(arc, { mode: 0o600 }));
  } catch (e) {
    dropStage(sid); release();
    return (e as Error).message === 'too-big' ? fail(413, 'Архив больше 1 ГБ') : fail(400, 'Архив не дозагрузился');
  }
  const userId = a.user.id;
  return lateJson(async () => {
    try {
      const r = await extractArchive(arc, name, path.join(dir, 'f'), {}, prefix);
      fs.rmSync(arc, { force: true });
      if (!r.ok) {
        dropStage(sid);
        const status = r.error === 'unsupported' ? 415 : r.error === 'too-big' ? 413 : 422;
        return { status, body: { error: r.message } };
      }
      const entries = r.entries.map((e) => ({ n: parseInt(path.basename(e.file), 10), path: e.path, size: e.size, sha256: e.sha256 }));
      writeManifest({ sid, userId, createdAt: Date.now(), archive: name, entries, skipped: r.skipped, left: entries.map((e) => e.n) });
      const sum = skipSummary(r.skipped);
      return { status: 200, body: { sid, archive: name, entries: entries.map(({ n, path: p, size }) => ({ n, path: p, size })), bytes: r.totalBytes, skipped: { total: sum.total, text: sum.text, byReason: sum.byReason, items: r.skipped.slice(0, 40) } } };
    } catch (e) {
      dropStage(sid);
      return { status: 422, body: { error: `Архив не распакован: ${(e as Error).message.slice(0, 160)}` } };
    } finally { release(); }
  });
}
