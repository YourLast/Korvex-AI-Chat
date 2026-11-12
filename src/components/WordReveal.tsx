'use client';
import { useLayoutEffect, useMemo, useRef, type AnimationEvent, type RefObject } from 'react';
import { REVEAL_BLUR_PX, REVEAL_RISE_PX, revealPlan } from '@/lib/voiceLogic';

export const MIRROR = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-kerning', 'font-feature-settings', 'font-variant-ligatures', 'font-variant-numeric',
  'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform', 'text-align', 'text-rendering', 'tab-size', 'direction',
  'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'line-break',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
] as const;

export const REVEAL_GRACE_MS = 250;

const END_NAMES = new Set(['wr-tr', 'wr-fade']);
const INTERRUPT = ['pointerdown', 'beforeinput', 'paste', 'cut', 'drop', 'compositionstart'] as const;
const MODS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn', 'OS']);

export function WordReveal({ full, from, ta, onDone, reduced = false, max }: {
  full: string; from: number; ta: RefObject<HTMLTextAreaElement | null>; onDone: () => void;
  reduced?: boolean;
  max?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const done = useRef(onDone); done.current = onDone;
  const plan = useMemo(() => revealPlan(full, from, reduced, max), [full, from, reduced, max]);
  useLayoutEffect(() => {
    const el = ta.current, o = outer.current, i = inner.current;
    if (!el || !o || !i) return;
    const place = () => {
      const cs = getComputedStyle(el);
      for (const p of MIRROR) i.style.setProperty(p, cs.getPropertyValue(p));
      o.style.width = el.clientWidth + 'px';
      i.style.transform = `translateY(${-el.scrollTop}px)`;
    };
    place();
    const raf = requestAnimationFrame(place), t1 = window.setTimeout(place, 60);
    const end = window.setTimeout(() => done.current(), plan.total + REVEAL_GRACE_MS);
    const stop = () => done.current();
    const key = (e: KeyboardEvent) => { if (!MODS.has(e.key)) stop(); };
    el.addEventListener('scroll', place);
    el.addEventListener('keydown', key);
    for (const n of INTERRUPT) el.addEventListener(n, stop);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(end); ro?.disconnect();
      el.removeEventListener('scroll', place); el.removeEventListener('keydown', key);
      for (const n of INTERRUPT) el.removeEventListener(n, stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, ta]);
  let k = 0;
  const lastW = plan.count - 1;
  return (
    <div className={`wr${reduced ? ' wr--rm' : ''}`} ref={outer} aria-hidden="true" data-testid="reveal" data-words={plan.count} data-skipped={plan.skipped} data-motion={reduced ? 'fade' : 'blur'}>
      <div className="wr-t" ref={inner}
        style={{ ['--wr-fade' as string]: plan.fade + 'ms', ['--wr-rise' as string]: plan.rise + 'ms', ['--wr-blur' as string]: REVEAL_BLUR_PX + 'px', ['--wr-lift' as string]: REVEAL_RISE_PX + 'px' }}>
        {plan.head}
        {plan.parts.map((p, n) => {
          if (!p.w) return p.t;
          const idx = k++;
          return (
            <span key={n} className="wr-w" style={{ ['--d' as string]: Math.round(idx * plan.step) + 'ms' }}
              onAnimationEnd={idx === lastW ? (e: AnimationEvent) => { if (END_NAMES.has(e.animationName)) done.current(); } : undefined}>{p.t}</span>
          );
        })}
      </div>
    </div>
  );
}
