
const START = 12;
const RATIO = 1.5;
const OPEN_AT = 0.35;
const FAST = 0.45;

function hScrollable(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}
const blocked = (t: Element) => !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .sheet, .pop, .scrim, .dlg-scrim, [data-noswipe]');
const overlayOpen = () => !!document.querySelector('.sheet, .pop, .dlg-scrim, .acct-menu, .iv, .blv--full');
const selecting = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && String(s).length > 0; };

export function attachDrawerSwipe(open: () => void, close: () => void): () => void {
  const mq = window.matchMedia('(max-width: 760px) and (pointer: coarse)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  type G = { x0: number; y0: number; t0: number; was: boolean; state: 'wait' | 'drag' | 'no'; w: number; x: number; lx: number; lt: number; v: number };
  let g: G | null = null;
  const panel = () => document.querySelector<HTMLElement>('.sidebar');
  const scrim = () => document.querySelector<HTMLElement>('.drawer-scrim');

  const place = (offset: number) => {
    const p = panel(), s = scrim();
    if (!g || !p) return;
    p.style.transform = `translateX(${offset - g.w}px)`;
    if (s) s.style.opacity = String(Math.max(0, Math.min(1, offset / g.w)));
  };
  const reset = () => {
    const p = panel(), s = scrim();
    root.classList.remove('drawer-drag');
    if (p) p.style.transform = '';
    if (s) s.style.opacity = '';
  };

  const onStart = (e: TouchEvent) => {
    g = null;
    if (!mq.matches || e.touches.length !== 1) return;
    const t = e.target as Element;
    const was = root.classList.contains('drawer-open');
    if (!was && (overlayOpen() || blocked(t) || hScrollable(t, document.body))) return;
    if (was && !t.closest('.sidebar, .drawer-scrim')) return;
    if (was && hScrollable(t, document.body)) return;
    if (selecting()) return;
    const p = e.touches[0];
    g = { x0: p.clientX, y0: p.clientY, t0: e.timeStamp, was, state: 'wait', w: panel()?.offsetWidth || 320, x: 0, lx: p.clientX, lt: e.timeStamp, v: 0 };
  };
  const onMove = (e: TouchEvent) => {
    if (!g || g.state === 'no') return;
    const p = e.touches[0];
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (g.state === 'wait') {
      if (Math.abs(dy) > START && Math.abs(dy) >= Math.abs(dx)) { g.state = 'no'; return; }
      if (Math.abs(dx) <= START || Math.abs(dx) <= RATIO * Math.abs(dy)) return;
      if ((g.was && dx > 0) || (!g.was && dx < 0) || selecting()) { g.state = 'no'; return; }
      g.state = 'drag';
      if (!reduce.matches) { root.classList.add('drawer-drag'); place(g.was ? g.w : 0); }
    }
    if (e.cancelable) e.preventDefault();
    const dt = Math.max(1, e.timeStamp - g.lt);
    g.v = 0.7 * ((p.clientX - g.lx) / dt) + 0.3 * g.v;
    g.lx = p.clientX; g.lt = e.timeStamp;
    g.x = dx;
    if (!reduce.matches) place(Math.max(0, Math.min(g.w, (g.was ? g.w : 0) + dx)));
  };
  const onEnd = () => {
    if (!g || g.state !== 'drag') { g = null; return; }
    const offset = Math.max(0, Math.min(g.w, (g.was ? g.w : 0) + g.x));
    const toOpen = g.was ? !(offset < g.w * (1 - OPEN_AT) || g.v < -FAST) : offset > g.w * OPEN_AT || g.v > FAST;
    if (toOpen) open(); else close();
    reset();
    g = null;
  };
  const onCancel = () => { if (g?.state === 'drag') reset(); g = null; };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
  };
}
