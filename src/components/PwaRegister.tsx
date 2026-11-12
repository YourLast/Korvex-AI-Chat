'use client';
import { useEffect } from 'react';
import { watchInstall } from '@/lib/installPrompt';

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    watchInstall();
  }, []);
  return null;
}
