import type { Lang } from '../i18n/core';

const GEN: Record<Lang, string[]> = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sr: ['januara', 'februara', 'marta', 'aprila', 'maja', 'juna', 'jula', 'avgusta', 'septembra', 'oktobra', 'novembra', 'decembra'],
};
const NOM: Record<Lang, string[]> = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: GEN.en,
  sr: ['Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun', 'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'],
};
const SHORT: Record<Lang, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sr: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'],
};
export const WEEKDAY: Record<Lang, string[]> = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], sr: ['ned', 'pon', 'uto', 'sre', 'čet', 'pet', 'sub'],
};
const parts = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null; };

export function dateWords(iso: string | undefined | null, lang: Lang, withYear = true): string {
  const p = parts(iso ?? '');
  if (!p) return iso ?? '';
  if (lang === 'en') return `${GEN.en[p.mo]} ${p.d}${withYear ? `, ${p.y}` : ''}`;
  return `${p.d} ${GEN[lang][p.mo]}${withYear ? ` ${p.y}` : ''}`;
}
export const monthTitle = (iso: string, lang: Lang) => { const p = parts(iso); return p ? `${NOM[lang][p.mo]} ${p.y}` : iso; };
export const monthShort = (iso: string, lang: Lang) => { const p = parts(iso); return p ? SHORT[lang][p.mo] : ''; };
export const dayOf = (iso: string) => parts(iso)?.d ?? 0;
export const weekday = (iso: string, lang: Lang) => WEEKDAY[lang][new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? '';

export function plural(n: number, lang: Lang, one: string, few: string, many: string): string {
  if (lang === 'en') return n === 1 ? one : many;
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
