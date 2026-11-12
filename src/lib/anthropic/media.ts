import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db';
import { readOriginal, sameContentOriginal } from '../turn';

export const IMG_SIDE = 1568;
const IMG_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PDF_MAX = 30 * 1024 * 1024;
export const DOC_TEXT_MAX = 400_000;

type Sharp = (typeof import('sharp'))['default'];
let lib: Promise<Sharp | null> | null = null;
const sharp = () => (lib ??= import('sharp').then((m) => (m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp)).catch(() => null));

type F = { id: string; userId: string; sha256: string | null; mime: string; name: string; size?: number | null };

export async function claudeImage(f: F): Promise<{ media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null> {
  const dir = path.join(dataDir(), 'files', f.id);
  const cache = path.join(dir, `claude-${IMG_SIDE}.jpg`);
  try { return { media_type: 'image/jpeg', data: fs.readFileSync(cache).toString('base64') }; } catch {  }
  const orig = readOriginal(f.id) ?? sameContentOriginal(f);
  if (!orig) return null;
  const s = await sharp();
  if (s) {
    try {
      const out = await s(orig, { failOn: 'none' }).rotate().resize({ width: IMG_SIDE, height: IMG_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(cache, out, { mode: 0o600 }); } catch {  }
      return { media_type: 'image/jpeg', data: out.toString('base64') };
    } catch {  }
  }
  if (IMG_TYPES.has(f.mime) && orig.length <= 5 * 1024 * 1024) return { media_type: f.mime as 'image/jpeg', data: orig.toString('base64') };
  return null;
}

export function claudePdf(f: F): string | null {
  if (f.mime !== 'application/pdf') return null;
  const orig = readOriginal(f.id) ?? sameContentOriginal(f);
  return orig && orig.length <= PDF_MAX ? orig.toString('base64') : null;
}
