import { CLOSE_AT, FAST, LOCK, releaseVelocity } from './sheetDrag';

const NO_DRAG = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-nodrag]';
const MS = 220;
const EASE = 'cubic-bezier(.2, 0, 0, 1)';

function hScrollable(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function shouldDismiss(dx: number, w: number, v: number): boolean {
  if (dx === 0) return false;
  const s = Math.sign(dx), vs = v * s;
  if (vs > FAST) return true;
  if (vs < -FAST) return false;
  return Math.abs(dx) > CLOSE_AT * w;
}

export function attachPageSwipe(page: HTMLElement, dismiss: () => void): () => void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  type G = { x0: number; y0: number; state: 'wait' | 'drag' | 'no'; w: number; samples: { t: number; y: number }[] };
  let g: G | null = null;
  let dx = 0;
  let timer = 0;

  const move = (x: number, ms = 0) => {
    dx = x;
    page.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
    page.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
  };
  const noClickOnce = () => {
    const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    page.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => page.removeEventListener('click', stop, { capture: true }), 400);
  };
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) { g = null; return; }
    const t = e.target as Element;
    if (t.closest?.(NO_DRAG) || hScrollable(t, page)) { g = null; return; }
    const p = e.touches[0];
    g = { x0: p.clientX, y0: p.clientY, state: 'wait', w: Math.max(1, page.offsetWidth), samples: [{ t: e.timeStamp, y: p.clientX }] };
  };
  const onMove = (e: TouchEvent) => {
    if (!g || g.state === 'no') return;
    const p = e.touches[0];
    if (!p) return;
    const ddx = p.clientX - g.x0, ddy = p.clientY - g.y0;
    if (g.state === 'wait') {
      if (Math.abs(ddx) < LOCK && Math.abs(ddy) < LOCK) return;
      if (Math.abs(ddx) <= Math.abs(ddy)) { g.state = 'no'; return; }
      g.state = 'drag';
      g.x0 = p.clientX;
      page.dataset.drag = 'active';
    }
    if (e.cancelable) e.preventDefault();
    move(p.clientX - g.x0);
    g.samples.push({ t: e.timeStamp, y: p.clientX });
    if (g.samples.length > 12) g.samples.splice(0, g.samples.length - 12);
  };
  const onEnd = (e: TouchEvent) => {
    if (!g || g.state !== 'drag') { g = null; return; }
    const v = releaseVelocity(g.samples, e.timeStamp);
    const w = g.w;
    g = null;
    noClickOnce();
    if (shouldDismiss(dx, w, v)) {
      page.style.pointerEvents = 'none';
      if (reduce.matches) { dismiss(); return; }
      move(Math.sign(dx) * w, MS);
      timer = window.setTimeout(dismiss, MS);
    } else {
      move(0, reduce.matches ? 0 : MS);
      timer = window.setTimeout(() => { page.style.transition = ''; page.dataset.drag = '1'; }, MS);
    }
  };
  const onCancel = () => {
    if (g?.state === 'drag') move(0, MS);
    g = null;
  };

  page.addEventListener('touchstart', onStart, { passive: true });
  page.addEventListener('touchmove', onMove, { passive: false });
  page.addEventListener('touchend', onEnd, { passive: true });
  page.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    window.clearTimeout(timer);
    page.removeEventListener('touchstart', onStart);
    page.removeEventListener('touchmove', onMove);
    page.removeEventListener('touchend', onEnd);
    page.removeEventListener('touchcancel', onCancel);
  };
}
