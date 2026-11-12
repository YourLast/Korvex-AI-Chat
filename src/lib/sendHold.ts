import type { FileChip } from './types';
import type { Batch } from './upload/queue';
import type { Up } from '@/components/UpRow';

export type Hold = { id: string; text: string; ups: Up[]; batches: Batch[]; at?: number;  sending?: boolean };

export type HoldState = {
  total: number;
  ready: number;
  failed: string[];
  chips: FileChip[];
  settled: boolean;
  unpacking: boolean;
};

export function holdState(h: Pick<Hold, 'ups' | 'batches'>): HoldState {
  let total = 0, ready = 0, settled = true, unpacking = false;
  const failed: string[] = [], chips: FileChip[] = [];
  for (const u of h.ups) {
    total++;
    if (u.status === 'ready' && u.chip) { ready++; chips.push(u.chip); }
    else if (u.status === 'error') failed.push(u.name);
    else settled = false;
  }
  for (const b of h.batches) {
    const s = b.getSnap();
    if (b.busy) settled = false;
    if (s.phase === 'unpacking') unpacking = true;
    total += s.total;
    ready += s.ready;
    for (const j of s.jobs) if (j.status === 'error' || j.status === 'cancelled') failed.push(j.path);
    if (!b.busy && s.err && s.jobs.length === 0) { failed.push(s.label); total++; }
    chips.push(...b.chips());
  }
  return { total, ready, failed, chips: dedupe(chips), settled, unpacking };
}

const dedupe = (c: FileChip[]) => c.filter((x, i) => c.findIndex((y) => y.id === x.id) === i);

export function failedNote(failed: readonly string[], head: string, more: (n: number) => string): string {
  if (!failed.length) return '';
  const shown = failed.slice(0, 8).join(', ');
  return `${head} ${shown}${failed.length > 8 ? more(failed.length - 8) : ''}`;
}

export type HeldKind = 'doc' | 'table' | 'image' | 'folder' | 'zip';
export type HeldState = 'wait' | 'run' | 'ok' | 'err';
export type HeldFile = { key: string; name: string; size: number; kind: HeldKind; state: HeldState; err?: string; errKind?: FileErrKind; done?: number; total?: number; unpacking?: boolean; pages?: number };

export { fileErrKind, type FileErrKind } from './upload/errKind';
import type { FileErrKind } from './upload/errKind';

const TABLE_EXT = /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
export const heldKind = (name: string, img?: boolean): HeldKind => (img || IMAGE_EXT.test(name) ? 'image' : TABLE_EXT.test(name) ? 'table' : 'doc');

function jobState(s: string): HeldState | null {
  if (s === 'ready') return 'ok';
  if (s === 'error' || s === 'cancelled') return 'err';
  if (s === 'uploading') return 'run';
  if (s === 'queued') return 'wait';
  return null;
}

export function heldFiles(h: Pick<Hold, 'ups' | 'batches'>): HeldFile[] {
  const out: HeldFile[] = [];
  for (const u of h.ups) {
    if (u.edit) continue;
    let state: HeldState = 'run';
    if (u.status === 'ready' && u.chip) state = 'ok';
    else if (u.status === 'error') state = 'err';
    else if (u.started === false) state = 'wait';
    out.push({ key: `u:${u.tmp}`, name: u.name, size: u.size, kind: heldKind(u.name, u.img), state, err: u.error, errKind: u.errKind, pages: Number(u.chip?.info?.pages) || undefined });
  }
  for (const b of h.batches) {
    const s = b.getSnap();
    if (s.kind === 'files') {
      for (const j of s.jobs) {
        const st = jobState(j.status);
        if (st) out.push({ key: `${s.id}:${j.key}`, name: j.path, size: j.size, kind: heldKind(j.path), state: st, err: j.error, errKind: j.errKind });
      }
      continue;
    }
    const unpacking = s.phase === 'unpacking';
    let state: HeldState = b.busy || unpacking ? 'run' : 'ok';
    if (!b.busy && !unpacking && s.err && s.jobs.length === 0) state = 'err';
    out.push({ key: s.id, name: s.label, size: s.bytesTotal, kind: s.kind === 'zip' ? 'zip' : 'folder', state, err: s.err ?? undefined, done: s.ready, total: s.total, unpacking });
  }
  return out;
}
