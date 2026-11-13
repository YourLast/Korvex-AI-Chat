import { ADM } from './admDict';
import { errText } from './errors';
import { count, plural, type Forms } from '../plural';
import type { Lang } from './types';

let CUR: Lang = 'ru';
export function setAdmLang(l: Lang) { CUR = l; }
export const admLang = (): Lang => CUR;

function pick(ru: string): string {
  if (CUR === 'ru') return ru;
  const e = ADM[ru];
  if (!e) return ru;
  return (CUR === 'sr' ? e[1] || e[0] : e[0]) || ru;
}
export const adm = (ru: string): string => pick(ru);
export function admf(pattern: string, ...v: unknown[]): string {
  return pick(pattern).replace(/\{(\d+)\}/g, (_, i: string) => String(v[Number(i)] ?? ''));
}
export const admErr = <T extends string | null | undefined>(m: T): T => (m ? (errText(CUR, m) as T) : m);

export const admLocale = (): string => (CUR === 'ru' ? 'ru-RU' : CUR === 'sr' ? 'sr-Latn-RS' : 'en-GB');
export function admPlural(n: number, forms: Forms): string {
  if (CUR === 'ru') return plural(n, forms);
  const e = ADM[forms.join('|')];
  if (!e) return plural(n, forms);
  const f = (CUR === 'sr' && e[1] ? e[1] : e[0]).split('|');
  if (CUR === 'sr' && f.length === 3) { const a = Math.abs(n) % 100, b = Math.abs(n) % 10; return a >= 11 && a <= 14 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; }
  return n === 1 ? f[0] : f[f.length - 1];
}
export const admCount = (n: number, forms: Forms): string =>
  CUR === 'ru' ? count(n, forms) : `${new Intl.NumberFormat(admLocale()).format(n)} ${admPlural(n, forms)}`;
let PATS: { re: RegExp; key: string; n: number }[] | null = null;
export function admAny(text: string): string {
  if (CUR === 'ru' || !text) return text;
  if (ADM[text]) return pick(text);
  PATS ??= Object.keys(ADM).filter((k) => /\{\d+\}/.test(k)).map((k) => ({
    key: k, n: (k.match(/\{\d+\}/g) ?? []).length,
    re: new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, '(?<v$1>[\\s\\S]+?)').replace(/\\\{|\\\}/g, '') + '$'),
  }));
  for (const p of PATS) { const m = p.re.exec(text); if (m) return pick(p.key).replace(/\{(\d+)\}/g, (_, i: string) => m.groups?.[`v${i}`] ?? ''); }
  return text;
}
