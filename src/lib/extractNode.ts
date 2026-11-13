import path from 'node:path';
import yauzl from 'yauzl';
import * as XLSX from 'xlsx';
import type { Extracted } from './extract';

const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm', '.yaml', '.yml', '.log', '.ini', '.toml', '.cfg', '.conf',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.sql', '.css', '.scss', '.tex', '.rst', '.srt', '.vtt']);
const SHEETS = new Set(['.xlsx', '.xlsm', '.xls', '.ods']);
const MAX_ZIP_ENTRY = 64 * 1024 * 1024;

function looksText(b: Buffer): boolean {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.length - 4 > 0 ? head.length - 4 : head.length)); return true; } catch { return false; }
}

export function decodeText(b: Buffer): string {
  const body = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body); } catch {  }
  try { return new TextDecoder('windows-1251').decode(body); } catch { return body.toString('utf8'); }
}
function looksCp1251(b: Buffer): boolean {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  let t = '';
  try { t = new TextDecoder('windows-1251').decode(head); } catch { return false; }
  return (t.match(/[А-Яа-яЁё]/g)?.length ?? 0) > 8;
}

function zipEntries(data: Buffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('архив не открылся'));
      const out = new Map<string, string>();
      zip.on('entry', (e: yauzl.Entry) => {
        if (!want(e.fileName) || e.uncompressedSize > MAX_ZIP_ENTRY) { zip.readEntry(); return; }
        zip.openReadStream(e, (er, rs) => {
          if (er || !rs) { zip.readEntry(); return; }
          const parts: Buffer[] = [];
          rs.on('data', (d: Buffer) => parts.push(d));
          rs.on('end', () => { out.set(e.fileName, Buffer.concat(parts).toString('utf8')); zip.readEntry(); });
          rs.on('error', () => zip.readEntry());
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function xmlText(xml: string, ns: 'w' | 'a'): string {
  const paras = xml.split(new RegExp(`</${ns}:p>`));
  return paras.map((p) => {
    let t = '';
    const re = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:tab\\s*/>|<${ns}:br\\s*/>`, 'g');
    for (const m of p.matchAll(re)) t += m[1] !== undefined ? unxml(m[1]) : m[0].includes(':tab') ? '\t' : '\n';
    return t;
  }).filter((x) => x.trim()).join('\n');
}

async function pdfText(data: Buffer): Promise<Extracted> {
  const pdfjs = await import(/* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      const text = tc.items.map((x) => ('str' in x ? x.str + (x.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      pages.push(`[page ${i}]\n${text}`);
    }
    return { text: pages.join('\n\n'), info: { format: 'pdf', pages: doc.numPages } };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export async function extractNode(data: Buffer, name: string): Promise<Extracted> {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return pdfText(data);
  if (ext === '.docx') {
    const z = await zipEntries(data, (n) => n === 'word/document.xml');
    const xml = z.get('word/document.xml');
    if (!xml) throw new Error('в документе нет текста (word/document.xml)');
    return { text: xmlText(xml, 'w'), info: { format: 'docx' } };
  }
  if (ext === '.pptx') {
    const z = await zipEntries(data, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const slides = [...z.entries()].sort((a, b) => Number(/(\d+)\.xml$/.exec(a[0])![1]) - Number(/(\d+)\.xml$/.exec(b[0])![1]));
    return { text: slides.map(([, xml], i) => `[slide ${i + 1}]\n${xmlText(xml, 'a')}`).join('\n\n'), info: { format: 'pptx', slides: slides.length } };
  }
  if (SHEETS.has(ext)) {
    const wb = XLSX.read(data, { type: 'buffer', cellDates: true });
    const text = wb.SheetNames.map((n) => `[sheet ${n}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n');
    return { text, info: { format: ext.slice(1), sheets: wb.SheetNames.length } };
  }
  if (TEXT.has(ext) || looksText(data) || looksCp1251(data)) return { text: decodeText(data), info: { format: 'text' } };
  throw new Error('этот формат пока не читается');
}
