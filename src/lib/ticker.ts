
export type FrameFn = (now: number, dt: number) => boolean;
export type Anim = {
  kick(): void;
  stop(): void;
  readonly on: boolean;
};

type Sub = { fn: FrameFn; last: number; on: boolean };
const active = new Set<Sub>();
let raf = 0;
let listening = false;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const hidden = () => typeof document !== 'undefined' && document.hidden === true;
const rafFn = (): ((cb: FrameRequestCallback) => number) | null =>
  typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null;
const cafFn = (): ((id: number) => void) =>
  typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : () => {};

function onVisibility() {
  if (hidden()) { if (raf) cafFn()(raf); raf = 0; return; }
  const t = now();
  for (const s of active) s.last = t;
  request();
}
function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', onVisibility);
}
function request() {
  if (raf || !active.size || hidden()) return;
  const r = rafFn();
  if (r) raf = r(frame);
}
function frame(t: number) {
  raf = 0;
  for (const s of [...active]) {
    if (!active.has(s)) continue;
    const dt = Math.max(0, Math.min(0.1, (t - s.last) / 1000));
    s.last = t;
    let more = false;
    try { more = s.fn(t, dt); } catch (e) { more = false; console.error(e); }
    if (!more) { active.delete(s); s.on = false; }
  }
  request();
}

export function animate(fn: FrameFn): Anim {
  const s: Sub = { fn, last: 0, on: false };
  return {
    kick() {
      if (!rafFn()) return;
      listen();
      if (!s.on) { s.on = true; s.last = now(); active.add(s); }
      request();
    },
    stop() {
      if (!s.on) return;
      s.on = false; active.delete(s);
      if (!active.size && raf) { cafFn()(raf); raf = 0; }
    },
    get on() { return s.on; },
  };
}

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)')?.matches;

const quietSubs = new Set<(q: boolean) => void>();
let mo: MutationObserver | null = null;
let quietNow = false;
export const isQuiet = (): boolean => typeof document !== 'undefined' && document.documentElement.classList.contains('wbar-shown');
export function onQuiet(cb: (q: boolean) => void): () => void {
  quietSubs.add(cb);
  if (!mo && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    quietNow = isQuiet();
    mo = new MutationObserver(() => {
      const q = isQuiet();
      if (q === quietNow) return;
      quietNow = q;
      for (const f of [...quietSubs]) f(q);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
  return () => {
    quietSubs.delete(cb);
    if (!quietSubs.size && mo) { mo.disconnect(); mo = null; }
  };
}

export const tickerState = () => ({ active: active.size, raf: raf !== 0 });
export function tickerReset() {
  if (raf) cafFn()(raf);
  raf = 0;
  for (const s of active) s.on = false;
  active.clear();
}
