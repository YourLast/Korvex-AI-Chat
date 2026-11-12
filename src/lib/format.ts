import { fmtNum, tr, type Lang } from './i18n/core';

const nf = new Intl.NumberFormat('ru-RU');
export const fmtInt = (n: number, lang: Lang = 'ru') => lang !== 'ru' ? fmtNum(lang, Math.round(n)) : nf.format(Math.round(n)).replace(/ /g, ' ');
export const decimal = (x: string, lang: Lang = 'ru') => (lang === 'en' ? x : x.replace('.', ','));

export function fmtTok(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const dec = (x: number, d: number) => String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
  if (n < 1000) return String(Math.round(n));
  if (Math.round(n / 1024) < 1000) return n < 10 * 1024 ? `${dec(n / 1024, 1)}K` : `${Math.round(n / 1024)}K`;
  return `${dec(Math.max(1, n / 1048576), 2)}M`;
}

export const fmtTokLang = (lang: Lang, n: number): string => (lang === 'en' ? fmtTok(n).replace(',', '.') : fmtTok(n));

export function fmtSec(ms: number, lang: Lang = 'ru'): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return tr(lang, 'time.sec', { n: s || 1 });
  return tr(lang, 'time.minSec', { m: Math.floor(s / 60), s: s % 60 });
}

export function fmtBytes(n: number, lang: Lang = 'ru'): string {
  if (n < 1024) return `${n} ${tr(lang, 'unit.B')}`;
  if (n < 1048576) return `${Math.round(n / 1024)} ${tr(lang, 'unit.KB')}`;
  return `${decimal((n / 1048576).toFixed(1), lang)} ${tr(lang, 'unit.MB')}`;
}

export const stripMarker = (s: string) => s.split('⁠‌⁠').join('');
export const hasMarker = (s: string) => s.includes('⁠‌⁠');

export function dayGroup(ts: number, now = Date.now(), lang: Lang = 'ru'): string {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const t = d0.getTime();
  if (ts >= t) return tr(lang, 'time.today');
  if (ts >= t - 864e5) return tr(lang, 'time.yesterday');
  if (ts >= t - 7 * 864e5) return tr(lang, 'time.week');
  return tr(lang, 'time.earlier');
}

export function fmtWhen(ts: number, now = Date.now(), lang: Lang = 'ru'): string {
  const d = new Date(ts), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  if (ts >= d0.getTime()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (ts >= d0.getTime() - 864e5) return tr(lang, 'time.yesterdayLc');
  if (d.getFullYear() === d0.getFullYear()) return tr(lang, 'time.dayMon', { d: String(d.getDate()), mon: tr(lang, 'time.months').split(',')[d.getMonth()] });
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
