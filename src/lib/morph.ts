
export type Pt = [number, number];

export function parsePath(d: string, seg = 24): { pts: Pt[]; closed: boolean }[] {
  const toks = d.match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let i = 0, cmd = '', cur: Pt = [0, 0], start: Pt = [0, 0];
  const num = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/[A-Za-z]/.test(toks[i]);
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (out.length) out[out.length - 1].closed = true;
      cur = start;
      continue;
    }
    if (!isNum()) { i++; continue; }
    if (C === 'M') {
      const p: Pt = [num() + rel * cur[0], num() + rel * cur[1]];
      cur = start = p; out.push({ pts: [p], closed: false });
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      const p: Pt = [num() + rel * cur[0], num() + rel * cur[1]];
      out[out.length - 1]?.pts.push(p); cur = p;
    } else if (C === 'H') {
      const p: Pt = [num() + rel * cur[0], cur[1]]; out[out.length - 1]?.pts.push(p); cur = p;
    } else if (C === 'V') {
      const p: Pt = [cur[0], num() + rel * cur[1]]; out[out.length - 1]?.pts.push(p); cur = p;
    } else if (C === 'C') {
      const c1: Pt = [num() + rel * cur[0], num() + rel * cur[1]], c2: Pt = [num() + rel * cur[0], num() + rel * cur[1]], p: Pt = [num() + rel * cur[0], num() + rel * cur[1]];
      out[out.length - 1]?.pts.push(...cubic(cur, c1, c2, p, seg).slice(1)); cur = p;
    } else if (C === 'Q') {
      const c: Pt = [num() + rel * cur[0], num() + rel * cur[1]], p: Pt = [num() + rel * cur[0], num() + rel * cur[1]];
      out[out.length - 1]?.pts.push(...quad(cur, c, p, seg).slice(1)); cur = p;
    } else i++;
  }
  for (const s of out) if (s.closed && s.pts.length > 1 && dist(s.pts[0], s.pts[s.pts.length - 1]) < 1e-6) s.pts.pop();
  return out;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, m = 1 - t;
    out.push([m * m * m * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p3[1]]);
  }
  return out;
}
export function quad(p0: Pt, c: Pt, p2: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) { const t = k / n, m = 1 - t; out.push([m * m * p0[0] + 2 * m * t * c[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * c[1] + t * t * p2[1]]); }
  return out;
}
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 0): Pt[] {
  const steps = n || Math.max(6, Math.ceil(Math.abs(a1 - a0) / 8));
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) { const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
export function join(...parts: Pt[][]): Pt[] {
  const out: Pt[] = [];
  for (const p of parts) for (const q of p) if (!out.length || dist(out[out.length - 1], q) > 1e-6) out.push(q);
  return out;
}

export function lengths(p: Pt[], closed = false): number[] {
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + dist(p[i - 1], p[i]));
  if (closed && p.length > 1) s.push(s[s.length - 1] + dist(p[p.length - 1], p[0]));
  return s;
}
export function resample(p: Pt[], n: number, closed = true): Pt[] {
  if (p.length === 0) return [];
  if (p.length === 1) return Array.from({ length: n }, () => [p[0][0], p[0][1]] as Pt);
  const ring = closed ? [...p, p[0]] : p;
  const s = lengths(ring);
  const total = s[s.length - 1];
  const out: Pt[] = [];
  const count = closed ? n : n - 1;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / Math.max(1, count);
    while (j < s.length - 2 && s[j + 1] < target) j++;
    const seg = s[j + 1] - s[j] || 1;
    const u = Math.max(0, Math.min(1, (target - s[j]) / seg));
    out.push([ring[j][0] + (ring[j + 1][0] - ring[j][0]) * u, ring[j][1] + (ring[j + 1][1] - ring[j][1]) * u]);
  }
  return out;
}
export function slice(p: Pt[], a: number, b: number): Pt[] {
  if (p.length < 2 || b <= a) return p.length ? [p[0]] : [];
  const s = lengths(p), total = s[s.length - 1];
  const at = (x: number): Pt => {
    const target = Math.max(0, Math.min(1, x)) * total;
    let j = 0; while (j < s.length - 2 && s[j + 1] < target) j++;
    const seg = s[j + 1] - s[j] || 1, u = Math.max(0, Math.min(1, (target - s[j]) / seg));
    return [p[j][0] + (p[j + 1][0] - p[j][0]) * u, p[j][1] + (p[j + 1][1] - p[j][1]) * u];
  };
  const out: Pt[] = [at(a)];
  for (let i = 1; i < p.length - 1; i++) if (s[i] > a * total && s[i] < b * total) out.push(p[i]);
  out.push(at(b));
  return out;
}
export const signedArea = (p: Pt[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };

export function align(a: Pt[], b: Pt[]): Pt[] {
  const n = a.length;
  if (n !== b.length || n === 0) throw new Error('align: different point counts');
  const bb = Math.sign(signedArea(a)) !== Math.sign(signedArea(b)) ? [...b].reverse() : b;
  let best = 0, bestCost = Infinity;
  for (let off = 0; off < n; off++) {
    let c = 0;
    for (let i = 0; i < n && c < bestCost; i++) { const q = bb[(i + off) % n]; c += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2; }
    if (c < bestCost) { bestCost = c; best = off; }
  }
  return Array.from({ length: n }, (_, i) => bb[(i + best) % n]);
}
export const lerpPts = (a: Pt[], b: Pt[], k: number): Pt[] => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * k, p[1] + (b[i][1] - p[1]) * k]);

export function polyD(p: Pt[], closed = true, prec = 2): string {
  if (!p.length) return '';
  const f = (x: number) => { const s = x.toFixed(prec); return s.includes('.') ? s.replace(/\.?0+$/, '') : s; };
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 1; i < p.length; i++) d += `L${f(p[i][0])} ${f(p[i][1])}`;
  return closed ? d + 'Z' : d;
}

export function taper(spine: Pt[], w: number, taper0: number, taper1: number, profile?: (u: number) => number): Pt[] {
  const raw = spine.filter((q, i) => i === 0 || dist(q, spine[i - 1]) > 1e-6);
  if (raw.length < 2) return raw.length ? [raw[0]] : [];
  const total = lengths(raw)[raw.length - 1];
  const tips = [taper0, taper1].filter((x) => x > 0);
  const p = densify(raw, Math.max(total / 160, Math.min(total, ...(tips.length ? tips : [total])) / 6));
  const s = lengths(p), L = s[s.length - 1];
  const half = (i: number) => {
    const a = s[i], b = L - s[i];
    const k0 = taper0 > 0 ? Math.min(1, a / taper0) ** 1.35 : 1;
    const k1 = taper1 > 0 ? Math.min(1, b / taper1) ** 1.35 : 1;
    return (w / 2) * k0 * k1 * (profile ? profile(L ? a / L : 0) : 1);
  };
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const prev = p[Math.max(0, i - 1)], next = p[Math.min(p.length - 1, i + 1)];
    const n1 = i > 0 ? norm(p[i - 1], p[i]) : norm(p[i], next);
    const n2 = i < p.length - 1 ? norm(p[i], p[i + 1]) : norm(prev, p[i]);
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const cos = Math.max(0.35, nx * n1[0] + ny * n1[1]);
    const h = half(i) / cos;
    left.push([p[i][0] + nx * h, p[i][1] + ny * h]);
    right.push([p[i][0] - nx * h, p[i][1] - ny * h]);
  }
  const capPts = (c: Pt, dir: Pt, r: number): Pt[] => {
    const a0 = Math.atan2(dir[1], dir[0]) + Math.PI / 2, out: Pt[] = [];
    for (let k = 1; k < 6; k++) { const a = a0 - (Math.PI * k) / 6; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
  };
  const end = p.length - 1;
  untangle(left); untangle(right);
  const out: Pt[] = [...left];
  if (taper1 <= 0) out.push(...capPts(p[end], unit(p[end - 1], p[end]), half(end)));
  out.push(...right.reverse());
  if (taper0 <= 0) out.push(...capPts(p[0], unit(p[1], p[0]), half(0)));
  return out;
}
function untangle(p: Pt[], window = 48) {
  for (let i = 0; i < p.length - 3; i++) {
    for (let j = Math.min(p.length - 2, i + window); j >= i + 2; j--) {
      const x = cross(p[i], p[i + 1], p[j], p[j + 1]);
      if (x) { p.splice(i + 1, j - i, x); break; }
    }
  }
}
function cross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}
export function densify(p: Pt[], step: number): Pt[] {
  const out: Pt[] = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
function unit(a: Pt, b: Pt): Pt { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
function norm(a: Pt, b: Pt): Pt { const u = unit(a, b); return [-u[1], u[0]]; }

export function xform(p: Pt[], { dx = 0, dy = 0, rot = 0, s = 1, cx = 0, cy = 0 }: { dx?: number; dy?: number; rot?: number; s?: number; cx?: number; cy?: number }): Pt[] {
  const c = Math.cos((rot * Math.PI) / 180), si = Math.sin((rot * Math.PI) / 180);
  return p.map(([x, y]) => { const X = (x - cx) * s, Y = (y - cy) * s; return [cx + X * c - Y * si + dx, cy + X * si + Y * c + dy]; });
}
