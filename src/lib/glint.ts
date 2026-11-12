
import { animate, reducedMotion } from './ticker';

export type Tip = [angle: number, length: number];
export const MARK: { outer: Tip[]; inner: Tip[]; outerCtl: number[]; innerCtl: number[]; R: number; C: [number, number] } = {
  outer: [[1.5, 0.52], [62.25, 1.09], [181.0, 0.598], [243, 1.074]],
  inner: [[-0.25, 0.2325], [64.5, 0.33225], [180, 0.2335], [245.875, 0.31725]],
  outerCtl: [42, 50, 66, 79, 34, 54, 90, 90],
  innerCtl: [8, 8, 10, 10, 11, 6, 27, 12],
  R: 373, C: [515, 508],
};
export const GLINT_VIEWBOX = '280 140 452 735';

export type Preset = { ray: number; sway: number; flareLen: number; flareEvery: number; breath: number; pulse: number; glow: number; spin: number; base: number };
export const PRESETS: Record<'calm' | 'vivid', Preset> = {
  calm:  { ray: 1,   sway: 1,   flareLen: 0.2,  flareEvery: 4.0, breath: 0.18, pulse: 0,     glow: 0.55, spin: 1.5, base: 1 },
  vivid: { ray: 1.9, sway: 1.8, flareLen: 0.34, flareEvery: 2.6, breath: 0.3,  pulse: 0.07,  glow: 0.9,  spin: 2.4, base: 0.84 },
};

const rad = (a: number) => (a * Math.PI) / 180;
const smoothstep = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

export type Shape = { bodyBase: number; openInner: boolean };
export const SHAPE_FULL: Shape = { bodyBase: 1, openInner: false };
export const SHAPE_SMALL: Shape = { bodyBase: 1.35, openInner: true };

export function sub(tips: Tip[], ctl: number[], rot: number, k: number): string {
  const [cx, cy] = MARK.C;
  const u = tips.map(([a]) => [Math.cos(rad(a + rot)), -Math.sin(rad(a + rot))]);
  const p = tips.map(([, l], i) => [cx + MARK.R * l * u[i][0], cy + MARK.R * l * u[i][1]]);
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < tips.length; i++) {
    const j = (i + 1) % tips.length;
    const a = ctl[2 * i] * k, b = ctl[2 * i + 1] * k;
    d += `C${(cx + a * u[i][0]).toFixed(1)} ${(cy + a * u[i][1]).toFixed(1)} ${(cx + b * u[j][0]).toFixed(1)} ${(cy + b * u[j][1]).toFixed(1)} ${p[j][0].toFixed(1)} ${p[j][1].toFixed(1)}`;
  }
  return d + 'Z';
}

const wander = (t: number, f1: number, f2: number, ph: number) => 0.62 * Math.sin(2 * Math.PI * f1 * t + ph) + 0.38 * Math.sin(2 * Math.PI * f2 * t + ph * 1.7);
function flare(t: number, every = 4.0): number {
  const period = every + 0.15 * every * Math.sin(t * 0.21);
  const ph = (t % period) / 0.9;
  return ph < 1 ? Math.sin(Math.PI * ph) ** 2 : 0;
}

export function glintPath(t: number, amt = 1, P: Preset = PRESETS.calm, S: Shape = SHAPE_FULL): { d: string; glow: number; scale: number } {
  const g = flare(t, P.flareEvery) * amt;
  const sway = (7 * Math.sin(2 * Math.PI * 0.11 * t) + 3 * Math.sin(2 * Math.PI * 0.29 * t + 1)) * amt * P.sway;
  const outer = MARK.outer.map(([a, l], i): Tip => {
    const long = i % 2 === 1;
    const w = wander(t, [0.17, 0.13, 0.23, 0.19][i], [0.41, 0.37, 0.31, 0.47][i], [0, 2.1, 4.2, 1.3][i]);
    const len = long ? l * (1 + amt * 0.07 * P.ray * w + P.flareLen * g) : l * (1 - amt * 0.16 * P.ray * w - 0.4 * P.flareLen * g);
    return [a + amt * 2.5 * Math.sin(2 * Math.PI * [0.09, 0.07, 0.12, 0.08][i] * t + i), len];
  });
  const body = 1 + amt * 0.1 * Math.sin(2 * Math.PI * 0.21 * t) - 0.12 * g;
  const breath = 1 + amt * P.breath * Math.sin(2 * Math.PI * 0.17 * t + Math.PI);
  const scale = (1 + (P.base - 1) * amt) * (1 + amt * P.pulse * Math.sin(2 * Math.PI * 0.23 * t) + 0.5 * P.pulse * g);
  const glow = g * P.glow / 0.55;
  const outerD = sub(outer, MARK.outerCtl, sway, body * S.bodyBase);
  if (S.openInner && amt <= 0) return { d: outerD, glow, scale };
  const open = S.openInner ? smoothstep(amt) : 1;
  const inner = MARK.inner.map(([a, l]): Tip => [a, l * breath * open]);
  return { d: outerD + sub(inner, MARK.innerCtl, -P.spin * sway, breath * open), glow, scale };
}

export type GlintOptions = { live?: boolean; preset?: 'calm' | 'vivid'; viewBox?: string; rest?: string; base?: number; bodyBase?: number; openInner?: boolean };
export type GlintHandle = { setLive(v: boolean): void; destroy(): void };

export function mountGlint(svg: SVGSVGElement, { live = true, preset = 'calm', viewBox = GLINT_VIEWBOX, rest, base, bodyBase = SHAPE_FULL.bodyBase, openInner = SHAPE_FULL.openInner }: GlintOptions = {}): GlintHandle {
  const P: Preset = { ...(PRESETS[preset] || PRESETS.calm), ...(base === undefined ? {} : { base }) };
  const S: Shape = { bodyBase, openInner };
  const NS = 'http://www.w3.org/2000/svg';
  const restD = rest ?? glintPath(0, 0, P, S).d;
  svg.setAttribute('viewBox', viewBox);
  svg.style.overflow = 'visible';
  const path = svg.querySelector('path') || svg.appendChild(document.createElementNS(NS, 'path'));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  const still = reducedMotion();
  const canAnim = typeof requestAnimationFrame === 'function';
  let on = live && !still && canAnim, amt = on ? 1 : 0;
  const t0 = performance.now();
  const settle = () => { path.setAttribute('d', restD); svg.style.filter = ''; svg.style.transform = ''; };
  const anim = animate((now, dt) => {
    amt += ((on ? 1 : 0) - amt) * Math.min(1, dt * 4);
    const { d, glow, scale } = glintPath((now - t0) / 1000, amt, P, S);
    path.setAttribute('d', d);
    svg.style.transform = scale !== 1 ? `scale(${scale.toFixed(3)})` : '';
    svg.style.filter = glow > 0.02 ? `drop-shadow(0 0 ${(1 + 3 * glow).toFixed(2)}px rgba(255,255,255,${Math.min(0.95, 0.55 * glow).toFixed(2)}))` : '';
    if (on || amt > 0.002) return true;
    amt = 0; settle();
    return false;
  });
  path.setAttribute('d', restD);
  if (on) anim.kick();
  return {
    setLive(v: boolean) { on = !!v && !still && canAnim; if (on) anim.kick(); else if (!anim.on && amt <= 0.002) settle();  },
    destroy() { anim.stop(); on = false; amt = 0; settle(); },
  };
}
