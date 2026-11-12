import type { Message } from './db/schema';

export type Lane = 'a' | 'b';
export type PairRef = { a: string; b: string; pick?: Lane | null };
export type Winner = 'a' | 'b' | 'tie' | 'bad';
export const LANES: Lane[] = ['a', 'b'];

export const pairOf = (m: Message | undefined | null): PairRef | null => {
  const p = (m?.meta as { pair?: PairRef } | null | undefined)?.pair;
  return m?.role === 'user' && p && typeof p.a === 'string' && typeof p.b === 'string' ? p : null;
};
export const laneOf = (m: Message | undefined | null): Lane | null => {
  const l = (m?.meta as { lane?: unknown } | null | undefined)?.lane;
  return l === 'a' || l === 'b' ? l : null;
};
export const sessionMeta = (m: Message | undefined | null): string | null => {
  const s = (m?.meta as { session?: unknown } | null | undefined)?.session;
  return typeof s === 'string' && s ? s : null;
};
export const isOpen = (p: PairRef | null): p is PairRef => !!p && !p.pick;
export const other = (l: Lane): Lane => (l === 'a' ? 'b' : 'a');

export function laneView(all: Message[], path: Message[], lane: Lane): Message[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  return path.map((m, i) => {
    const prev = path[i - 1];
    const p = pairOf(prev);
    if (m.role !== 'assistant' || !isOpen(p)) return m;
    return byId.get(p[lane]) ?? m;
  });
}

export function openPairs(path: Message[]): Message[] {
  return path.filter((m) => isOpen(pairOf(m)));
}

export function lastOpenPair(path: Message[]): Message | null {
  const last = path[path.length - 1];
  const u = last?.role === 'user' ? last : path[path.length - 2];
  return u && isOpen(pairOf(u)) ? u : null;
}

export type ResolvePlan = {
  picks: { questionId: string; pair: PairRef }[];
  moves: { from: string; to: string }[];
  leaf: string | null;
};

export function resolvePlan(all: Message[], path: Message[], lane: Lane, leafId: string | null): ResolvePlan {
  const byId = new Map(all.map((m) => [m.id, m]));
  const plan: ResolvePlan = { picks: [], moves: [], leaf: null };
  path.forEach((m, i) => {
    const p = pairOf(m);
    if (!isOpen(p)) return;
    plan.picks.push({ questionId: m.id, pair: { ...p, pick: lane } });
    const cur = path[i + 1];
    const want = byId.get(p[lane]);
    if (!want || !cur || cur.role !== 'assistant' || cur.id === want.id) return;
    plan.moves.push({ from: cur.id, to: want.id });
    if (leafId === cur.id) plan.leaf = want.id;
  });
  return plan;
}

export function defaultLane(pairs: PairRef[], voteOf: (p: PairRef) => Winner | null | undefined): Lane {
  for (let i = pairs.length - 1; i >= 0; i--) {
    const v = voteOf(pairs[i]);
    if (v === 'a' || v === 'b') return v;
  }
  return 'a';
}

export function laneSessions(all: Message[], path: Message[], questionSession: string, fresh: () => string, mode: 'send' | 'edit'): Record<Lane, string> {
  if (mode === 'send') {
    const u = path[path.length - 2];
    const p = pairOf(u);
    if (isOpen(p)) {
      const byId = new Map(all.map((m) => [m.id, m]));
      const sa = sessionMeta(byId.get(p.a)), sb = sessionMeta(byId.get(p.b));
      if (sa && sb && sa !== sb) return { a: sa, b: sb };
    }
  }
  return { a: questionSession, b: fresh() };
}

export function expandPairs(all: Message[], path: Message[]): Message[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: Message[] = [];
  for (let i = 0; i < path.length; i++) {
    const m = path[i];
    out.push(m);
    const p = pairOf(m);
    if (!p) continue;
    const a = byId.get(p.a), b = byId.get(p.b);
    if (!a && !b) continue;
    const next = path[i + 1];
    if (next?.role === 'assistant') i++;
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return out;
}

export function pairChild(all: Message[], u: Message): string | null {
  const p = pairOf(u);
  if (!p) return null;
  const kids = all.filter((x) => x.parentId === u.id);
  const withKids = kids.filter((k) => all.some((x) => x.parentId === k.id));
  if (withKids.length) return withKids[withKids.length - 1].id;
  const want = p[p.pick ?? 'a'];
  return kids.some((k) => k.id === want) ? want : null;
}
