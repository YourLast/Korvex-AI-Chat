import type { Cell, GridMeta } from './gridview';

const metas = new Map<string, Promise<GridMeta | null>>();
const rows = new Map<string, Promise<{ head: string[]; cells: string[] } | null>>();
const lines = new Map<string, Promise<string | null>>();
const txt = (c: Cell | undefined) => (c === undefined ? '' : typeof c === 'string' ? c : c[0]);
const nm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/[«»"']/g, '');

export function gridMeta(id: string): Promise<GridMeta | null> {
  let p = metas.get(id);
  if (!p) {
    p = (async () => {
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`/api/files/${id}/view?wait=12000`);
        if (!r.ok) return null;
        const j = (await r.json()) as { state?: string; kind?: string; meta?: GridMeta };
        if (j.state === 'pending') continue;
        return j.kind === 'grid' && j.meta ? j.meta : null;
      }
      return null;
    })().catch(() => null);
    metas.set(id, p);
    p.then((m) => { if (!m) metas.delete(id); });
  }
  return p;
}

export function sheetOf(meta: GridMeta, name: string | undefined): number {
  if (!name) return 0;
  const n = nm(name);
  const i = meta.sheets.findIndex((s) => nm(s.name) === n);
  if (i >= 0) return i;
  const j = meta.sheets.findIndex((s) => nm(s.name).includes(n) || n.includes(nm(s.name)));
  return j >= 0 ? j : meta.sheets.length === 1 ? 0 : -1;
}

export function peekRow(id: string, sheet: string | undefined, row: number): Promise<{ head: string[]; cells: string[] } | null> {
  const key = `${id}|${sheet ?? ''}|${row}`;
  let p = rows.get(key);
  if (!p) {
    p = (async () => {
      const meta = await gridMeta(id);
      if (!meta) return null;
      const si = sheetOf(meta, sheet);
      if (si < 0) return null;
      const sh = meta.sheets[si];
      if (row < 1 || row > sh.rows) return null;
      const list = sh.header && sh.header !== row ? [sh.header, row] : [row];
      const r = await fetch(`/api/files/${id}/grid?sheet=${si}&rows=${list.join(',')}`);
      if (!r.ok) return null;
      const j = (await r.json()) as { rows?: Record<string, Cell[]> };
      const cells = (j.rows?.[String(row)] ?? []).map(txt);
      const head = sh.header && sh.header !== row ? (j.rows?.[String(sh.header)] ?? []).map(txt) : [];
      return { head, cells };
    })().catch(() => null);
    rows.set(key, p);
  }
  return p;
}

export function peekLine(id: string, line: number): Promise<string | null> {
  const key = `${id}|${line}`;
  let p = lines.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch(`/api/files/${id}/text?from=${line}&to=${line}`);
      if (!r.ok) return null;
      return ((await r.json()) as { lines?: string[] }).lines?.[0] ?? null;
    })().catch(() => null);
    lines.set(key, p);
  }
  return p;
}
export const _resetPeek = () => { metas.clear(); rows.clear(); lines.clear(); };
