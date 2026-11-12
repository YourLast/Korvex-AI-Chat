import { tr, type Lang } from './i18n/core';
import { canShareFile, isIOS, type Outcome } from './imageActions';

const files = new Map<string, Promise<File>>();
const ready = new Map<string, File>();

const TYPES: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', zip: 'application/zip',
};

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try { return window.matchMedia('(display-mode: standalone)').matches; } catch { return false; }
}
export const needsShare = () => isIOS() && isStandalone();

export function typeOf(name: string, given: string): string {
  if (given && given !== 'application/octet-stream') return given;
  return TYPES[(name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';
}

function fileFor(href: string, name: string): Promise<File> {
  let p = files.get(href);
  if (!p) {
    p = fetch(href, { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.blob();
      const f = new File([b], name || 'file', { type: typeOf(name, b.type) });
      ready.set(href, f);
      return f;
    });
    p.catch(() => { files.delete(href); });
    files.set(href, p);
  }
  return p;
}
export function prefetchFile(href: string, name: string) { if (needsShare()) void fileFor(href, name).catch(() => {}); }
export const _test = { reset: () => { files.clear(); ready.clear(); } };

export async function saveFile(href: string, name: string, lang: Lang = 'ru'): Promise<Outcome> {
  let f: File | null = ready.get(href) ?? null;
  if (!f) { try { f = await fileFor(href, name); } catch { f = null; } }
  if (f && canShareFile(f)) {
    try {
      await navigator.share({ files: [f], title: f.name });
      return { ok: true, note: null, kind: 'shared' };
    } catch (e) {
      const n = (e as { name?: string })?.name;
      if (n === 'AbortError') return { ok: true, note: null, kind: 'cancelled' };
      if (n === 'NotAllowedError') return { ok: false, note: tr(lang, 'work.img.again'), kind: 'retry' };
    }
  }
  window.open(href, '_blank', 'noopener');
  return { ok: true, note: null, kind: 'link' };
}
