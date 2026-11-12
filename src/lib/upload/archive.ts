import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import yauzl from 'yauzl';
import { archiveKind, archiveStem, cleanRelPath, isJunkPath, type ArchiveKind } from './paths';
import { decodeZipName } from './zipnames';

export const LIMITS = {
  maxFiles: 2000,
  maxTotalBytes: 2 * 1024 ** 3,
  maxFileBytes: 100 * 1024 ** 2,
  entryRatio: 150,
  entryRatioFrom: 8 * 1024 ** 2,
  totalRatio: 120,
  totalRatioFrom: 256 * 1024 ** 2,
  maxScan: 50_000,
  maxDepth: 1,
};
export type Limits = typeof LIMITS;

export type SkipReason = 'junk' | 'empty' | 'traversal' | 'absolute' | 'link' | 'device' | 'encrypted' | 'too-big' | 'bomb' | 'limit-files' | 'limit-total' | 'duplicate' | 'error';
export type Skipped = { path: string; reason: SkipReason };
export type Entry = { path: string; size: number; file: string; sha256: string };
export type ExtractOk = { ok: true; entries: Entry[]; skipped: Skipped[]; totalBytes: number; names: Record<string, number> };
export type ExtractErr = { ok: false; error: 'bomb' | 'corrupt' | 'unsupported' | 'encrypted' | 'too-big'; message: string };
export type ExtractResult = ExtractOk | ExtractErr;

type State = { opts: Limits; entries: Entry[]; skipped: Skipped[]; total: number; seen: Set<string>; n: number; dest: string; names: Record<string, number>; scanned: number; abort: ExtractErr | null };

const newState = (dest: string, opts: Limits): State => ({ opts, entries: [], skipped: [], total: 0, seen: new Set(), n: 0, dest, names: {}, scanned: 0, abort: null });

export const REASON_TEXT: Record<SkipReason, string> = {
  junk: 'служебные файлы', empty: 'пустые файлы', traversal: 'небезопасный путь', absolute: 'небезопасный путь', link: 'ссылки', device: 'устройства', encrypted: 'защищены паролем',
  'too-big': 'файл больше 100 МБ', bomb: 'подозрительно сильное сжатие', 'limit-files': 'больше 2000 файлов', 'limit-total': 'больше 2 ГБ в архиве', duplicate: 'дубли (то же содержимое)', error: 'не удалось распаковать',
};

function mkErr(code: string): Error { return Object.assign(new Error(code), { code }); }

async function sink(st: State, src: Readable): Promise<{ file: string; size: number; sha256: string }> {
  const file = path.join(st.dest, String(++st.n).padStart(6, '0'));
  const h = createHash('sha256');
  let size = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > st.opts.maxFileBytes) { cb(mkErr('KX_TOO_BIG')); return; }
      if (st.total + size > st.opts.maxTotalBytes) { cb(mkErr('KX_TOTAL')); return; }
      h.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(src, guard, fs.createWriteStream(file, { mode: 0o600, flags: 'wx' }));
  } catch (e) {
    try { fs.rmSync(file, { force: true }); } catch {  }
    throw e;
  }
  return { file, size, sha256: h.digest('hex') };
}

function accept(st: State, p: string, got: { file: string; size: number; sha256: string }) {
  const drop = (reason: SkipReason) => { try { fs.rmSync(got.file, { force: true }); } catch {  } st.skipped.push({ path: p, reason }); };
  if (got.size === 0) return drop('empty');
  const key = `${got.size}:${got.sha256}`;
  if (st.seen.has(key)) return drop('duplicate');
  st.seen.add(key);
  st.total += got.size;
  st.entries.push({ path: p, size: got.size, file: got.file, sha256: got.sha256 });
}

function pathVerdict(st: State, raw: string): { path: string } | { reason: SkipReason } {
  const c = cleanRelPath(raw);
  if (!c.ok) return { reason: c.reason === 'empty' ? 'junk' : c.reason };
  if (isJunkPath(c.path)) return { reason: 'junk' };
  if (st.entries.length >= st.opts.maxFiles) return { reason: 'limit-files' };
  return { path: c.path };
}

async function readZip(file: string, st: State, archiveBytes: number, prefix: string): Promise<void> {
  const zf = await new Promise<yauzl.ZipFile>((res, rej) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true, strictFileNames: false, autoClose: true }, (e, z) => (e || !z ? rej(e ?? new Error('zip')) : res(z)));
  });
  await new Promise<void>((resolve, reject) => {
    zf.on('error', reject);
    zf.on('end', () => resolve());
    zf.on('close', () => resolve());
    const next = () => { if (st.abort) { zf.close(); resolve(); return; } zf.readEntry(); };
    zf.on('entry', (e: yauzl.Entry) => {
      void (async () => {
        try {
          if (++st.scanned > st.opts.maxScan) { st.skipped.push({ path: '…', reason: 'limit-files' }); zf.close(); resolve(); return; }
          const raw = e.fileName as unknown as Buffer;
          const dec = decodeZipName(raw, (e.generalPurposeBitFlag & 0x800) !== 0);
          st.names[dec.enc] = (st.names[dec.enc] ?? 0) + 1;
          const name = dec.name;
          if (name.endsWith('/') || name.endsWith('\\')) return next();
          const mode = (e.versionMadeBy >>> 8) === 3 ? (e.externalFileAttributes >>> 16) & 0xffff : 0;
          const fmt = mode & 0o170000;
          if (fmt === 0o120000) { st.skipped.push({ path: name, reason: 'link' }); return next(); }
          if (fmt !== 0 && fmt !== 0o100000) { st.skipped.push({ path: name, reason: 'device' }); return next(); }
          const v = pathVerdict(st, prefix + name);
          if ('reason' in v) { st.skipped.push({ path: name, reason: v.reason }); return next(); }
          if (e.isEncrypted()) { st.skipped.push({ path: v.path, reason: 'encrypted' }); return next(); }
          if (e.uncompressedSize > st.opts.maxFileBytes) { st.skipped.push({ path: v.path, reason: 'too-big' }); return next(); }
          if (e.uncompressedSize >= st.opts.entryRatioFrom && e.uncompressedSize / Math.max(1, e.compressedSize) > st.opts.entryRatio) { st.skipped.push({ path: v.path, reason: 'bomb' }); return next(); }
          if (st.total + e.uncompressedSize > st.opts.maxTotalBytes) { st.skipped.push({ path: v.path, reason: 'limit-total' }); return next(); }
          if (e.uncompressedSize === 0) { st.skipped.push({ path: v.path, reason: 'empty' }); return next(); }
          const rs = await new Promise<Readable>((res, rej) => zf.openReadStream(e, (err, s) => (err || !s ? rej(err ?? new Error('zip')) : res(s))));
          try {
            const got = await sink(st, rs);
            accept(st, v.path, got);
            if (st.total >= st.opts.totalRatioFrom && st.total / Math.max(1, archiveBytes) > st.opts.totalRatio) {
              st.abort = { ok: false, error: 'bomb', message: 'Архив раздувается слишком сильно: похоже на «бомбу», не распаковываю' };
            }
          } catch (err) {
            const c = (err as { code?: string }).code;
            if (c === 'KX_TOO_BIG') st.skipped.push({ path: v.path, reason: 'too-big' });
            else if (c === 'KX_TOTAL') st.skipped.push({ path: v.path, reason: 'limit-total' });
            else st.skipped.push({ path: v.path, reason: /size|crc|inflate|data|bytes|stream/i.test((err as Error).message) ? 'bomb' : 'error' });
          }
          next();
        } catch (err) { reject(err); }
      })();
    });
    zf.readEntry();
  });
}

class ByteReader {
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  private it: AsyncIterator<Buffer>;
  consumed = 0;
  constructor(s: AsyncIterable<Buffer>) { this.it = s[Symbol.asyncIterator](); }
  private async fill(n: number): Promise<void> {
    while (this.buf.length < n && !this.done) {
      const r = await this.it.next();
      if (r.done) { this.done = true; break; }
      this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : r.value;
    }
  }
  async read(n: number): Promise<Buffer | null> {
    await this.fill(n);
    if (this.buf.length < n) return null;
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); this.consumed += n;
    return out;
  }
  async stream(n: number, cb: (b: Buffer) => void): Promise<boolean> {
    let left = n;
    while (left > 0) {
      if (!this.buf.length) await this.fill(1);
      if (!this.buf.length) return false;
      const take = Math.min(left, this.buf.length);
      cb(this.buf.subarray(0, take));
      this.buf = this.buf.subarray(take); left -= take; this.consumed += take;
    }
    return true;
  }
  async skip(n: number): Promise<boolean> { return this.stream(n, () => {}); }
}

const octal = (b: Buffer): number => {
  if (b[0] & 0x80) {
    let v = b[0] & 0x7f;
    for (let i = 1; i < b.length; i++) v = v * 256 + b[i];
    return v;
  }
  const s = b.toString('latin1').replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
};
const cstr = (b: Buffer) => { const i = b.indexOf(0); return b.subarray(0, i < 0 ? b.length : i); };

function parsePax(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp < 0) break;
    const len = parseInt(buf.subarray(i, sp).toString('latin1'), 10);
    if (!(len > 0) || i + len > buf.length) break;
    const rec = buf.subarray(sp + 1, i + len - 1);
    const eq = rec.indexOf(0x3d);
    if (eq > 0) out[rec.subarray(0, eq).toString('latin1')] = rec.subarray(eq + 1);
    i += len;
  }
  return out;
}

async function readTar(src: Readable, st: State, archiveBytes: () => number, prefix: string): Promise<void> {
  const r = new ByteReader(src);
  let longName: Buffer | null = null;
  let pax: Record<string, Buffer> = {};
  for (;;) {
    if (st.abort) return;
    const h = await r.read(512);
    if (!h) return;
    if (h.every((b) => b === 0)) return;
    {
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (sum !== octal(h.subarray(148, 156))) { if (st.entries.length || r.consumed > 512) throw mkErr('KX_TRUNC'); throw mkErr('KX_NOTTAR'); }
    }
    const kind = String.fromCharCode(h[156] || 0x30);
    let size = octal(h.subarray(124, 136));
    const paxSize = pax.size ? parseInt(pax.size.toString('latin1'), 10) : NaN;
    if (!Number.isNaN(paxSize)) size = paxSize;
    const pad = (512 - (size % 512)) % 512;
    const hasUstar = h.subarray(257, 262).toString('latin1') === 'ustar';
    let rawName: Buffer = cstr(h.subarray(0, 100));
    if (hasUstar) { const pre = cstr(h.subarray(345, 500)); if (pre.length) rawName = Buffer.concat([pre, Buffer.from('/'), rawName]); }
    if (longName) rawName = longName;
    if (pax.path) rawName = pax.path;
    const paxUtf8 = !!pax.path || !!longName;
    if (kind === 'x' || kind === 'g' || kind === 'L' || kind === 'K') {
      if (size > 1024 * 1024) { st.abort = { ok: false, error: 'corrupt', message: 'tar: служебный заголовок слишком большой' }; return; }
      const body: Buffer[] = [];
      if (!(await r.stream(size, (b) => body.push(Buffer.from(b))))) return;
      if (pad) await r.skip(pad);
      const data = Buffer.concat(body);
      if (kind === 'x') pax = parsePax(data);
      else if (kind === 'L') longName = cstr(data);
      continue;
    }
    const dec = decodeZipName(rawName, paxUtf8);
    const name = dec.name;
    pax = {}; longName = null;
    const skipBody = async () => { if (!(await r.skip(size + pad))) throw mkErr('KX_TRUNC'); };
    if (++st.scanned > st.opts.maxScan) { st.skipped.push({ path: '…', reason: 'limit-files' }); return; }
    if (kind === '5' || name.endsWith('/')) { await skipBody(); continue; }
    if (kind === '2' || kind === '1') { st.skipped.push({ path: name, reason: 'link' }); await skipBody(); continue; }
    if (kind !== '0' && kind !== '\0' && kind !== '7') { st.skipped.push({ path: name, reason: 'device' }); await skipBody(); continue; }
    st.names[dec.enc] = (st.names[dec.enc] ?? 0) + 1;
    const v = pathVerdict(st, prefix + name);
    if ('reason' in v) { st.skipped.push({ path: name, reason: v.reason }); await skipBody(); continue; }
    if (size > st.opts.maxFileBytes) { st.skipped.push({ path: v.path, reason: 'too-big' }); await skipBody(); continue; }
    if (st.total + size > st.opts.maxTotalBytes) { st.skipped.push({ path: v.path, reason: 'limit-total' }); await skipBody(); continue; }
    if (size === 0) { st.skipped.push({ path: v.path, reason: 'empty' }); continue; }
    const file = path.join(st.dest, String(++st.n).padStart(6, '0'));
    const hash = createHash('sha256');
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });
    let ok = true;
    try {
      ok = await r.stream(size, (b) => { hash.update(b); out.write(b); });
    } finally {
      await new Promise<void>((res) => out.end(res));
    }
    if (!ok) { try { fs.rmSync(file, { force: true }); } catch {  } throw mkErr('KX_TRUNC'); }
    if (pad) await r.skip(pad);
    accept(st, v.path, { file, size, sha256: hash.digest('hex') });
    if (st.total >= st.opts.totalRatioFrom && st.total / Math.max(1, archiveBytes()) > st.opts.totalRatio) st.abort = { ok: false, error: 'bomb', message: 'Архив раздувается слишком сильно: похоже на «бомбу», не распаковываю' };
  }
}

function which(names: string[]): string | null {
  for (const dir of (process.env.PATH ?? '/usr/bin:/bin').split(':')) for (const n of names) { const f = path.join(dir, n); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {  } }
  return null;
}
function run7z(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C.UTF-8' } as unknown as NodeJS.ProcessEnv });
    let out = '', err = '';
    p.stdout.on('data', (b: Buffer) => { if (out.length < 40 * 1024 * 1024) out += b.toString('utf8'); });
    p.stderr.on('data', (b: Buffer) => { if (err.length < 8000) err += b.toString('utf8'); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {  } }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
  });
}
export const has7z = () => !!which(['7z', '7za', '7zr']);

async function read7z(file: string, st: State, archiveBytes: number, prefix: string): Promise<ExtractErr | null> {
  const bin = which(['7z', '7za', '7zr']);
  if (!bin) return { ok: false, error: 'unsupported', message: 'Формат .7z на этом сервере не поддерживается: загрузите zip' };
  const base = ['-sccUTF-8', '-scsUTF-8', '-y', '-bd', '-bso0', '-bsp0'];
  const l = await run7z(bin, ['l', '-slt', '-sccUTF-8', '-scsUTF-8', '--', file], 60_000);
  if (l.code !== 0 && !l.out.includes('Path =')) return { ok: false, error: 'corrupt', message: 'Не удалось прочитать .7z' };
  const blocks = l.out.split(/\r?\n\r?\n/).filter((b) => /^Path = /m.test(b));
  const items: { path: string; size: number; folder: boolean; link: boolean; enc: boolean }[] = [];
  for (const b of blocks) {
    const g = (k: string) => new RegExp(`^${k} = (.*)$`, 'm').exec(b)?.[1] ?? '';
    const p = g('Path');
    if (!p || p === file) continue;
    const attr = g('Attributes');
    items.push({ path: p, size: Number(g('Size')) || 0, folder: g('Folder') === '+' || /^D/.test(attr), link: /^l/.test(attr.replace(/^[A-Z_]+\s/, '')) || /^l/.test(attr) || !!g('Symbolic Link') || !!g('Hard Link'), enc: g('Encrypted') === '+' });
  }
  if (items.some((i) => i.link)) return { ok: false, error: 'unsupported', message: 'В .7z есть ссылки: такой архив не распаковываю' };
  const files = items.filter((i) => !i.folder);
  if (files.some((i) => i.enc)) return { ok: false, error: 'encrypted', message: 'Архив защищён паролем' };
  const declared = files.reduce((s, i) => s + i.size, 0);
  if (declared > st.opts.maxTotalBytes - st.total) return { ok: false, error: 'too-big', message: 'В архиве больше 2 ГБ' };
  if (declared >= st.opts.totalRatioFrom && declared / Math.max(1, archiveBytes) > st.opts.totalRatio) return { ok: false, error: 'bomb', message: 'Архив раздувается слишком сильно: похоже на «бомбу», не распаковываю' };
  const tmp = path.join(st.dest, `.x7z-${st.n + 1}`);
  fs.mkdirSync(tmp, { mode: 0o700 });
  try {
    const x = await run7z(bin, ['x', ...base, `-o${tmp}`, '--', file], 10 * 60_000);
    if (x.code > 1) return { ok: false, error: 'corrupt', message: 'Не удалось распаковать .7z' };
    const walk = (dir: string, rel: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, d.name);
        const r = rel ? `${rel}/${d.name}` : d.name;
        let lst: fs.Stats;
        try { lst = fs.lstatSync(abs); } catch { continue; }
        if (lst.isSymbolicLink()) { st.skipped.push({ path: r, reason: 'link' }); continue; }
        if (lst.isDirectory()) { walk(abs, r); continue; }
        if (!lst.isFile()) { st.skipped.push({ path: r, reason: 'device' }); continue; }
        if (++st.scanned > st.opts.maxScan) return;
        const v = pathVerdict(st, prefix + r);
        if ('reason' in v) { st.skipped.push({ path: r, reason: v.reason }); continue; }
        if (lst.size > st.opts.maxFileBytes) { st.skipped.push({ path: v.path, reason: 'too-big' }); continue; }
        if (lst.size === 0) { st.skipped.push({ path: v.path, reason: 'empty' }); continue; }
        if (st.total + lst.size > st.opts.maxTotalBytes) { st.skipped.push({ path: v.path, reason: 'limit-total' }); continue; }
        const dst = path.join(st.dest, String(++st.n).padStart(6, '0'));
        fs.renameSync(abs, dst);
        const h = createHash('sha256').update(fs.readFileSync(dst)).digest('hex');
        accept(st, v.path, { file: dst, size: lst.size, sha256: h });
      }
    };
    walk(tmp, '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return null;
}

async function readOne(file: string, kind: ArchiveKind, st: State, prefix: string): Promise<ExtractErr | null> {
  const bytes = fs.statSync(file).size;
  try {
    if (kind === 'zip') await readZip(file, st, bytes, prefix);
    else if (kind === '7z') return await read7z(file, st, bytes, prefix);
    else {
      const raw = fs.createReadStream(file);
      let src: Readable = raw;
      if (kind === 'tgz') { src = raw.pipe(createGunzip()); raw.on('error', (e) => src.destroy(e)); }
      try { await readTar(src, st, () => (kind === 'tgz' ? Math.max(1, raw.bytesRead) : bytes), prefix); }
      finally { raw.destroy(); src.destroy(); }
    }
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === 'KX_TRUNC' || c === 'KX_NOTTAR') return { ok: false, error: 'corrupt', message: 'Архив обрезан или повреждён' };
    return { ok: false, error: 'corrupt', message: `Архив не читается: ${(e as Error).message.slice(0, 160)}` };
  }
  return st.abort;
}

export async function extractArchive(file: string, name: string, dest: string, limits: Partial<Limits> = {}, prefixDir = ''): Promise<ExtractResult> {
  const kind = archiveKind(name);
  if (!kind) return { ok: false, error: 'unsupported', message: 'Неизвестный тип архива' };
  const st = newState(dest, { ...LIMITS, ...limits });
  const err = await readOne(file, kind, st, '');
  if (err) { cleanup(st); return err; }
  if (st.opts.maxDepth >= 1) {
    for (const e of [...st.entries]) {
      const k = archiveKind(e.path);
      if (!k) continue;
      const stem = `${e.path.slice(0, e.path.length - path.basename(e.path).length)}${archiveStem(e.path)}/`;
      const idx = st.entries.indexOf(e);
      st.entries.splice(idx, 1);
      st.total -= e.size;
      const before = st.entries.length;
      const nestedErr = await readOne(e.file, k, st, stem).catch(() => null);
      st.abort = null;
      if (nestedErr && (nestedErr.error === 'bomb' || nestedErr.error === 'too-big')) { cleanup(st); return nestedErr; }
      if (nestedErr || st.entries.length === before) {
        st.entries.splice(idx, 0, e); st.total += e.size;
      } else {
        try { fs.rmSync(e.file, { force: true }); } catch {  }
      }
    }
  }
  const stem = archiveStem(name);
  const tops = new Set(st.entries.map((e) => e.path.split('/')[0]));
  const single = st.entries.length > 0 && tops.size === 1 && st.entries.every((e) => e.path.includes('/'));
  if (!single) for (const e of st.entries) e.path = cleanPrefix(prefixDir ? `${prefixDir}/${stem}` : stem, e.path);
  else if (prefixDir) for (const e of st.entries) e.path = cleanPrefix(prefixDir, e.path);
  return { ok: true, entries: st.entries, skipped: st.skipped, totalBytes: st.total, names: st.names };
}

function cleanPrefix(stem: string, p: string): string {
  const c = cleanRelPath(`${stem}/${p}`);
  return c.ok ? c.path : p;
}
function cleanup(st: State) { for (const e of st.entries) { try { fs.rmSync(e.file, { force: true }); } catch {  } } }

export function skipSummary(skipped: Skipped[]): { total: number; text: string; byReason: Partial<Record<SkipReason, number>> } {
  const by: Partial<Record<SkipReason, number>> = {};
  for (const s of skipped) by[s.reason] = (by[s.reason] ?? 0) + 1;
  const parts = (Object.entries(by) as [SkipReason, number][]).map(([r, n]) => `${REASON_TEXT[r]} (${n})`);
  return { total: skipped.length, text: parts.join(', '), byReason: by };
}
