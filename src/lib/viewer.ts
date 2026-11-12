import { rubber } from './sheetDrag';

export type Box = { x: number; y: number; w: number; h: number };
export type View = { x: number; y: number; s: number };

export const GAP = 24;
export const DOUBLE_MS = 300;
export const DOUBLE_PX = 32;
export const TAP_PX = 8;
export const MIN_S = 1;
export const DOUBLE_S = 2;

export function fit(nw: number, nh: number, W: number, H: number, pad = { x: 0, y: 0 }): Box {
  const aw = Math.max(1, W - 2 * pad.x), ah = Math.max(1, H - 2 * pad.y);
  if (!(nw > 0 && nh > 0)) return { x: (W - Math.min(aw, ah)) / 2, y: (H - Math.min(aw, ah)) / 2, w: Math.min(aw, ah), h: Math.min(aw, ah) };
  const k = Math.min(aw / nw, ah / nh, 2);
  const w = nw * k, h = nh * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

export function maxScale(nw: number, f: Box): number {
  return Math.min(8, Math.max(4, nw > 0 ? (2 * nw) / f.w : 4));
}

export function zoomAt(v: View, s2: number, px: number, py: number): View {
  const k = s2 / v.s;
  return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, s: s2 };
}

export function range(size: number, stage: number): [number, number] {
  return size <= stage ? [(stage - size) / 2, (stage - size) / 2] : [stage - size, 0];
}

export function clamp(v: View, f: Box, W: number, H: number): View {
  const [x0, x1] = range(f.w * v.s, W), [y0, y1] = range(f.h * v.s, H);
  return { s: v.s, x: Math.min(x1, Math.max(x0, v.x)), y: Math.min(y1, Math.max(y0, v.y)) };
}

export function rubberClamp(v: View, f: Box, W: number, H: number): View {
  const ax = (val: number, [a, b]: [number, number], dim: number) => (val < a ? a - rubber(a - val, dim) : val > b ? b + rubber(val - b, dim) : val);
  return { s: v.s, x: ax(v.x, range(f.w * v.s, W), W), y: ax(v.y, range(f.h * v.s, H), H) };
}

export function rubberScale(s: number, max: number): number {
  if (s > max) return max + rubber(s - max, max * 0.5, 1);
  if (s < MIN_S) return MIN_S - rubber(MIN_S - s, MIN_S * 0.5, 1);
  return s;
}

export const fitView = (f: Box): View => ({ x: f.x, y: f.y, s: 1 });

export function doubleTap(v: View, f: Box, W: number, H: number, px: number, py: number): View {
  if (v.s > 1.01) return fitView(f);
  return clamp(zoomAt(v, DOUBLE_S, px, py), f, W, H);
}

export function shouldDismiss(dy: number, H: number, vy: number): boolean {
  if (vy > 0.45 && dy > 16) return true;
  if (vy < -0.45) return false;
  return dy > Math.max(90, 0.12 * H);
}

export function dismissLook(dy: number, H: number): { bg: number; s: number } {
  const p = Math.min(1, Math.max(0, dy) / (H * 0.55));
  return { bg: 1 - p, s: 1 - 0.3 * Math.min(1, Math.max(0, dy) / H) };
}

export function pageStep(dx: number, W: number, vx: number, hasPrev: boolean, hasNext: boolean): -1 | 0 | 1 {
  const far = Math.abs(dx) > W * 0.22;
  const fast = Math.abs(vx) > 0.35 && Math.abs(dx) > 12 && Math.sign(vx) === Math.sign(dx);
  if (!(far || fast)) return 0;
  if (dx < 0 && hasNext) return 1;
  if (dx > 0 && hasPrev) return -1;
  return 0;
}

export function trackOffset(dx: number, W: number, hasPrev: boolean, hasNext: boolean): number {
  if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) return Math.sign(dx) * rubber(Math.abs(dx), W, 0.5);
  return dx;
}

export function thumbRect(box: Box, nw: number, nh: number, objectFit: string): { img: Box; clip: Box } {
  if (!(nw > 0 && nh > 0)) return { img: box, clip: box };
  const k = objectFit === 'cover' ? Math.max(box.w / nw, box.h / nh) : objectFit === 'fill' ? NaN : Math.min(box.w / nw, box.h / nh);
  if (Number.isNaN(k)) return { img: box, clip: box };
  const w = nw * k, h = nh * k;
  const img = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  const clip = objectFit === 'cover' ? box : img;
  return { img, clip };
}

export function morph(f: Box, from: { img: Box; clip: Box }, p: number, radius = 12): { v: View; inset: [number, number, number, number]; r: number } {
  const s0 = from.img.w / f.w;
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const s = lerp(s0, 1);
  const x = lerp(from.img.x, f.x), y = lerp(from.img.y, f.y);
  const it = Math.max(0, (from.clip.y - from.img.y) / s0), il = Math.max(0, (from.clip.x - from.img.x) / s0);
  const ib = Math.max(0, (from.img.y + from.img.h - (from.clip.y + from.clip.h)) / s0), ir = Math.max(0, (from.img.x + from.img.w - (from.clip.x + from.clip.w)) / s0);
  const q = 1 - p;
  return { v: { x, y, s }, inset: [it * q, ir * q, ib * q, il * q], r: (radius / s) * q };
}

export function visibleEnough(b: Box, W: number, H: number): boolean {
  if (!(b.w > 4 && b.h > 4)) return false;
  const ix = Math.max(0, Math.min(b.x + b.w, W) - Math.max(b.x, 0)), iy = Math.max(0, Math.min(b.y + b.h, H) - Math.max(b.y, 0));
  return (ix * iy) / (b.w * b.h) > 0.3;
}

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function velocity(samples: { t: number; x: number; y: number }[], now: number): { vx: number; vy: number } {
  const s = samples.filter((p) => p.t >= now - 100);
  if (s.length < 2) return { vx: 0, vy: 0 };
  const a = s[0], b = s[s.length - 1], dt = b.t - a.t;
  return dt > 0 ? { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt } : { vx: 0, vy: 0 };
}

export function glide(v: View, vx: number, vy: number, f: Box, W: number, H: number): View {
  const T = 325;
  return clamp({ s: v.s, x: v.x + vx * T, y: v.y + vy * T }, f, W, H);
}
