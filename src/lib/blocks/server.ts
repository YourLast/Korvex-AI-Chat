import fs from 'node:fs';
import path from 'node:path';
import { OUT_PREFIX, outRoot, ownsToken } from '../outfiles';
import { outOwner } from '../adminView';
import { parseBlock, type Parsed } from './parse';
import { LIMITS, type DeadlinesBlock, type TableBlock } from './schema';
import { fmtDate } from './money';
import { tr, type Lang } from '../i18n/core';

export function blockFilePath(userId: string, href: string, admin = false): string | null {
  if (!href.startsWith(OUT_PREFIX)) return null;
  const m = /^([0-9a-f]{32})\/([^/\\]+)$/.exec(href.slice(OUT_PREFIX.length).split('?')[0]);
  if (!m) return null;
  let name: string;
  try { name = decodeURIComponent(m[2]); } catch { return null; }
  if (!/\.kxb\.json$/i.test(name) || name.startsWith('.') || name.includes('/') || name.includes('\\')) return null;
  if (!ownsToken(userId, m[1]) && !(admin && outOwner(m[1]))) return null;
  const root = path.resolve(outRoot(), m[1]);
  const file = path.resolve(root, name);
  return file.startsWith(root + path.sep) ? file : null;
}

export function readBlockFile(file: string): Parsed | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > LIMITS.fileBytes) return null;
    return parseBlock(fs.readFileSync(file, 'utf8'), 'file');
  } catch { return null; }
}

const toNum = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : v; };
const toDate = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v; };

export async function tableXlsx(b: TableBlock, lang: Lang): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korvex';
  const ws = wb.addWorksheet(b.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Таблица');
  const cols = b.data.columns;
  const notes = b.data.rows.some((r) => r.note || r.verified === false);
  ws.addRow([b.title]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const head = ws.addRow([...cols.map((c) => c.title), ...(notes ? [tr(lang, 'blk.tbl.status.warn')] : [])]);
  head.font = { bold: true };
  head.eachCell((c) => { c.border = { bottom: { style: 'thin' } }; });
  for (const r of b.data.rows) {
    const vals = cols.map((c) => {
      const v = r[c.key];
      if (v == null || v === '' || typeof v === 'boolean') return null;
      if (c.kind === 'money' || c.kind === 'number' || c.kind === 'percent') return toNum(v);
      if (c.kind === 'date') return toDate(v);
      if (c.kind === 'status') return v ? tr(lang, `blk.tbl.status.${v}` as 'blk.tbl.status.pos') : null;
      return v;
    });
    if (notes) vals.push(`${r.verified === false ? `${tr(lang, 'blk.notVerified')}${r.note ? ': ' : ''}` : ''}${r.note ?? ''}` || null);
    ws.addRow(vals);
  }
  const first = 4, last = 3 + b.data.rows.length;
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === 'money') col.numFmt = '#,##0.00';
    else if (c.kind === 'date') col.numFmt = 'dd.mm.yyyy';
    else if (c.kind === 'percent') col.numFmt = '0.##';
    col.width = Math.min(48, Math.max(10, c.title.length + 2, ...b.data.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2)));
  });
  const tot = cols.map((c, i) => (c.total && c.kind === 'money' && b.data.rows.length ? { formula: `SUM(${ws.getColumn(i + 1).letter}${first}:${ws.getColumn(i + 1).letter}${last})` } : null));
  if (tot.some(Boolean)) {
    const row = ws.addRow(tot.map((t, i) => (i === 0 && !t ? tr(lang, 'blk.tbl.totalAll') : t)));
    row.font = { bold: true };
    row.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
  }
  if (b.source.basis) ws.addRow([]).getCell(1).value = b.source.basis;
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string): string {
  const out: string[] = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > 75) { out.push(cur); cur = ' '; n = 1; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function deadlinesIcs(b: DeadlinesBlock, lang: Lang, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Korvex//Blocks//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(b.title)}`];
  b.data.items.forEach((x, i) => {
    const d = x.date.replace(/-/g, '');
    const next = new Date(Date.UTC(+x.date.slice(0, 4), +x.date.slice(5, 7) - 1, +x.date.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    const desc = [x.basis, x.orig ? tr(lang, x.reason ? 'blk.dl.moved' : 'blk.dl.movedPlain', { orig: fmtDate(x.orig, lang), reason: x.reason ?? '', date: fmtDate(x.date, lang) }) : ''].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${d}-${i}-${Buffer.from(x.what).toString('hex').slice(0, 16)}@korvex`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsText(x.what)}`, ...(desc ? [`DESCRIPTION:${icsText(desc)}`] : []), 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(x.what)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function attachment(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'korvex';
  return `attachment; filename="block.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`;
}
