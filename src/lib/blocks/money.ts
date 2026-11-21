import type { Lang } from '../i18n/core';

export function toKop(v: string | null | undefined): bigint | null {
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const k = BigInt(m[2]) * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -k : k;
}

export function fromKop(k: bigint): string {
  const neg = k < 0n, a = neg ? -k : k;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

export const sumKop = (vals: (string | null | undefined)[]): bigint => vals.reduce<bigint>((s, v) => s + (toKop(v) ?? 0n), 0n);

const GROUP: Record<Lang, string> = { ru: ' ', sr: '.', en: ',' };
const DEC: Record<Lang, string> = { ru: ',', sr: ',', en: '.' };
const MINUS = '−';

function groupInt(int: string, lang: Lang): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP[lang]);
}

export function fmtNum(v: string | null | undefined, lang: Lang, opts: { fixed?: number; sign?: boolean } = {}): string {
  if (v == null || v === '') return '';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v).trim());
  if (!m) return String(v);
  let frac = m[3] ?? '';
  if (opts.fixed !== undefined) frac = frac.padEnd(opts.fixed, '0').slice(0, opts.fixed);
  const zero = /^0+$/.test(m[2]) && /^0*$/.test(frac);
  const sign = m[1] && !zero ? (lang === 'en' ? '-' : MINUS) : opts.sign && !zero ? '+' : '';
  return `${sign}${groupInt(m[2].replace(/^0+(?=\d)/, ''), lang)}${frac ? DEC[lang] + frac : ''}`;
}

export const fmtMoney = (v: string | null | undefined, lang: Lang, sign = false) => fmtNum(v, lang, { fixed: 2, sign });
export const fmtKop = (k: bigint, lang: Lang, sign = false) => fmtMoney(fromKop(k), lang, sign);

export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return lang === 'en' ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

export function cmpBy(kind: string, lang: Lang): (a: unknown, b: unknown) => number {
  if (kind === 'money' || kind === 'number' || kind === 'percent') {
    return (a, b) => {
      const x = numKey(a), y = numKey(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : x > y ? 1 : 0;
    };
  }
  const coll = new Intl.Collator(lang === 'sr' ? 'sr-Latn' : lang, { numeric: true, sensitivity: 'base' });
  return (a, b) => {
    const x = a == null ? '' : String(a), y = b == null ? '' : String(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return coll.compare(x, y);
  };
}
function numKey(v: unknown): bigint | null {
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(v.trim());
  if (!m) return null;
  const k = BigInt(m[2]) * 1_000_000n + BigInt((m[3] ?? '').padEnd(6, '0'));
  return m[1] ? -k : k;
}
