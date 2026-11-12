'use client';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icon';
import { ERR_C, ICONS, errBadge, iconFrame, isActIcon, strokeUnits, type El, type IconState } from '@/lib/actIcons';
import { animate, isQuiet, onQuiet, reducedMotion } from '@/lib/ticker';
import '@/styles/act-icons.css';

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const isErr = (s: IconState) => s === 'err' || s === 'warn';
const ERR_MS = 340;
const DOT_TF = (k: number) => (k >= 0.999 ? '' : `translate(${ERR_C[0]} ${ERR_C[1] + 3.3}) scale(${Math.max(0, k).toFixed(3)}) translate(${-ERR_C[0]} ${-(ERR_C[1] + 3.3)})`);

export type IconHandle = { set(s: IconState): void; destroy(): void; readonly amt: number; readonly err: number };

export function mountIcon(svg: SVGSVGElement, n: string, px: number, init: IconState, quietable = false): IconHandle {
  const def = ICONS[n] ?? ICONS.tool, w = strokeUnits(px);
  const els = Array.from(svg.querySelectorAll<SVGElement>('.ai-e'));
  const grp = svg.querySelector<SVGGElement>('.ai-g'), cut = svg.querySelector<SVGCircleElement>('.ai-cut');
  const spike = svg.querySelector<SVGPathElement>('.ai-x'), xdot = svg.querySelector<SVGPathElement>('.ai-xd');
  const maskUrl = grp?.dataset.mask ?? '';
  const instant = reducedMotion() || typeof requestAnimationFrame !== 'function';
  let st = init, quiet = quietable && isQuiet();
  let amt = 0, err = isErr(init) ? 1 : 0;
  const t0 = performance.now();
  const last: { d?: string; o?: string; tf?: string }[] = els.map(() => ({}));
  const set = (el: Element, k: string, v: string | undefined) => { if (v) el.setAttribute(k, v); else el.removeAttribute(k); };
  const paint = (now: number) => {
    const f: El[] = def.draw({ t: amt > 0 ? (now - t0) / 1000 : 0, amt, w });
    for (let i = 0; i < els.length && i < f.length; i++) {
      const e = f[i], l = last[i];
      const o = e.o === undefined || e.o >= 0.999 ? undefined : Math.max(0, e.o).toFixed(3);
      if (l.d !== e.d) { els[i].setAttribute('d', e.d); l.d = e.d; }
      if (l.o !== o) { set(els[i], 'opacity', o); l.o = o; }
      if (l.tf !== e.tf) { set(els[i], 'transform', e.tf); l.tf = e.tf; }
    }
    if (grp && cut && spike && xdot) {
      const b = errBadge(err, w);
      set(grp, 'mask', err > 0.001 ? maskUrl : undefined);
      cut.setAttribute('r', b.cut.toFixed(2));
      spike.setAttribute('d', err > 0.001 ? b.spike : 'M0 0Z');
      xdot.setAttribute('d', err > 0.001 ? b.dot : 'M0 0Z');
      set(xdot, 'transform', DOT_TF(b.dotR));
    }
  };
  const target = () => (st === 'run' && !quiet && !instant ? 1 : 0);
  const anim = animate((now, dt) => {
    const tgt = target();
    amt += (tgt - amt) * Math.min(1, dt * 5);
    if (tgt === 0 && amt < 0.004) amt = 0;
    const et = isErr(st) ? 1 : 0;
    err = et > err ? Math.min(1, err + (dt * 1000) / ERR_MS) : Math.max(0, err - (dt * 1000) / ERR_MS);
    paint(now);
    return tgt > 0 || amt > 0 || err !== et;
  });
  const go = () => {
    if (instant) { amt = 0; err = isErr(st) ? 1 : 0; paint(performance.now()); return; }
    if (target() > 0 || amt > 0 || err !== (isErr(st) ? 1 : 0)) anim.kick();
  };
  const offQuiet = quietable ? onQuiet((q) => { quiet = q; go(); }) : () => {};
  go();
  return {
    set(s: IconState) { if (s === st) return; st = s; go(); },
    destroy() { anim.stop(); offQuiet(); },
    get amt() { return amt; },
    get err() { return err; },
  };
}

export function ActIcon({ n, state = 'ok', px = 16, quiet = false, className }: { n: string; state?: IconState; px?: number; quiet?: boolean; className?: string }) {
  if (!isActIcon(n)) return <Icon n={n} sm className={className} />;
  return <ActSvg n={n} state={state} px={px} quiet={quiet} className={className} />;
}

function ActSvg({ n, state, px, quiet, className }: { n: string; state: IconState; px: number; quiet: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const h = useRef<IconHandle | null>(null);
  const mid = `aim${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  useIso(() => {
    const svg = ref.current;
    if (!svg) return;
    h.current = mountIcon(svg, n, px, state, quiet);
    return () => { h.current?.destroy(); h.current = null; };
  }, [n, px, quiet]); // eslint-disable-line react-hooks/exhaustive-deps
  useIso(() => { h.current?.set(state); }, [state]);
  const f = iconFrame(n, 0, 0, px);
  const e0 = isErr(state);
  const b = errBadge(e0 ? 1 : 0, strokeUnits(px));
  return (
    <svg ref={ref} className={`i i--sm ai${className ? ' ' + className : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-ai={n} data-st={state}>
      <mask id={mid} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
        <rect x="-2" y="-2" width="28" height="28" fill="#fff" />
        <circle className="ai-cut" cx={ERR_C[0]} cy={ERR_C[1]} r={b.cut.toFixed(2)} fill="#000" />
      </mask>
      <g className="ai-g" data-mask={`url(#${mid})`} mask={e0 ? `url(#${mid})` : undefined}>
        {f.map((e, i) => e.k === 'l'
          ? <path key={i} className="ai-e" d={e.d} opacity={e.o === undefined || e.o >= 0.999 ? undefined : e.o.toFixed(3)} transform={e.tf} />
          : <path key={i} className="ai-e" d={e.d} fill="currentColor" stroke="none" opacity={e.o === undefined || e.o >= 0.999 ? undefined : e.o.toFixed(3)} transform={e.tf} />)}
      </g>
      <path className="ai-x" d={e0 ? b.spike : 'M0 0Z'} fill="currentColor" stroke="none" />
      <path className="ai-xd" d={e0 ? b.dot : 'M0 0Z'} fill="currentColor" stroke="none" />
    </svg>
  );
}
