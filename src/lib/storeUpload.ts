import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from './db';
import { ingestDocument } from './extract';
import { MAX_IMAGE_BYTES, sniffImage } from './images';
import { OK_EXT, unparsedCard } from './docext';
import { extName, type Origin } from './upload/paths';
import { docFields } from './orgDocs';
import { decodeText } from './extractNode';
import { estTokens } from './tokest';

export const MAX_BYTES = 100 * 1024 * 1024;

export type StoreIn = {
  userId: string; name: string; buf: Buffer; mime?: string; origin?: Origin;
  folderId?: string | null;
  modelId?: string | null;
  w?: number; h?: number;
  uploadId?: string | null;
  extraInfo?: Record<string, unknown>;
};
export type StoreOut = { status: number; body: Record<string, unknown> & { id?: string; error?: string; docType?: string } };

export async function storeUpload(p: StoreIn): Promise<StoreOut> {
  const { buf, name, userId } = p;
  const folderId = p.folderId ?? null;
  if (buf.length > MAX_BYTES) return { status: 413, body: { error: 'Файл больше 100 МБ' } };
  if (buf.length === 0) return { status: 422, body: { error: `Файл «${name}» пустой` } };
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const extra = p.extraInfo ?? {};
  const imageMime = sniffImage(buf);
  if (imageMime) {
    if (buf.length > MAX_IMAGE_BYTES) return { status: 413, body: { error: 'Картинка больше 12 МБ' } };
    const id = randomUUID();
    const dir = path.join(dataDir(), 'files', id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'original'), buf, { mode: 0o600 });
    const d = docFields(name, '', { format: 'image', w: p.w, h: p.h, ...(p.origin ? { origin: p.origin } : {}), ...extra });
    getDb().insert(schema.files).values({ id, userId, threadId: null, name, mime: imageMime, size: buf.length, sha256, text: '', info: d.info, createdAt: Date.now(), folderId, docType: d.docType, docDate: d.docDate, docFrom: d.docFrom, docTo: d.docTo }).run();
    return { status: 200, body: { id, name, size: buf.length, mime: imageMime, chars: 0, tokens: 0, info: d.info, docType: d.docType } };
  }
  const ext = path.extname(name).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
  const ex = await ingestDocument(buf, name, p.modelId ?? null, p.uploadId ? { uploadId: p.uploadId } : undefined);
  let text: string, info: Record<string, unknown>;
  if (ex.ok) { text = ex.text; info = ex.info; }
  else if (!OK_EXT.has(ext)) {
    text = unparsedCard(name, buf.length, extName(name));
    info = { format: 'unknown', unparsed: true, extractor: 'none' };
  } else return { status: ex.status, body: { error: ex.message } };
  if (p.origin) info = { ...info, origin: p.origin };
  const d = docFields(name, /\.(txt|csv|xml|tsv|1c)$/i.test(name) ? decodeText(buf) : text, { ...info, ...extra });
  const id = randomUUID();
  const dir = path.join(dataDir(), 'files', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'original' + safeExt), buf, { mode: 0o600 });
  getDb().insert(schema.files).values({
    id, userId, threadId: null, name, mime: p.mime || 'application/octet-stream', size: buf.length,
    sha256, text, info: d.info, createdAt: Date.now(), folderId, docType: d.docType, docDate: d.docDate, docFrom: d.docFrom, docTo: d.docTo,
  }).run();
  return { status: 200, body: { id, name, size: buf.length, chars: text.length, tokens: estTokens(text), info: d.info, docType: d.docType } };
}
