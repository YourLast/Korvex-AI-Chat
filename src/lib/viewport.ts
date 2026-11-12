export const KB_THRESHOLD = 120;
export const RECHECK_MS = [300, 700] as const;
const SETTLE_MS = 350;

const NO_KEYBOARD_INPUT = new Set(['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'image', 'color', 'hidden']);

export function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') { const t = el as HTMLTextAreaElement; return !t.readOnly && !t.disabled; }
  if (el.tagName === 'INPUT') { const i = el as HTMLInputElement; return !NO_KEYBOARD_INPUT.has((i.type || 'text').toLowerCase()) && !i.readOnly && !i.disabled; }
  const ce = el.getAttribute('contenteditable');
  return (el as HTMLElement).isContentEditable === true || (ce !== null && ce.toLowerCase() !== 'false');
}

function touchDevice(): boolean {
  try { return !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; }
}

export function markSafeTop(root: HTMLElement = document.documentElement): boolean {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top)';
    document.body.appendChild(probe);
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    root.classList.toggle('sa-top', top > 0);
    return top > 0;
  } catch { return false; }
}

export function trackViewport(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  markSafeTop(root);
  let raf = 0;
  let settleT = 0;
  const timers = new Set<number>();
  let base = 0;
  let lastW = 0;
  let away = document.visibilityState === 'hidden';

  const clearVars = () => { root.style.removeProperty('--vvh'); root.style.removeProperty('--vvt'); };

  const apply = (settled: boolean) => {
    const w = vv.width;
    if (Math.abs(w - lastW) > 1) { base = 0; lastW = w; }
    const editable = !away && isEditable(document.activeElement);
    const cur = Math.max(vv.height, window.innerHeight);
    base = editable || !settled ? Math.max(base, cur) : cur;
    const zoomed = vv.scale > 1.02;
    const kb = editable && !zoomed && base - vv.height > KB_THRESHOLD;
    root.classList.toggle('kb-open', kb);
    if (kb) {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvt', `${Math.max(0, Math.round(vv.offsetTop))}px`);
    } else clearVars();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(false); }); };
  const clearTimers = () => { timers.forEach((t) => window.clearTimeout(t)); timers.clear(); };
  const onSize = () => {
    schedule();
    window.clearTimeout(settleT);
    settleT = window.setTimeout(() => apply(true), SETTLE_MS);
  };
  const burst = () => {
    schedule();
    clearTimers();
    for (const ms of RECHECK_MS) {
      const id = window.setTimeout(() => { timers.delete(id); apply(ms === RECHECK_MS[RECHECK_MS.length - 1]); }, ms);
      timers.add(id);
    }
  };

  const goAway = () => {
    away = true;
    if (touchDevice()) { const a = document.activeElement; if (a instanceof HTMLElement && isEditable(a)) a.blur(); }
    apply(false);
  };
  const comeBack = () => {
    if (document.visibilityState === 'hidden') return;
    away = false;
    burst();
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') goAway(); else comeBack(); };
  const onOrientation = () => { markSafeTop(root); base = 0; burst(); };

  apply(true);
  vv.addEventListener('resize', onSize);
  vv.addEventListener('scroll', onSize);
  window.addEventListener('resize', onSize);
  window.addEventListener('orientationchange', onOrientation);
  window.addEventListener('pageshow', comeBack);
  window.addEventListener('pagehide', goAway);
  window.addEventListener('focus', comeBack);
  window.addEventListener('blur', burst);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('focusin', burst);
  document.addEventListener('focusout', burst);
  document.addEventListener('freeze', goAway);
  document.addEventListener('resume', comeBack);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(settleT);
    clearTimers();
    vv.removeEventListener('resize', onSize);
    vv.removeEventListener('scroll', onSize);
    window.removeEventListener('resize', onSize);
    window.removeEventListener('orientationchange', onOrientation);
    window.removeEventListener('pageshow', comeBack);
    window.removeEventListener('pagehide', goAway);
    window.removeEventListener('focus', comeBack);
    window.removeEventListener('blur', burst);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('focusin', burst);
    document.removeEventListener('focusout', burst);
    document.removeEventListener('freeze', goAway);
    document.removeEventListener('resume', comeBack);
    clearVars(); root.classList.remove('kb-open');
  };
}
