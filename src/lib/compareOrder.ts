
export type Order = -1 | 0 | 1;
const cmp = (x: number, y: number): Order => (x < y ? -1 : x > y ? 1 : 0);

const MONTHS: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const ymd = (y: number, m: number, d: number): number | null => (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y * 10000 + m * 100 + d : null);

function datesIn(s: string): { at: number; end: number; v: number }[] {
  const out: { at: number; end: number; v: number }[] = [];
  const push = (m: RegExpExecArray, v: number | null) => { if (v !== null) out.push({ at: m.index, end: m.index + m[0].length, v }); };
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?!\d)/g)) push(m, ymd(+m[3], +m[2], +m[1]));
  for (const m of s.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(m, ymd(+m[1], +m[2], +m[3]));
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})/g)) push(m, ymd(+m[3], MONTHS[m[2].toLowerCase()] ?? 0, +m[1]));
  for (const m of s.matchAll(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/g)) push(m, ymd(+m[3], MONTHS[m[1].toLowerCase()] ?? 0, +m[2]));
  return out.sort((x, y) => x.at - y.at);
}

const baseOf = (name: string) => name.slice(name.lastIndexOf('/') + 1).replace(/\.[A-Za-z0-9]{1,5}$/, '');

const edIn = (s: string): number | null => {
  const m = /(?<![A-Za-zА-Яа-яЁё])(?:ред(?:акци[яи])?|верси[яи]|version|ver|rev|ed|v)[\s_.\-№#]*(\d{1,4})(?!\d)/i.exec(s);
  return m ? Number(m[1]) : null;
};

const TOK = /\d+|[^\d\s_.\-]+|[\s_.\-]+/g;

export function orderByNames(a: string, b: string): Order {
  const A = baseOf(a), B = baseOf(b);
  if (A === B) return 0;
  const da = datesIn(A), db = datesIn(B);
  if (da.length && db.length && da[0].v !== db[0].v) return cmp(da[0].v, db[0].v);
  const ea = edIn(A), eb = edIn(B);
  if (ea !== null && eb !== null && ea !== eb) return cmp(ea, eb);
  const ta = A.match(TOK) ?? [], tb = B.match(TOK) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    if (ta[i] === tb[i]) continue;
    if (/^\d+$/.test(ta[i]) && /^\d+$/.test(tb[i])) return cmp(Number(ta[i]), Number(tb[i]));
    return 0;
  }
  return 0;
}

function leadDates(text: string): { eff?: number; of?: number; first?: number; ed?: number } {
  const head = text.slice(0, 2500);
  const ds = datesIn(head);
  const near = (re: RegExp) => {
    for (const m of head.matchAll(re)) { const end = m.index + m[0].length; const d = ds.find((x) => x.at >= m.index && x.at <= end + 6); if (d) return d.v; }
    return undefined;
  };
  const ed = /(?<![A-Za-zА-Яа-яЁё])(?:редакци[яи]|верси[яи]|version|revision)\s*(?:№|N|#)?\s*(\d{1,4})(?!\d)/i.exec(head);
  return {
    eff: near(/(?:действу\p{L}*|вступа\p{L}*\s+в\s+силу|введ\p{L}*\s+в\s+действие|effective|valid\s+from|in\s+force)\s+(?:с|from|as\s+of)?\s*/giu),
    of: near(/(?<![\p{L}])(?:от|dated)\s+/giu),
    first: ds[0]?.v,
    ed: ed ? Number(ed[1]) : undefined,
  };
}

export function orderByTexts(ta: string, tb: string): Order {
  const a = leadDates(ta), b = leadDates(tb);
  for (const k of ['ed', 'eff', 'of', 'first'] as const) {
    const x = a[k], y = b[k];
    if (x !== undefined && y !== undefined && x !== y) return cmp(x, y);
  }
  return 0;
}

export function shortLabels(a: string, b: string): [string, string] {
  const A = baseOf(a), B = baseOf(b);
  const full: [string, string] = [A, B];
  if (A === B) return full;
  const ta = A.match(TOK) ?? [], tb = B.match(TOK) ?? [];
  let p = 0;
  while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
  let s = 0;
  while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++;
  const ma = ta.slice(p, ta.length - s).join('').trim(), mb = tb.slice(p, tb.length - s).join('').trim();
  if (!ma || !mb || ma.length > 28 || mb.length > 28) return full;
  const before = ta.slice(0, p);
  while (before.length && /^[\s_.\-]+$/.test(before[before.length - 1])) before.pop();
  const w = before[before.length - 1] ?? '';
  const word = /^(?:ред|редакция)$/i.test(w) ? 'ред.' : /^(?:v|ver|rev|ed|version|версия|вер)$/i.test(w) ? w.toLowerCase() : '';
  const lab = (m: string) => (word ? (word.endsWith('.') || word.length > 1 ? `${word} ${m}` : `${word}${m}`) : m);
  return [lab(ma), lab(mb)];
}
