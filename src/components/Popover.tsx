'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { attachSheetDrag } from '@/lib/sheetDrag';
import { useT } from '@/lib/i18n/react';
import '@/styles/sheet-drag.css';

export const MainCtx = createContext<HTMLElement | null>(null);
export const useMain = () => useContext(MainCtx);

export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 760px)');
    const f = () => setM(q.matches);
    f();
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  return m;
}

function useExit(open: boolean, animate: boolean): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useLayoutEffect(() => {
    if (open) { setMounted(true); return; }
    if (!mounted) return;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-exit').trim();
    const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : 0;
    if (!animate || !(ms > 0)) { setMounted(false); return; }
    const id = window.setTimeout(() => setMounted(false), ms + 20);
    return () => window.clearTimeout(id);
  }, [open, mounted, animate]);
  return { mounted: open || mounted, closing: !open && mounted && animate };
}

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';

export function Popover({ anchor, open, onClose, side = 'top', title, sub, icon, className, sheetClass, bodyClass, children, foot, align = 'left', focusFirst, instant, testId }: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; side?: 'top' | 'bottom'; title: string; sub?: string; icon?: string; className?: string; sheetClass?: string; bodyClass?: string;
  children: ReactNode; foot?: ReactNode; align?: 'left' | 'right'; focusFirst?: string; instant?: boolean; testId?: string;
}) {
  const tx = useT();
  const main = useMain();
  const mobile = useIsMobile();
  const [dragOut, setDragOut] = useState(false);
  const exit = useExit(open && mobile, !instant && !dragOut);
  const ref = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { if (open) setDragOut(false); }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!open || !mobile || !main || !el) return;
    return attachSheetDrag(el, scrimRef.current, () => { setDragOut(true); closeRef.current(); });
  }, [open, mobile, main]);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !main || mobile) return;
    const place = () => {
      const hr = main.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? 400;
      let left = align === 'right' ? ar.right - hr.left - w : ar.left - hr.left;
      left = Math.max(8, Math.min(left, hr.width - w - 8));
      const above = ar.top - hr.top - 16, below = hr.bottom - ar.bottom - 16;
      const need = (ref.current?.scrollHeight ?? 420) + 8;
      const fits = (sp: number) => sp >= need;
      const useTop = side === 'top' ? fits(above) || (!fits(below) && above >= below) : !(fits(below) || (!fits(above) && below >= above));
      if (!fits(above) && !fits(below)) setPos({ left, top: 8, maxHeight: Math.max(160, hr.height - 16) });
      else setPos(useTop
        ? { left, bottom: hr.bottom - ar.top + 8, maxHeight: Math.max(160, above) }
        : { left, top: ar.bottom - hr.top + 8, maxHeight: Math.max(160, below) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, main, mobile, side, align]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab' && focusFirst && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1], cur = document.activeElement;
        if (e.shiftKey && (cur === first || !ref.current.contains(cur))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (cur === last || !ref.current.contains(cur))) { e.preventDefault(); first.focus(); }
      }
    };
    const down = (e: PointerEvent) => {
      if (mobile) return;
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, [open, onClose, anchor, mobile, focusFirst]);

  useEffect(() => {
    if (!open || !focusFirst) return;
    const box = ref.current;
    const id = requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>(focusFirst) ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      el?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
      const a = document.activeElement;
      if (anchor && (!a || a === document.body || box?.contains(a) || !a.isConnected)) anchor.focus({ preventScroll: true });
    };
  }, [open, focusFirst, anchor, mobile]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!main || !(open || (mobile && exit.mounted))) return null;
  const head = (
    <div className="pop-head">
      {icon && <Icon n={icon} sm />}
      <b>{title}</b>
      <span className="grow" />
      {sub && <small>{sub}</small>}
      {mobile && <button type="button" className="icon-btn" onClick={onClose} aria-label={tx('common.close')} data-testid="pop-close"><Icon n="x" /></button>}
    </div>
  );
  return createPortal(
    mobile ? (
      <>
        <div className={`scrim${instant ? ' is-instant' : ''}${exit.closing ? ' is-closing' : ''}`} onClick={onClose} ref={scrimRef} data-testid="scrim" />
        <div className={`sheet${sheetClass ? ' ' + sheetClass : ''}${instant ? ' is-instant' : ''}${exit.closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={exit.closing || undefined} ref={ref} data-testid={testId}>
          <div className="grab" />
          {head}
          <div className={`pop-body${bodyClass ? ' ' + bodyClass : ''}`}>{children}</div>
          {foot && <div className="pop-foot">{foot}</div>}
        </div>
      </>
    ) : (
      <div className={`pop${className ? ' ' + className : ''}${instant ? ' is-instant' : ''}`} role="dialog" aria-label={title} ref={ref} style={pos ?? { left: -9999, top: 0 }} data-testid={testId}>
        {head}
        <div className={`pop-body${bodyClass ? ' ' + bodyClass : ''}`}>{children}</div>
        {foot && <div className="pop-foot">{foot}</div>}
      </div>
    ),
    main,
  );
}
