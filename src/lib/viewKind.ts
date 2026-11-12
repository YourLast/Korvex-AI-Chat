export type ViewKind = 'pdf' | 'convert' | 'grid' | 'md' | 'text' | 'extracted' | 'none';

const CONVERT = new Set(['docx', 'doc', 'docm', 'dotx', 'odt', 'rtf', 'pptx', 'ppt', 'pps', 'ppsx', 'odp']);
const GRID = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv']);
const EXTRACTED = new Set(['eml', 'msg', 'html', 'htm', 'xhtml', 'mht', 'mhtml', 'epub', 'fb2', 'parquet', 'sav', 'dta']);
const TEXT = new Set(['txt', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'env', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'sql', 'kt', 'swift', 'lua', 'r', 'tex', 'srt', 'vtt', 'bat', 'ps1', 'diff', 'patch', 'properties', 'gradle']);

export const extOfName = (name: string) => (/\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1] ?? '').toLowerCase();

export function viewKind(name: string): ViewKind {
  const e = extOfName(name);
  if (e === 'pdf') return 'pdf';
  if (CONVERT.has(e)) return 'convert';
  if (GRID.has(e)) return 'grid';
  if (e === 'md' || e === 'markdown') return 'md';
  if (EXTRACTED.has(e)) return 'extracted';
  if (TEXT.has(e)) return 'text';
  return 'none';
}
export const comparable = (name: string) => { const k = viewKind(name); return k === 'pdf' || k === 'convert' || k === 'md' || k === 'text' || k === 'extracted'; };

export function isCardText(text: string | null | undefined, info: Record<string, unknown> | null | undefined): boolean {
  if (info?.unparsed === true || info?.format === 'binary') return true;
  return /^\s*\[?Файл «[^»]*»[^\n]{0,40}(формат не разобран|сохранён без разбора)/.test(String(text ?? '').slice(0, 300));
}
