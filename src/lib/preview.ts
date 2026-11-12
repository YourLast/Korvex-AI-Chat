import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dataDir } from './db';
import { PREVIEW_W, extOf, previewKind, type PreviewKind, type PreviewW } from './previewKind';
import { cfg } from './cfg';

export const previewRoot = () => path.join(dataDir(), 'previews');
export const IMAGE = () => cfg('KX_PREVIEW_IMAGE', 'korvex-preview:1');
const MAX_PAGES = () => Math.max(1, Number(process.env.KX_PREVIEW_MAX_PAGES || 150));
const TIMEOUT_MS = () => Math.max(10, Number(process.env.KX_PREVIEW_TIMEOUT_S || 120)) * 1000;
const PAR = () => Math.max(1, Number(process.env.KX_PREVIEW_PAR || 2));
export const MAX_BYTES = 60 * 1024 * 1024;
export const RETRY_MS = 10 * 60_000;

export type ErrCode = 'convert' | 'timeout' | 'unavailable' | 'too-big' | 'empty' | 'unsupported';
export type Manifest = { pages: [number, number][]; total: number };
export type PreviewState =
  | { state: 'ready'; v: string; pages: [number, number][]; total: number }
  | { state: 'pending' }
  | { state: 'error'; code: ErrCode };

export type Converter = (o: { src: string; ext: string; outDir: string; maxPages: number; widths: readonly number[]; timeoutMs: number }) => Promise<{ ok: true } | { ok: false; code: ErrCode; detail?: string }>;

const shaMemo = new Map<string, string>();
export async function shaOf(file: string, st: fs.Stats): Promise<string> {
  const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
  const m = shaMemo.get(key);
  if (m) return m;
  const h = createHash('sha256');
  await new Promise<void>((res, rej) => { fs.createReadStream(file).on('data', (b) => h.update(b)).on('end', () => res()).on('error', rej); });
  const sha = h.digest('hex');
  if (shaMemo.size > 2000) shaMemo.clear();
  shaMemo.set(key, sha);
  return sha;
}

const manifestOf = (sha: string): Manifest | null => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(previewRoot(), sha, 'manifest.json'), 'utf8')) as Manifest;
    return validManifest(m) ? m : null;
  } catch { return null; }
};
function validManifest(m: unknown): m is Manifest {
  const x = m as Manifest;
  return !!x && Array.isArray(x.pages) && x.pages.length > 0 && x.pages.length <= 5000 && Number.isInteger(x.total) && x.total >= x.pages.length
    && x.pages.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n > 0 && n <= 100_000));
}
const errFile = (sha: string) => path.join(previewRoot(), `${sha}.err.json`);
function recentError(sha: string, now = Date.now()): ErrCode | null {
  try {
    const e = JSON.parse(fs.readFileSync(errFile(sha), 'utf8')) as { code: ErrCode; at: number };
    return now - e.at < RETRY_MS ? e.code : null;
  } catch { return null; }
}

export function pagePath(sha: string, n: number, w: PreviewW): string | null {
  if (!/^[0-9a-f]{64}$/.test(sha) || !Number.isInteger(n) || n < 1 || n > 5000 || !(PREVIEW_W as readonly number[]).includes(w)) return null;
  const f = path.join(previewRoot(), sha, `${n}-${w}.webp`);
  try { return fs.lstatSync(f).isFile() ? f : null; } catch { return null; }
}

type Q = { inflight: Map<string, Promise<void>>; running: number; queue: (() => void)[]; conv: Converter | null; runs: number };
const g = globalThis as unknown as { __kxPrev?: Q };
const P = (): Q => (g.__kxPrev ??= { inflight: new Map(), running: 0, queue: [], conv: null, runs: 0 });

export async function slot<T>(fn: () => Promise<T>): Promise<T> {
  const p = P();
  if (p.running >= PAR()) await new Promise<void>((r) => p.queue.push(r));
  p.running++;
  try { return await fn(); } finally { p.running--; p.queue.shift()?.(); }
}

export const KEEP_MS = 60 * 24 * 3_600_000;
let swept = 0;
export function sweep(root = previewRoot(), now = Date.now(), force = false) {
  if (!force && now - swept < 3_600_000) return;
  swept = now;
  try {
    for (const d of fs.readdirSync(/*turbopackIgnore: true*/ root)) {
      const f = path.join(root, d);
      try {
        const age = now - fs.lstatSync(f).mtimeMs;
        if ((d.startsWith('.tmp-') && age > 3_600_000) || (/^[0-9a-f]{64}$/.test(d) && age > KEEP_MS) || (d.endsWith('.err.json') && age > RETRY_MS * 6)) fs.rmSync(f, { recursive: true, force: true });
      } catch {  }
    }
  } catch {  }
}
const touched = new Map<string, number>();
function touch(sha: string, now = Date.now()) {
  if (now - (touched.get(sha) ?? 0) < 24 * 3_600_000) return;
  touched.set(sha, now);
  if (touched.size > 5000) touched.clear();
  try { fs.utimesSync(path.join(previewRoot(), sha), now / 1000, now / 1000); } catch {  }
}

function cleanOut(dir: string, pages: number): boolean {
  const ok = new Set(['manifest.json']);
  for (let n = 1; n <= pages; n++) for (const w of PREVIEW_W) ok.add(`${n}-${w}.webp`);
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.lstatSync(p);
    if (!ok.has(f) || !st.isFile()) fs.rmSync(p, { recursive: true, force: true });
  }
  for (let n = 1; n <= pages; n++) for (const w of PREVIEW_W) if (!fs.existsSync(path.join(dir, `${n}-${w}.webp`))) return false;
  return true;
}

async function convertOnce(sha: string, file: string, ext: string): Promise<void> {
  const root = previewRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  sweep(root);
  const tmp = path.join(root, `.tmp-${sha.slice(0, 16)}-${randomBytes(4).toString('hex')}`);
  const inDir = path.join(tmp, 'in'), outDir = path.join(tmp, 'out');
  fs.mkdirSync(inDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const fail = (code: ErrCode, detail = '') => {
    if (detail) console.error(`[preview] ${sha.slice(0, 12)} ${code}: ${detail.slice(-300)}`);
    try { fs.writeFileSync(errFile(sha), JSON.stringify({ code, at: Date.now() }), { mode: 0o600 }); } catch {  }
  };
  try {
    const src = path.join(inDir, `doc.${ext}`);
    fs.copyFileSync(file, src);
    const conv = P().conv ?? dockerConvert;
    P().runs++;
    const r = await slot(() => conv({ src, ext, outDir, maxPages: MAX_PAGES(), widths: PREVIEW_W, timeoutMs: TIMEOUT_MS() }));
    if (!r.ok) { fail(r.code, r.detail); return; }
    let m: unknown = null;
    try { m = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')); } catch {  }
    if (!validManifest(m) || !cleanOut(outDir, m.pages.length)) { fail('convert', 'bad output'); return; }
    const dst = path.join(root, sha);
    try { fs.renameSync(outDir, dst); } catch (e) { if (!manifestOf(sha)) { fail('convert', (e as Error).message); return; } }
    try { fs.rmSync(errFile(sha), { force: true }); } catch {  }
  } catch (e) {
    fail('convert', (e as Error).message);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function previewOf(file: string, st: fs.Stats, name: string, o: { waitMs?: number } = {}): Promise<PreviewState> {
  const ext = extOf(name);
  if (!previewKind(name)) return { state: 'error', code: 'unsupported' };
  if (st.size > MAX_BYTES) return { state: 'error', code: 'too-big' };
  const sha = await shaOf(file, st);
  const ready = (): PreviewState | null => { const m = manifestOf(sha); if (m) touch(sha); return m ? { state: 'ready', v: sha.slice(0, 16), pages: m.pages, total: m.total } : null; };
  const done = ready();
  if (done) return done;
  const p = P();
  let job = p.inflight.get(sha);
  if (!job) {
    const err = recentError(sha);
    if (err) return { state: 'error', code: err };
    job = convertOnce(sha, file, ext)
      .catch((e) => { console.error('[preview]', (e as Error).message); try { fs.writeFileSync(errFile(sha), JSON.stringify({ code: 'convert', at: Date.now() }), { mode: 0o600 }); } catch {  } })
      .finally(() => p.inflight.delete(sha));
    p.inflight.set(sha, job);
  }
  const waitMs = o.waitMs ?? 15_000;
  if (waitMs > 0) await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
  else return { state: 'pending' };
  const now = ready();
  if (now) return now;
  if (p.inflight.has(sha)) return { state: 'pending' };
  return { state: 'error', code: recentError(sha) ?? 'convert' };
}

const RENDER = () => fs.readFileSync(path.join(process.cwd(), 'scripts', 'preview_render.py'), 'utf8');

export function run(args: string[], o: { input?: string; timeoutMs: number }): Promise<{ code: number; err: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const p = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } as unknown as NodeJS.ProcessEnv });
    let err = '', timedOut = false;
    p.stderr.on('data', (b: Buffer) => { if (err.length < 8000) err += b.toString('utf8'); });
    const t = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch {  } }, o.timeoutMs);
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, err: e.message, timedOut }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, err, timedOut }); });
    p.stdin.on('error', () => {  });
    p.stdin.end(o.input ?? '');
  });
}

export const dockerConvert: Converter = async ({ src, ext, outDir, maxPages, widths, timeoutMs }) => {
  if ([path.dirname(src), outDir].some((d) => /[,\n]/.test(d))) return { ok: false, code: 'unavailable', detail: 'bad data path' };
  const name = `kxprev-${randomBytes(6).toString('hex')}`;
  const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
  const inner = Math.max(5, Math.floor(timeoutMs / 1000) - 5);
  const args = ['run', '--rm', '-i', '--pull', 'never', '--name', name, '--label', 'korvex.preview=1',
    '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=768m,mode=1777', '--memory', '2g', '--memory-swap', '2g', '--cpus', '2', '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none', '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp',
    '--mount', `type=bind,src=${path.dirname(src)},dst=/in,readonly`, '--mount', `type=bind,src=${outDir},dst=/out`,
    IMAGE(), 'timeout', '-s', 'KILL', String(inner), 'python3', '-I', '-', `/in/doc.${ext}`, String(maxPages), widths.join(',')];
  const r = await run(args, { input: RENDER(), timeoutMs: timeoutMs + 15_000 });
  if (r.timedOut) {
    await run(['kill', name], { timeoutMs: 20_000 });
    return { ok: false, code: 'timeout', detail: 'docker client timeout' };
  }
  if (r.code === 0) return { ok: true };
  let code: ErrCode = 'convert';
  try { const e = JSON.parse(fs.readFileSync(path.join(outDir, 'error.json'), 'utf8')) as { error?: string }; if (e.error === 'empty') code = 'empty'; } catch {  }
  if (r.code === 137 && !fs.existsSync(path.join(outDir, 'error.json'))) code = 'timeout';
  if (r.code === 125 || r.code === 127 || r.code === -1) code = 'unavailable';
  return { ok: false, code, detail: r.err };
};

const HDR = { 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" };

export async function previewResponse(sp: URLSearchParams, file: string, name: string, st: fs.Stats): Promise<Response> {
  const kind: PreviewKind | null = previewKind(name);
  const page = sp.get('page');
  if (page !== null) {
    if (!kind || st.size > MAX_BYTES) return new Response(null, { status: 404, headers: HDR });
    const sha = await shaOf(file, st);
    const w = (Number(sp.get('w')) || 1600) as PreviewW;
    const f = pagePath(sha, Number(page), w);
    if (!f) return new Response(null, { status: 404, headers: HDR });
    const size = fs.statSync(/*turbopackIgnore: true*/ f).size;
    const fresh = sp.get('v') === sha.slice(0, 16);
    return new Response(Readable.toWeb(fs.createReadStream(/*turbopackIgnore: true*/ f)) as ReadableStream, {
      headers: { ...HDR, 'Content-Type': 'image/webp', 'Content-Length': String(size), 'Content-Disposition': 'inline',
        'Cache-Control': fresh ? 'private, max-age=31536000, immutable' : 'private, max-age=0' },
    });
  }
  const waitMs = Math.min(25_000, Math.max(0, Number(sp.get('wait') ?? 15_000) || 0));
  const s = await previewOf(file, st, name, { waitMs });
  return new Response(JSON.stringify({ kind, ...s }), {
    status: s.state === 'error' && s.code === 'unsupported' ? 415 : 200,
    headers: { ...HDR, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

export const _test = {
  setConverter: (c: Converter | null) => { P().conv = c; },
  runs: () => P().runs,
  reset: () => { const p = P(); p.inflight.clear(); p.runs = 0; shaMemo.clear(); touched.clear(); },
};
