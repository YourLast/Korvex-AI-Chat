import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';
import { IMAGE, RETRY_MS, run, shaOf, slot } from './preview';
import { extOfName } from './viewKind';
import { sweepOld } from './cacheSweep';

export const pdfRoot = () => path.join(dataDir(), 'pdfcopies');
const TIMEOUT_MS = () => Math.max(10, Number(process.env.KX_PREVIEW_TIMEOUT_S || 120)) * 1000;
export const MAX_BYTES = 60 * 1024 * 1024;
export type PdfErr = 'convert' | 'timeout' | 'unavailable' | 'too-big' | 'empty';
export type PdfState = { state: 'ready'; sha: string; path: string } | { state: 'pending' } | { state: 'error'; code: PdfErr };
export type PdfConverter = (o: { src: string; ext: string; outDir: string; timeoutMs: number }) => Promise<{ ok: true } | { ok: false; code: PdfErr; detail?: string }>;

const g = globalThis as unknown as { __kxPdf?: { inflight: Map<string, Promise<void>>; conv: PdfConverter | null; errs: Map<string, { code: PdfErr; at: number }>; runs: number } };
const P = () => (g.__kxPdf ??= { inflight: new Map(), conv: null, errs: new Map(), runs: 0 });
const copyOf = (sha: string) => path.join(pdfRoot(), `${sha}.pdf`);

export const dockerPdf: PdfConverter = async ({ src, ext, outDir, timeoutMs }) => {
  if ([path.dirname(src), outDir].some((d) => /[,\n]/.test(d))) return { ok: false, code: 'unavailable', detail: 'bad data path' };
  const name = `kxprev-${randomBytes(6).toString('hex')}`;
  const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
  const inner = Math.max(5, Math.floor(timeoutMs / 1000) - 5);
  const args = ['run', '--rm', '-i', '--pull', 'never', '--name', name, '--label', 'korvex.preview=1',
    '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=768m,mode=1777', '--memory', '2g', '--memory-swap', '2g', '--cpus', '2', '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--log-driver', 'none', '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp',
    '--mount', `type=bind,src=${path.dirname(src)},dst=/in,readonly`, '--mount', `type=bind,src=${outDir},dst=/out`,
    IMAGE(), 'timeout', '-s', 'KILL', String(inner), 'python3', '-I', '-', `/in/doc.${ext}`];
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'pdfcopy_render.py'), 'utf8');
  const r = await run(args, { input: script, timeoutMs: timeoutMs + 15_000 });
  if (r.timedOut) { await run(['kill', name], { timeoutMs: 20_000 }); return { ok: false, code: 'timeout', detail: 'docker client timeout' }; }
  if (r.code === 0) return { ok: true };
  let code: PdfErr = 'convert';
  try { const e = JSON.parse(fs.readFileSync(path.join(outDir, 'error.json'), 'utf8')) as { error?: string }; if (e.error === 'empty') code = 'empty'; } catch {  }
  if (r.code === 137 && !fs.existsSync(path.join(outDir, 'error.json'))) code = 'timeout';
  if (r.code === 125 || r.code === 127 || r.code === -1) code = 'unavailable';
  return { ok: false, code, detail: r.err };
};

async function convertOnce(sha: string, file: string, ext: string): Promise<void> {
  fs.mkdirSync(pdfRoot(), { recursive: true, mode: 0o700 });
  sweepOld(pdfRoot());
  const tmp = path.join(pdfRoot(), `.tmp-${sha.slice(0, 16)}-${randomBytes(4).toString('hex')}`);
  const inDir = path.join(tmp, 'in'), outDir = path.join(tmp, 'out');
  fs.mkdirSync(inDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const fail = (code: PdfErr, detail = '') => { if (detail) console.error(`[pdfcopy] ${sha.slice(0, 12)} ${code}: ${detail.slice(-300)}`); P().errs.set(sha, { code, at: Date.now() }); };
  try {
    const src = path.join(inDir, `doc.${ext}`);
    fs.copyFileSync(file, src);
    P().runs++;
    const r = await slot(() => (P().conv ?? dockerPdf)({ src, ext, outDir, timeoutMs: TIMEOUT_MS() }));
    if (!r.ok) { fail(r.code, r.detail); return; }
    const out = path.join(outDir, 'doc.pdf');
    let head = Buffer.alloc(5);
    try { const fd = fs.openSync(out, 'r'); try { fs.readSync(fd, head, 0, 5, 0); } finally { fs.closeSync(fd); } } catch { head = Buffer.alloc(5); }
    if (head.toString('latin1') !== '%PDF-' || !fs.lstatSync(out).isFile()) { fail('convert', 'bad output'); return; }
    fs.renameSync(out, copyOf(sha));
  } catch (e) {
    fail('convert', (e as Error).message);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function pdfCopyOf(file: string, st: fs.Stats, name: string, o: { waitMs?: number } = {}): Promise<PdfState> {
  const ext = extOfName(name);
  if (st.size > MAX_BYTES) return { state: 'error', code: 'too-big' };
  const sha = await shaOf(file, st);
  const ready = (): PdfState | null => { try { return fs.lstatSync(copyOf(sha)).isFile() ? { state: 'ready', sha, path: copyOf(sha) } : null; } catch { return null; } };
  const done = ready();
  if (done) return done;
  const p = P();
  let job = p.inflight.get(sha);
  if (!job) {
    const e = p.errs.get(sha);
    if (e && Date.now() - e.at < RETRY_MS) return { state: 'error', code: e.code };
    job = convertOnce(sha, file, ext).catch((e2) => { console.error('[pdfcopy]', (e2 as Error).message); p.errs.set(sha, { code: 'convert', at: Date.now() }); }).finally(() => p.inflight.delete(sha));
    p.inflight.set(sha, job);
  }
  const waitMs = o.waitMs ?? 15_000;
  if (waitMs > 0) await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
  const now = ready();
  if (now) return now;
  if (p.inflight.has(sha)) return { state: 'pending' };
  return { state: 'error', code: p.errs.get(sha)?.code ?? 'convert' };
}

export const _test = {
  setConverter: (c: PdfConverter | null) => { P().conv = c; },
  reset: () => { const p = P(); p.inflight.clear(); p.errs.clear(); p.runs = 0; },
  runs: () => P().runs,
};
