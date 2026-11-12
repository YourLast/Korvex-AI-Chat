import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, lt, ne } from 'drizzle-orm';
import { getDb, schema } from './db';

export const HEARTBEAT_MS = 5_000;
export const ALIVE_MS = 30_000;
const RELAY_KEEP_MS = 15 * 60_000;

type St = {
  id: string; started: boolean; draining: boolean; drainAt: number; timer: NodeJS.Timeout | null;
  hooks: Set<() => void>; busy: Map<string, () => number>; others: { at: number; list: { id: string; state: string }[] };
};
const g = globalThis as unknown as { __kxInst?: St; __kxLifecycle?: { id: string; drain: () => void; busy: () => Record<string, number>; draining: () => boolean } };
const S = (): St => (g.__kxInst ??= {
  id: process.env.KX_INSTANCE || `kx-${process.pid}-${randomBytes(3).toString('hex')}`, started: false, draining: false, drainAt: 0, timer: null,
  hooks: new Set(), busy: new Map(), others: { at: 0, list: [] },
});

export const instanceId = (): string => S().id;
export const isDraining = (): boolean => S().draining;

function buildId(): string | null {
  try { return fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.KX_DIST_DIR || '.next', 'BUILD_ID'), 'utf8').trim() || null; } catch { return null; }
}

export function startInstance(o: { build?: string | null; adminPort?: number | null } = {}, now = Date.now()) {
  const s = S();
  if (s.started) return;
  s.started = true;
  if (o.build === undefined) o = { ...o, build: buildId() };
  const db = getDb();
  db.insert(schema.instances).values({ id: s.id, pid: process.pid, build: o.build ?? null, adminPort: o.adminPort ?? null, state: 'live', startedAt: now, heartbeatAt: now })
    .onConflictDoUpdate({ target: schema.instances.id, set: { pid: process.pid, build: o.build ?? null, adminPort: o.adminPort ?? null, state: 'live', heartbeatAt: now } }).run();
  s.timer = setInterval(() => { try { beat(); } catch (e) { console.error('[instance] heartbeat', (e as Error).message); } }, HEARTBEAT_MS);
  s.timer.unref?.();
  g.__kxLifecycle = { id: s.id, drain: startDrain, busy: busyNow, draining: isDraining };
  console.log(`[instance] ${s.id} pid ${process.pid}${o.build ? ` build ${o.build}` : ''}`);
}

function beat(now = Date.now()) {
  const s = S();
  const db = getDb();
  db.update(schema.instances).set({ heartbeatAt: now, state: s.draining ? 'draining' : 'live' }).where(eq(schema.instances.id, s.id)).run();
  db.delete(schema.busRelay).where(lt(schema.busRelay.at, now - RELAY_KEEP_MS)).run();
  db.delete(schema.jobCommands).where(lt(schema.jobCommands.createdAt, now - RELAY_KEEP_MS)).run();
  db.delete(schema.instances).where(and(ne(schema.instances.state, 'live'), ne(schema.instances.state, 'draining'), lt(schema.instances.heartbeatAt, now - 86_400_000))).run();
}

export function ownerAlive(owner: string | null | undefined, now = Date.now()): boolean {
  if (!owner) return false;
  if (owner === S().id) return true;
  const r = getDb().select({ state: schema.instances.state, hb: schema.instances.heartbeatAt }).from(schema.instances).where(eq(schema.instances.id, owner)).get();
  return !!r && r.state !== 'gone' && r.hb > now - ALIVE_MS;
}

export function otherInstances(now = Date.now()): { id: string; state: string }[] {
  const s = S();
  if (now - s.others.at < 1000) return s.others.list;
  let list: { id: string; state: string }[] = [];
  try {
    list = getDb().select({ id: schema.instances.id, state: schema.instances.state, hb: schema.instances.heartbeatAt }).from(schema.instances).all()
      .filter((r) => r.id !== s.id && r.state !== 'gone' && r.hb > now - ALIVE_MS).map((r) => ({ id: r.id, state: r.state }));
  } catch { list = []; }
  s.others = { at: now, list };
  return list;
}

export function onDrain(fn: () => void): () => void {
  const s = S();
  if (s.draining) { try { fn(); } catch (e) { console.error('[instance] drain hook', (e as Error).message); } }
  s.hooks.add(fn);
  return () => s.hooks.delete(fn);
}

export function registerBusy(name: string, fn: () => number) { S().busy.set(name, fn); }

export function busyNow(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, f] of S().busy) { try { out[k] = Math.max(0, Number(f()) || 0); } catch { out[k] = 0; } }
  return out;
}

export function startDrain(now = Date.now()) {
  const s = S();
  if (s.draining) return;
  s.draining = true;
  s.drainAt = now;
  try { getDb().update(schema.instances).set({ state: 'draining', heartbeatAt: now }).where(eq(schema.instances.id, s.id)).run(); } catch {  }
  s.others.at = 0;
  console.log(`[instance] ${s.id}: доводка — новых задач и соединений не беру, довожу свои`);
  for (const f of s.hooks) { try { f(); } catch (e) { console.error('[instance] drain hook', (e as Error).message); } }
}

export function markGone() {
  const s = S();
  if (s.timer) { clearInterval(s.timer); s.timer = null; }
  try { getDb().update(schema.instances).set({ state: 'gone', heartbeatAt: Date.now() }).where(eq(schema.instances.id, s.id)).run(); } catch {  }
}

export function __resetInstance(id?: string) {
  const s = S();
  if (s.timer) clearInterval(s.timer);
  g.__kxInst = undefined;
  if (id) process.env.KX_INSTANCE = id;
}
