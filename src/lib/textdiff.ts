
export type Block = { text: string; key: string; loc?: string };
export type Seg = { t: string; mark: boolean };
export type Row =
  | { kind: 'eq'; a: Block; b: Block }
  | { kind: 'chg'; a: Block; b: Block; sa: Seg[]; sb: Seg[] }
  | { kind: 'del'; a: Block }
  | { kind: 'add'; b: Block };
export type Diff = { rows: Row[]; changes: number; truncated: boolean };

const MARK_LINE = /^\s*\[(page|slide|стр\.?|слайд)\s+(\d+)\]\s*$/i;
const SHEET_LINE = /^\s*\[sheet\s+«([^»\]]*)»(?:\s+rows\s+(\d+)-(\d+))?\]\s*$/i;
const LINES_LINE = /^\s*\[lines\s+(\d+)-(\d+)\]\s*$/i;
const SECTION_LINE = /^\s*\[section\s+«([^»\]]*)»\]\s*$/i;

export const normKey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[«»"“”„]/g, '"');

export function toBlocks(text: string, o: { maxBlocks?: number } = {}): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const hasBlank = lines.filter((l) => l.trim() === '').length >= 3;
  const out: Block[] = [];
  let loc: string | undefined;
  let cur: string[] = [];
  const flush = () => {
    const t = cur.join('\n').trim();
    cur = [];
    if (t) out.push({ text: t, key: normKey(t), loc });
  };
  for (const raw of lines) {
    const m = MARK_LINE.exec(raw);
    const sh = SHEET_LINE.exec(raw);
    const ln = LINES_LINE.exec(raw), sec = SECTION_LINE.exec(raw);
    if (m || sh || ln || sec) {
      flush();
      loc = m ? `${/^(page|стр)/i.test(m[1]) ? 'стр.' : 'слайд'} ${m[2]}` : sh ? `лист ${sh[1]}${sh[2] ? `, ${sh[2]}–${sh[3]}` : ''}` : ln ? `строки ${ln[1]}–${ln[2]}` : `раздел ${sec![1]}`;
      continue;
    }
    if (raw.trim() === '') { flush(); continue; }
    cur.push(raw);
    if (!hasBlank) flush();
  }
  flush();
  return o.maxBlocks && out.length > o.maxBlocks ? out.slice(0, o.maxBlocks) : out;
}

type Op = { t: 'eq' | 'del' | 'add'; i: number; j: number };
const MAX_D = 3000;

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length, m = b.length;
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 3);
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    const nv = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1]; else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      nv[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    trace.push(v);
    v = nv;
  }
  if (found < 0) return null;
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const px = pv[off + prevK], py = px - prevK;
    while (x > px && y > py) { x--; y--; ops.push({ t: 'eq', i: x, j: y }); }
    if (x === px) { y--; ops.push({ t: 'add', i: x, j: y }); } else { x--; ops.push({ t: 'del', i: x, j: y }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: 'eq', i: x, j: y }); }
  return ops.reverse();
}

function script(a: string[], b: string[]): Op[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const mid = myers(a.slice(p, a.length - s), b.slice(p, b.length - s));
  const ops: Op[] = [];
  for (let i = 0; i < p; i++) ops.push({ t: 'eq', i, j: i });
  if (mid) for (const o of mid) ops.push({ t: o.t, i: o.i + p, j: o.j + p });
  else { for (let i = p; i < a.length - s; i++) ops.push({ t: 'del', i, j: p }); for (let j = p; j < b.length - s; j++) ops.push({ t: 'add', i: a.length - s, j }); }
  for (let k = 0; k < s; k++) ops.push({ t: 'eq', i: a.length - s + k, j: b.length - s + k });
  return ops;
}

const WORD = /\s+|[\p{L}\p{N}_]+(?:[.,][\p{N}]+)*|[^\s\p{L}\p{N}_]/gu;
const tokens = (s: string) => s.match(WORD) ?? [];
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []));
export function jaccard(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size && !y.size) return 1;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

export function wordDiff(a: string, b: string): { sa: Seg[]; sb: Seg[] } {
  const ta = tokens(a), tb = tokens(b);
  const ops = script(ta, tb);
  const sa: Seg[] = [], sb: Seg[] = [];
  const push = (arr: Seg[], t: string, mark: boolean) => { const l = arr[arr.length - 1]; if (l && l.mark === mark) l.t += t; else arr.push({ t, mark }); };
  for (const o of ops) {
    if (o.t === 'eq') { push(sa, ta[o.i], false); push(sb, tb[o.j], false); }
    else if (o.t === 'del') push(sa, ta[o.i], true);
    else push(sb, tb[o.j], true);
  }
  return { sa, sb };
}

function pairRun(dels: Block[], adds: Block[]): Row[] {
  const rows: Row[] = [];
  const N = dels.length, M = adds.length;
  if (N === 0) return adds.map((b) => ({ kind: 'add', b }) as Row);
  if (M === 0) return dels.map((a) => ({ kind: 'del', a }) as Row);
  const small = N * M <= 40_000;
  const sim: number[][] = small ? dels.map((d) => adds.map((a) => jaccard(d.text, a.text))) : [];
  const take: [number, number][] = [];
  if (small) {
    const dp = Array.from({ length: N + 1 }, () => new Float64Array(M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) {
      const s = sim[i][j] >= 0.4 ? sim[i][j] : 0;
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], s ? s + dp[i + 1][j + 1] : 0);
    }
    let i = 0, j = 0;
    while (i < N && j < M) {
      const s = sim[i][j] >= 0.4 ? sim[i][j] : 0;
      if (s && Math.abs(dp[i][j] - (s + dp[i + 1][j + 1])) < 1e-9) { take.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  } else for (let k = 0; k < Math.min(N, M); k++) take.push([k, k]);
  let i = 0, j = 0;
  for (const [ti, tj] of take) {
    while (i < ti) rows.push({ kind: 'del', a: dels[i++] });
    while (j < tj) rows.push({ kind: 'add', b: adds[j++] });
    const w = wordDiff(dels[ti].text, adds[tj].text);
    rows.push({ kind: 'chg', a: dels[ti], b: adds[tj], sa: w.sa, sb: w.sb });
    i = ti + 1; j = tj + 1;
  }
  while (i < N) rows.push({ kind: 'del', a: dels[i++] });
  while (j < M) rows.push({ kind: 'add', b: adds[j++] });
  return rows;
}

export function diffBlocks(A: Block[], B: Block[]): Diff {
  const ops = script(A.map((x) => x.key), B.map((x) => x.key));
  const rows: Row[] = [];
  let dels: Block[] = [], adds: Block[] = [];
  const flush = () => { if (dels.length || adds.length) rows.push(...pairRun(dels, adds)); dels = []; adds = []; };
  for (const o of ops) {
    if (o.t === 'eq') { flush(); rows.push({ kind: 'eq', a: A[o.i], b: B[o.j] }); }
    else if (o.t === 'del') dels.push(A[o.i]);
    else adds.push(B[o.j]);
  }
  flush();
  return { rows, changes: rows.filter((r) => r.kind !== 'eq').length, truncated: false };
}

export function diffTexts(a: string, b: string, o: { maxBlocks?: number } = {}): Diff {
  const max = o.maxBlocks ?? 6000;
  const A = toBlocks(a), B = toBlocks(b);
  const trunc = A.length > max || B.length > max;
  const d = diffBlocks(A.slice(0, max), B.slice(0, max));
  return { ...d, truncated: trunc };
}

export function cites(row: Row, marks: { quote?: string; page?: number; slide?: number }[]): boolean {
  const blocks = row.kind === 'eq' ? [row.a, row.b] : row.kind === 'chg' ? [row.a, row.b] : row.kind === 'del' ? [row.a] : [row.b];
  for (const m of marks) {
    const q = m.quote ? normKey(m.quote) : '';
    if (q.length >= 8) for (const b of blocks) if (b.key.includes(q)) return true;
  }
  return false;
}
