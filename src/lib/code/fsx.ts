import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './git';

export const MAX_FILE = 2 * 1024 * 1024;
export class FsError extends Error {}

export function resolveIn(root: string, rel: string): { abs: string; rel: string } {
  if (typeof rel !== 'string' || rel.includes('\0') || rel.length > 1000) throw new FsError('Неверный путь');
  const rel0 = path.posix.normalize(rel.replace(/\\/g, '/').replace(/^\/+/, '') || '.');
  if (rel0 === '..' || rel0.startsWith('../')) throw new FsError('Путь вне репозитория');
  const clean = rel0 === '.' ? '' : rel0.replace(/\/+$/, '');
  if (clean.split('/').some((c) => c === '.git')) throw new FsError('Каталог .git недоступен');
  const abs = clean ? path.join(root, clean) : root;
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new FsError('Путь вне репозитория');
  let cur = root;
  for (const c of clean ? clean.split('/') : []) {
    cur = path.join(cur, c);
    let st: fs.Stats;
    try { st = fs.lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) throw new FsError(`${path.relative(root, cur)} — символьная ссылка: открывать её нельзя`);
  }
  return { abs, rel: clean };
}

function fdInside(fd: number, root: string): boolean {
  try {
    const real = fs.readlinkSync(`/proc/self/fd/${fd}`);
    const r = fs.realpathSync(root);
    return real === r || real.startsWith(r + path.sep);
  } catch { return false; }
}

export const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

export function readText(root: string, rel: string): string | null {
  const { abs } = resolveIn(root, rel);
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === 'ENOENT') return null;
    if (c === 'ELOOP') throw new FsError('Это символьная ссылка');
    if (c === 'EISDIR') throw new FsError('Это каталог');
    throw new FsError('Файл не открывается');
  }
  try {
    if (!fdInside(fd, root)) throw new FsError('Путь вне репозитория');
    const st = fs.fstatSync(fd);
    if (st.isDirectory()) throw new FsError('Это каталог');
    if (!st.isFile()) throw new FsError('Это не обычный файл');
    if (st.size > MAX_FILE) throw new FsError(`Файл большой (${Math.round(st.size / 1024)} КБ): читайте частями через поиск`);
    const b = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = fs.readSync(fd, b, off, st.size - off, off); if (!n) break; off += n; }
    if (isBinary(b)) throw new FsError('Двоичный файл');
    return b.subarray(0, off).toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function writeText(root: string, rel: string, content: string | null): void {
  const { abs, rel: r } = resolveIn(root, rel);
  if (!r) throw new FsError('Нужен путь файла');
  if (content === null) {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (!st.isFile() && !st.isSymbolicLink()) throw new FsError('Это не файл');
    fs.unlinkSync(abs);
    return;
  }
  if (Buffer.byteLength(content) > MAX_FILE) throw new FsError('Слишком большой файл (больше 2 МБ)');
  let cur = root;
  for (const c of r.split('/').slice(0, -1)) {
    cur = path.join(cur, c);
    try { const st = fs.lstatSync(cur); if (st.isSymbolicLink() || !st.isDirectory()) throw new FsError(`${path.relative(root, cur)} — не каталог`); }
    catch (e) { if (e instanceof FsError) throw e; fs.mkdirSync(cur); }
  }
  let fd: number;
  try { fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o644); } catch (e) {
    throw new FsError((e as NodeJS.ErrnoException).code === 'ELOOP' ? 'Это символьная ссылка' : 'Файл не открывается на запись');
  }
  try {
    if (!fdInside(fd, root)) throw new FsError('Путь вне репозитория');
    if (!fs.fstatSync(fd).isFile()) throw new FsError('Это не обычный файл');
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, content, 0, 'utf8');
  } finally { fs.closeSync(fd); }
}

export type Entry = { name: string; type: 'dir' | 'file' | 'link' | 'other'; size: number };
export function listDir(root: string, rel: string): Entry[] {
  const { abs } = resolveIn(root, rel);
  const st = fs.lstatSync(abs);
  if (!st.isDirectory()) throw new FsError('Это не каталог');
  return fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.name !== '.git').map((d) => {
    const type = d.isSymbolicLink() ? 'link' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other';
    let size = 0;
    if (type === 'file') { try { size = fs.lstatSync(path.join(abs, d.name)).size; } catch {  } }
    return { name: d.name, type, size } as Entry;
  }).sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
}

export function treeBytes(root: string): number {
  let total = 0, n = 0;
  const stack = [root];
  while (stack.length && n < 200_000) {
    const d = stack.pop()!;
    let list: fs.Dirent[];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      n++;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.lstatSync(p).blocks * 512; } catch {  } }
    }
  }
  return total;
}

export type UDiff = { diff: string; added: number; removed: number };
export async function udiff(rel: string, before: string | null, after: string | null): Promise<UDiff> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kxdiff-'));
  try {
    const a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
    fs.writeFileSync(a, before ?? ''); fs.writeFileSync(b, after ?? '');
    const r = await git(null, ['diff', '--no-index', '--no-color', '-U3', '--', before === null ? '/dev/null' : a, after === null ? '/dev/null' : b], { cwd: tmp });
    const body = r.out.split('\n');
    const at = body.findIndex((l) => l.startsWith('@@'));
    const hunks = at >= 0 ? body.slice(at).join('\n').replace(/\n$/, '') : '';
    const head = [`diff --git a/${rel} b/${rel}`, ...(before === null ? ['new file mode 100644'] : after === null ? ['deleted file mode 100644'] : []),
      `--- ${before === null ? '/dev/null' : `a/${rel}`}`, `+++ ${after === null ? '/dev/null' : `b/${rel}`}`];
    let added = 0, removed = 0;
    for (const l of hunks.split('\n')) { if (l.startsWith('+')) added++; else if (l.startsWith('-')) removed++; }
    return { diff: hunks ? `${head.join('\n')}\n${hunks}\n` : '', added, removed };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
