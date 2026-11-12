import katex from 'katex';

export const KATEX_BASE = { strict: 'ignore', output: 'htmlAndMathml' } as const;

const CODE_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;

function renders(tex: string, display: boolean): boolean {
  try { katex.renderToString(tex, { ...KATEX_BASE, displayMode: display, throwOnError: true }); return true; } catch { return false; }
}

function closeBraces(tex: string): string | null {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return null;
  }
  if (depth === 0) return tex;
  return tex.replace(/\s*$/, (tail) => '}'.repeat(depth) + tail);
}

const FIXED = new Map<string, string | null>();
const FIXED_MAX = 2000;

function fixTex(tex: string, display: boolean): string | null {
  const key = (display ? 'D' : 'I') + tex;
  const hit = FIXED.get(key);
  if (hit !== undefined) return hit;
  let r: string | null = null;
  if (renders(tex, display)) r = tex;
  else {
    const f = closeBraces(tex);
    if (f !== null && f !== tex && renders(f, display)) r = f;
  }
  if (FIXED.size >= FIXED_MAX) FIXED.clear();
  FIXED.set(key, r);
  return r;
}

function asPlain(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]()<>#+\-.!|~$&]/g, (c) => '\\' + c);
}

function mathSegment(delim: string, tex: string, display: boolean): string {
  const raw = delim + tex + delim;
  if (!tex.trim()) return raw;
  const f = fixTex(tex, display);
  if (f === tex) return raw;
  return f === null ? asPlain(raw) : delim + f + delim;
}

function lineStart(s: string, i: number): boolean {
  let k = i;
  while (k > 0 && s[k - 1] === ' ' && i - k < 4) k--;
  return (k === 0 || s[k - 1] === '\n') && i - k <= 3;
}

function restBlank(s: string, i: number): boolean {
  for (let k = i; k < s.length && s[k] !== '\n'; k++) if (s[k] !== ' ' && s[k] !== '\t') return false;
  return true;
}

function guardDollars(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { out += c + s[i + 1]; i += 2; continue; }
    if (c !== '$') { out += c; i++; continue; }
    if (s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end >= 0) {
        const tex = s.slice(i + 2, end);
        const block = /^[ \t]*\n/.test(tex) && /\n[ \t]*$/.test(tex) && lineStart(s, i) && restBlank(s, end + 2);
        out += mathSegment('$$', tex, block); i = end + 2;
      } else { out += '$$'; i += 2; }
      continue;
    }
    let j = i + 1;
    let close = -1;
    while (j < s.length && s[j] !== '\n') {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '$') { close = j; break; }
      j++;
    }
    const inner = close > 0 ? s.slice(i + 1, close) : '';
    const ok = close > 0 && inner.length > 0 && !/^\s/.test(inner) && !/\s$/.test(inner) && !/\d/.test(s[close + 1] ?? '') && s[close + 1] !== '$';
    if (ok) { out += mathSegment('$', inner, false); i = close + 1; } else { out += '\\$'; i++; }
  }
  return out;
}

function prepText(s: string): string {
  let t = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`);
  t = t.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`);
  return guardDollars(t);
}

export function prepMath(text: string): string {
  if (!text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return text;
  return text
    .split(CODE_RE)
    .map((seg, i) => (i % 2 === 1 ? seg : prepText(seg)))
    .join('');
}
