import { DICT, type Key } from './dict';
import type { Lang, Params, Tx } from './types';
import { brandText } from '../brandCore';
export type { Lang, Params } from './types';

export const LANGS: readonly Lang[] = ['ru', 'en', 'sr'];
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', sr: 'Srpski' };
export const DEFAULT_LANG: Lang = 'en';
export const LANG_COOKIE = 'kx_lang';
export const LANG_STORE = 'kx.lang';
export const LANG_ASKED = 'kx.langAsk';
const IDX: Record<Lang, 0 | 1 | 2> = { ru: 0, en: 1, sr: 2 };

export const asLang = (x: unknown): Lang | null => (x === 'ru' || x === 'en' || x === 'sr' ? x : null);

export function langOfTag(tag: string | null | undefined): Lang | null {
  const p = String(tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!p) return null;
  if (p === 'sr' || p === 'hr' || p === 'bs' || p === 'me' || p === 'cnr' || p === 'sh') return 'sr';
  if (p === 'ru' || p === 'uk' || p === 'be' || p === 'kk') return 'ru';
  if (p === 'en') return 'en';
  return null;
}

export function detectLang(list: readonly string[] | null | undefined): Lang {
  for (const t of list ?? []) { const l = langOfTag(t); if (l) return l; }
  return DEFAULT_LANG;
}

export function fromAcceptLanguage(h: string | null | undefined): Lang {
  const items = String(h ?? '').split(',').map((s, i) => {
    const [tag, ...ps] = s.trim().split(';');
    const q = ps.map((x) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(x)?.[1]).find(Boolean);
    return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), i };
  }).filter((x) => x.tag && x.tag !== '*' && x.q > 0 && Number.isFinite(x.q));
  items.sort((a, b) => b.q - a.q || a.i - b.i);
  return detectLang(items.map((x) => x.tag));
}

export function suggestLang(list: readonly string[] | null | undefined): Lang | null {
  const p = String(list?.[0] ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (p === 'uk' || p === 'be' || p === 'kk') return null;
  return langOfTag(p);
}

export function pickLang(opts: { user?: string | null; cookie?: string | null; accept?: string | null }): Lang {
  return asLang(opts.user) ?? asLang(opts.cookie) ?? fromAcceptLanguage(opts.accept);
}

export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

export function pluralIndex(lang: Lang, n: number): 0 | 1 | 2 {
  if (lang === 'en') return n === 1 ? 0 : 1;
  if (!Number.isInteger(n)) return 1;
  const a = Math.abs(n), m10 = a % 10, m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return 0;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
  return 2;
}

const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', sr: 'sr-Latn-RS' };
export const localeOf = (lang: Lang) => LOCALE[lang];
const nfs = new Map<Lang, Intl.NumberFormat>();
export function fmtNum(lang: Lang, n: number): string {
  let f = nfs.get(lang);
  if (!f) nfs.set(lang, (f = new Intl.NumberFormat(LOCALE[lang])));
  return f.format(n).replace(/[  \s]/g, ' ');
}

function pick(lang: Lang, v: Tx, params?: Params): string {
  if (typeof v === 'string') return v;
  const n = Number(params?.n);
  return v[Math.min(pluralIndex(lang, Number.isFinite(n) ? n : 0), v.length - 1)] ?? '';
}

export function tr(lang: Lang, key: Key, params?: Params): string {
  const e = DICT[key];
  if (!e) return String(key);
  const s = pick(lang, e[IDX[lang]], params);
  return brandText(params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? (typeof params[k] === 'number' ? fmtNum(lang, params[k] as number) : String(params[k])) : m)) : s);
}
export type { Key };
export type TFn = (key: Key, params?: Params) => string;
export const bind = (lang: Lang): TFn => (key, params) => tr(lang, key, params);

export const hasKey = (key: string): key is Key => Object.prototype.hasOwnProperty.call(DICT, key);
