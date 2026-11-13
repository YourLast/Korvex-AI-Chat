import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent, fetch as undiciFetch } from 'undici';

export const JOB_TIMEOUT_MS = 30 * 60_000;
export const MAX_IDLE_MS = 15 * 60_000;
export const MAX_CEILING_MS = 4 * 60 * 60_000;
export const holdMaxMs = (ceilingMs: number) => Math.max(ceilingMs, (Number(process.env.KX_HOLD_MAX_H) || 8) * 3_600_000);
const IDLE_TICK_MS = 15_000;

export type TimeoutPlan = { kind: 'total'; ms: number } | { kind: 'idle'; idleMs: number; ceilingMs: number };

export function timeoutPlan(levelId: string | null | undefined, claudeDirect = false): TimeoutPlan {
  if (levelId === 'max' || !claudeDirect) return { kind: 'idle', idleMs: MAX_IDLE_MS, ceilingMs: MAX_CEILING_MS };
  return { kind: 'total', ms: JOB_TIMEOUT_MS };
}

export const upstreamNetMs = () => { const v = Number(process.env.KX_UPSTREAM_NET_S); return (process.env.KX_UPSTREAM_NET_S && v > 0 ? v : 20 * 60) * 1000; };
let agent: { ms: number; a: Agent } | null = null;
function modelAgent(): Agent {
  const ms = upstreamNetMs();
  if (!agent || agent.ms !== ms) agent = { ms, a: new Agent({ headersTimeout: ms, bodyTimeout: ms }) };
  return agent.a;
}
export const modelFetch: typeof fetch = (input, init) =>
  undiciFetch(input as never, { ...(init as object), dispatcher: modelAgent() } as never) as unknown as Promise<Response>;

export type JobGuard = { touch: () => void; hold: (ms: number) => void; clear: () => void; plan: TimeoutPlan };

const minutes = (ms: number) => Math.round(ms / 60_000);
const hours = (ms: number) => Math.round(ms / 3_600_000);

export function armJobTimeout(plan: TimeoutPlan, onTimeout: (message: string) => void, now: () => number = Date.now): JobGuard {
  let fired = false;
  const fire = (msg: string) => { if (fired) return; fired = true; clear(); onTimeout(msg); };
  let ticker: NodeJS.Timeout | null = null;
  let last = now();
  let total: NodeJS.Timeout | null = null;
  let ceil: NodeJS.Timeout | null = null;
  let deadline = now() + (plan.kind === 'total' ? plan.ms : plan.ceilingMs);
  let held = 0;
  const clear = () => { if (total) clearTimeout(total); total = null; if (ceil) clearTimeout(ceil); ceil = null; if (ticker) clearInterval(ticker); ticker = null; };
  const armTotal = () => {
    if (plan.kind !== 'total') return;
    if (total) clearTimeout(total);
    total = setTimeout(() => fire(`Превышено время ответа (${minutes(plan.ms)} минут)`), Math.max(0, deadline - now()));
  };
  const armCeil = () => {
    if (plan.kind !== 'idle') return;
    if (ceil) clearTimeout(ceil);
    ceil = setTimeout(() => fire(`Превышено время ответа (${hours(plan.ceilingMs)} ч)`), Math.max(0, deadline - now()));
  };
  if (plan.kind === 'total') {
    armTotal();
  } else {
    armCeil();
    ticker = setInterval(() => {
      if (now() - last >= plan.idleMs) fire(`Модель не отвечает ${minutes(plan.idleMs)} минут`);
    }, Math.min(IDLE_TICK_MS, plan.idleMs));
  }
  const hold = (ms: number) => {
    last = now();
    if (fired || !(ms > 0)) return;
    if (plan.kind === 'total') { deadline += ms; armTotal(); return; }
    const add = Math.min(ms, holdMaxMs(plan.ceilingMs) - held);
    if (add <= 0) return;
    held += add;
    deadline += add;
    armCeil();
  };
  return { touch: () => { last = now(); }, hold, clear, plan };
}

const activity = new AsyncLocalStorage<{ touch: () => void; hold?: (ms: number) => void }>();

export function withUpstreamActivity<T>(touch: () => void, fn: () => Promise<T>, hold?: (ms: number) => void): Promise<T> {
  return activity.run({ touch, hold }, fn);
}

export function upstreamBytes(): void {
  activity.getStore()?.touch();
}

export function upstreamHold(ms: number): void {
  const a = activity.getStore();
  if (a?.hold) a.hold(ms); else a?.touch();
}

export const tapFetch: typeof fetch = async (input, init) => {
  const res = await modelFetch(input, init);
  const touch = activity.getStore()?.touch;
  if (!touch || !res.body) return res;
  const tapped = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { touch(); ctl.enqueue(chunk); },
  }));
  return new Response(tapped, { status: res.status, statusText: res.statusText, headers: res.headers });
};
