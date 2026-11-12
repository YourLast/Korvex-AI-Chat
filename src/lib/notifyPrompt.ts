import { tr, type Lang } from './i18n/core';
import type { PushEnv } from './pushClient';

export const NP_KEY = 'kx.np';
export const NP_SESSION = 'kx.np.s';
export const SNOOZE_MS = 7 * 24 * 3600 * 1000;
export const SLOW_MS = 15000;

export type NPState = { visits: number; snoozeUntil: number; denied: boolean };
export type Card = 'push' | 'install';
export type Trigger = 'visit' | 'slow';

const EMPTY: NPState = { visits: 0, snoozeUntil: 0, denied: false };

export function readNP(raw: string | null): NPState {
  if (!raw) return { ...EMPTY };
  try {
    const j = JSON.parse(raw) as Partial<NPState>;
    return {
      visits: Number.isFinite(j.visits) ? Math.max(0, Math.floor(Number(j.visits))) : 0,
      snoozeUntil: Number.isFinite(j.snoozeUntil) ? Number(j.snoozeUntil) : 0,
      denied: j.denied === true,
    };
  } catch { return { ...EMPTY }; }
}

export function cardFor(env: PushEnv): Card | null {
  if (env.iosOld) return null;
  if (env.ios && !env.standalone) return 'install';
  if (!env.supported) return null;
  return 'push';
}

export function decide(st: NPState, env: PushEnv, on: boolean, trigger: Trigger, now: number): Card | null {
  if (on) return null;
  if (st.denied || env.permission === 'denied') return null;
  if (st.snoozeUntil > now) return null;
  const card = cardFor(env);
  if (!card) return null;
  if (trigger === 'slow') return card;
  if (st.visits >= 2) return card;
  if (card === 'push' && env.ios && env.standalone) return card;
  return null;
}

export const visit = (st: NPState): NPState => ({ ...st, visits: st.visits + 1 });
export const snooze = (st: NPState, now: number): NPState => ({ ...st, snoozeUntil: now + SNOOZE_MS });
export const markDenied = (st: NPState): NPState => ({ ...st, denied: true });

export function deniedHint(env: PushEnv, ua: string, lang: Lang = 'ru'): string {
  if (env.ios) return tr(lang, 'tools.notify.deniedIos');
  if (/Edg\//.test(ua)) return tr(lang, 'tools.notify.deniedEdge');
  if (/Chrome\//.test(ua)) return tr(lang, 'tools.notify.deniedChrome');
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return tr(lang, 'tools.notify.deniedSafari');
  if (/Firefox\//.test(ua)) return tr(lang, 'tools.notify.deniedFirefox');
  return tr(lang, 'tools.notify.deniedOther');
}
