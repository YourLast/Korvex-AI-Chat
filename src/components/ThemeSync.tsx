'use client';
import { useEffect } from 'react';
import { rememberScheme, rememberTheme } from '@/lib/themeClient';
import type { Theme } from '@/lib/theme';

export function ThemeSync({ theme, signedIn }: { theme: Theme; signedIn: boolean }) {
  useEffect(() => {
    if (signedIn) rememberTheme(theme);
    rememberScheme();
    let mq: MediaQueryList | null = null;
    try { mq = matchMedia('(prefers-color-scheme: light)'); } catch { return; }
    const on = () => rememberScheme();
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, [theme, signedIn]);
  return null;
}
