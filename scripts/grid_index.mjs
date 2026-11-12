#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [, , file, out, ext] = process.argv;
const CHUNK = 500, MAX_ROWS = 600000, MAX_COLS = 256, MAX_CELL = 1000, EXCELJS_MAX_BYTES = 12 * 1024 * 1024;
const require = createRequire(import.meta.url);

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {  }
  const FREQ = 'оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфё';
  const score = (s) => { let g = 0, bad = 0; for (const ch of s.toLowerCase()) { if (FREQ.includes(ch)) g++; const c = ch.codePointAt(0); if (c >= 0x2500 && c <= 0x259f) bad += 4; else if ('ЂЃЌЋЏђѓќћџЎўЈҐЄЇІіґєїјЅѕЉЊљњ'.includes(ch)) bad += 3; } return g - bad * 3; };
  const sample = buf.subarray(0, 65536);
  const a = new TextDecoder('windows-1251'), b = new TextDecoder('ibm866');
  return score(b.decode(sample)) > score(a.decode(sample)) ? b.decode(buf) : a.decode(buf);
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = []; i++;
      if (rows.length >= MAX_ROWS) break;
      continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clip = (v) => { const s = v == null ? '' : String(v); return s.length > MAX_CELL ? s.slice(0, MAX_CELL) + '…' : s; };
const entryText = (e) => (typeof e === 'string' ? e : e[0]);
const isBlank = (e) => entryText(e) === '' && typeof e === 'string';

const styles = [{}];
const styleIdx = new Map([['{}', 0]]);
function styleId(def) {
  const k = JSON.stringify(def);
  let i = styleIdx.get(k);
  if (i === undefined) { i = styles.length; styles.push(def); styleIdx.set(k, i); }
  return i;
}

const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
let THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
function readTheme(xml) {
  if (!xml) return;
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const got = names.map((n) => {
    const m = new RegExp(`<a:${n}>([\\s\\S]*?)</a:${n}>`).exec(xml);
    if (!m) return null;
    const c = /(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/.exec(m[1]);
    return c ? c[1].toUpperCase() : null;
  });
  THEME = THEME.map((d, i) => got[i] || d);
}
function tint(hex, t) {
  if (!t) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const f = (p, q, x) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  let rr, gg, bb;
  if (s === 0) rr = gg = bb = l;
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; rr = f(p, q, h + 1 / 3); gg = f(p, q, h); bb = f(p, q, h - 1 / 3); }
  const x = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return (x(rr) + x(gg) + x(bb)).toUpperCase();
}
function colorOf(c) {
  if (!c) return undefined;
  let hex;
  if (typeof c.argb === 'string' && c.argb.length >= 6) hex = c.argb.slice(-6).toUpperCase();
  else if (typeof c.theme === 'number') hex = tint(THEME[c.theme] ?? '000000', c.tint || 0);
  else if (typeof c.indexed === 'number') hex = INDEXED[c.indexed];
  return hex ? '#' + hex.toLowerCase() : undefined;
}

let SSF = null;
const getSSF = () => (SSF ??= require('xlsx').SSF);
const EPOCH = Date.UTC(1899, 11, 30);
const serialOf = (d) => (d.getTime() - EPOCH) / 86400000;
function escapeDots(z) {
  const bare = z.replace(/"[^"]*"|\\./g, '');
  if (!/[dy]/i.test(bare)) return z;
  return z.replace(/("[^"]*")|(\\.)|\./g, (m, q, esc) => (q || esc ? m : '\\.'));
}
const SHORT_DATE = (z) => z === 'mm-dd-yy' || z === 'm/d/yy' || z === 'mm-dd-yyyy';
function markOf(z, isDate) {
  if (z === '@') return 0;
  if (SHORT_DATE(z) || (isDate && (!z || z === 'General'))) return 2;
  if (z && z !== 'General') { try { if (getSSF().is_date(z)) return 0; } catch {  } }
  return isDate ? 0 : 1;
}
function fmtNum(v, z) {
  if (z === 'mm-dd-yy' || z === 'm/d/yy' || z === 'mm-dd-yyyy') z = 'dd.mm.yyyy';
  const fmt = z && z !== 'General' ? z : 'General';
  try { return getSSF().format(fmt, v).replace(/^\s+/, ''); } catch {  }
  try { return getSSF().format(escapeDots(fmt), v).replace(/^\s+/, ''); } catch { return String(v); }
}

const sheets = [];
function writeSheet(si, name, rows, cols, truncated, extra = {}) {
  let last = rows.length;
  while (last > 0 && rows[last - 1].every(isBlank)) last--;
  rows.length = last;
  let header = 1;
  for (let i = 0; i < rows.length; i++) if (rows[i].some((c) => !isBlank(c))) { header = i + 1; break; }
  let k = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map((r) => r.map((e) => (typeof e === 'string' ? clip(e) : [clip(e[0]), e[1], ...(e[3] ? [e[2] ? clip(e[2]) : '', e[3]] : e[2] ? [clip(e[2])] : [])])));
    fs.writeFileSync(path.join(out, `s${si}-${k++}.json`), JSON.stringify(part));
  }
  sheets.push({ name, rows: rows.length, cols, header, chunks: k, truncated, ...extra });
}

const BORDER_W = { hair: 1, thin: 1, dotted: 1, dashed: 1, medium: 2, mediumDashed: 2, thick: 3, double: 3 };
function borderDef(b) {
  if (!b) return undefined;
  const o = {};
  for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
    const x = b[side];
    if (x && x.style) o[k] = [BORDER_W[x.style] ?? 1, /dash|hair/i.test(x.style) ? 'd' : /dot/i.test(x.style) ? 'o' : x.style === 'double' ? 'x' : 's', colorOf(x.color) ?? '#000000'];
  }
  return Object.keys(o).length ? o : undefined;
}
function cellText(cell) {
  let v = cell.value;
  const z = cell.numFmt;
  let formula;
  if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v) { formula = '=' + v.formula; v = v.result; }
  else if (v && typeof v === 'object' && !(v instanceof Date) && 'sharedFormula' in v) { formula = '=' + (cell.formula || ''); v = v.result; }
  if (v == null) return { t: '', n: false, formula };
  if (v instanceof Date) return { t: fmtNum(serialOf(v), z && z !== 'General' ? z : 'dd.mm.yyyy'), n: true, formula, m: markOf(z, true) };
  if (typeof v === 'number') return { t: fmtNum(v, z), n: true, formula, m: markOf(z, false) };
  if (typeof v === 'boolean') return { t: v ? 'TRUE' : 'FALSE', n: false, formula, c: true };
  if (typeof v === 'string') return { t: v, n: false, formula };
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return { t: v.richText.map((x) => x.text).join(''), n: false, formula };
    if (v.error) return { t: String(v.error), n: false, formula, c: true };
    if (v.text !== undefined) return { t: typeof v.text === 'object' && Array.isArray(v.text.richText) ? v.text.richText.map((x) => x.text).join('') : String(v.text), n: false, formula };
  }
  return { t: String(v), n: false, formula };
}
async function viaExcelJs(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  readTheme(wb.model && wb.model.themes && (wb.model.themes.theme1 || Object.values(wb.model.themes)[0]));
  wb.worksheets.forEach((ws, si) => {
    const nRows = Math.min(ws.rowCount || 0, MAX_ROWS), nCols = Math.min(ws.columnCount || 0, MAX_COLS);
    const truncated = (ws.rowCount || 0) > MAX_ROWS || (ws.columnCount || 0) > MAX_COLS;
    const rows = new Array(nRows);
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (r > nRows) return;
      const arr = new Array(nCols).fill('');
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c > nCols) return;
        if (cell.type === 1 && cell.master && cell.master.address !== cell.address) { arr[c - 1] = ['', styleFor(cell.master, { t: '', n: false }), undefined]; return; }
        const x = cellText(cell);
        const sid = styleFor(cell, x);
        arr[c - 1] = sid === 0 && !x.formula && !x.m ? x.t : [x.t, sid, x.formula, x.m || undefined];
      });
      rows[r - 1] = arr;
    });
    for (let i = 0; i < nRows; i++) if (!rows[i]) rows[i] = [];
    const defCol = ws.properties && ws.properties.defaultColWidth ? ws.properties.defaultColWidth : 8.43;
    const widths = [];
    let anyWidth = false;
    for (let c = 1; c <= nCols; c++) {
      const col = ws.getColumn(c);
      const w = col.hidden ? 0 : Math.round((col.width || defCol) * 7 + 5);
      if (col.width || col.hidden) anyWidth = true;
      widths.push(w);
    }
    const heights = {};
    ws.eachRow({ includeEmpty: false }, (row, r) => { if (r <= nRows && (row.height || row.hidden)) heights[r] = row.hidden ? 0 : Math.round(row.height * 4 / 3); });
    const merges = ((ws.model && ws.model.merges) || []).filter((m) => typeof m === 'string').slice(0, 5000);
    const view = (ws.views || [])[0] || {};
    const frozen = view.state === 'frozen' ? { rows: view.ySplit || 0, cols: view.xSplit || 0 } : undefined;
    const tab = ws.properties && ws.properties.tabColor ? colorOf(ws.properties.tabColor) : undefined;
    writeSheet(si, ws.name, rows, nCols, truncated, {
      ...(anyWidth ? { widths } : {}), ...(Object.keys(heights).length ? { heights } : {}), ...(merges.length ? { merges } : {}),
      ...(frozen && (frozen.rows || frozen.cols) ? { frozen } : {}), ...(view.showGridLines === false ? { grid: false } : {}), ...(tab ? { tab } : {}),
      ...(ws.state && ws.state !== 'visible' ? { hidden: true } : {}),
    });
  });
}
function styleFor(cell, x) {
  const def = {};
  const f = cell.font;
  if (f) {
    if (f.bold) def.b = 1;
    if (f.italic) def.i = 1;
    if (f.underline) def.u = 1;
    if (f.strike) def.s = 1;
    const c = colorOf(f.color);
    if (c && c !== '#000000') def.c = c;
    if (f.size && f.size !== 11) def.sz = f.size;
  }
  const fl = cell.fill;
  if (fl && fl.type === 'pattern' && fl.pattern === 'solid') { const c = colorOf(fl.fgColor); if (c && c !== '#ffffff') def.f = c; }
  const al = cell.alignment;
  if (al) {
    if (al.horizontal && al.horizontal !== 'general') def.h = { left: 'l', center: 'c', centerContinuous: 'c', right: 'r', justify: 'j', fill: 'l', distributed: 'c' }[al.horizontal];
    if (al.vertical) def.v = { top: 't', middle: 'm', center: 'm', bottom: 'b' }[al.vertical];
    if (al.wrapText) def.w = 1;
    if (al.indent) def.in = al.indent;
  }
  if (!def.h && x.n) def.h = 'r';
  else if (!def.h && x.c) def.h = 'c';
  const bd = borderDef(cell.border);
  if (bd) def.bd = bd;
  return Object.keys(def).length ? styleId(def) : 0;
}

function viaSheetJs(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', dense: true, cellDates: false, cellNF: true, cellStyles: false, sheetStubs: false });
  wb.SheetNames.forEach((name, si) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) { writeSheet(si, name, [], 0, false); return; }
    const rg = XLSX.utils.decode_range(ws['!ref']);
    let truncated = false;
    if (rg.e.r + 1 > MAX_ROWS) { rg.e.r = MAX_ROWS - 1; truncated = true; }
    if (rg.e.c + 1 > MAX_COLS) { rg.e.c = MAX_COLS - 1; truncated = true; }
    const data = ws['!data'] || [];
    const nCols = rg.e.c + 1;
    const rows = [];
    for (let r = 0; r <= rg.e.r; r++) {
      const src = data[r];
      const arr = new Array(nCols).fill('');
      if (src) for (let c = 0; c < nCols; c++) {
        const cell = src[c];
        if (!cell || cell.v === undefined) continue;
        let t;
        if (cell.t === 'n' && cell.z && cell.z !== 'General') t = fmtNum(cell.v, cell.z);
        else if (typeof cell.w === 'string') t = cell.w;
        else if (cell.t === 'n') t = fmtNum(cell.v, 'General');
        else if (cell.t === 'b') t = cell.v ? 'TRUE' : 'FALSE';
        else t = String(cell.v);
        const num = cell.t === 'n';
        arr[c] = num ? [t.replace(/^\s+/, ''), styleId({ h: 'r' }), cell.f ? '=' + cell.f : undefined, markOf(cell.z, false) || undefined] : (cell.f ? [t, 0, '=' + cell.f] : t);
      }
      rows.push(arr);
    }
    const widths = (ws['!cols'] || []).slice(0, nCols).map((c) => (c ? (c.hidden ? 0 : Math.round(c.wpx || (c.wch ? c.wch * 7 + 5 : 64))) : 64));
    const merges = (ws['!merges'] || []).map((m) => XLSX.utils.encode_range(m)).slice(0, 5000);
    const heights = {};
    (ws['!rows'] || []).forEach((rw, i) => { if (rw && (rw.hpx || rw.hpt || rw.hidden) && i < rows.length) heights[i + 1] = rw.hidden ? 0 : Math.round(rw.hpx || rw.hpt * 4 / 3); });
    writeSheet(si, name, rows, nCols, truncated, { ...(widths.length ? { widths } : {}), ...(merges.length ? { merges } : {}), ...(Object.keys(heights).length ? { heights } : {}) });
  });
}

fs.mkdirSync(out, { recursive: true });
const buf = fs.readFileSync(file);
if (ext === 'csv' || ext === 'tsv') {
  const text = decodeText(buf);
  const first = text.slice(0, text.search(/\r|\n|$/));
  const delim = ext === 'tsv' ? '\t' : [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  let rows = parseCsv(text, delim);
  const trunc = rows.length >= MAX_ROWS;
  let cols = 0;
  rows = rows.map((r) => { if (r.length > MAX_COLS) r = r.slice(0, MAX_COLS); cols = Math.max(cols, r.length); return r; });
  writeSheet(0, path.basename(file).replace(/\.[^.]+$/, '') || 'CSV', rows, cols, trunc);
} else if ((ext === 'xlsx' || ext === 'xlsm') && buf.length <= EXCELJS_MAX_BYTES) {
  try { await viaExcelJs(buf); }
  catch (e) { console.error('exceljs:', e && e.message); sheets.length = 0; viaSheetJs(buf); }
} else {
  viaSheetJs(buf);
}
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ v: 3, styles, sheets }));
