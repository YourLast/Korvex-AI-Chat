import { tr, type Lang } from './i18n/core';
import { BUSY_OFF_ETA, BUSY_ON_ETA } from './announce';

export type AlertKind = 'spike' | 'queue' | 'eta' | 'busyOn';
export type LoadKind = AlertKind | 'busyOff' | 'clear';

export type LoadCfg = {
  spikeRunning: number;
  spikeWindowMs: number;
  spikeTurns: number;
  queueWaitS: number;
  etaS: number;
  calmEtaS: number;
  calmMs: number;
  repeatMs: number;
  gapMs: number;
  names: number;
};
export const LW: LoadCfg = { spikeRunning: 3, spikeWindowMs: 60_000, spikeTurns: 8, queueWaitS: 15, etaS: BUSY_ON_ETA, calmEtaS: BUSY_OFF_ETA, calmMs: 180_000, repeatMs: 600_000, gapMs: 60_000, names: 3 };
export function cfgFromEnv(raw: string | undefined): LoadCfg {
  const o: LoadCfg = { ...LW };
  if (!raw) return o;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(LW) as (keyof LoadCfg)[]) if (typeof j[k] === 'number' && Number.isFinite(j[k]) && (j[k] as number) >= 0) o[k] = j[k] as number;
  } catch {  }
  return o;
}

export type Waiting = { name: string; sinceMs: number };
export type LoadSample = { now: number; running: number; queued: number; etaNext: number; busyAuto: boolean; waiting: Waiting[]; turnsLastMinute: number; pushOn: boolean };

export type LoadEvent = {
  kind: LoadKind; at: number; push: boolean;
  running: number; queued: number; eta: number; turns: number;
  waiting: { name: string; sec: number }[];
  people: number;
};

type Mark = { at: number; eta: number; queued: number; running: number; turns: number };
export type LoadWatch = {
  hist: { t: number; running: number; turns: number }[];
  last: Partial<Record<AlertKind, Mark>>;
  episode: boolean;
  pushed: boolean;
  busyAnnounced: boolean;
  calmSince: number | null;
  pending: LoadEvent[];
  lastPushAt: number | null;
};
export type LoadPersist = Pick<LoadWatch, 'last' | 'episode' | 'pushed' | 'busyAnnounced'>;

export const watchInit = (p?: Partial<LoadPersist> | null): LoadWatch => ({
  hist: [], last: p?.last && typeof p.last === 'object' ? p.last : {}, episode: !!p?.episode, pushed: !!p?.pushed, busyAnnounced: !!p?.busyAnnounced,
  calmSince: null, pending: [], lastPushAt: null,
});
export const persistOf = (s: LoadWatch): LoadPersist => ({ last: s.last, episode: s.episode, pushed: s.pushed, busyAnnounced: s.busyAnnounced });

const HIST_MS = 125_000;
const PRIORITY: LoadKind[] = ['busyOn', 'eta', 'queue', 'spike', 'clear'];

export function whoWaits(w: Waiting[]): { list: { name: string; sec: number }[]; people: number } {
  const m = new Map<string, number>();
  for (const x of w) m.set(x.name, Math.max(m.get(x.name) ?? 0, x.sinceMs));
  const all = [...m].map(([name, ms]) => ({ name, sec: Math.round(ms / 1000) })).sort((a, b) => b.sec - a.sec || a.name.localeCompare(b.name));
  return { list: all.slice(0, 5), people: all.length };
}

const numbers = (x: LoadSample) => ({ running: x.running, queued: x.queued, eta: Math.round(x.etaNext), turns: x.turnsLastMinute });
const markOf = (x: LoadSample): Mark => ({ at: x.now, ...numbers(x) });

function worse(kind: AlertKind, m: Mark, x: LoadSample): boolean {
  if (kind === 'eta') return x.etaNext >= 2 * m.eta;
  if (kind === 'queue') return x.queued >= 2 * m.queued && x.queued - m.queued >= 2;
  if (kind === 'spike') return (x.running >= 2 * m.running && x.running - m.running >= 2) || (x.turnsLastMinute >= 2 * m.turns && x.turnsLastMinute - m.turns >= 4);
  return false;
}

export function watchStep(s0: LoadWatch, x: LoadSample, cfg: LoadCfg = LW): { state: LoadWatch; events: LoadEvent[]; push: LoadEvent | null } {
  const s: LoadWatch = { ...s0, last: { ...s0.last }, pending: [...s0.pending] };
  const events: LoadEvent[] = [];
  const hist = s0.hist.filter((h) => x.now - h.t <= HIST_MS);
  const who = whoWaits(x.waiting);
  const waitMaxS = x.waiting.reduce((m, w) => Math.max(m, w.sinceMs), 0) / 1000;
  const emit = (kind: LoadKind, push: boolean): LoadEvent => {
    const e: LoadEvent = { kind, at: x.now, push, ...numbers(x), waiting: who.list, people: who.people };
    events.push(e);
    return e;
  };

  const warm = hist.length > 0 && x.now - hist[0].t >= cfg.spikeWindowMs - 5_000;
  const win = hist.filter((h) => x.now - h.t <= cfg.spikeWindowMs);
  const before = [...hist].reverse().find((h) => x.now - h.t >= cfg.spikeWindowMs - 5_000);
  const spikeA = warm && x.running >= cfg.spikeRunning && win.length > 0 && Math.min(...win.map((h) => h.running)) <= 1;
  const spikeB = warm && x.turnsLastMinute >= cfg.spikeTurns && !!before && before.turns <= 3;
  const cond: Record<AlertKind, boolean> = {
    spike: spikeA || spikeB,
    queue: x.waiting.length > 0 && waitMaxS >= cfg.queueWaitS,
    eta: x.etaNext >= cfg.etaS,
    busyOn: x.busyAuto && !s.busyAnnounced,
  };
  for (const kind of ['spike', 'queue', 'eta', 'busyOn'] as const) {
    if (!cond[kind]) continue;
    const m = s.last[kind];
    const due = !m || x.now - m.at >= cfg.repeatMs || (kind !== 'busyOn' && x.now - m.at >= cfg.gapMs && worse(kind, m, x));
    if (!due) continue;
    const e = emit(kind, x.pushOn);
    s.last[kind] = markOf(x);
    s.episode = true;
    if (e.push) { s.pushed = true; s.pending.push(e); }
    if (kind === 'busyOn') s.busyAnnounced = true;
  }
  if (!x.busyAuto && s.busyAnnounced) { emit('busyOff', false); s.busyAnnounced = false; }

  const calm = x.queued === 0 && x.waiting.length === 0 && x.etaNext < cfg.calmEtaS && !x.busyAuto && x.turnsLastMinute < cfg.spikeTurns;
  s.calmSince = calm ? (s.calmSince ?? x.now) : null;
  if (!calm) s.pending = s.pending.filter((p) => p.kind !== 'clear');
  if (s.episode && s.calmSince !== null && x.now - s.calmSince >= cfg.calmMs) {
    const e = emit('clear', x.pushOn && s.pushed);
    if (e.push) s.pending.push(e);
    s.episode = false; s.pushed = false; s.calmSince = null;
  }

  let push: LoadEvent | null = null;
  if (!x.pushOn) s.pending = [];
  if (s.pending.length && (s.lastPushAt === null || x.now - s.lastPushAt >= cfg.gapMs)) {
    const top = [...s.pending].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
    push = top.kind === 'clear' ? { ...top, running: x.running, queued: x.queued, eta: Math.round(x.etaNext) } : { ...top, ...numbers(x), waiting: who.list, people: who.people };
    s.pending = [];
    s.lastPushAt = x.now;
  }
  s.hist = [...hist, { t: x.now, running: x.running, turns: x.turnsLastMinute }];
  return { state: s, events, push };
}

export function fmtWait(s: number, lang: Lang = 'ru'): string {
  return s >= 90 ? tr(lang, 'ops.min', { n: Math.round(s / 60) }) : tr(lang, 'ops.sec', { n: Math.max(0, Math.round(s)) });
}
const names = (e: Pick<LoadEvent, 'waiting' | 'people'>, max: number) => {
  const shown = e.waiting.slice(0, max).map((w) => w.name).join(', ');
  return e.people > max ? `${shown} +${e.people - max}` : shown;
};

export function eventText(lang: Lang, e: LoadEvent, maxNames = LW.names): { title: string; body: string; line: string } {
  const nums = { running: e.running, queued: e.queued };
  const title = tr(lang, `ops.${e.kind}.t`);
  let body = '';
  const waiters = e.waiting.length ? tr(lang, 'ops.waiting', { who: names(e, maxNames) }) : '';
  switch (e.kind) {
    case 'spike': body = tr(lang, 'ops.spike.b', { ...nums, turns: e.turns }) + waiters; break;
    case 'queue': body = tr(lang, 'ops.queue.b', { ...nums, wait: fmtWait(e.waiting[0]?.sec ?? 0, lang) }) + waiters; break;
    case 'eta': body = tr(lang, 'ops.eta.b', { ...nums, eta: fmtWait(e.eta, lang) }) + waiters; break;
    case 'busyOn': body = tr(lang, 'ops.busyOn.b', { ...nums, eta: fmtWait(e.eta, lang) }) + waiters; break;
    case 'busyOff': body = tr(lang, 'ops.busyOff.b', nums); break;
    case 'clear': body = tr(lang, 'ops.clear.b', { running: e.running }); break;
  }
  return { title, body, line: `${title} — ${body}` };
}
