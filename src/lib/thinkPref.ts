'use client';
import { useEffect, useState } from 'react';

export const THINK_FULL_KEY = 'kx.thinkFull';
const EV = 'kx:think-full';
export const THINK_DEFAULT = { on: false };
export const THINK_GATE = { brief: false };

export function readThinkFull(): boolean {
  try { return localStorage.getItem(THINK_FULL_KEY) === '1' || THINK_DEFAULT.on; } catch { return THINK_DEFAULT.on; }
}
export function setThinkFull(v: boolean) {
  try { if (v) localStorage.setItem(THINK_FULL_KEY, '1'); else localStorage.removeItem(THINK_FULL_KEY); } catch {  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EV));
}
export function useThinkFull(): boolean {
  const [on, setOn] = useState(() => THINK_DEFAULT.on);
  useEffect(() => {
    const read = () => setOn(readThinkFull());
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === THINK_FULL_KEY) read(); };
    window.addEventListener(EV, read);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(EV, read); window.removeEventListener('storage', onStorage); };
  }, []);
  return on || !THINK_GATE.brief;
}
