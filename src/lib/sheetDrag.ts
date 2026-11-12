
export const LOCK = 8;
export const CLOSE_AT = 0.3;
export const FAST = 0.5;
const VEL_WINDOW = 100;
const OMEGA = (2 * Math.PI) / 360;

export function rubber(d: number, dim: number, c = 0.55): number {
  if (d <= 0 || dim <= 0) return 0;
  return (1 - 1 / ((d * c) / dim + 1)) * dim;
}

export function shouldClose(offset: number, h: number, v: number): boolean {
  if (v > FAST) return true;
  if (v < -FAST) return false;
  return offset > CLOSE_AT * h;
}

export function releaseVelocity(samples: { t: number; y: number }[], now: number): number {
  const s = samples.filter((p) => p.t >= now - VEL_WINDOW);
  if (s.length < 2) return 0;
  const a = s[0], b = s[s.length - 1];
  const dt = b.t - a.t;
  return dt > 0 ? (b.y - a.y) / dt : 0;
}

export function closePlan(x0: number, v0: number, h: number): { T: number; a: number; v: number } {
  const D = Math.max(0, h - x0);
  const v = Math.max(0, v0);
  if (D <= 0) return { T: 0, a: 0, v };
  let T = Math.min(260, Math.max(120, v > 0 ? D / v : 260));
  if (v > 0) T = Math.min(T, (2 * D) / v);
  T = Math.max(1, T);
  return { T, a: (2 * (D - v * T)) / (T * T), v };
}
export const closeAt = (x0: number, p: { a: number; v: number }, t: number) => x0 + p.v * t + 0.5 * p.a * t * t;

export function springAt(x0: number, v0: number, t: number, w = OMEGA): { x: number; v: number } {
  const B = v0 + w * x0;
  const e = Math.exp(-w * t);
  return { x: (x0 + B * t) * e, v: (v0 - w * B * t) * e };
}

const NO_DRAG = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-nodrag]';

function scrollerOf(el: Element | null, stop: Element): HTMLElement | null {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;
    }
  }
  return null;
}
function hScrollable(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function attachSheetDrag(sheet: HTMLElement, scrim: HTMLElement | null, dismiss: () => void, opts: { handle?: string } = {}): () => void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  type G = { x0: number; y0: number; base: number; state: 'wait' | 'drag' | 'no'; scroller: HTMLElement | null; hs: boolean; h: number; samples: { t: number; y: number }[] };
  let g: G | null = null;
  let y = 0;
  let h = 1;
  let raf = 0;
  let mode: 'idle' | 'back' | 'close' = 'idle';

  const apply = (off: number, fade = 1) => {
    y = off;
    sheet.style.transform = off ? `translate3d(0, ${off}px, 0)` : '';
    if (fade < 1) sheet.style.opacity = String(fade);
    if (scrim) scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(0, off) / h)) * fade);
  };
  const begin = () => {
    sheet.dataset.drag = 'active';
    if (scrim) scrim.dataset.drag = '1';
  };
  const rest = () => {
    sheet.dataset.drag = '1';
    sheet.style.transform = ''; sheet.style.opacity = ''; sheet.style.pointerEvents = '';
    if (scrim) { scrim.style.opacity = ''; scrim.style.pointerEvents = ''; }
    y = 0; mode = 'idle';
  };
  const frames = (step: (t: number) => boolean) => {
    cancelAnimationFrame(raf);
    let t0 = -1;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now;
      if (step(now - t0)) raf = requestAnimationFrame(tick); else raf = 0;
    };
    raf = requestAnimationFrame(tick);
  };
  const finish = () => {
    mode = 'idle';
    dismiss();
    window.setTimeout(() => { if (sheet.isConnected && !sheet.classList.contains('is-closing')) rest(); }, 600);
  };
  const close = (x0: number, v0: number) => {
    mode = 'close';
    sheet.style.pointerEvents = 'none';
    if (scrim) scrim.style.pointerEvents = 'none';
    if (reduce.matches) {
      const T = 160;
      frames((t) => { const k = Math.min(1, t / T); apply(x0, 1 - k); if (k < 1) return true; finish(); return false; });
      return;
    }
    const p = closePlan(x0, v0, h);
    frames((t) => {
      if (t >= p.T) { apply(h); finish(); return false; }
      apply(Math.min(h, closeAt(x0, p, t)));
      return true;
    });
  };
  const back = (x0: number, v0: number) => {
    if (reduce.matches || Math.abs(x0) < 0.5) { cancelAnimationFrame(raf); rest(); return; }
    mode = 'back';
    frames((t) => {
      const s = springAt(x0, v0, t);
      if ((t > 60 && Math.abs(s.x) < 0.5 && Math.abs(s.v) < 0.02) || t > 900) { rest(); return false; }
      apply(s.x);
      return true;
    });
  };
  const noClickOnce = () => {
    const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    sheet.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => sheet.removeEventListener('click', stop, { capture: true }), 400);
  };

  const onStart = (e: TouchEvent) => {
    if (mode === 'close') { g = null; return; }
    if (e.touches.length !== 1) {
      if (g?.state === 'drag') back(y, 0);
      g = null; return;
    }
    const t = e.target as Element;
    const hd = opts.handle ? t.closest?.(opts.handle) : sheet;
    if (!hd || !sheet.contains(hd)) { g = null; return; }
    const nd = t.closest?.(NO_DRAG);
    if (nd && (opts.handle ? hd.contains(nd) : true)) { g = null; return; }
    let base = 0;
    if (mode === 'back') { cancelAnimationFrame(raf); mode = 'idle'; base = y; }
    const p = e.touches[0];
    h = Math.max(1, sheet.offsetHeight);
    g = { x0: p.clientX, y0: p.clientY, base, state: base ? 'drag' : 'wait', scroller: scrollerOf(t, sheet), hs: hScrollable(t, sheet), h, samples: [{ t: e.timeStamp, y: p.clientY }] };
    if (base) begin();
  };
  const onMove = (e: TouchEvent) => {
    if (!g || g.state === 'no') return;
    const p = e.touches[0];
    if (!p) return;
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (g.state === 'wait') {
      if (g.scroller && g.scroller.scrollTop > 0) { g.state = 'no'; return; }
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) {
        if (dy > 0 && dy >= Math.abs(dx) && !g.hs && e.cancelable) e.preventDefault();
        return;
      }
      if (Math.abs(dy) <= Math.abs(dx)) { g.state = 'no'; return; }
      if (dy < 0 && g.scroller) { g.state = 'no'; return; }
      g.state = 'drag';
      g.y0 = p.clientY;
      begin();
    }
    if (e.cancelable) e.preventDefault();
    const raw = g.base + (p.clientY - g.y0);
    apply(raw >= 0 ? raw : -rubber(-raw, g.h));
    g.samples.push({ t: e.timeStamp, y: p.clientY });
    if (g.samples.length > 12) g.samples.splice(0, g.samples.length - 12);
  };
  const onEnd = (e: TouchEvent) => {
    if (!g || g.state !== 'drag') { g = null; return; }
    const v = releaseVelocity(g.samples, e.timeStamp);
    sheet.dataset.v = v.toFixed(2);
    g = null;
    noClickOnce();
    if (shouldClose(y, h, v)) close(y, v); else back(y, v);
  };
  const onCancel = () => {
    if (g?.state === 'drag') back(y, 0);
    g = null;
  };

  sheet.addEventListener('touchstart', onStart, { passive: true });
  sheet.addEventListener('touchmove', onMove, { passive: false });
  sheet.addEventListener('touchend', onEnd, { passive: true });
  sheet.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    cancelAnimationFrame(raf);
    sheet.removeEventListener('touchstart', onStart);
    sheet.removeEventListener('touchmove', onMove);
    sheet.removeEventListener('touchend', onEnd);
    sheet.removeEventListener('touchcancel', onCancel);
  };
}
