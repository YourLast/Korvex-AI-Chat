import { ownFolder } from '@/lib/orgDocs';
import { MAX_BYTES, storeUpload } from '@/lib/storeUpload';
import fs from 'node:fs';
import path from 'node:path';
import { authed, fail, json, lateJson } from '@/lib/api';
import { sniffImage } from '@/lib/images';
import { cleanRelPath, isJunkPath, rootOf, type Origin } from '@/lib/upload/paths';
import { consumeStaged, stagedFile, sweepStaging } from '@/lib/upload/staging';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { MAX_BYTES } from '@/lib/storeUpload';

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
  const folderRaw = form.get('folder');
  const folderId = typeof folderRaw === 'string' && folderRaw ? (ownFolder(a.user.id, folderRaw)?.id ?? null) : null;
  if (typeof folderRaw === 'string' && folderRaw && !folderId) return fail(404, 'Нет такой организации');
  const w = Number(form.get('w')) || undefined, h = Number(form.get('h')) || undefined;
  const model = form.get('model');
  const modelId = typeof model === 'string' ? model.slice(0, 64) : null;
  const run = async () => {
    const r = await storeUpload({ userId: a.user.id, name, buf, mime, origin, folderId, modelId, w, h });
    if (r.status === 200 && staged) consumeStaged(staged.sid, staged.n);
    return r;
  };
  if (buf.length === 0 || buf.length > MAX_BYTES || sniffImage(buf)) { const r = await run(); return json(r.body, r.status); }
  return lateJson(run);
}
