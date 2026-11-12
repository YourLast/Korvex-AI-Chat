
export const MAX_PATH_CHARS = 240;

export const markerName = (p: string) => p.replace(/[|\]]/g, '_');
const MAX_SEG = 120;

const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.localized', '.directory']);
const JUNK_DIRS = new Set(['__macosx', '.git', '.svn', '.hg', '.idea', '.vscode', '$recycle.bin', 'system volume information']);

export function isJunkPath(p: string): boolean {
  const segs = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!segs.length) return true;
  for (const d of segs.slice(0, -1)) if (JUNK_DIRS.has(d.toLowerCase())) return true;
  const base = segs[segs.length - 1];
  const low = base.toLowerCase();
  if (JUNK_NAMES.has(low) || JUNK_DIRS.has(low)) return true;
  if (base.startsWith('~$')) return true;
  if (base.startsWith('._')) return true;
  if (/^\.~lock\..*#$/.test(base)) return true;
  return false;
}

export type CleanPath = { ok: true; path: string } | { ok: false; reason: 'empty' | 'traversal' | 'absolute' };

export function cleanRelPath(raw: string): CleanPath {
  let s = String(raw ?? '').replace(/\\/g, '/').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '');
  if (/^\/|^[A-Za-z]:(\/|$)/.test(s)) return { ok: false, reason: 'absolute' };
  const segs: string[] = [];
  for (const part of s.split('/')) {
    const seg = part.trim();
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return { ok: false, reason: 'traversal' };
    const clean = markerName(seg);
    segs.push(clean.length > MAX_SEG ? cutName(clean, MAX_SEG) : clean);
  }
  if (!segs.length) return { ok: false, reason: 'empty' };
  let out = segs.join('/');
  while (out.length > MAX_PATH_CHARS && segs.length > 1) { segs.shift(); out = segs.join('/'); }
  if (out.length > MAX_PATH_CHARS) out = cutName(out, MAX_PATH_CHARS);
  return { ok: true, path: out };
}

function cutName(name: string, n: number): string {
  const m = /(\.[A-Za-z0-9]{1,8})$/.exec(name);
  const ext = m ? m[1] : '';
  return Array.from(name.slice(0, name.length - ext.length)).slice(0, Math.max(1, n - ext.length - 1)).join('') + '…' + ext;
}

export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const extName = (p: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(baseName(p))?.[1] ?? '').toLowerCase();

export type ArchiveKind = 'zip' | '7z' | 'tar' | 'tgz';
export function archiveKind(name: string): ArchiveKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.zip')) return 'zip';
  if (n.endsWith('.7z')) return '7z';
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'tgz';
  if (n.endsWith('.tar')) return 'tar';
  return null;
}
export const archiveStem = (name: string) => baseName(name).replace(/\.(tar\.gz|tgz|tar|zip|7z)$/i, '') || 'архив';

export const rootOf = (p: string): string | null => (p.includes('/') ? p.slice(0, p.indexOf('/')) : null);

export type Origin = { kind: 'folder' | 'zip'; root: string; archive?: string };

export type FolderGroup<T> = { root: string; kind: 'folder' | 'zip'; items: T[]; types: number; bytes: number };
export function groupByFolder<T extends { name: string; size?: number; info?: Record<string, unknown> | null }>(files: T[]): { groups: FolderGroup<T>[]; rest: T[] } {
  const by = new Map<string, T[]>();
  for (const f of files) {
    const r = rootOf(f.name);
    if (r === null) continue;
    (by.get(r) ?? by.set(r, []).get(r)!).push(f);
  }
  const groups: FolderGroup<T>[] = [];
  const taken = new Set<T>();
  for (const [root, items] of by) {
    if (items.length < 2) continue;
    items.forEach((x) => taken.add(x));
    const o = items.find((x) => (x.info as { origin?: Origin } | null | undefined)?.origin)?.info as { origin?: Origin } | undefined;
    groups.push({ root, kind: o?.origin?.kind === 'zip' ? 'zip' : 'folder', items, types: new Set(items.map((x) => extName(x.name) || '·')).size, bytes: items.reduce((s, x) => s + (x.size ?? 0), 0) });
  }
  return { groups, rest: files.filter((f) => !taken.has(f)) };
}
