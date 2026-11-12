'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useVirtual(count: number, rowH: number, overscan = 10) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 640 });
  const raf = useRef(0);
  const read = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight ? v : { top: el.scrollTop, h: el.clientHeight }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; read(); }); };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    read();
    return () => { el.removeEventListener('scroll', onScroll); ro?.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [read]);
  const first = Math.max(0, Math.floor(view.top / rowH) - overscan);
  const last = Math.min(count - 1, Math.ceil((view.top + view.h) / rowH) + overscan);
  const scrollTo = useCallback((i: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = Math.max(0, i * rowH - el.clientHeight / 3);
    read();
  }, [rowH, read]);
  const visibleFirst = Math.min(Math.max(0, count - 1), Math.floor(view.top / rowH));
  return { ref, first, last, scrollTo, visibleFirst, height: count * rowH, viewH: view.h };
}
