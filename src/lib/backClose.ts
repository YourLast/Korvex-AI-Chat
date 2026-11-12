'use client';
import { useEffect, useRef } from 'react';

const KEY = 'kxBack';

export function useBackClose(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const token = Math.random().toString(36).slice(2, 10);
    const ours = () => (window.history.state as Record<string, unknown> | null)?.[KEY] === token;
    try { window.history.pushState({ ...((window.history.state as object | null) ?? {}), [KEY]: token }, ''); } catch { return; }
    let popped = false;
    const onPop = () => {
      if (ours()) return;
      popped = true;
      cb.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && ours()) window.history.back();
    };
  }, [active]);
}
