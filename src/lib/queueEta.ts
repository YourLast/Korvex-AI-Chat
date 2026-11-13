
import { tr, type Lang } from './i18n/core';

export const ETA_START_S = 30;
export const ETA_MIN_S = 5;
export const ETA_MAX_S = 300;
export const ETA_ALPHA = 0.25;

const clampAvg = (s: number) => Math.min(ETA_MAX_S, Math.max(ETA_MIN_S, s));

export function ewma(prevS: number, sampleS: number, alpha = ETA_ALPHA): number {
  const prev = clampAvg(Number.isFinite(prevS) ? prevS : ETA_START_S);
  if (!Number.isFinite(sampleS) || sampleS <= 0) return prev;
  return clampAvg(alpha * clampAvg(sampleS) + (1 - alpha) * prev);
}

export function etaFor(ahead: number, limit: number, avgS: number): number {
  const a = Math.max(0, Math.floor(Number.isFinite(ahead) ? ahead : 0));
  const l = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1));
  return Math.round(Math.ceil((a + 1) / l) * clampAvg(avgS));
}

export function etaNextFor(active: number, queued: number, limit: number, avgS: number): number {
  if (queued <= 0 && active < Math.max(1, limit)) return 0;
  return etaFor(queued, limit, avgS);
}

export function fmtEta(sec: number, lang: Lang = 'ru'): string {
  if (sec > 120) return tr(lang, 'queue.etaMore');
  if (sec >= 60) return tr(lang, 'queue.etaMin');
  return tr(lang, 'queue.etaSec', { n: Math.min(55, Math.max(5, Math.round(sec / 5) * 5)) });
}

export function serveQueueOf(v: unknown): { ahead: number; eta: number | null } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { ahead?: unknown; eta?: unknown };
  const ahead = Number(o.ahead), eta = Number(o.eta);
  return { ahead: Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0, eta: Number.isFinite(eta) && eta > 0 ? Math.round(eta) : null };
}

export function fmtWait(sec: number, lang: Lang = 'ru'): string | null {
  if (!Number.isFinite(sec) || sec < 60) return null;
  const min = Math.round(sec / 60);
  if (min < 60) return tr(lang, 'squeue.min', { n: min });
  const h = Math.floor(min / 60), m = Math.round((min % 60) / 5) * 5;
  return m === 0 ? tr(lang, 'squeue.h', { h }) : m === 60 ? tr(lang, 'squeue.h', { h: h + 1 }) : tr(lang, 'squeue.hm', { h, m });
}

export function ordinal(n: number, lang: Lang = 'ru'): string {
  if (lang === 'en') { const m100 = n % 100, m10 = n % 10; return `${n}${m100 >= 11 && m100 <= 13 ? 'th' : m10 === 1 ? 'st' : m10 === 2 ? 'nd' : m10 === 3 ? 'rd' : 'th'}`; }
  return lang === 'sr' ? `${n}. mesto` : `${n}-й`;
}
