import { Block, LIMITS, KX_VERSION, BLOCK_TYPES, type BlockType } from './schema';

export type Via = 'fence' | 'file';
export type ParseErr = { code: 'size' | 'json' | 'depth' | 'string' | 'version' | 'type' | 'fence' | 'schema'; detail?: string };
export type Parsed = { ok: true; block: Block } | { ok: false; err: ParseErr };

const bytes = (s: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : Buffer.byteLength(s));

function walk(v: unknown, depth: number): ParseErr | null {
  if (depth > LIMITS.depth) return { code: 'depth' };
  if (typeof v === 'string') return v.length > LIMITS.str ? { code: 'string' } : null;
  if (Array.isArray(v)) { for (const x of v) { const e = walk(x, depth + 1); if (e) return e; } return null; }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) { const e = walk(x, depth + 1); if (e) return e; } return null; }
  return null;
}

function fenceAllows(b: Block): boolean {
  if (b.type === 'rate' || b.type === 'map') return true;
  if (b.type === 'table') return b.data.columns.every((c) => c.kind === 'text' || c.kind === 'date' || c.kind === 'status') && !b.data.totals && !b.data.summary;
  return false;
}

const pathText = (p: readonly PropertyKey[]) => p.map((x) => (typeof x === 'number' ? `[${x}]` : String(x))).join('.').replace(/\.\[/g, '[');

export function parseBlock(raw: string, via: Via): Parsed {
  const max = via === 'fence' ? LIMITS.fenceBytes : LIMITS.fileBytes;
  if (bytes(raw) > max) return { ok: false, err: { code: 'size', detail: String(Math.round(max / 1024)) } };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, err: { code: 'json' } }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, err: { code: 'json' } };
  const o = j as { kx?: unknown; type?: unknown };
  if (o.kx !== KX_VERSION) return { ok: false, err: { code: 'version', detail: String(o.kx ?? '—') } };
  if (typeof o.type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(o.type)) return { ok: false, err: { code: 'type', detail: String(o.type ?? '—').slice(0, 30) } };
  const deep = walk(j, 0);
  if (deep) return { ok: false, err: deep };
  const r = Block.safeParse(j);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, err: { code: 'schema', detail: `${pathText(i.path)}${i.path.length ? ': ' : ''}${i.message}`.slice(0, 200) } };
  }
  if (via === 'fence' && !fenceAllows(r.data)) return { ok: false, err: { code: 'fence', detail: r.data.type } };
  return { ok: true, block: r.data };
}

export const isStage1 = (t: BlockType) => t === 'table' || t === 'kpi' || t === 'rate' || t === 'deadlines';
