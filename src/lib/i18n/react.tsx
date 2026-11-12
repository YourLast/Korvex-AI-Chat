'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { bind, LANG_ASKED, LANG_COOKIE, LANG_STORE, type Lang, type TFn } from './core';

type Ctx = { lang: Lang; signedIn: boolean };
const LangCtx = createContext<Ctx>({ lang: 'ru', signedIn: false });

export function rememberLang(lang: Lang) {
  try { document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${365 * 86400}; samesite=lax`; } catch {  }
  try { localStorage.setItem(LANG_STORE, lang); } catch {  }
}

export function I18nProvider({ lang, signedIn = false, children }: { lang: Lang; signedIn?: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ lang, signedIn }), [lang, signedIn]);
  useEffect(() => { if (signedIn) rememberLang(lang); document.documentElement.lang = lang === 'sr' ? 'sr-Latn' : lang; }, [lang, signedIn]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export type T = TFn & { lang: Lang };
export function useT(): T {
  const { lang } = useContext(LangCtx);
  return useMemo(() => Object.assign(bind(lang), { lang }), [lang]);
}
export const useLang = (): Lang => useContext(LangCtx).lang;

export function useSetLang(): (l: Lang) => Promise<void> {
  const { signedIn } = useContext(LangCtx);
  return useCallback(async (l: Lang) => {
    rememberLang(l);
    if (signedIn) { try { await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }); } catch {  } }
    window.location.reload();
  }, [signedIn]);
}

export function langAsked(dev: Lang): boolean {
  try { return localStorage.getItem(LANG_ASKED) === dev; } catch { return true; }
}
export function setLangAsked(dev: Lang) {
  try { localStorage.setItem(LANG_ASKED, dev); } catch {  }
}

export function docLang(): Lang {
  const l = typeof document === 'undefined' ? '' : document.documentElement.lang.toLowerCase();
  return l.startsWith('sr') ? 'sr' : l.startsWith('en') ? 'en' : 'ru';
}
