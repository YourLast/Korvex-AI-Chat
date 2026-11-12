
const INVISIBLE = /[­​-‏⁠-⁤﻿]/g;

const APOS = /(?<=[a-z])['’ʼ](?=[a-z])/gi;

export function fold(s: string): string {
  return s
    .replace(INVISIBLE, '')
    .replace(APOS, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/й/g, '\u0001')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\u0001/g, 'й');
}

export function plainText(md: string): string {
  return md
    .replace(INVISIBLE, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/```[a-z0-9_-]*\n?/gi, ' ')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/^\s*[-=:]{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Tok = { w: string; i: number; n: number };
const WORD = /[\p{L}\p{N}]+(?:['’ʼ](?=[a-z])[\p{L}\p{N}]+)*/giu;
export function words(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(WORD)) out.push({ w: m[0], i: m.index!, n: m[0].length });
  return out;
}

const CYR = /[а-яё]/;
const LAT = /[a-z]/;
export const isCyr = (w: string) => CYR.test(w);
export const isLat = (w: string) => LAT.test(w) && !CYR.test(w);

const SK_CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'z', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's', щ: 'sc', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a', ё: 'e', і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u',
};
const SK_LAT: [RegExp, string][] = [
  [/shch|sch/g, 'S'], [/zh/g, 'z'], [/kh/g, 'h'], [/ch/g, 'c'], [/sh/g, 's'], [/ck/g, 'k'], [/ts|tz/g, 'c'], [/ph/g, 'f'],
  [/[yj]a/g, 'a'], [/[yj]u/g, 'u'], [/[yj][oe]/g, 'e'], [/[yj]/g, 'i'], [/x/g, 'X'], [/w/g, 'v'], [/q/g, 'k'], [/'/g, ''],
];
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

export function skel(w: string): string {
  if (isCyr(w)) {
    let o = '';
    for (const ch of w) o += SK_CYR[ch] ?? ch;
    return collapse(o.replace(/ck/g, 'k').replace(/ts/g, 'c'));
  }
  let o = w;
  for (const [re, to] of SK_LAT) o = o.replace(re, to);
  return collapse(o.replace(/S/g, 'sc').replace(/X/g, 'ks'));
}

export function skelVariants(w: string): string[] {
  const out = new Set([skel(w)]);
  if (isCyr(w)) {
    if (w.includes('щ')) out.add(skel(w.replace(/щ/g, 'ш')));
    if (w.includes('сх')) out.add(skel(w.replace(/сх/g, 'ш')));
    return [...out];
  }
  if (!isLat(w)) return [...out];
  if (/c(?!h)/.test(w)) out.add(skel(w.replace(/c(?!h)/g, 'k')));
  if (/x/.test(w)) out.add(skel(w.replace(/x/g, 'h')));
  if (/(?<![sc])sh(?!ch)/.test(w)) out.add(skel(w.replace(/(?<![sc])sh(?!ch)/g, 'shch')));
  return [...out];
}

const CY_LAT: [RegExp, string][] = [
  [/shch|sch/g, 'щ'], [/zh/g, 'ж'], [/kh/g, 'х'], [/ch/g, 'ч'], [/sh/g, 'ш'], [/ts/g, 'ц'], [/[yj]a/g, 'я'], [/[yj]u/g, 'ю'], [/[yj]o/g, 'ё'],
  [/(^|[^aeiouy])ye/g, '$1е'], [/x/g, 'кс'], [/w/g, 'в'], [/q/g, 'к'], [/'/g, 'ь'],
];
const CY_ONE: Record<string, string> = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц' };
export function cyr(w: string): string {
  let o = w;
  for (const [re, to] of CY_LAT) o = o.replace(re, to);
  o = o.replace(/([аеёиоуыэюяaeiou])y/g, '$1й').replace(/y/g, 'ы');
  let r = '';
  for (const ch of o) r += CY_ONE[ch] ?? ch;
  return r;
}

const V = 'аеиоуыэюя';
const isV = (c: string | undefined) => !!c && V.includes(c);
const PERF_G1 = ['вшись', 'вши', 'в'], PERF_G2 = ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'];
const ADJ = ['ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею'];
const PART_G1 = ['ем', 'нн', 'вш', 'ющ', 'щ'], PART_G2 = ['ивш', 'ывш', 'ующ'];
const REFL = ['ся', 'сь'];
const VERB_G1 = ['ете', 'йте', 'ешь', 'нно', 'ла', 'на', 'ли', 'ем', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'й', 'л', 'н'];
const VERB_G2 = ['ейте', 'уйте', 'ила', 'ыла', 'ена', 'ите', 'или', 'ыли', 'ило', 'ыло', 'ено', 'ует', 'уют', 'ены', 'ить', 'ыть', 'ишь', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ят', 'ит', 'ыт', 'ую', 'ю'];
const NOUN = ['иями', 'ями', 'ами', 'ией', 'иям', 'ием', 'иях', 'ев', 'ов', 'ие', 'ье', 'еи', 'ии', 'ей', 'ой', 'ий', 'ям', 'ем', 'ам', 'ом', 'ах', 'ях', 'ию', 'ью', 'ия', 'ья', 'а', 'е', 'и', 'й', 'о', 'у', 'ы', 'ь', 'ю', 'я'];
const byLen = (a: string[]) => [...a].sort((x, y) => y.length - x.length);
const S = { PERF_G1: byLen(PERF_G1), PERF_G2: byLen(PERF_G2), ADJ: byLen(ADJ), PART_G1: byLen(PART_G1), PART_G2: byLen(PART_G2), REFL, VERB_G1: byLen(VERB_G1), VERB_G2: byLen(VERB_G2), NOUN: byLen(NOUN) };

function cut(w: string, rv: number, g1: string[], g2: string[] = []): string | null {
  let best: string | null = null;
  for (const e of g1) {
    if (!w.endsWith(e)) continue;
    const s = w.length - e.length;
    if (s - 1 < rv || (w[s - 1] !== 'а' && w[s - 1] !== 'я')) continue;
    best = w.slice(0, s);
    break;
  }
  for (const e of g2) {
    if (!w.endsWith(e)) continue;
    const s = w.length - e.length;
    if (s < rv) continue;
    if (best === null || s < best.length) best = w.slice(0, s);
    break;
  }
  return best;
}

export function stemRu(word: string): string {
  let w = word;
  if (!/^[а-я]+$/.test(w) || w.length < 3) return w;
  let rv = 0;
  while (rv < w.length && !isV(w[rv])) rv++;
  rv = Math.min(w.length, rv + 1);
  if (rv >= w.length) return w;
  const rOf = (from: number) => { let i = from; while (i < w.length && !isV(w[i])) i++; while (i < w.length && isV(w[i])) i++; return Math.min(w.length, i + 1); };
  const g = cut(w, rv, S.PERF_G1, S.PERF_G2);
  if (g !== null) w = g;
  else {
    w = cut(w, rv, [], S.REFL) ?? w;
    const adj = cut(w, rv, [], S.ADJ);
    if (adj !== null) { w = adj; w = cut(w, rv, S.PART_G1, S.PART_G2) ?? w; }
    else {
      const vb = cut(w, rv, S.VERB_G1, S.VERB_G2);
      if (vb !== null) w = vb;
      else w = cut(w, rv, [], S.NOUN) ?? w;
    }
  }
  if (w.endsWith('и') && w.length - 1 >= rv) w = w.slice(0, -1);
  const r2 = rOf(rOf(0) - 1);
  for (const e of ['ость', 'ост']) if (w.endsWith(e) && w.length - e.length >= r2) { w = w.slice(0, -e.length); break; }
  if (w.endsWith('нн')) w = w.slice(0, -1);
  else {
    const sup = ['ейше', 'ейш'].find((e) => w.endsWith(e) && w.length - e.length >= rv);
    if (sup) { w = w.slice(0, -sup.length); if (w.endsWith('нн')) w = w.slice(0, -1); }
    else if (w.endsWith('ь')) w = w.slice(0, -1);
  }
  return w;
}

const DERIV = ['тель', 'ств', 'ник', 'чик', 'щик', 'йк', 'ени', 'ани', 'к'];
export function stemShort(stem: string): string | null {
  for (const e of DERIV) if (stem.endsWith(e) && stem.length - e.length >= 4) return stem.slice(0, -e.length);
  return null;
}

export function dl(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length, m = b.length;
  let pp = new Array<number>(m + 1).fill(0), p = Array.from({ length: m + 1 }, (_, j) => j), c = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    c[0] = i;
    let rowMin = c[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      c[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [pp, p, c] = [p, c, pp];
  }
  return p[m];
}

export function fuzzyPrefix(q: string, term: string): boolean {
  if (q.length < 5 || term.length < q.length - 1 || term[0] !== q[0]) return false;
  const last = q[q.length - 1];
  for (const L of [q.length, q.length - 1, q.length + 1]) {
    if (L < 3 || L > term.length || term[L - 1] !== last) continue;
    if (dl(q, term.slice(0, L), 1) <= 1) return true;
  }
  return false;
}

export type Term = {
  raw: string;
  body: string[];
  alt: string[];
  tiers: { body: string[]; alt: string[]; w: number }[];
  exact?: boolean;
  fuzzy: Fuzzy | null;
};
export type Fuzzy = { col: 'body' | 'alt'; q: string; whole: string };
export type Phrase = { body: string[]; alt: string[] };
export type Parsed = { terms: Term[]; phrases: Phrase[] };

export function termOf(w0: string): Term {
  const w = fold(w0);
  if (w.length < 2) return { raw: w, body: [w], alt: [], tiers: [{ body: [w], alt: [], w: 1 }], exact: true, fuzzy: null };
  if (/^\d+$/.test(w)) return { raw: w, body: [w], alt: [], tiers: [{ body: [w], alt: [], w: 1 }], fuzzy: null };
  const A = { body: new Set<string>([w]), alt: new Set<string>(skelVariants(w)), w: 1 };
  const B = { body: new Set<string>(), alt: new Set<string>(), w: 0.8 };
  const C = { body: new Set<string>(), alt: new Set<string>(), w: 0.6 };
  let stem: string | null = null;
  if (isCyr(w)) {
    stem = stemRu(w);
    if (w.length >= 6 && stem.length < w.length - 1) A.body.add(w.slice(0, -1));
    if (stem.length >= 3 && stem !== w) B.body.add(stem);
  } else if (isLat(w)) {
    stem = stemRu(cyr(w));
  }
  if (stem && stem.length >= 3) for (const v of isCyr(stem) ? skelVariants(stem) : [skel(stem)]) B.alt.add(v);
  const short = stem ? stemShort(stem) : null;
  if (short) { if (isCyr(w)) C.body.add(short); C.alt.add(skel(short)); }
  const seen = { body: new Set<string>(), alt: new Set<string>() };
  const tiers = [A, B, C].map((t) => {
    const out = { body: [] as string[], alt: [] as string[], w: t.w };
    for (const col of ['body', 'alt'] as const) for (const x of t[col]) { if (x.length < 2 || seen[col].has(x)) continue; seen[col].add(x); out[col].push(x); }
    return out;
  }).filter((t) => t.body.length || t.alt.length);
  let fuzzy: Fuzzy | null = null;
  if (w.length >= 5 && isCyr(w)) fuzzy = { col: 'body', q: stem && stem.length >= 5 ? stem : w, whole: w };
  else if (w.length >= 5 && isLat(w)) { const sk = skel(stem && stem.length >= 5 ? stem : w); if (sk.length >= 4) fuzzy = { col: 'alt', q: sk, whole: skel(w) }; }
  return { raw: w, body: [...seen.body], alt: [...seen.alt], tiers, fuzzy };
}

export function parseQuery(q: string): Parsed {
  const phrases: Phrase[] = [];
  const rest = q.replace(/["«»“”„]([^"«»“”„]+)["«»“”„]?/g, (_, p: string) => {
    const ws = words(fold(p)).map((t) => t.w);
    if (ws.length >= 2) phrases.push({ body: ws, alt: ws.map(skel) });
    else if (ws.length === 1) return ' ' + ws[0] + ' ';
    return ' ';
  });
  const seen = new Set<string>();
  const terms = words(rest).map((t) => termOf(t.w)).filter((t) => { if (seen.has(t.raw)) return false; seen.add(t.raw); return true; });
  return { terms: terms.slice(0, 8), phrases: phrases.slice(0, 3) };
}

const qq = (s: string) => `"${s.replace(/"/g, '')}"`;
export function ftsTier(t: { body: string[]; alt: string[] }, exact = false): string {
  const parts = [
    ...t.body.map((b) => `{body}: ${qq(b)}${exact ? '' : '*'}`),
    ...t.alt.map((a) => `{alt}: ${qq(a)}*`),
  ];
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}
export function ftsTerm(t: Term): string { return ftsTier(t, t.exact); }
export function ftsPhrase(p: Phrase): string {
  return `({body}: ${qq(p.body.join(' '))}* OR {alt}: ${qq(p.alt.join(' '))}*)`;
}
export function ftsFuzzy(terms: string[], col: 'body' | 'alt' = 'alt'): string {
  return `{${col}}: (${terms.map(qq).join(' OR ')})`;
}

export type Seg = [string, 0 | 1];
export type Matcher = { body: string[]; alt: string[]; exact: string[]; fuzzy: string[] };

export function matcherOf(p: Parsed, fuzzy: string[] = []): Matcher {
  const m: Matcher = { body: [], alt: [], exact: [], fuzzy };
  for (const t of p.terms) { if (t.exact) m.exact.push(...t.body); else m.body.push(...t.body); m.alt.push(...t.alt); }
  for (const ph of p.phrases) { m.body.push(...ph.body); m.alt.push(...ph.alt); }
  return m;
}

export function wordHit(m: Matcher, w: string): boolean {
  const f = fold(w);
  if (m.exact.includes(f)) return true;
  if (m.body.some((b) => f.startsWith(b))) return true;
  if (!m.alt.length && !m.fuzzy.length) return false;
  if (m.fuzzy.includes(f)) return true;
  const s = skel(f);
  return m.alt.some((a) => s.startsWith(a)) || m.fuzzy.includes(s);
}

export function segments(text: string, m: Matcher): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const t of words(text)) {
    if (!wordHit(m, t.w)) continue;
    if (t.i > at) out.push([text.slice(at, t.i), 0]);
    out.push([t.w, 1]);
    at = t.i + t.n;
  }
  if (at < text.length) out.push([text.slice(at), 0]);
  return out.length ? out : [[text, 0]];
}

export function snippet(text0: string, m: Matcher, max = 160): { segs: Seg[]; hits: string[]; count: number } {
  const text = plainText(text0);
  const toks = words(text);
  const hitIdx = toks.map((t, i) => (wordHit(m, t.w) ? i : -1)).filter((i) => i >= 0);
  const hits = [...new Set(hitIdx.map((i) => toks[i].w))];
  if (!hitIdx.length) return { segs: [[cutTo(text, max), 0]], hits, count: 0 };
  let best = hitIdx[0], bestN = 0;
  for (const i of hitIdx) {
    const end = toks[i].i + max * 0.7;
    const n = hitIdx.filter((j) => toks[j].i >= toks[i].i && toks[j].i < end).length;
    if (n > bestN) { best = i; bestN = n; }
  }
  let start = toks[best].i <= max * 0.6 ? 0 : toks[best].i - Math.round(max * 0.25);
  if (start > 0) { const sp = text.indexOf(' ', start); start = sp >= 0 && sp < toks[best].i ? sp + 1 : toks[best].i; }
  let end = Math.min(text.length, start + max);
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > toks[best].i + toks[best].n) end = sp; }
  const segs: Seg[] = [];
  if (start > 0) segs.push(['…', 0]);
  let at = start;
  for (const i of hitIdx) {
    const t = toks[i];
    if (t.i < start || t.i + t.n > end) continue;
    if (t.i > at) segs.push([text.slice(at, t.i), 0]);
    segs.push([t.w, 1]);
    at = t.i + t.n;
  }
  if (at < end) segs.push([text.slice(at, end), 0]);
  if (end < text.length) segs.push(['…', 0]);
  return { segs, hits, count: hitIdx.length };
}

function cutTo(s: string, max: number): string {
  if (s.length <= max) return s;
  const sp = s.lastIndexOf(' ', max);
  return s.slice(0, sp > max * 0.6 ? sp : max).trimEnd() + '…';
}

export function indexText(text: string): { body: string; alt: string } {
  const ws = words(fold(plainText(text))).map((t) => t.w);
  return { body: ws.join(' '), alt: ws.map(skel).join(' ') };
}
