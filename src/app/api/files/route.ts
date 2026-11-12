import { estTokens } from '@/lib/tokest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from '@/lib/db';
import { authed, fail, json, lateJson } from '@/lib/api';
import { ingestDocument } from '@/lib/extract';
import { MAX_IMAGE_BYTES, sniffImage } from '@/lib/images';
import { OK_EXT, unparsedCard } from '@/lib/docext';
import { cleanRelPath, extName, isJunkPath, rootOf, type Origin } from '@/lib/upload/paths';
import { consumeStaged, stagedFile, sweepStaging } from '@/lib/upload/staging';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('files', a.user.id)) return fail(403, FEATURE_OFF);
  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, 'Нет файла');
  const stagedSid = form.get('staged');
  const stagedN = Number(form.get('n'));
  let buf: Buffer;
  let name: string;
  let mime = 'application/octet-stream';
  let origin: Origin | undefined;
  let staged: { sid: string; n: number } | null = null;
  if (typeof stagedSid === 'string' && stagedSid) {
    sweepStaging();
    const s = stagedFile(a.user.id, stagedSid, stagedN);
    if (!s) return fail(404, 'Файл из архива не найден (возможно, он уже загружен)');
    buf = fs.readFileSync(s.file);
    name = s.entry.path;
    const root = rootOf(name);
    origin = { kind: 'zip', root: root ?? s.archive, archive: s.archive };
    staged = { sid: stagedSid, n: stagedN };
  } else {
    const f = form.get('file');
    if (!(f instanceof File)) return fail(400, 'Нет файла');
    if (f.size > MAX_BYTES) return fail(413, 'Файл больше 100 МБ');
    const rel = form.get('path');
    const c = typeof rel === 'string' && rel ? cleanRelPath(rel) : null;
    name = c?.ok ? c.path : path.basename(f.name.replace(/\\/g, '/')).slice(0, 200) || 'document';
    if (c?.ok && c.path.includes('/')) origin = { kind: 'folder', root: rootOf(c.path)! };
    if (c?.ok && isJunkPath(c.path)) return fail(415, 'Служебный файл не загружается');
    mime = f.type || mime;
    buf = Buffer.from(await f.arrayBuffer());
  }
  if (buf.length > MAX_BYTES) return fail(413, 'Файл больше 100 МБ');
  if (buf.length === 0) return fail(422, `Файл «${name}» пустой`);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const imageMime = sniffImage(buf);
  if (imageMime) {
    if (buf.length > MAX_IMAGE_BYTES) return fail(413, 'Картинка больше 12 МБ');
    const id = randomUUID();
    const dir = path.join(dataDir(), 'files', id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'original'), buf, { mode: 0o600 });
    const w = Number(form.get('w')) || undefined, h = Number(form.get('h')) || undefined;
    const info = { format: 'image', w, h, ...(origin ? { origin } : {}) };
    getDb().insert(schema.files).values({ id, userId: a.user.id, threadId: null, name, mime: imageMime, size: buf.length, sha256, text: '', info, createdAt: Date.now() }).run();
    if (staged) consumeStaged(staged.sid, staged.n);
    return json({ id, name, size: buf.length, mime: imageMime, chars: 0, tokens: 0, info });
  }
  const ext = path.extname(name).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
  const model = form.get('model');
  const modelId = typeof model === 'string' ? model.slice(0, 64) : null;
  return lateJson(async () => {
    const ex = await ingestDocument(buf, name, modelId);
    let text: string, info: Record<string, unknown>;
    if (ex.ok) { text = ex.text; info = ex.info; }
    else if (!OK_EXT.has(ext)) {
      text = unparsedCard(name, buf.length, extName(name));
      info = { format: 'unknown', unparsed: true, extractor: 'none' };
    } else return { status: ex.status, body: { error: ex.message } };
    if (origin) info = { ...info, origin };
    const id = randomUUID();
    const dir = path.join(dataDir(), 'files', id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'original' + safeExt), buf, { mode: 0o600 });
    getDb().insert(schema.files).values({
      id, userId: a.user.id, threadId: null, name, mime, size: buf.length,
      sha256, text, info, createdAt: Date.now(),
    }).run();
    if (staged) consumeStaged(staged.sid, staged.n);
    return { status: 200, body: { id, name, size: buf.length, chars: text.length, tokens: estTokens(text), info } };
  });
}
