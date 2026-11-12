import { flushSync } from 'react-dom';
import { reducedMotion } from './ticker';

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
const NAMES = ['kx-held-mark', 'kx-held-bubble'] as const;

const last = <T extends Element>(sel: string): T | null => { const all = document.querySelectorAll<T>(sel); return all.length ? all[all.length - 1] : null; };

export function heldMorph(apply: () => void): void {
  const doc = typeof document !== 'undefined' ? (document as VTDoc) : null;
  const from = doc ? [last<HTMLElement>('[data-held-mark]'), last<HTMLElement>('[data-held-bubble]')] : [];
  if (!doc?.startViewTransition || reducedMotion() || !from[0]) { apply(); return; }
  from.forEach((e, i) => { if (e) e.style.viewTransitionName = NAMES[i]; });
  const named: HTMLElement[] = [];
  doc.documentElement.classList.add('vt-held');
  try {
    const t = doc.startViewTransition(() => {
      flushSync(apply);
      const to = [last<HTMLElement>('.ans-wait-ic'), last<HTMLElement>('[data-testid="user-msg"] .bubble')];
      to.forEach((e, i) => { if (e) { e.style.viewTransitionName = NAMES[i]; named.push(e); } });
    });
    void t.finished.finally(() => {
      named.forEach((e) => { e.style.viewTransitionName = ''; });
      doc.documentElement.classList.remove('vt-held');
    });
  } catch {
    doc.documentElement.classList.remove('vt-held');
    apply();
  }
}
