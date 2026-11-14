import type { Lang } from './i18n/core';

let override: readonly string[] | null = null;
export function setClockLocales(l: readonly string[] | null) { override = l; }

function browserLocale(): string | undefined {
  if (override) return override[0];
  if (typeof navigator === 'undefined') return undefined;
  return navigator.languages?.[0] || navigator.language || undefined;
}

export function hour12Of(lang: Lang, locales?: readonly string[] | null): boolean {
  if (lang !== 'en') return false;
  const loc = locales?.[0] ?? browserLocale() ?? 'en-US';
  try {
    const hc = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h11' || hc === 'h12';
  } catch { return true; }
}

export function parseHM(v: string): { h: number; m: number } | null {
  const x = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!x) return null;
  const h = Number(x[1]), m = Number(x[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}
export const toHM = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
export const to12 = (h: number) => ({ h: h % 12 || 12, pm: h >= 12 });
export const from12 = (h: number, pm: boolean) => (h % 12) + (pm ? 12 : 0);

export function fmtHM(v: string, lang: Lang, h12 = hour12Of(lang)): string {
  const p = parseHM(v);
  if (!p) return v;
  if (!h12) return `${p.h}:${String(p.m).padStart(2, '0')}`;
  const t = to12(p.h);
  return `${t.h}:${String(p.m).padStart(2, '0')}\u00a0${t.pm ? 'PM' : 'AM'}`;
}

export const hourOpt = (lang: Lang): Intl.DateTimeFormatOptions => ({ hour12: hour12Of(lang) });
