import { BUSY_CHECK_MS } from './announce';
import { queuesStats } from './jobs';
import { busyTick, busyView } from './status';
import { loadAlertsTick } from './loadAlerts';

type G = { timer?: ReturnType<typeof setInterval> };
const g = globalThis as unknown as { __kxBusy?: G };

export const busyQueues = () => queuesStats().filter((q) => q.limit >= 2 && !q.claude);

export function sampleEta(): number {
  return busyQueues().reduce((m, q) => Math.max(m, q.etaNext), 0);
}

export function adminBusy(now = Date.now()) {
  return { ...busyView(now), etaNow: sampleEta(), queues: queuesStats() };
}

export function startBusyWatch(sample: () => number = sampleEta, everyMs = Math.max(50, Number(process.env.KX_BUSY_MS) || BUSY_CHECK_MS)) {
  if (process.env.KX_BUSY === '0') return;
  const b = (g.__kxBusy ??= {});
  if (b.timer) return;
  const tick = () => {
    try { busyTick(sample(), Date.now()); } catch (e) { console.error('[busy]', (e as Error).message); }
    try { loadAlertsTick(busyQueues()); } catch (e) { console.error('[loadalerts]', (e as Error).message); }
  };
  tick();
  b.timer = setInterval(tick, everyMs);
  b.timer.unref?.();
}
export function stopBusyWatch() { const b = g.__kxBusy; if (b?.timer) { clearInterval(b.timer); b.timer = undefined; } }
