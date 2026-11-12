import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db';

const g = globalThis as unknown as { __kxSecretKey?: { file: string; key: Buffer } };

export function keyFile(): string {
  return process.env.KORVEX_SECRET_KEY_FILE || path.join(dataDir(), 'keys', 'korvex.key');
}

function key(): Buffer {
  const file = keyFile();
  if (g.__kxSecretKey?.file === file) return g.__kxSecretKey.key;
  let k: Buffer;
  try {
    k = Buffer.from(fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8').trim(), 'base64');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ключ шифрования не читается');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    k = randomBytes(32);
    fs.writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  }
  if (k.length !== 32) throw new Error('ключ шифрования повреждён');
  g.__kxSecretKey = { file, key: k };
  return k;
}

export function seal(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function open(sealed: string, aad: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('токен повреждён');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new Error('токен не расшифровывается (сменили ключ?) — подключите GitHub заново');
  }
}

export function _resetKey() { delete g.__kxSecretKey; }
