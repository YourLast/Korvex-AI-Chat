import { MARK_SMALL } from './thinkMark';
import { align, lerpPts, parsePath, polyD, resample, signedArea, slice, taper, type Pt } from './morph';

export const HM = {
  DRAW: 380,
  HOLD: 3000,
  BACK: 620,
  SNAP: 220,
} as const;

export type HmPose = 'check' | 'error' | 'stop';
export type HmPhase = 'rest' | 'think' | 'in' | 'hold' | 'out' | 'snap';
export type HmState = { phase: HmPhase; pose: HmPose | null; at: number };
export type HmProps = { live: boolean; end: HmPose | null };

export function hmStart(p: HmProps, now: number, play = false, reduced = false): HmState {
  if (p.live) return { phase: 'think', pose: null, at: now };
  if (play && p.end) return { phase: reduced ? 'hold' : 'in', pose: p.end, at: now };
  return { phase: 'rest', pose: null, at: now };
}

export function hmProps(s: HmState, prev: HmProps, next: HmProps, now: number, reduced = false): HmState {
  if (next.live) {
    if (s.phase === 'think' || s.phase === 'snap') return s;
    if (s.phase === 'rest' || reduced) return { phase: 'think', pose: null, at: now };
    return { phase: 'snap', pose: s.pose, at: now };
  }
  const ended = prev.live && !next.live;
  const changed = !!next.end && next.end !== prev.end;
  if (next.end && (ended || changed)) {
    if (s.pose === next.end && (s.phase === 'in' || s.phase === 'hold')) return s;
    return { phase: reduced ? 'hold' : 'in', pose: next.end, at: now };
  }
  if (s.phase === 'think' || s.phase === 'snap') return { phase: 'rest', pose: null, at: now };
  return s;
}

export function hmAdvance(s: HmState, now: number, reduced = false): HmState {
  for (let i = 0; i < 6; i++) {
    const due = hmDue(s, reduced);
    if (due === null || now < due) return s;
    if (s.phase === 'in') s = { phase: 'hold', pose: s.pose, at: due };
    else if (s.phase === 'hold') s = reduced ? { phase: 'rest', pose: null, at: due } : { phase: 'out', pose: s.pose, at: due };
    else if (s.phase === 'out') s = { phase: 'rest', pose: null, at: due };
    else if (s.phase === 'snap') s = { phase: 'think', pose: null, at: due };
  }
  return s;
}

export function hmDue(s: HmState, reduced = false): number | null {
  switch (s.phase) {
    case 'in': return s.at + (reduced ? 0 : HM.DRAW);
    case 'hold': return s.at + HM.HOLD;
    case 'out': return s.at + (reduced ? 0 : HM.BACK);
    case 'snap': return s.at + (reduced ? 0 : HM.SNAP);
    default: return null;
  }
}

const C: Pt = [515, 508];
const N = 120;
const CHECK_SPINE: Pt[] = [[322, 522], [455, 655], [738, 330]];
const CHECK_W = 104;
const SHORT = Math.hypot(CHECK_SPINE[1][0] - CHECK_SPINE[0][0], CHECK_SPINE[1][1] - CHECK_SPINE[0][1]);
const LONG = Math.hypot(CHECK_SPINE[2][0] - CHECK_SPINE[1][0], CHECK_SPINE[2][1] - CHECK_SPINE[1][1]);
const ERR_SPINE: Pt[] = [[515, 214], [515, 640]];
const ERR_W = 118;
const ERR_DOT: Pt = [515, 760];
const ERR_DOT_R = 54;
const STOP_SIDE = 330, STOP_R = 74;

const f1 = (x: number) => { const s = x.toFixed(1); return s.endsWith('.0') ? s.slice(0, -2) : s; };
const ease = { out: (x: number) => 1 - (1 - x) ** 3, inOut: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2), in: (x: number) => x * x * x };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function checkD(k: number): string {
  if (k <= 0.001) return '';
  const total = SHORT + LONG;
  const sp = k >= 0.999 ? CHECK_SPINE : slice(CHECK_SPINE, 0, k);
  const len = total * Math.min(1, k);
  return polyD(taper(sp, CHECK_W, Math.min(SHORT * 0.96, len * 0.55), Math.min(LONG * 0.9, len * 0.7)), true, 1);
}
export function errorD(k: number): string {
  if (k <= 0.001) return '';
  const sp = k >= 0.999 ? ERR_SPINE : slice(ERR_SPINE, 0, k);
  const len = (ERR_SPINE[1][1] - ERR_SPINE[0][1]) * Math.min(1, k);
  return polyD(taper(sp, ERR_W, 0, len * 0.86), true, 1);
}
function stopPts(): Pt[] {
  const h = STOP_SIDE / 2, r = STOP_R, out: Pt[] = [];
  const corners: [number, number, number][] = [[C[0] + h - r, C[1] - h + r, -90], [C[0] + h - r, C[1] + h - r, 0], [C[0] - h + r, C[1] + h - r, 90], [C[0] - h + r, C[1] - h + r, 180]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 8; k++) { const a = ((a0 + (90 * k) / 8) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
export const STOP_D = polyD(stopPts(), true, 1);
export const ERR_DOT_D = (r: number) => (r <= 0.5 ? '' : `M${f1(ERR_DOT[0] - r)} ${f1(ERR_DOT[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`);
export const ERR_DOT_FULL = ERR_DOT_R;

const GLINT_DENSE = parsePath(MARK_SMALL, 48)[0].pts;
const TIP = { right: [708.9, 502.9] as Pt, upper: [704.3, 148.2] as Pt, left: [292.0, 511.9] as Pt, lower: [333.1, 864.9] as Pt };
const nearest = (p: Pt[], q: Pt) => { let bi = 0, bd = Infinity; p.forEach((x, i) => { const d = (x[0] - q[0]) ** 2 + (x[1] - q[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
const nearestOn = (p: Pt[], a: number, b: number, q: Pt) => { let bi = a, bd = Infinity; for (let i = a; i !== b; i = (i + 1) % p.length) { const d = (p[i][0] - q[0]) ** 2 + (p[i][1] - q[1]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
const cyclicUp = (ix: number[], n: number) => { let turns = 0; for (let j = 0; j < ix.length; j++) if ((ix[(j + 1) % ix.length] - ix[j] + n) % n === 0) return false; else if (ix[(j + 1) % ix.length] < ix[j]) turns++; return turns === 1; };
function marksOf(p: Pt[], kind: HmPose | 'glint3' | 'glint4'): number[] {
  if (kind === 'glint3' || kind === 'glint4') {
    const u = nearest(p, TIP.upper), l = nearest(p, TIP.left), lo = nearest(p, TIP.lower), r = nearest(p, TIP.right);
    return kind === 'glint4' ? [u, nearestOn(p, u, l, C), l, lo, r] : [u, l, lo, r];
  }
  if (kind === 'check') {
    const [s0, e, s1] = CHECK_SPINE;
    const lt = nearest(p, s1), st = nearest(p, s0);
    const notch = nearestOn(p, lt, st, e), elbow = nearestOn(p, st, lt, e);
    const mid: Pt = [(e[0] + s1[0]) / 2 + 40, (e[1] + s1[1]) / 2 + 40];
    return [lt, notch, st, elbow, nearestOn(p, elbow, lt, mid)];
  }
  const ys = p.map((q) => q[1]), xs = p.map((q) => q[0]);
  if (kind === 'error') return [ys.indexOf(Math.min(...ys)), xs.indexOf(Math.min(...xs)), ys.indexOf(Math.max(...ys)), xs.indexOf(Math.max(...xs))];
  const h = STOP_SIDE / 2;
  return [[h, -h], [-h, -h], [-h, h], [h, h]].map(([dx, dy]) => nearest(p, [C[0] + dx, C[1] + dy]));
}
function oriented(p: Pt[], kind: HmPose | 'glint3' | 'glint4'): [Pt[], number[]] {
  let m = marksOf(p, kind);
  if (cyclicUp(m, p.length)) return [p, m];
  const r = [...p].reverse(); m = marksOf(r, kind);
  return [r, m];
}
export function landmarkPair(a: Pt[], ma: number[], b: Pt[], mb: number[], n = N): [Pt[], Pt[]] {
  const seg = (p: Pt[], i: number, j: number) => { const out: Pt[] = []; for (let k = i; ; k = (k + 1) % p.length) { out.push(p[k]); if (k === j) break; } return out; };
  const k = ma.length, segsA = [], segsB = [];
  for (let j = 0; j < k; j++) { segsA.push(seg(a, ma[j], ma[(j + 1) % k])); segsB.push(seg(b, mb[j], mb[(j + 1) % k])); }
  const len = (p: Pt[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
  const la = segsA.map(len), lb = segsB.map(len), LA = la.reduce((x, y) => x + y, 0), LB = lb.reduce((x, y) => x + y, 0);
  const cnt = la.map((x, j) => Math.max(2, Math.round((n * (x / LA + lb[j] / LB)) / 2)));
  cnt[cnt.indexOf(Math.max(...cnt))] += n - cnt.reduce((x, y) => x + y, 0);
  const A: Pt[] = [], B: Pt[] = [];
  for (let j = 0; j < k; j++) { A.push(...resample(segsA[j], cnt[j] + 1, false).slice(0, -1)); B.push(...resample(segsB[j], cnt[j] + 1, false).slice(0, -1)); }
  return [A, B];
}
const posePoly = (p: HmPose): Pt[] => (p === 'stop' ? stopPts() : parsePath(p === 'check' ? checkD(1) : errorD(1))[0].pts);
const RINGS = new Map<HmPose, [Pt[], Pt[]]>();
export function morphPair(p: HmPose): [Pt[], Pt[]] {
  let r = RINGS.get(p);
  if (!r) {
    const [a, ma] = oriented(posePoly(p), p);
    const [b, mb] = oriented(GLINT_DENSE, p === 'check' ? 'glint4' : 'glint3');
    if (cyclicUp(ma, a.length) && cyclicUp(mb, b.length) && Math.sign(signedArea(a)) === Math.sign(signedArea(b))) r = landmarkPair(a, ma, b, mb);
    else { const ra = resample(a, N); r = [ra, align(ra, resample(b, N))]; }
    RINGS.set(p, r);
  }
  return r;
}
export function morphD(p: HmPose, k: number): string {
  const [a, b] = morphPair(p);
  const e = ease.inOut(clamp01(k));
  return polyD(lerpPts(a, b, e), true, 1);
}

export function poseDrawD(p: HmPose, k: number): { d: string; dot: number; tf?: string } {
  const e = clamp01(k);
  if (p === 'check') return { d: checkD(ease.out(e)), dot: 0 };
  if (p === 'error') return { d: errorD(ease.out(clamp01(e / 0.72))), dot: ERR_DOT_R * backOut(clamp01((e - 0.55) / 0.45)) };
  const s = 0.35 + 0.65 * ease.out(e), r = 45 * (1 - ease.out(e));
  return { d: STOP_D, dot: 0, tf: `rotate(${f1(r)} ${C[0]} ${C[1]}) translate(${C[0]} ${C[1]}) scale(${s.toFixed(3)}) translate(${-C[0]} ${-C[1]})` };
}
const backOut = (x: number) => (x <= 0 ? 0 : 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2);
export const HM_CENTER = C;
export { ease as hmEase };
