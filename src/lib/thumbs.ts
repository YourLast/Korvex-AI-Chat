import fs from 'node:fs';
import path from 'node:path';

export const THUMB_W = [160, 480, 960, 1440] as const;
export function thumbWidth(v: string | null): number | null {
  const n = Number(v);
  return (THUMB_W as readonly number[]).includes(n) ? n : null;
}

type Sharp = (typeof import('sharp'))['default'];
let lib: Promise<Sharp | null> | null = null;
const sharp = () => (lib ??= import('sharp').then((m) => (m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp)).catch(() => null));

const inflight = new Map<string, Promise<Buffer | null>>();

export function thumbOf(src: string, cacheFile: string, w: number): Promise<Buffer | null> {
  try { return Promise.resolve(fs.readFileSync(cacheFile)); } catch {  }
  const fly = inflight.get(cacheFile);
  if (fly) return fly;
  const p = (async () => {
    const s = await sharp();
    if (!s) return null;
    try {
      const st = fs.statSync(src);
      const img = s(src, { failOn: 'none', limitInputPixels: 64e6 });
      const meta = await img.metadata();
      if ((meta.pages ?? 1) > 1) return null;
      if ((meta.width ?? 0) <= w && st.size <= 160 * 1024) return null;
      const buf = await img.rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 3 }).toBuffer();
      if (buf.length >= st.size) return null;
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
      fs.renameSync(tmp, cacheFile);
      return buf;
    } catch { return null; }
  })().finally(() => inflight.delete(cacheFile));
  inflight.set(cacheFile, p);
  return p;
}

export function thumbResponse(buf: Buffer, extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': 'image/webp', 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=31536000, immutable', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}
