import type { FileChip } from '../types';
import { fileErrKind, type FileErrKind } from './errKind';
import { archiveKind, archiveStem, cleanRelPath, extName, isJunkPath, rootOf } from './paths';

export const PARALLEL = 5;
export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type Picked = { file: File; path: string };
export type SkipWhy = 'junk' | 'empty' | 'duplicate' | 'too-big' | 'limit-files' | 'unsafe';
export type SkipRec = { path: string; why: string };
export type JobStatus = 'queued' | 'uploading' | 'ready' | 'error' | 'skipped' | 'cancelled';
export type Job = { key: number; path: string; size: number; hash?: string; file?: File; staged?: { sid: string; n: number }; status: JobStatus; error?: string; errKind?: FileErrKind; chip?: FileChip };
export type BatchKind = 'folder' | 'files' | 'zip';
export type Phase = 'unpacking' | 'uploading' | 'idle';

export const WHY_TEXT: Record<string, string> = {
  junk: 'служебные файлы', empty: 'пустые файлы', duplicate: 'дубли (то же содержимое)', 'too-big': 'файл больше 100 МБ', 'limit-files': 'больше 2000 файлов', unsafe: 'небезопасный путь',
  encrypted: 'защищены паролем', link: 'ссылки', device: 'устройства', bomb: 'подозрительно сильное сжатие', traversal: 'небезопасный путь', absolute: 'небезопасный путь', 'limit-total': 'больше 2 ГБ в архиве', error: 'не удалось распаковать',
};

type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void } };

async function walkEntry(e: FsEntry, out: Picked[], depth = 0): Promise<void> {
  if (depth > 60) return;
  if (e.isFile && e.file) {
    const f = await new Promise<File | null>((ok) => e.file!(ok, () => ok(null)));
    if (f) out.push({ file: f, path: e.fullPath.replace(/^\/+/, '') || f.name });
  } else if (e.isDirectory && e.createReader) {
    const rd = e.createReader();
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok) => rd.readEntries(ok, () => ok([])));
      if (!batch.length) break;
      for (const c of batch) await walkEntry(c, out, depth + 1);
    }
  }
}

export function collectDropped(dt: DataTransfer): Promise<Picked[]> {
  const entries: FsEntry[] = [];
  const loose: File[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind !== 'file') continue;
    const en = (it as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null;
    if (en) entries.push(en);
    else { const f = it.getAsFile(); if (f) loose.push(f); }
  }
  if (!entries.length && !loose.length) loose.push(...Array.from(dt.files ?? []));
  return (async () => {
    const out: Picked[] = loose.map((f) => ({ file: f, path: f.name }));
    for (const e of entries) await walkEntry(e, out);
    return out;
  })();
}

export function fromFileList(list: FileList | File[]): Picked[] {
  return Array.from(list).map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
}

export function filterPicked(picked: Picked[]): { keep: Picked[]; skipped: SkipRec[] } {
  const keep: Picked[] = [], skipped: SkipRec[] = [];
  for (const p of picked) {
    const c = cleanRelPath(p.path);
    if (!c.ok) { skipped.push({ path: p.path, why: 'unsafe' }); continue; }
    if (isJunkPath(c.path)) { skipped.push({ path: c.path, why: 'junk' }); continue; }
    if (p.file.size === 0) { skipped.push({ path: c.path, why: 'empty' }); continue; }
    if (p.file.size > MAX_FILE_BYTES) { skipped.push({ path: c.path, why: 'too-big' }); continue; }
    if (keep.length >= MAX_FILES) { skipped.push({ path: c.path, why: 'limit-files' }); continue; }
    keep.push({ file: p.file, path: c.path });
  }
  return { keep, skipped };
}

export function skipLine(skipped: readonly SkipRec[]): string {
  if (!skipped.length) return '';
  const by = new Map<string, number>();
  for (const s of skipped) by.set(s.why, (by.get(s.why) ?? 0) + 1);
  return [...by].map(([w, n]) => `${WHY_TEXT[w] ?? w} (${n})`).join(', ');
}

export const isArchivePick = (p: Picked) => !!archiveKind(p.file.name) && !p.path.includes('/');

export type Snap = {
  id: string; kind: BatchKind; label: string; phase: Phase; err: string | null;
  jobs: readonly Job[]; skipped: readonly SkipRec[];
  total: number; ready: number; failed: number; cancelled: number; queued: number; running: number; dups: number;
  bytesTotal: number; bytesDone: number; types: number;
};

export type Deps = {
  fetch: typeof fetch;
  modelId?: string;
  errText?: (raw: string) => string;
  sha256?: (f: File) => Promise<string | null>;
  retryMs?: number;
};

async function defaultSha(f: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle || f.size > 64 * 1024 * 1024) return null;
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

let seq = 0;
export class Batch {
  readonly id = `b${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  kind: BatchKind;
  label: string;
  private unpacking = 0;
  err: string | null = null;
  jobs: Job[] = [];
  skipped: SkipRec[] = [];
  get phase(): Phase { return this.unpacking > 0 ? 'unpacking' : this.pump ? 'uploading' : 'idle'; }
  private subs = new Set<() => void>();
  private snapCache: Snap | null = null;
  private seen = new Map<string, true>();
  private ctrl: AbortController | null = null;
  private running = 0;
  private pump: Promise<void> | null = null;
  private jobSeq = 0;
  private dead = false;
  private d: Deps;

  constructor(kind: BatchKind, label: string, deps: Deps) { this.kind = kind; this.label = label; this.d = deps; }

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  private emit() { this.snapCache = null; this.subs.forEach((f) => f()); }
  getSnap = (): Snap => (this.snapCache ??= this.compute());

  private compute(): Snap {
    const c = { ready: 0, failed: 0, cancelled: 0, queued: 0, running: 0, dups: 0, bytesTotal: 0, bytesDone: 0 };
    const types = new Set<string>();
    for (const j of this.jobs) {
      if (j.status === 'skipped') { c.dups++; continue; }
      c.bytesTotal += j.size;
      types.add(extName(j.path) || '·');
      if (j.status === 'ready') { c.ready++; c.bytesDone += j.size; }
      else if (j.status === 'error') c.failed++;
      else if (j.status === 'cancelled') c.cancelled++;
      else if (j.status === 'uploading') c.running++;
      else c.queued++;
    }
    return { id: this.id, kind: this.kind, label: this.label, phase: this.phase, err: this.err, jobs: this.jobs, skipped: this.skipped, total: this.jobs.length - c.dups, ...c, types: types.size };
  }

  addPicked(keep: Picked[], skipped: SkipRec[]) {
    this.skipped = [...this.skipped, ...skipped];
    for (const p of keep) this.jobs.push({ key: ++this.jobSeq, path: p.path, size: p.file.size, file: p.file, status: 'queued' });
    this.emit();
  }
  addStaged(sid: string, entries: { n: number; path: string; size: number }[], skipped: SkipRec[]) {
    this.skipped = [...this.skipped, ...skipped];
    for (const e of entries) this.jobs.push({ key: ++this.jobSeq, path: e.path, size: e.size, staged: { sid, n: e.n }, status: 'queued' });
    this.emit();
  }

  async unpack(file: File, prefix = ''): Promise<void> {
    this.unpacking++; this.err = null; this.emit();
    this.ctrl ??= new AbortController();
    try {
      let r!: Response;
      for (let attempt = 0; ; attempt++) {
        r = await this.d.fetch('/api/files/archive', { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name), ...(prefix ? { 'X-Prefix': encodeURIComponent(prefix) } : {}), 'Content-Type': 'application/octet-stream' }, signal: this.ctrl.signal });
        if (r.status !== 429 || attempt >= 6) break;
        await new Promise((ok) => setTimeout(ok, this.d.retryMs ?? 3000));
      }
      const text = await r.text();
      let j: { error?: string; sid?: string; entries?: { n: number; path: string; size: number }[]; skipped?: { items?: { path: string; reason: string }[]; total?: number; byReason?: Record<string, number> } } = {};
      try { j = JSON.parse(text.trim() || '{}'); } catch {  }
      if (!r.ok || j.error || !j.sid) throw new Error(j.error ? (this.d.errText?.(j.error) ?? j.error) : r.status === 413 ? (this.d.errText?.('Файл больше предела сервера') ?? 'Файл больше предела сервера') : `HTTP ${r.status}`);
      const sk: SkipRec[] = [];
      for (const [why, n] of Object.entries(j.skipped?.byReason ?? {})) for (let i = 0; i < n; i++) sk.push({ path: '', why });
      this.addStaged(j.sid, j.entries ?? [], sk);
      if (!(j.entries ?? []).length) this.err = `${file.name}: нет файлов, которые можно загрузить`;
    } catch (e) {
      if (!this.dead && (e as Error).name !== 'AbortError') this.err = `${this.kind === 'zip' ? '' : file.name + ': '}${(e as Error).message}`;
    } finally {
      this.unpacking--; this.emit();
    }
    await this.start();
  }

  start(): Promise<void> {
    if (this.pump) {
      const again = () => (this.jobs.some((j) => j.status === 'queued') && !this.ctrl?.signal.aborted ? this.start() : undefined);
      if (!this.ctrl?.signal.aborted) return this.pump.then(again);
      return this.pump.then(() => this.start());
    }
    this.ctrl = new AbortController();
    this.emit();
    const run = Promise.all(Array.from({ length: PARALLEL }, () => this.worker())).then(() => {}, () => {}).then(() => { this.pump = null; this.emit(); });
    this.pump = run;
    this.emit();
    return run;
  }

  private async worker() {
    for (;;) {
      if (this.dead || this.ctrl?.signal.aborted) return;
      const j = this.jobs.find((x) => x.status === 'queued');
      if (!j) return;
      j.status = 'uploading'; this.running++; this.emit();
      try { await this.upload(j); } finally { this.running--; }
      this.emit();
    }
  }

  private async upload(j: Job) {
    const signal = this.ctrl!.signal;
    try {
      if (j.file) {
        const h = await (this.d.sha256 ?? defaultSha)(j.file);
        if (h) {
          const k = `${j.file.size}:${h}`;
          if (this.seen.has(k)) { j.status = 'skipped'; this.skipped = [...this.skipped, { path: j.path, why: 'duplicate' }]; return; }
          this.seen.set(k, true); j.hash = k;
        }
        if (signal.aborted) { if (j.hash) { this.seen.delete(j.hash); j.hash = undefined; } j.status = 'cancelled'; return; }
      }
      const fd = new FormData();
      if (j.staged) { fd.append('staged', j.staged.sid); fd.append('n', String(j.staged.n)); }
      else { fd.append('file', j.file!, j.file!.name); fd.append('path', j.path); }
      if (this.d.modelId) fd.append('model', this.d.modelId);
      const r = await this.d.fetch('/api/files', { method: 'POST', body: fd, signal });
      const text = await r.text();
      let b: { error?: string; id?: string; name?: string; size?: number; mime?: string; tokens?: number; info?: Record<string, unknown> } = {};
      try { b = JSON.parse(text.trim() || '{}'); } catch {  }
      if (!r.ok || b.error || !b.id) j.errKind = fileErrKind(r.status, String(b.error ?? ''));
      if (!r.ok || b.error || !b.id) throw new Error(b.error ? (this.d.errText?.(b.error) ?? b.error) : r.status === 413 ? (this.d.errText?.('Файл больше предела сервера') ?? 'Файл больше предела сервера') : `HTTP ${r.status}`);
      j.chip = { id: b.id, name: b.name ?? j.path, size: b.size ?? j.size, mime: b.mime, tokens: b.tokens, info: b.info };
      j.status = 'ready';
    } catch (e) {
      if (j.hash) { this.seen.delete(j.hash); j.hash = undefined; }
      if (signal.aborted || (e as Error).name === 'AbortError') { j.status = 'cancelled'; return; }
      j.status = 'error'; j.error = (e as Error).message; j.errKind ??= 'net';
    }
  }

  cancel() {
    this.ctrl?.abort();
    for (const j of this.jobs) if (j.status === 'queued' || j.status === 'uploading') j.status = 'cancelled';
    this.emit();
  }
  retry(): Promise<void> {
    for (const j of this.jobs) if (j.status === 'error' || j.status === 'cancelled') { j.status = 'queued'; j.error = undefined; }
    this.err = null;
    this.emit();
    return this.start();
  }
  dispose() { this.dead = true; this.ctrl?.abort(); this.subs.clear(); }

  chips(): FileChip[] { return this.jobs.filter((j) => j.status === 'ready' && j.chip).map((j) => j.chip!); }
  get busy() { return this.unpacking > 0 || !!this.pump || this.jobs.some((j) => j.status === 'uploading' || j.status === 'queued'); }
}

export function planBatches(picked: Picked[]): { archives: Picked[]; folders: Map<string, Picked[]>; loose: Picked[] } {
  const archives: Picked[] = [], loose: Picked[] = [];
  const folders = new Map<string, Picked[]>();
  for (const p of picked) {
    if (isArchivePick(p)) { archives.push(p); continue; }
    const c = cleanRelPath(p.path);
    const root = c.ok ? rootOf(c.path) : null;
    if (root) (folders.get(root) ?? folders.set(root, []).get(root)!).push(p);
    else loose.push(p);
  }
  return { archives, folders, loose };
}
export { archiveStem };
