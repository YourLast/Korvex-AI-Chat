'use client';
import { useEffect, useRef } from 'react';
import { glintPath, PRESETS, SHAPE_SMALL, type Preset } from '@/lib/glint';
import { ERR_DOT_D, ERR_DOT_FULL, HM, HM_CENTER, hmAdvance, hmDue, hmEase, hmProps, hmStart, morphD, poseDrawD, type HmPose, type HmProps, type HmState } from '@/lib/headMark';
import { MARK_ASPECT, MARK_SMALL, MARK_VIEWBOX } from '@/lib/thinkMark';
import { animate, reducedMotion } from '@/lib/ticker';
import '@/styles/thinkmark.css';

const P: Preset = { ...PRESETS.vivid, base: 0.95 };
const CALM_AMT = 0.35;
const [CX, CY] = HM_CENTER;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const scaleAbout = (s: number, rot = 0) => (Math.abs(s - 1) < 0.001 && !rot ? '' : `${rot ? `rotate(${rot.toFixed(1)} ${CX} ${CY}) ` : ''}translate(${CX} ${CY}) scale(${s.toFixed(3)}) translate(${-CX} ${-CY})`);
const now = () => performance.now();
const T0 = typeof performance !== 'undefined' ? performance.now() : 0;
let handoff = { at: -1e9, amt: 0 };

export type HeadHandle = { set(p: HmProps, calm?: boolean): void; destroy(): void; readonly state: HmState };

export function mountHead(svg: SVGSVGElement, init: HmProps, { play = false, calm = false }: { play?: boolean; calm?: boolean } = {}): HeadHandle {
  const g = svg.querySelector<SVGPathElement>('.hm-g')!, p = svg.querySelector<SVGPathElement>('.hm-p')!, dot = svg.querySelector<SVGPathElement>('.hm-d')!;
  const instant = reducedMotion() || typeof requestAnimationFrame !== 'function';
  let props = init, quiet = calm;
  let s = hmStart(init, now(), play, instant);
  let amt = 0, timer = 0, painted = '', dotR = 0, snapDot = 0;
  if (s.phase === 'think' && !instant && now() - handoff.at < 700) amt = handoff.amt;

  const attr = (el: Element, k: string, v: string) => { if (v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); } else if (el.hasAttribute(k)) el.removeAttribute(k); };
  const setDot = (r: number) => { dotR = r; attr(dot, 'd', ERR_DOT_D(r)); };
  const setPhase = () => {
    svg.dataset.phase = s.phase;
    const pose = s.phase === 'in' || s.phase === 'hold' ? s.pose ?? '' : '';
    if (pose) svg.dataset.pose = pose; else delete svg.dataset.pose;
  };
  const glintAt = (tms: number, dt: number, target: number) => {
    amt = instant ? 0 : amt + (target - amt) * Math.min(1, dt * 4);
    if (amt < 0.002 && target === 0) amt = 0;
    const f = glintPath((tms - T0) / 1000, amt, P, SHAPE_SMALL);
    return f;
  };
  const paint = (tms: number, dt: number) => {
    const ph = s.phase;
    if (ph === 'rest' || ph === 'think') {
      const f = glintAt(tms, dt, ph === 'think' ? (quiet ? CALM_AMT : 1) : 0);
      attr(g, 'd', f.d); attr(g, 'transform', scaleAbout(f.scale)); attr(g, 'opacity', '');
      attr(p, 'd', ''); attr(p, 'transform', ''); attr(p, 'opacity', ''); setDot(0);
      svg.style.filter = f.glow > 0.02 && !instant ? `drop-shadow(0 0 ${(1 + 3 * f.glow).toFixed(2)}px rgba(255,255,255,${Math.min(0.95, 0.55 * f.glow).toFixed(2)}))` : '';
      return;
    }
    svg.style.filter = '';
    const pose = s.pose as HmPose;
    const e = instant ? 1 : clamp01((tms - s.at) / (ph === 'in' ? HM.DRAW : ph === 'out' ? HM.BACK : ph === 'snap' ? HM.SNAP : 1));
    if (ph === 'in') {
      const u = hmEase.in(clamp01((e * HM.DRAW) / 240));
      const f = glintAt(tms, dt, 0);
      attr(g, 'd', f.d); attr(g, 'transform', u >= 1 ? 'scale(0)' : scaleAbout(f.scale * (1 - u), -40 * u)); attr(g, 'opacity', u >= 1 ? '0' : (1 - u * u).toFixed(3));
      const k = clamp01((e * HM.DRAW - 40) / (HM.DRAW - 40));
      const pd = poseDrawD(pose, k);
      attr(p, 'd', pd.d); attr(p, 'transform', pd.tf ?? ''); attr(p, 'opacity', pose === 'stop' ? hmEase.out(k).toFixed(3) : '');
      setDot(pd.dot);
    } else if (ph === 'hold') {
      const pd = poseDrawD(pose, 1);
      attr(g, 'opacity', '0'); attr(g, 'transform', 'scale(0)');
      attr(p, 'd', pd.d); attr(p, 'transform', ''); attr(p, 'opacity', '');
      setDot(pose === 'error' ? ERR_DOT_FULL : 0);
      amt = 0;
    } else if (ph === 'out') {
      attr(g, 'opacity', '0'); attr(g, 'transform', 'scale(0)');
      attr(p, 'd', morphD(pose, e)); attr(p, 'transform', ''); attr(p, 'opacity', '');
      setDot(pose === 'error' ? ERR_DOT_FULL * (1 - hmEase.out(clamp01(e / 0.4))) : 0);
    } else if (ph === 'snap') {
      const f = glintAt(tms, dt, quiet ? CALM_AMT : 1);
      attr(g, 'd', f.d); attr(g, 'transform', scaleAbout(f.scale * (0.55 + 0.45 * hmEase.out(e)))); attr(g, 'opacity', hmEase.out(e).toFixed(3));
      if (painted !== 'snap') snapDot = dotR;
      attr(p, 'transform', scaleAbout(1 - 0.4 * e)); attr(p, 'opacity', (1 - e).toFixed(3));
      setDot(snapDot * (1 - e));
    }
    painted = ph;
  };
  const needFrames = () => !instant && (s.phase === 'think' || s.phase === 'in' || s.phase === 'out' || s.phase === 'snap' || (s.phase === 'rest' && amt > 0));
  const anim = animate((tms, dt) => {
    const before = s.phase;
    s = hmAdvance(s, tms, instant);
    if (s.phase !== before) setPhase();
    paint(tms, dt);
    arm();
    return needFrames();
  });
  const arm = () => {
    const due = hmDue(s, instant);
    if (timer || due === null || (!instant && s.phase !== 'hold')) return;
    timer = window.setTimeout(() => {
      timer = 0;
      const before = s.phase;
      s = hmAdvance(s, Math.max(now(), due), instant);
      if (s.phase !== before) setPhase();
      paint(now(), 0);
      arm();
      if (needFrames()) anim.kick();
    }, Math.max(0, due - now()));
  };
  const kick = () => { setPhase(); paint(now(), 0); arm(); if (needFrames()) anim.kick(); };
  kick();
  return {
    set(next: HmProps, c = false) {
      quiet = c;
      if (next.live === props.live && next.end === props.end) { if (needFrames()) anim.kick(); return; }
      const before = s;
      s = hmProps(s, props, next, now(), instant);
      props = next;
      if (s !== before) { if (timer) { window.clearTimeout(timer); timer = 0; } kick(); }
    },
    destroy() {
      if (s.phase === 'think' && amt > 0) handoff = { at: now(), amt };
      anim.stop();
      if (timer) window.clearTimeout(timer);
      timer = 0;
    },
    get state() { return s; },
  };
}

export function HeadMark({ live, end = null, calm = false, play = false, size, className }: { live: boolean; end?: HmPose | null; calm?: boolean; play?: boolean; size?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const h = useRef<HeadHandle | null>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    h.current = mountHead(svg, { live, end }, { play, calm });
    return () => { h.current?.destroy(); h.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { h.current?.set({ live, end }, calm); }, [live, end, calm]);
  const style = size ? { height: size, width: size * MARK_ASPECT } : undefined;
  return (
    <svg ref={ref} className={`tm hm${live ? ' is-live' : ''}${className ? ' ' + className : ''}`} style={style} viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false" data-live={live ? '' : undefined}>
      <path className="hm-g" fill="currentColor" fillRule="evenodd" d={MARK_SMALL} />
      <path className="hm-p" fill="currentColor" />
      <path className="hm-d" fill="currentColor" />
    </svg>
  );
}
