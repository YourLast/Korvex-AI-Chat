import { MARK_SMALL } from './thinkMark';
import { glintPath, PRESETS, SHAPE_SMALL } from './glint';
import { arc, cubic, join, parsePath, polyD, slice, taper, type Pt } from './morph';

export type El = { k: 'l' | 'f'; d: string; o?: number; tf?: string };
export type Ctx = { t: number; amt: number; w: number };
export type IconDef = { draw(c: Ctx): El[] };

const TAU = Math.PI * 2;
const wave = (t: number, p: number, ph = 0) => 0.5 - 0.5 * Math.cos(TAU * (t / p + ph));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const inOut = (x: number) => { const c = clamp01(x); return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2; };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const f2 = (x: number) => { const s = x.toFixed(2); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
function blink(t: number, p: number, duty = 0.55, edge = 0.12): number {
  const x = ((t / p) % 1 + 1) % 1;
  if (x < edge) return smooth(x / edge);
  if (x < duty) return 1;
  if (x < duty + edge) return 1 - smooth((x - duty) / edge);
  return 0;
}
const L = (a: Pt, b: Pt): Pt[] => [a, b];
const poly = (...p: Pt[]): Pt[] => p;

const cache = new Map<string, string>();
function tp(key: string, w: number, spine: Pt[], t0: number, t1: number): string {
  const k = `${key}@${w.toFixed(3)}`;
  let d = cache.get(k);
  if (d === undefined) { d = polyD(taper(spine, w, t0, t1)); cache.set(k, d); }
  return d;
}
const tpn = (w: number, spine: Pt[], t0: number, t1: number) => polyD(taper(spine, w, t0, t1));
const circleD = (cx: number, cy: number, r: number) => `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
const rot = (deg: number, cx: number, cy: number) => (Math.abs(deg) < 0.01 ? undefined : `rotate(${f2(deg)} ${f2(cx)} ${f2(cy)})`);
const tr = (dx: number, dy: number) => (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005 ? undefined : `translate(${f2(dx)} ${f2(dy)})`);
const sc = (s: number, cx: number, cy: number) => (Math.abs(s - 1) < 0.002 ? undefined : `translate(${f2(cx)} ${f2(cy)}) scale(${s.toFixed(3)}) translate(${f2(-cx)} ${f2(-cy)})`);

const GLINT_PTS = parsePath(MARK_SMALL, 10)[0].pts;
function glintD(cx: number, cy: number, h: number): string {
  const k = h / 717;
  return polyD(GLINT_PTS.map(([x, y]) => [cx + (x - 500) * k, cy + (y - 506) * k] as Pt));
}

const FRAME = 'M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5Z';

export const ICONS: Record<string, IconDef> = {
  terminal: { draw: ({ t, amt, w }) => {
    const b = blink(t, 1.1);
    const nudge = amt * 0.45 * b;
    return [
      { k: 'l', d: FRAME },
      { k: 'f', d: tp('term.chev', w, poly([7.3, 9.2], [10.6, 12], [7.3, 14.8]), 2.6, 2.6), tf: tr(nudge, 0) },
      { k: 'f', d: tp('term.cur', w, L([12.8, 15], [16.8, 15]), 1.3, 1.3), o: lerp(1, 0.18 + 0.82 * b, amt) },
    ];
  } },

  code: { draw: ({ t, amt, w }) => {
    const br = amt * 0.85 * wave(t, 1.8);
    return [
      { k: 'f', d: tp('code.l', w, poly([8.7, 7.2], [4.2, 12], [8.7, 16.8]), 2.6, 2.6), tf: tr(-br, 0) },
      { k: 'f', d: tp('code.r', w, poly([15.3, 7.2], [19.8, 12], [15.3, 16.8]), 2.6, 2.6), tf: tr(br, 0) },
      { k: 'f', d: tp('code.s', w, L([13.6, 5.4], [10.4, 18.6]), 2.4, 2.4), o: 1 - amt * 0.5 * wave(t, 1.8) },
    ];
  } },

  globe: { draw: ({ t, amt, w }) => {
    const R = 8.5, cx = 12, cy = 12;
    const meridian = (lon: number) => {
      const a = R * Math.sin((lon * Math.PI) / 180) * (4 / 3);
      return cubic([cx, cy - R], [cx + a, cy - R], [cx + a, cy + R], [cx, cy + R], 20);
    };
    const ph = (t / 2.6) % 1 * 90;
    const els: El[] = [
      { k: 'l', d: circleD(cx, cy, R) },
      { k: 'l', d: 'M3.5 12h17' },
    ];
    for (const [i, rest] of [[0, -23.6], [1, 23.6]] as const) {
      const lon = i === 0 ? -90 + ph : ph;
      const front = Math.cos((lon * Math.PI) / 180) ** 0.6;
      els.push({ k: 'f', d: amt > 0.001 ? tpn(w, meridian(lon), 2.4, 2.4) : tp(`globe.m${i}`, w, meridian(rest), 2.4, 2.4), o: amt > 0.001 ? amt * front : 0 });
      els.push({ k: 'f', d: tp(`globe.m${i}`, w, meridian(rest), 2.4, 2.4), o: 1 - amt });
    }
    return els;
  } },

  search: { draw: ({ t, amt, w }) => {
    const a = TAU * (t / 1.7), r = 1.15 * amt;
    const m = tr(r * Math.cos(a), r * Math.sin(a) * 0.8);
    return [
      { k: 'l', d: circleD(10.5, 10.5, 5.6), tf: m },
      { k: 'f', d: tp('search.h', w, L([14.6, 14.6], [19.8, 19.8]), 0, 3.2), tf: m },
      { k: 'f', d: tp('search.g', w * 0.85, arc(10.5, 10.5, 3.2, 200, 260), 1.4, 1.4), tf: m, o: 0.55 + 0.45 * amt },
    ];
  } },

  browser: { draw: ({ t, amt, w }) => {
    const x = ((t / 1.5) % 1);
    const head = lerp(3.5, 23, inOut(x)), tail = head - 6;
    const seg = [Math.max(4.4, tail), Math.min(19.6, head)];
    return [
      { k: 'l', d: FRAME },
      { k: 'l', d: 'M3.5 9h17', o: 1 - 0.7 * amt },
      { k: 'f', d: seg[1] - seg[0] > 0.6 ? tpn(w, L([seg[0], 9], [seg[1], 9]), 1.8, 2.6) : 'M0 0Z', o: amt },
      { k: 'f', d: tp('br.l1', w, L([7, 13], [17, 13]), 1.8, 1.8), o: 1 - 0.25 * amt },
      { k: 'f', d: tp('br.l2', w, L([7, 16.2], [13.2, 16.2]), 1.8, 1.8), o: 1 - 0.25 * amt },
    ];
  } },

  cursor: { draw: ({ t, amt, w }) => {
    const p = (t / 1.6) % 1;
    const press = amt * (p < 0.18 ? smooth(p / 0.18) : p < 0.36 ? 1 - smooth((p - 0.18) / 0.18) : 0);
    const ring = clamp01((p - 0.16) / 0.6);
    return [
      { k: 'l', d: 'M5.5 4.5 18 10.2l-5.4 1.9-2.1 5.6Z', tf: sc(1 - 0.12 * press, 5.5, 4.5) },
      { k: 'f', d: tp('cur.tail', w, L([12.9, 12.4], [18.2, 17.7]), 0, 2.6), tf: sc(1 - 0.12 * press, 5.5, 4.5) },
      { k: 'l', d: circleD(5.5, 4.5, 0.8 + 4.2 * smooth(ring)), o: amt * (ring > 0 ? (1 - ring) ** 1.4 * 0.9 : 0) },
    ];
  } },

  doc: { draw: ({ t, amt, w }) => {
    const x = (t / 1.7) % 1;
    const y = lerp(7.6, 19, inOut(clamp01(x / 0.86)));
    const fade = x < 0.08 ? x / 0.08 : x > 0.86 ? 1 - (x - 0.86) / 0.14 : 1;
    const lit = (ly: number) => 1 - amt * 0.5 * (1 - Math.exp(-(((ly - y) / 1.6) ** 2)));
    return [
      { k: 'l', d: 'M13.5 3.5H8A2.5 2.5 0 0 0 5.5 6v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8.5Z' },
      { k: 'l', d: 'M13.5 3.5v5h5' },
      { k: 'f', d: tp('doc.1', w, L([9, 12.2], [15, 12.2]), 1.6, 1.6), o: lit(12.2) },
      { k: 'f', d: tp('doc.2', w, L([9, 15.1], [15, 15.1]), 1.6, 1.6), o: lit(15.1) },
      { k: 'f', d: tp('doc.3', w, L([9, 18], [12.6, 18]), 1.6, 1.6), o: lit(18) },
      { k: 'f', d: tp('doc.scan', w, L([7.4, 0], [16.6, 0]), 3, 3), tf: tr(0, y), o: amt * fade },
    ];
  } },

  table: { draw: ({ t, amt }) => {
    const cells: [number, number, number, number][] = [[4.9, 10.9, 4.4, 2.8], [10.9, 10.9, 8.2, 2.8], [4.9, 15.4, 4.4, 2.8], [10.9, 15.4, 8.2, 2.8]];
    const step = 0.55, x = t / step, i = Math.floor(x) % 4, j = (i + 1) % 4, k = inOut(clamp01((x % 1) / 0.45));
    const c = cells[i].map((v, q) => lerp(v, cells[j][q], k));
    return [
      { k: 'l', d: 'M6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9A2.5 2.5 0 0 1 6.5 5Z' },
      { k: 'l', d: 'M4 10h16M4 14.5h16M10 10v9' },
      { k: 'f', d: `M${f2(c[0] + 0.6)} ${f2(c[1])}h${f2(c[2] - 1.2)}a.6 .6 0 0 1 .6 .6v${f2(c[3] - 1.2)}a.6 .6 0 0 1-.6 .6h${f2(-(c[2] - 1.2))}a.6 .6 0 0 1-.6-.6v${f2(-(c[3] - 1.2))}a.6 .6 0 0 1 .6-.6Z`, o: 0.42 * amt },
    ];
  } },

  chat: { draw: ({ t, amt, w }) => {
    const dot = (i: number) => { const p = ((t / 1.2 - i * 0.16) % 1 + 1) % 1; return p < 0.4 ? Math.sin((Math.PI * p) / 0.4) : 0; };
    const dots: El[] = [8.5, 12, 15.5].map((x, i) => ({ k: 'f' as const, d: circleD(x, 11.25, 1.05), o: amt * (0.35 + 0.65 * dot(i)), tf: tr(0, -0.7 * amt * dot(i)) }));
    return [
      { k: 'l', d: 'M5.5 5h13A2 2 0 0 1 20.5 7v8.5a2 2 0 0 1-2 2H11l-4.5 3v-3h-1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z' },
      { k: 'f', d: tp('chat.1', w, L([8, 9.6], [16, 9.6]), 1.8, 1.8), o: 1 - amt },
      { k: 'f', d: tp('chat.2', w, L([8, 13], [12.8, 13]), 1.8, 1.8), o: 1 - amt },
      ...dots,
    ];
  } },

  memory: { draw: ({ t, amt }) => {
    const p = wave(t, 1.5);
    const s = 1 + amt * (0.28 * p - 0.12), r = amt * 18 * (p - 0.5);
    return [
      { k: 'l', d: circleD(10, 8.6, 3.4) },
      { k: 'l', d: 'M3.8 20c.8-3.6 3.2-5.6 6.2-5.6 1.6 0 3 .5 4.1 1.5' },
      { k: 'f', d: glintD(17.6, 16.4, 8.2), tf: [rot(r, 17.6, 16.4), sc(s, 17.6, 16.4)].filter(Boolean).join(' ') || undefined, o: 1 - amt * 0.25 * (1 - p) },
    ];
  } },

  branch: { draw: ({ t, amt, w }) => {
    const curve = cubic([17, 10.5], [17, 14.5], [12, 13.5], [7.8, 16.9], 24);
    const x = (t / 1.6) % 1, k = inOut(clamp01(x / 0.8));
    const idx = Math.min(curve.length - 1, Math.round(k * (curve.length - 1)));
    const [bx, by] = curve[idx];
    const bo = amt * (x < 0.1 ? x / 0.1 : x > 0.7 ? Math.max(0, 1 - (x - 0.7) / 0.15) : 1);
    return [
      { k: 'l', d: circleD(7, 5.5, 2) + circleD(7, 18.5, 2) + circleD(17, 8.5, 2) },
      { k: 'l', d: 'M7 7.5v9' },
      { k: 'f', d: tp('branch.c', w, curve, 0, 2.4) },
      { k: 'f', d: circleD(bx, by, 1.3), o: bo },
    ];
  } },

  agents: { draw: ({ t, amt }) => {
    const c1 = join(L([8, 12], [8, 14.5]), arc(10, 14.5, 2, 180, 90), L([10, 16.5], [11.5, 16.5]));
    const c2 = join(L([16, 12], [16, 9.5]), arc(14, 9.5, 2, 0, -90), L([14, 7.5], [12.5, 7.5]));
    const x = (t / 2.2) % 1, half = x < 0.5, u = inOut(clamp01(((half ? x : x - 0.5) / 0.5 - 0.1) / 0.8));
    const path = half ? c1 : c2;
    const at = (q: Pt[], k: number): Pt => q[Math.min(q.length - 1, Math.round(k * (q.length - 1)))];
    const [bx, by] = at(path, u);
    const xx = (half ? x : x - 0.5) / 0.5, bo = amt * (xx < 0.1 ? xx / 0.1 : xx > 0.9 ? (1 - xx) / 0.1 : 1);
    return [
      { k: 'l', d: 'M5.5 5h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM13.5 12h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z' },
      { k: 'l', d: 'M8 12v2.5a2 2 0 0 0 2 2h1.5M16 12V9.5a2 2 0 0 0-2-2h-1.5', o: 1 - 0.45 * amt },
      { k: 'f', d: circleD(bx, by, 1.2), o: bo },
    ];
  } },

  edit: { draw: ({ t, amt, w }) => {
    const p = (t / 1.6) % 1;
    const rk = amt * 6 * Math.sin(TAU * p);
    const len = amt * smooth(p / 0.75) * (p < 0.9 ? 1 : 1 - (p - 0.9) / 0.1);
    return [
      { k: 'l', d: 'M4.5 19.5l.8-3.8L16 5a2.1 2.1 0 0 1 3 3L8.3 18.7Z', tf: rot(rk, 4.9, 19.1) },
      { k: 'l', d: 'M14 7l3 3', tf: rot(rk, 4.9, 19.1) },
      { k: 'f', d: len > 0.03 ? tpn(w, L([11, 20.3], [11 + 8.5 * len, 20.3]), 1.6, 2.4) : 'M0 0Z', o: amt },
    ];
  } },

  steer: { draw: ({ t, amt, w }) => {
    const lift = tr(0, -amt * 1.1 * wave(t, 1.4));
    return [
      { k: 'f', d: tp('steer.s', w, L([12, 19.6], [12, 6]), 3, 0), tf: lift },
      { k: 'f', d: tp('steer.h', w, poly([6, 11.4], [12, 5.4], [18, 11.4]), 2.4, 2.4), tf: lift },
    ];
  } },

  work: { draw: ({ t, amt }) => {
    const d = glintPath(t, amt, PRESETS.calm, SHAPE_SMALL).d;
    const pts = parsePath(d, 10)[0].pts;
    const k = 17.4 / 717;
    return [{ k: 'l', d: polyD(pts.map(([x, y]) => [12 + (x - 500) * k, 12 + (y - 506) * k] as Pt)) }];
  } },

  tool: { draw: ({ t, amt, w }) => {
    const bolt = poly([14.2, 3.6], [7.4, 12.7], [16.6, 11.3], [9.8, 20.4]);
    const x = (t / 1.25) % 1, head = inOut(clamp01(x / 0.8)) * 1.3, a = Math.max(0, head - 0.38), b = Math.min(1, head);
    return [
      { k: 'f', d: tp('tool.bolt', w, bolt, 2.8, 2.8), o: 1 - 0.6 * amt },
      { k: 'f', d: b - a > 0.02 ? tpn(w, slice(bolt, a, b), 2.2, 2.2) : 'M0 0Z', o: amt },
    ];
  } },

  image: { draw: ({ t, amt, w }) => {
    const p = wave(t, 1.5);
    return [
      { k: 'l', d: 'M6 5h12a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 6 5Z' },
      { k: 'f', d: tp('img.m', w, poly([6.2, 16.6], [10.2, 12.4], [13, 15], [15, 13.2], [18, 16.2]), 1.8, 1.8) },
      { k: 'f', d: glintD(15.4, 9.4, 5.2), tf: [rot(amt * 20 * (p - 0.5), 15.4, 9.4), sc(1 + amt * (0.3 * p - 0.1), 15.4, 9.4)].filter(Boolean).join(' ') || undefined },
    ];
  } },

  retry: { draw: ({ t, amt, w }) => {
    const r = rot(amt * 360 * inOut((t / 1.4) % 1), 12, 12);
    return [
      { k: 'f', d: tp('retry.a', w, arc(12, 12, 7.5, 2, 312), 3.4, 0), tf: r },
      { k: 'f', d: tp('retry.h', w, poly([19.7, 4.2], [19.7, 8.7], [15.2, 8.7]), 1.8, 1.8), tf: r },
    ];
  } },
};

export const ICON_IDS = Object.keys(ICONS);
export const isActIcon = (n: string | undefined): n is string => !!n && Object.hasOwn(ICONS, n);

export const strokeUnits = (px: number) => (1.5 * 24) / Math.max(8, px);

export function iconFrame(n: string, t: number, amt: number, px = 16): El[] {
  const def = ICONS[n] ?? ICONS.tool;
  const a = clamp01(amt);
  return def.draw({ t: a > 0 ? t : 0, amt: a, w: strokeUnits(px) });
}

export const ERR_C: Pt = [18.6, 17.6];
export function errBadge(k: number, w: number): { cut: number; spike: string; dot: string; dotR: number } {
  const e = smooth(k);
  const top: Pt = [ERR_C[0], ERR_C[1] - 4.3], bot: Pt = [ERR_C[0], ERR_C[1] + 1.2];
  const len = clamp01((k - 0.15) / 0.65);
  const spike = len > 0.02 ? polyD(taper([top, [top[0], lerp(top[1], bot[1], inOut(len))]], w * 1.25, 0, 2.8 * inOut(len) + 0.01)) : 'M0 0Z';
  return { cut: 5.4 * e, spike, dot: circleD(ERR_C[0], ERR_C[1] + 3.3, 1.05), dotR: smooth((k - 0.6) / 0.4) };
}

export type IconState = 'run' | 'ok' | 'err' | 'warn' | 'off' | 'wait';
export function iconState(status: string, recovered?: boolean): IconState {
  if (status === 'run') return 'run';
  if (status === 'err') return recovered ? 'ok' : 'err';
  if (status === 'timeout') return 'warn';
  if (status === 'denied' || status === 'stopped') return 'off';
  if (status === 'wait') return 'wait';
  return 'ok';
}
