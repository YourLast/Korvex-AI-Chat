'use client';
import { isTheme, SCHEME_COOKIE, THEME_COLOR, THEME_COOKIE, type Theme } from './theme';

const YEAR = 365 * 86400;
const setCookie = (k: string, v: string) => { try { document.cookie = `${k}=${v}; path=/; max-age=${YEAR}; samesite=lax`; } catch {  } };
const getCookie = (k: string): string | null => { try { return document.cookie.split('; ').find((x) => x.startsWith(k + '='))?.slice(k.length + 1) ?? null; } catch { return null; } };

export function currentTheme(): Theme {
  const v = typeof document === 'undefined' ? null : document.documentElement.dataset.themePick;
  return isTheme(v) ? v : 'system';
}

export const deviceScheme = (): 'light' | 'dark' => { try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; } };

function metas(t: Theme) {
  const head = document.head;
  head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const add = (color: string, media?: string) => { const m = document.createElement('meta'); m.name = 'theme-color'; m.content = color; if (media) m.media = media; head.appendChild(m); };
  if (t === 'system') { add(THEME_COLOR.light, '(prefers-color-scheme: light)'); add(THEME_COLOR.dark, '(prefers-color-scheme: dark)'); } else add(THEME_COLOR[t]);
  let cs = head.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!cs) { cs = document.createElement('meta'); cs.name = 'color-scheme'; head.appendChild(cs); }
  cs.content = t === 'system' ? 'light dark' : t;
  const sb = head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (sb) sb.content = (t === 'system' ? deviceScheme() : t) === 'light' ? 'default' : 'black';
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.dataset.themePick = t;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  metas(t);
}

export const rememberTheme = (t: Theme) => setCookie(THEME_COOKIE, t);
export function rememberScheme() { const s = deviceScheme(); if (getCookie(SCHEME_COOKIE) !== s) setCookie(SCHEME_COOKIE, s); }

export async function saveTheme(t: Theme, signedIn: boolean): Promise<boolean> {
  applyTheme(t);
  rememberTheme(t);
  if (!signedIn) return true;
  try {
    const r = await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: t }) });
    return r.ok;
  } catch { return false; }
}
