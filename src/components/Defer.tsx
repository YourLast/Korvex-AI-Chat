'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const anchors = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow-anchor', 'auto');

function spanOf(el: HTMLElement): number {
  const a = el.firstElementChild, b = el.lastElementChild;
  if (!a || !b) return 0;
  return b.getBoundingClientRect().bottom - a.getBoundingClientRect().top;
}

export function Defer({ est, children }: { est: number; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef<{ above: boolean; h: number } | null>(null);
  useEffect(() => {
    if (on) return;
    const el = ref.current;
    const root = el?.closest('.thread') as HTMLElement | null;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      const r = el.getBoundingClientRect();
      was.current = { above: !!root && r.bottom <= root.getBoundingClientRect().top + 1, h: r.height };
      setOn(true);
    }, { root, rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [on]);
  useLayoutEffect(() => {
    const w = was.current;
    was.current = null;
    if (!on || !w?.above || anchors()) return;
    const el = ref.current, root = el?.closest('.thread') as HTMLElement | null;
    if (!el || !root) return;
    const d = spanOf(el) - w.h;
    if (d) root.scrollTop += d;
  }, [on]);
  if (!on) return <div ref={ref} className="turn-ph" aria-hidden="true" style={{ height: est }} />;
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}
