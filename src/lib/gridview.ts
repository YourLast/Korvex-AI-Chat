import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';
import { shaOf } from './preview';
import { extOfName } from './viewKind';
import { sweepOld } from './cacheSweep';
import type { Lang } from './i18n/core';

export const gridRoot = () => path.join(dataDir(), 'grids');
export const CHUNK = 500;
export const MAX_ROWS_PER_REQUEST = 600;
const TIMEOUT_MS = () => Math.max(10, Number(process.env.KX_GRID_TIMEOUT_S || 180)) * 1000;
const MEM_MB = () => Math.max(512, Number(process.env.KX_GRID_MEM_MB || 3072));

export type Cell = string | [string, number] | [string, number, string];
type RawCell = Cell | [string, number, string, 1 | 2];
export type StyleDef = { b?: 1; i?: 1; u?: 1; s?: 1; c?: string; f?: string; sz?: number; h?: 'l' | 'c' | 'r' | 'j'; v?: 't' | 'm' | 'b'; w?: 1; in?: number; bd?: Partial<Record<'t' | 'r' | 'b' | 'l', [number, 's' | 'd' | 'o' | 'x', string]>> };
export type SheetMeta = {
  name: string; rows: number; cols: number; header: number; chunks: number; truncated: boolean;
  widths?: number[]; heights?: Record<number, number>; merges?: string[]; frozen?: { rows: number; cols: number }; grid?: false; tab?: string; hidden?: boolean;
};
export type GridMeta = { v: number; styles?: StyleDef[]; sheets: SheetMeta[] };
export type GridState = { state: 'ready'; sha: string; meta: GridMeta } | { state: 'pending' } | { state: 'error'; code: 'unreadable' | 'timeout' | 'too-big' };

type Indexer = (o: { file: string; ext: string; outDir: string; timeoutMs: number }) => Promise<{ ok: true } | { ok: false; code: 'unreadable' | 'timeout'; detail?: string }>;
const g = globalThis as unknown as { __kxGrid?: { inflight: Map<string, Promise<void>>; idx: Indexer | null; runs: number; errs: Map<string, { code: 'unreadable' | 'timeout'; at: number }> } };
const P = () => (g.__kxGrid ??= { inflight: new Map(), idx: null, runs: 0, errs: new Map() });
export const MAX_BYTES = 100 * 1024 * 1024;
const RETRY_MS = 5 * 60_000;

const metaOf = (sha: string): GridMeta | null => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(gridRoot(), sha, 'meta.json'), 'utf8')) as GridMeta;
    return m && m.v >= 3 && Array.isArray(m.sheets) ? m : null;
  } catch { return null; }
};

const nodeIndexer: Indexer = ({ file, ext, outDir, timeoutMs }) => new Promise((resolve) => {
  const script = path.join(process.cwd(), 'scripts', 'grid_index.mjs');
  const p = spawn(process.execPath, [`--max-old-space-size=${MEM_MB()}`, script, file, outDir, ext], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } as unknown as NodeJS.ProcessEnv });
  let err = '', timedOut = false;
  p.stderr.on('data', (b: Buffer) => { if (err.length < 4000) err += b.toString('utf8'); });
  const t = setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch {  } }, timeoutMs);
  p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, code: 'unreadable', detail: e.message }); });
  p.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? { ok: true } : { ok: false, code: timedOut ? 'timeout' : 'unreadable', detail: err.slice(-300) }); });
});

async function build(sha: string, file: string, ext: string): Promise<void> {
  fs.mkdirSync(gridRoot(), { recursive: true, mode: 0o700 });
  sweepOld(gridRoot());
  const tmp = path.join(gridRoot(), `.tmp-${sha.slice(0, 16)}-${randomBytes(4).toString('hex')}`);
  try {
    P().runs++;
    const r = await (P().idx ?? nodeIndexer)({ file, ext, outDir: tmp, timeoutMs: TIMEOUT_MS() });
    if (!r.ok) { if (r.detail) console.error(`[grid] ${sha.slice(0, 12)} ${r.code}: ${r.detail}`); P().errs.set(sha, { code: r.code, at: Date.now() }); return; }
    const dst = path.join(gridRoot(), sha);
    try { fs.renameSync(tmp, dst); } catch (e) { if (!metaOf(sha)) { P().errs.set(sha, { code: 'unreadable', at: Date.now() }); console.error('[grid]', (e as Error).message); } }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function gridOf(file: string, st: fs.Stats, name: string, o: { waitMs?: number } = {}): Promise<GridState> {
  if (st.size > MAX_BYTES) return { state: 'error', code: 'too-big' };
  const sha = await shaOf(file, st);
  const ready = (): GridState | null => { const m = metaOf(sha); return m ? { state: 'ready', sha, meta: m } : null; };
  const done = ready();
  if (done) return done;
  const p = P();
  let job = p.inflight.get(sha);
  if (!job) {
    const e = p.errs.get(sha);
    if (e && Date.now() - e.at < RETRY_MS) return { state: 'error', code: e.code };
    job = build(sha, file, extOfName(name)).catch((e2) => { console.error('[grid]', (e2 as Error).message); p.errs.set(sha, { code: 'unreadable', at: Date.now() }); }).finally(() => p.inflight.delete(sha));
    p.inflight.set(sha, job);
  }
  const waitMs = o.waitMs ?? 20_000;
  if (waitMs > 0) await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
  const now = ready();
  if (now) return now;
  if (p.inflight.has(sha)) return { state: 'pending' };
  return { state: 'error', code: p.errs.get(sha)?.code ?? 'unreadable' };
}

const chunkCache = new Map<string, RawCell[][]>();
function chunk(sha: string, sheet: number, k: number): RawCell[][] | null {
  const key = `${sha}:${sheet}:${k}`;
  const hit = chunkCache.get(key);
  if (hit) { chunkCache.delete(key); chunkCache.set(key, hit); return hit; }
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(gridRoot(), sha, `s${sheet}-${k}.json`), 'utf8')) as RawCell[][];
    chunkCache.set(key, rows);
    if (chunkCache.size > 60) chunkCache.delete(chunkCache.keys().next().value as string);
    return rows;
  } catch { return null; }
}

const SEP: Record<Lang, { thou: string; dec: string }> = { ru: { thou: '\u00a0', dec: ',' }, sr: { thou: '.', dec: ',' }, en: { thou: ',', dec: '.' } };
export function localNumber(t: string, lang: Lang): string {
  if (lang === 'en') return t;
  const { thou, dec } = SEP[lang];
  return t.replace(/(?<=\d)[,.](?=\d)/g, (m) => (m === ',' ? thou : dec));
}
export function localShortDate(t: string, lang: Lang): string {
  const m = lang === 'en' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t) : null;
  return m ? `${Number(m[2])}/${Number(m[1])}/${m[3]}` : t;
}
function outCell(c: RawCell, lang: Lang | undefined): Cell {
  if (typeof c === 'string') return c;
  const mark = c.length === 4 ? c[3] : 0;
  if (!mark) return c as Cell;
  const text = lang ? (mark === 1 ? localNumber(c[0], lang) : localShortDate(c[0], lang)) : c[0];
  return c[2] ? [text, c[1], c[2]] : [text, c[1]];
}
const outRow = (r: RawCell[], lang: Lang | undefined): Cell[] => r.map((c) => outCell(c, lang));

export function rowRange(sha: string, meta: GridMeta, sheet: number, from: number, to: number, lang?: Lang): { from: number; rows: Cell[][] } | null {
  const s = meta.sheets[sheet];
  if (!s || !/^[0-9a-f]{64}$/.test(sha)) return null;
  const a = Math.max(1, Math.floor(from) || 1);
  const b = Math.min(s.rows, Math.max(a, Math.floor(to) || a), a + MAX_ROWS_PER_REQUEST - 1);
  const out: Cell[][] = [];
  for (let r = a; r <= b; r++) {
    const c = chunk(sha, sheet, Math.floor((r - 1) / CHUNK));
    out.push(outRow(c?.[(r - 1) % CHUNK] ?? [], lang));
  }
  return { from: a, rows: out };
}
export function rowList(sha: string, meta: GridMeta, sheet: number, list: number[], lang?: Lang): { rows: Record<number, Cell[]> } | null {
  const s = meta.sheets[sheet];
  if (!s || !/^[0-9a-f]{64}$/.test(sha)) return null;
  const rows: Record<number, Cell[]> = {};
  for (const r of list.slice(0, 300)) {
    if (!Number.isInteger(r) || r < 1 || r > s.rows) continue;
    rows[r] = outRow(chunk(sha, sheet, Math.floor((r - 1) / CHUNK))?.[(r - 1) % CHUNK] ?? [], lang);
  }
  return { rows };
}

export const _test = {
  setIndexer: (i: Indexer | null) => { P().idx = i; },
  reset: () => { const p = P(); p.inflight.clear(); p.errs.clear(); p.runs = 0; chunkCache.clear(); },
  runs: () => P().runs,
};
