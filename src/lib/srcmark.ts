import { tr, type Key, type Lang } from './i18n/core';
import { EXTRA_KEY } from '@/ext/client';

export type SrcKind = 'page' | 'row' | 'cell' | 'slide' | 'line' | 'sheet';
export type Source = {
  n?: number; raw: string; file: string; file_ref?: string; kind: SrcKind;
  sheet?: string; page?: number; page_to?: number; row?: number; row_to?: number; col?: string | number; slide?: number; line?: number; line_to?: number;
  attachment?: string; quote?: string; verified: boolean; reason?: string;
  row_values?: { header: string[]; values: string[] }; snippet?: string;
  auto?: boolean; quote_added?: boolean;
};

export const SRC_MARKER = /\[\[src:([\s\S]*?)\]\]/g;

export type Parsed = { file: string; loc: string; quote: string };
export function parseMarker(inner0: string): Parsed {
  const inner = inner0.replace(/\\\|/g, '|');
  const i = inner.indexOf('|');
  if (i < 0) return { file: inner.trim(), loc: '', quote: '' };
  const file = inner.slice(0, i).trim();
  const rest = inner.slice(i + 1);
  const j = rest.indexOf('|');
  const loc = (j < 0 ? rest : rest.slice(0, j)).trim();
  let quote = j < 0 ? '' : rest.slice(j + 1).trim();
  quote = quote.replace(/^["«„“]/, '').replace(/["»”“]$/, '').trim();
  return { file, loc, quote };
}

export function parseLocator(loc: string): Partial<Source> | null {
  let s = loc.trim().replace(/[\s.;]+$/, '');
  let attachment: string | undefined;
  const att = /^(?:вложение|attachment|prilog)\s+(.+?),\s*(.+)$/i.exec(s);
  if (att) { attachment = att[1].trim(); s = att[2].trim(); }
  const rng = (a: string, b?: string): [number, number | undefined] => [Number(a), b ? Number(b) : undefined];
  const R = '(\\d+)(?:\\s*[–—-]\\s*(\\d+))?';
  const PG = '(?:стр\\.?|с\\.|pp?\\.?|pages?|страниц[аы]?|str\\.?)';
  const RW = '(?:строк[аи]?|стр\\.?|rows?|lines?|red(?:ovi)?\\.?)';
  const unq = (x: string) => x.replace(/^["«„“]|["»“”]$/g, '');
  let m = new RegExp(`^(?:лист|sheet|list)\\s+(.+?),\\s*${RW}\\s*${R}$`, 'i').exec(s);
  if (m) { const [r, rt] = rng(m[2], m[3]); return { kind: 'row', sheet: unq(m[1]), row: r, row_to: rt, attachment }; }
  m = /^(?:лист|sheet|list)\s+(.+?),\s*(?:ячейка|cell|ćelija)\s+([A-Za-z]{1,3})(\d+)$/i.exec(s);
  if (m) return { kind: 'cell', sheet: unq(m[1]), col: m[2].toUpperCase(), row: Number(m[3]), attachment };
  m = /^(?:ячейка|cell|ćelija)\s+([A-Za-z]{1,3})(\d+)$/i.exec(s);
  if (m) return { kind: 'cell', col: m[1].toUpperCase(), row: Number(m[2]), attachment };
  m = new RegExp(`^(?:слайд[ы]?|slides?|slajd[ovi]*)\\s*${R}$`, 'i').exec(s);
  if (m) return { kind: 'slide', slide: Number(m[1]), attachment };
  m = new RegExp(`^(?:строк[аи]?|lines?|rows?|red(?:ovi)?\\.?)\\s*${R}$`, 'i').exec(s);
  if (m) { const [r, rt] = rng(m[1], m[2]); return { kind: 'line', line: r, line_to: rt, attachment }; }
  m = new RegExp(`^${PG}\\s*${R}$`, 'i').exec(s);
  if (m) { const [r, rt] = rng(m[1], m[2]); return { kind: 'page', page: r, page_to: rt, attachment }; }
  m = /^(?:лист|sheet|list)\s+(.+)$/i.exec(s);
  if (m) return { kind: 'sheet', sheet: unq(m[1].trim()), attachment };
  return null;
}

export function markerLoc(loc: string, t: (k: never, p?: Record<string, string | number>) => string): string {
  const p = parseLocator(loc);
  return p?.kind ? locLabel(p as Pick<Source, 'kind'>, t) : '';
}

export function asSource(x: unknown): Source | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined; };
  const kind = (['page', 'row', 'cell', 'slide', 'line', 'sheet'] as const).find((k) => k === o.kind);
  if (!kind || typeof o.file !== 'string') return null;
  return {
    n: num(o.n), raw: typeof o.raw === 'string' ? o.raw : '', file: o.file, file_ref: typeof o.file_ref === 'string' && o.file_ref ? o.file_ref : undefined, kind,
    sheet: typeof o.sheet === 'string' && o.sheet ? o.sheet : undefined, page: num(o.page), page_to: num(o.page_to), row: num(o.row), row_to: num(o.row_to),
    col: typeof o.col === 'string' || typeof o.col === 'number' ? o.col : undefined,
    slide: num(o.slide), line: num(o.line), line_to: num(o.line_to), attachment: typeof o.attachment === 'string' && o.attachment ? o.attachment : undefined,
    quote: typeof o.quote === 'string' && o.quote ? o.quote : undefined, verified: o.verified === true, reason: typeof o.reason === 'string' ? o.reason : undefined,
    row_values: rowValues(o.row_values), snippet: typeof o.snippet === 'string' && o.snippet.trim() ? o.snippet.trim() : undefined,
    auto: o.auto === true ? true : undefined, quote_added: o.quote_added === true ? true : undefined,
  };
}
function rowValues(v: unknown): Source['row_values'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const arr = (a: unknown) => (Array.isArray(a) ? a.map((x) => (x == null ? '' : String(x))) : null);
  const values = arr(o.values), header = arr(o.header) ?? [];
  return values && values.some((x) => x.trim()) ? { header, values } : undefined;
}
export const sourcesOf = (usage: unknown): Source[] | null => {
  const list = ((usage as Record<string, { sources?: unknown } | undefined> | null | undefined)?.[EXTRA_KEY])?.sources;
  if (!Array.isArray(list)) return null;
  return list.map(asSource).filter((s): s is Source => !!s);
};

export function colName(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
export function colIndex(c: string | number | undefined): number | undefined {
  if (typeof c === 'number') return c > 0 ? c : undefined;
  if (!c) return undefined;
  if (/^\d+$/.test(c)) return Number(c);
  if (!/^[A-Za-z]{1,3}$/.test(c)) return undefined;
  return [...c.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
}

export function locLabel(s: Pick<Source, 'kind' | 'sheet' | 'page' | 'page_to' | 'row' | 'row_to' | 'col' | 'slide' | 'line' | 'line_to'>, t: (k: never, p?: Record<string, string | number>) => string): string {
  const T = t as unknown as (k: string, p?: Record<string, string | number>) => string;
  const span = (a: number | undefined, b: number | undefined) => (b && a && b > a ? `${a}–${b}` : String(a ?? 1));
  if (s.kind === 'page') return T('files.loc.page', { n: span(s.page, s.page_to) });
  if (s.kind === 'slide') return T('files.loc.slide', { n: s.slide ?? 1 });
  if (s.kind === 'line') return T('files.loc.line', { n: span(s.line, s.line_to) });
  if (s.kind === 'sheet') return T('files.loc.sheetOnly', { sheet: s.sheet ?? '' });
  if (s.kind === 'row') return s.sheet ? T('files.loc.row', { sheet: s.sheet, n: span(s.row, s.row_to) }) : T('files.loc.rowNoSheet', { n: span(s.row, s.row_to) });
  const cell = `${typeof s.col === 'number' ? colName(s.col) : String(s.col ?? '').toUpperCase()}${s.row ?? ''}`;
  return s.sheet ? T('files.loc.cell', { sheet: s.sheet, cell }) : T('files.loc.cellNoSheet', { cell });
}

export function clauseOf(s: Pick<Source, 'kind' | 'quote' | 'snippet'>): string | null {
  if (s.kind !== 'page' || !s.quote) return null;
  const quote = quoteView(s.quote);
  const head = /^\s*[«"]?(\d{1,2}(?:\.\d{1,2}){1,2})\.?\s+(?=[A-ZА-ЯЁ«"(])/.exec(quote);
  if (head) return head[1];
  const sn = s.snippet ?? '';
  const words = quote.replace(/^[\s….]+/, '').split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!sn || words.length < 2) return null;
  let at = -1;
  try { at = new RegExp(words.join('[^\\p{L}\\p{N}]+'), 'iu').exec(sn)?.index ?? -1; } catch { return null; }
  if (at <= 0) return null;
  let last: string | null = null;
  for (const m of sn.slice(0, at).matchAll(/(?<![\d.,])(\d{1,2}(?:\.\d{1,2}){1,2})\.(?=\s)/g)) last = m[1];
  return last;
}

export function quoteView(q: string): string {
  return q.replace(/(?<!\*)\*\*(?!\*)/g, '').replace(/\s+/g, ' ').trim();
}

export const shortName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function stripMarkers(text: string, mode: 'plain' | 'drop' = 'plain', lang?: Lang): string {
  if (!text.includes('[[src:')) return text;
  const t = lang ? (((k: string, p?: Record<string, string | number>) => tr(lang, k as Key, p)) as never) : null;
  let out = text.replace(SRC_MARKER, (_m, inner: string) => {
    if (mode === 'drop') return '';
    const p = parseMarker(inner);
    const loc = t ? markerLoc(p.loc, t) : p.loc;
    return `(${shortName(p.file)}${loc ? ', ' + loc : ''})`;
  });
  out = out.replace(/\[\[src:[^\]]*$/, '');
  return out.replace(/[ \t]+([.,;:!?)])/g, '$1').replace(/ {2,}/g, ' ');
}

export function chipLabel(s: Pick<Source, 'kind' | 'sheet' | 'page' | 'page_to' | 'row' | 'row_to' | 'col' | 'slide' | 'line' | 'line_to'>, t: (k: never, p?: Record<string, string | number>) => string): string {
  const T = t as unknown as (k: string, p?: Record<string, string | number>) => string;
  const span = (a: number | undefined, b: number | undefined) => (b && a && b > a ? `${a}–${b}` : String(a ?? 1));
  const many = (a: number | undefined, b: number | undefined) => !!(a && b && b > a);
  if (s.kind === 'cell') return `${typeof s.col === 'number' ? colName(s.col) : String(s.col ?? '').toUpperCase()}${s.row ?? ''}`;
  if (s.kind === 'sheet') return T('files.chip.sheet', { sheet: s.sheet ?? '' });
  if (s.kind === 'slide') return T('files.chip.slide', { n: s.slide ?? 1 });
  if (s.kind === 'page') return T(many(s.page, s.page_to) ? 'files.chip.pages' : 'files.chip.page', { n: span(s.page, s.page_to) });
  if (s.kind === 'row') return T(many(s.row, s.row_to) ? 'files.chip.rows' : 'files.chip.row', { n: span(s.row, s.row_to) });
  return T(many(s.line, s.line_to) ? 'files.chip.rows' : 'files.chip.row', { n: span(s.line, s.line_to) });
}
export function chipName(path: string, max = 16): string {
  const base = shortName(path).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const a = Array.from(base);
  return a.length <= max ? base : `${a.slice(0, Math.ceil((max - 1) * 0.65)).join('')}…${a.slice(-Math.floor((max - 1) * 0.35)).join('')}`;
}
