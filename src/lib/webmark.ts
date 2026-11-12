
const FILE_EXT = new Set(('pdf doc docx docm xls xlsx xlsm xlsb csv tsv txt md markdown json jsonl ppt pptx odt ods odp rtf epub png jpg jpeg gif webp svg bmp tif tiff heic '
  + 'zip rar 7z gz tgz tar bz2 xz py js mjs cjs ts tsx jsx css scss html htm xml yaml yml toml ini cfg conf env lock log sql db sqlite ipynb eml msg '
  + 'mp3 mp4 m4a wav ogg mov avi mkv webm dwg dxf exe dll bin sh bash zsh bat ps1 pem key crt').split(' '));

const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?';
const HOST = `(?:${LABEL}\\.)+(?:\\p{L}{2,24}|xn--[a-z0-9-]{1,59})`;
const TOKEN_RE = new RegExp(`^(https?:\\/\\/)?((?:www\\.)?${HOST})(?::\\d{2,5})?([/?#][^\\s\\[\\]<>"'\`|,;]*)?$`, 'iu');
export const WEB_MARKER = /\[\[([^\[\]\n]{1,300})\]\]/g;

export type WebTarget = {
  host: string;
  url?: string;
  path?: string;
};

export function webTarget(tok0: string): WebTarget | null {
  const tok = tok0.trim().replace(/^[«"“'(<]+|[»"”'.)>:]+$/g, '');
  const m = TOKEN_RE.exec(tok);
  if (!m) return null;
  const host = m[2].toLowerCase().replace(/^www\./, '');
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (!m[1] && !/^www\./i.test(m[2]) && FILE_EXT.has(tld)) return null;
  const path = m[3] && m[3] !== '/' ? m[3] : undefined;
  return { host, ...(m[1] ? { url: tok } : {}), ...(path ? { path } : {}) };
}

export function webTargets(inner: string): WebTarget[] | null {
  const s = inner.trim();
  if (!s || /^\s*src\s*:/i.test(s)) return null;
  const parts = s.split(/\s*[,;|]\s*|\s+(?:и|and|i)\s+|\s+/u).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const out: WebTarget[] = [];
  for (const p of parts) {
    const t = webTarget(p);
    if (!t) return null;
    if (!out.some((x) => x.host === t.host && x.url === t.url && x.path === t.path)) out.push(t);
  }
  return out;
}

const hostOf = (u: string): string => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

export function turnUrls(texts: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const add = (u0: string) => {
    let u = u0;
    for (;;) {
      const t = u.replace(/[.,;:!?»”"'’]+$/, '');
      const unbalanced = t.endsWith(')') && (t.match(/\(/g)?.length ?? 0) < (t.match(/\)/g)?.length ?? 0);
      const next = unbalanced ? t.slice(0, -1) : t;
      if (next === u) break;
      u = next;
    }
    if (hostOf(u) && !out.includes(u)) out.push(u);
  };
  for (const t of texts) {
    if (!t || !t.includes('http')) continue;
    for (const m of t.matchAll(/\]\((https?:\/\/[^\s)]+(?:\([^\s)]*\)[^\s)]*)*)(?:\s+"[^"]*")?\)/g)) add(m[1]);
    for (const m of t.matchAll(/https?:\/\/[^\s<>"'`\[\]{}|\\^]+/g)) add(m[0]);
  }
  return out;
}

export function matchUrl(t: WebTarget, urls: readonly string[]): string | null {
  if (t.url) return t.url;
  const same = urls.filter((u) => hostOf(u) === t.host);
  const sub = same.length ? same : urls.filter((u) => hostOf(u).endsWith('.' + t.host));
  if (!sub.length) return null;
  if (t.path) {
    const p = t.path.replace(/\/+$/, '');
    const hit = sub.find((u) => { try { const x = new URL(u); return (x.pathname + x.search + x.hash).replace(/\/+$/, '') === p || x.pathname.replace(/\/+$/, '') === p; } catch { return false; } });
    if (hit) return hit;
  }
  return sub[0];
}

export function outsideCode(s: string, f: (part: string) => string): string {
  const parts = s.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g);
  return parts.map((p, i) => (i % 2 === 1 ? p : f(p))).join('');
}

export function stripWebMarks(text: string, mode: 'plain' | 'drop' = 'plain'): string {
  if (!text.includes('[[')) return text;
  return outsideCode(text, (p) => p.replace(/([ \t]*)\[\[([^\[\]\n]{1,300})\]\]/g, (m0, sp: string, inner: string) => {
    const ts = webTargets(inner);
    if (!ts) return m0;
    return mode === 'drop' ? '' : `${sp}(${ts.map((x) => x.host).join(', ')})`;
  }));
}
