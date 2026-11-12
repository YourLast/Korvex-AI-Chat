import { randomBytes } from 'node:crypto';

export type LiveEvent = { id: number; t: string; [k: string]: unknown };
type Sub = (e: LiveEvent) => void;
type UserBus = { buf: LiveEvent[]; dropped: number; subs: Set<Sub> };
type Presence = { userId: string; device: string; visible: boolean; active?: boolean; threads: string[]; since: number; seen: number };
type Bus = { boot: string; seq: number; users: Map<string, UserBus>; presence: Map<string, Presence> };

const MAX_EVENTS = 4000;
const MAX_AGE_MS = 15 * 60_000;
const g = globalThis as unknown as { __kxBus?: Bus };
function bus(): Bus {
  return (g.__kxBus ??= { boot: randomBytes(4).toString('hex'), seq: 0, users: new Map(), presence: new Map() });
}
function ub(userId: string): UserBus {
  const b = bus();
  let u = b.users.get(userId);
  if (!u) b.users.set(userId, (u = { buf: [], dropped: 0, subs: new Set() }));
  return u;
}

export const bootId = () => bus().boot;

const frames = new WeakMap<LiveEvent, string>();
export function wire(e: LiveEvent): string {
  let f = frames.get(e);
  if (f === undefined) frames.set(e, (f = `id: ${bus().boot}.${e.id}\ndata: ${JSON.stringify(e)}\n\n`));
  return f;
}
export const lastSeq = () => bus().seq;

type RelayOut = (userId: string, ev: { t: string; [k: string]: unknown }) => void;
const gr = globalThis as unknown as { __kxRelayOut?: RelayOut | null };
export function setRelayOut(fn: RelayOut | null) { gr.__kxRelayOut = fn; }

export function publish(userId: string, ev: { t: string; [k: string]: unknown }): LiveEvent {
  if (gr.__kxRelayOut) { try { gr.__kxRelayOut(userId, ev); } catch {  } }
  const b = bus();
  const e = { ...ev, id: ++b.seq, at: Date.now() } as LiveEvent;
  const u = ub(userId);
  u.buf.push(e);
  const now = Date.now();
  while (u.buf.length > MAX_EVENTS || (u.buf.length && now - (u.buf[0].at as number) > MAX_AGE_MS)) u.dropped = u.buf.shift()!.id;
  for (const s of u.subs) { try { s(e); } catch {  } }
  return e;
}

export function parseSince(v: string | null | undefined): number | null {
  if (!v) return null;
  const [boot, n] = v.split('.');
  if (boot !== bus().boot) return null;
  const x = Number(n);
  return Number.isInteger(x) && x >= 0 ? x : null;
}

export function subscribe(userId: string, since: number | null, fn: Sub): { replay: LiveEvent[] | null; unsubscribe: () => void } {
  const u = ub(userId);
  let replay: LiveEvent[] | null = null;
  if (since !== null && since >= u.dropped && since <= bus().seq) replay = u.buf.filter((e) => e.id > since);
  u.subs.add(fn);
  return { replay, unsubscribe: () => { u.subs.delete(fn); } };
}

export const subscribers = (userId: string) => bus().users.get(userId)?.subs.size ?? 0;

export function presenceSet(conn: string, p: Omit<Presence, 'since' | 'seen'>) {
  const b = bus();
  const old = b.presence.get(conn);
  b.presence.set(conn, { ...p, since: old?.since ?? Date.now(), seen: Date.now() });
}
export function presenceUpdate(conn: string, userId: string, patch: Partial<Pick<Presence, 'visible' | 'active' | 'threads'>>): boolean {
  const p = bus().presence.get(conn);
  if (!p || p.userId !== userId) return false;
  Object.assign(p, patch, { seen: Date.now() });
  return true;
}
export function presenceDrop(conn: string) { bus().presence.delete(conn); }
export function presenceGet(conn: string) { return bus().presence.get(conn); }
export function presenceOf(userId: string): Presence[] {
  return [...bus().presence.values()].filter((p) => p.userId === userId);
}
