import fs from 'node:fs';
import { decodeText, looksBinary, type Decoded } from './textdecode';

export const READ_LIMIT = 20 * 1024 * 1024;
export const MAX_WINDOW = 5000;
type Cached = { key: string; lines: string[]; enc: Decoded['enc']; truncated: boolean; binary: boolean };
const cache: Cached[] = [];

export function loadLines(file: string, st: fs.Stats): Cached {
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  const hit = cache.find((c) => c.key === key);
  if (hit) return hit;
  const fd = fs.openSync(file, 'r');
  let buf: Buffer;
  try { buf = Buffer.alloc(Math.min(st.size, READ_LIMIT)); fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  const binary = looksBinary(buf);
  const d = binary ? { text: '', enc: 'utf8' as const } : decodeText(buf);
  const lines = binary ? [] : d.text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const c: Cached = { key, lines, enc: d.enc, truncated: st.size > READ_LIMIT, binary };
  cache.unshift(c);
  if (cache.length > 3) cache.pop();
  return c;
}

export function textWindow(file: string, st: fs.Stats, from: number, to: number) {
  const c = loadLines(file, st);
  const a = Math.max(1, Math.floor(from) || 1);
  const b = Math.min(c.lines.length, Math.max(a, Math.floor(to) || a + 199), a + MAX_WINDOW - 1);
  return { total: c.lines.length, from: a, lines: c.lines.slice(a - 1, b), enc: c.enc, truncated: c.truncated, binary: c.binary };
}

const memo: { key: string; lines: string[] }[] = [];
const LABEL = /^\[lines \d+-\d+\]$/;
function linesOfText(key: string, text: string): string[] {
  const hit = memo.find((m) => m.key === key);
  if (hit) return hit.lines;
  const lines = text.split(/\r\n|\r|\n/).filter((l) => !LABEL.test(l.trim()));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  memo.unshift({ key, lines });
  if (memo.length > 3) memo.pop();
  return lines;
}
export const extractedTotal = (id: string, text: string) => linesOfText(`${id}:${text.length}`, text).length;
export function extractedWindow(id: string, text: string, from: number, to: number) {
  const lines = linesOfText(`${id}:${text.length}`, text);
  const a = Math.max(1, Math.floor(from) || 1);
  const b = Math.min(lines.length, Math.max(a, Math.floor(to) || a + 199), a + MAX_WINDOW - 1);
  return { total: lines.length, from: a, lines: lines.slice(a - 1, b), enc: 'utf8' as const, truncated: false, binary: false };
}

export function findLine(id: string, text: string, needle: string): number | null {
  const lines = linesOfText(`${id}:${text.length}`, text);
  const n = needle.trim().toLowerCase();
  const i = lines.findIndex((l) => l.trim().toLowerCase().startsWith(n));
  return i < 0 ? null : i + 1;
}
