
import { tr, type Lang } from './i18n/core';

export type Img = { src: string; name: string };
export type Outcome = { ok: boolean; note: string | null; kind: 'shared' | 'cancelled' | 'downloaded' | 'copied' | 'link' | 'failed' | 'retry' };

const files = new Map<string, Promise<File>>();
const ready = new Map<string, File>();

export function fileName(name: string, type: string): string {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[type] ?? 'png';
  const base = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  if (!base) return `image.${ext}`;
  return /\.[A-Za-z0-9]{2,5}$/.test(base) ? base : `${base}.${ext}`;
}

export function fileOf(img: Img): Promise<File> {
  let p = files.get(img.src);
  if (!p) {
    p = fetch(img.src, { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.blob();
      const type = b.type || 'image/png';
      const f = new File([b], fileName(img.name, type), { type });
      ready.set(img.src, f);
      return f;
    });
    p.catch(() => { files.delete(img.src); });
    files.set(img.src, p);
  }
  return p;
}
export function prefetch(img: Img) { void fileOf(img).catch(() => {}); }
export const _test = { reset: () => { files.clear(); ready.clear(); } };

type Nav = Navigator & { canShare?: (d: ShareData) => boolean };
const nav = () => (typeof navigator === 'undefined' ? null : (navigator as Nav));

export function isIOS(): boolean {
  const n = nav();
  if (!n) return false;
  return /iPad|iPhone|iPod/.test(n.userAgent) || (n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1);
}
export function canShareFile(f: File | null): boolean {
  const n = nav();
  if (!f || !n?.share || !n.canShare) return false;
  try { return n.canShare({ files: [f] }); } catch { return false; }
}
export function canCopyImage(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { ClipboardItem?: unknown }).ClipboardItem === 'function' && !!nav()?.clipboard?.write;
}
const abs = (src: string) => (src.startsWith('data:') ? src : new URL(src, window.location.href).href);
const aborted = (e: unknown) => (e as { name?: string })?.name === 'AbortError';
const notAllowed = (e: unknown) => (e as { name?: string })?.name === 'NotAllowedError';

async function shareFile(img: Img, f: File, lang: Lang): Promise<Outcome> {
  try {
    await nav()!.share({ files: [f], title: f.name });
    return { ok: true, note: null, kind: 'shared' };
  } catch (e) {
    if (aborted(e)) return { ok: true, note: null, kind: 'cancelled' };
    if (notAllowed(e)) return { ok: false, note: tr(lang, 'work.img.again'), kind: 'retry' };
    return { ok: false, note: tr(lang, 'work.img.shareFail'), kind: 'failed' };
  }
}

async function getFile(img: Img): Promise<File | null> {
  const f = ready.get(img.src);
  if (f) return f;
  try { return await fileOf(img); } catch { return null; }
}

export async function shareImage(img: Img, lang: Lang = 'ru'): Promise<Outcome> {
  const n = nav();
  const f = await getFile(img);
  if (f && canShareFile(f)) return shareFile(img, f, lang);
  if (!img.src.startsWith('data:') && n?.share) {
    try { await n.share({ title: img.name, url: abs(img.src) }); return { ok: true, note: null, kind: 'link' }; }
    catch (e) { if (aborted(e)) return { ok: true, note: null, kind: 'cancelled' }; }
  }
  if (!img.src.startsWith('data:') && n?.clipboard?.writeText) {
    try { await n.clipboard.writeText(abs(img.src)); return { ok: true, note: tr(lang, 'work.img.linkCopied'), kind: 'link' }; } catch {  }
  }
  return { ok: false, note: tr(lang, f ? 'work.img.noShare' : 'work.img.noFile'), kind: 'failed' };
}

export async function saveImage(img: Img, lang: Lang = 'ru'): Promise<Outcome> {
  const f = await getFile(img);
  if (!f) return { ok: false, note: tr(lang, 'work.img.noFileRetry'), kind: 'failed' };
  if (isIOS() && canShareFile(f)) return shareFile(img, f, lang);
  try {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, note: tr(lang, isIOS() ? 'work.img.toSafari' : 'work.img.started', { name: f.name }), kind: 'downloaded' };
  } catch {
    return { ok: false, note: tr(lang, 'work.img.saveFail'), kind: 'failed' };
  }
}

async function asPng(f: Blob): Promise<Blob> {
  if (f.type === 'image/png') return f;
  const bmp = await createImageBitmap(f);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

export async function copyImage(img: Img, lang: Lang = 'ru'): Promise<Outcome> {
  if (!canCopyImage()) return { ok: false, note: tr(lang, 'work.img.noCopy'), kind: 'failed' };
  try {
    const CI = (window as unknown as { ClipboardItem: new (d: Record<string, Promise<Blob> | Blob>) => ClipboardItem }).ClipboardItem;
    const png = getFile(img).then((f) => { if (!f) throw new Error('нет файла'); return asPng(f); });
    await nav()!.clipboard.write([new CI({ 'image/png': png })]);
    return { ok: true, note: tr(lang, 'work.img.copied'), kind: 'copied' };
  } catch {
    return { ok: false, note: tr(lang, 'work.img.copyFail'), kind: 'failed' };
  }
}
