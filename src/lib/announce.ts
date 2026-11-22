
import { tr, type Lang } from './i18n/core';
import { MODEL_PREFIX } from '@/ext/client';

export type LoadState = 'normal' | 'training' | 'down';
export type BannerLevel = 'info' | 'warn';
export type ModelState = 'ok' | 'slow' | 'down';

export type LoadEntry = { state: LoadState; until: number | null; rev: number; at: number };
export type LoadMap = Record<string, LoadEntry>;
export type ManualBanner = { enabled: boolean; text: string; level: BannerLevel; until: number | null; rev: number; at: number };
export type Probe = { ok: boolean; fails: number; at: number };
export type ModelRef = { id: string; name: string };

export type BannerView = { id: 'manual' | 'load' | 'busy' | 'local' | 'works' | 'readonly'; sig: string; level: BannerLevel; text: string };
export type ModelLive = { state: ModelState; until: number | null };
export type StatusView = { now: number; banners: BannerView[]; models: Record<string, ModelLive> };

export const ALL = '*';
export const MAX_TEXT = 280;
export const PROBE_DOWN_AFTER = 2;
export const STATE_LABEL: Record<ModelState, string> = { ok: 'работает', slow: 'медленно — идёт обучение', down: 'временно недоступна' };
export const STATE_SHORT: Record<ModelState, string> = { ok: 'работает', slow: 'медленно', down: 'недоступна' };

const SEV: Record<LoadState, number> = { normal: 0, training: 1, down: 2 };
const live = (e: LoadEntry | undefined, now: number): e is LoadEntry => !!e && e.state !== 'normal' && (e.until === null || e.until > now);

export function fmtUntil(ts: number, tz: string, now = Date.now()): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...o });
  const hm = f({ hour: '2-digit', minute: '2-digit', hour12: false }).format(ts);
  const day = (t: number) => f({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  return day(ts) === day(now) ? hm : `${f({ day: '2-digit', month: '2-digit' }).format(ts)} ${hm}`;
}

export function entryFor(load: LoadMap, modelId: string, now = Date.now()): LoadEntry | null {
  let best: LoadEntry | null = null;
  for (const e of [load[ALL], load[modelId]]) {
    if (!live(e, now)) continue;
    if (!best || SEV[e.state] > SEV[best.state] || (SEV[e.state] === SEV[best.state] && (e.until === null || (best.until !== null && e.until > best.until)))) best = e;
  }
  return best;
}

export function modelLive(modelId: string, load: LoadMap, probe: Probe | undefined, now = Date.now()): ModelLive {
  const e = entryFor(load, modelId, now);
  if (e?.state === 'down') return { state: 'down', until: e.until };
  if (probe && !probe.ok && probe.fails >= PROBE_DOWN_AFTER) return { state: 'down', until: null };
  if (e?.state === 'training') return { state: 'slow', until: e.until };
  return { state: 'ok', until: null };
}

const label = (m: ModelRef) => `${MODEL_PREFIX}${m.name}`;
const list = (xs: string[], lang: Lang = 'ru') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}${tr(lang, 'srv.and')}${xs[xs.length - 1]}`);

export function altModel(models: ModelRef[], states: Record<string, ModelLive>, not: string): ModelRef | null {
  return models.find((m) => m.id !== not && states[m.id]?.state !== 'down') ?? null;
}

export function downNotice(m: ModelRef, until: number | null, alt: ModelRef | null, tz: string, now = Date.now(), lang: Lang = 'ru'): string {
  const when = until ? tr(lang, 'srv.until', { t: fmtUntil(until, tz, now) }) : '';
  return `${tr(lang, 'srv.downNow', { model: label(m), when })} ${alt ? tr(lang, 'srv.tryAlt', { alt: label(alt) }) : tr(lang, 'srv.tryLater')}`;
}

export function loadBanner(models: ModelRef[], load: LoadMap, probes: Record<string, Probe | undefined>, tz: string, now = Date.now(), lang: Lang = 'ru'): BannerView | null {
  const states: Record<string, ModelLive> = {};
  const used: LoadEntry[] = [];
  for (const m of models) {
    const e = entryFor(load, m.id, now);
    states[m.id] = e?.state === 'down' ? { state: 'down', until: e.until } : e?.state === 'training' ? { state: 'slow', until: e.until } : { state: 'ok', until: null };
    if (e && !used.includes(e)) used.push(e);
  }
  const down = models.filter((m) => states[m.id].state === 'down');
  const slow = models.filter((m) => states[m.id].state === 'slow');
  if (!down.length && !slow.length) return null;
  const parts: string[] = [];
  if (down.length) {
    const untils = down.map((m) => states[m.id].until);
    const until = untils.every((u) => u !== null) ? Math.max(...(untils as number[])) : null;
    const when = until ? `,${tr(lang, 'srv.until', { t: fmtUntil(until, tz, now) })}` : '';
    const alive = models.filter((m) => states[m.id].state !== 'down' && !(probes[m.id] && !probes[m.id]!.ok && probes[m.id]!.fails >= PROBE_DOWN_AFTER));
    const advice = alive.length ? tr(lang, 'srv.advTry', { models: list(alive.map(label), lang) }) : tr(lang, 'srv.advLater');
    parts.push(tr(lang, 'srv.trainDown', { n: down.length, models: list(down.map(label), lang), when, advice }));
  }
  if (slow.length) {
    const all = slow.length === models.length;
    parts.push(all ? tr(lang, 'srv.trainAll') : tr(lang, 'srv.trainSome', { models: list(slow.map(label), lang) }));
  }
  const text = parts.map((p, i) => (i === 0 && parts.length > 1 ? p + '.' : p)).join(' ');
  const sig = 'l' + used.map((e) => e.rev).sort((a, b) => a - b).join('.');
  return { id: 'load', sig, level: down.length ? 'warn' : 'info', text };
}

export function manualBanner(b: ManualBanner, now = Date.now()): BannerView | null {
  if (!b.enabled || !b.text.trim() || (b.until !== null && b.until <= now)) return null;
  return { id: 'manual', sig: 'm' + b.rev, level: b.level, text: b.text.trim() };
}

export type WorksFlag = { since: number; until: number };
export function worksBanner(f: unknown, now = Date.now(), lang: Lang = 'ru'): BannerView | null {
  const o = f as Partial<WorksFlag> | null;
  if (!o || typeof o.until !== 'number' || !Number.isFinite(o.until) || o.until <= now) return null;
  const since = typeof o.since === 'number' && Number.isFinite(o.since) ? o.since : 0;
  return { id: 'works', sig: 'w' + since, level: 'info', text: tr(lang, 'srv.works') };
}

export function parseUntil(v: unknown, minutes?: unknown, now = Date.now()): number | null | undefined | 'bad' {
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) return now + Math.round(minutes * 60_000);
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? Math.round(t) : 'bad';
}

export type BusyMode = 'auto' | 'off' | 'on';
export const BUSY_MODES: readonly BusyMode[] = ['auto', 'off', 'on'];
export const BUSY_ON_ETA = 60;
export const BUSY_ON_HOLD_MS = 20_000;
export const BUSY_OFF_ETA = 20;
export const BUSY_OFF_HOLD_MS = 120_000;
export const BUSY_CHECK_MS = 5_000;

export type BusyAuto = { on: boolean; since: number | null; hi: number | null; lo: number | null; eta: number; at: number };
export const busyInit = (): BusyAuto => ({ on: false, since: null, hi: null, lo: null, eta: 0, at: 0 });

export function busyStep(s: BusyAuto, eta: number, now: number): BusyAuto {
  const n: BusyAuto = { ...s, eta, at: now };
  if (!s.on) {
    n.lo = null;
    if (eta >= BUSY_ON_ETA) {
      n.hi = s.hi ?? now;
      if (now - n.hi >= BUSY_ON_HOLD_MS) { n.on = true; n.since = now; n.hi = null; }
    } else n.hi = null;
  } else {
    n.hi = null;
    if (eta < BUSY_OFF_ETA) {
      n.lo = s.lo ?? now;
      if (now - n.lo >= BUSY_OFF_HOLD_MS) { n.on = false; n.since = null; n.lo = null; }
    } else n.lo = null;
  }
  return n;
}

export function busyText(eta: number, lang: Lang = 'ru'): string {
  const n = eta >= 30 ? Math.max(1, Math.round(eta / 60)) : 0;
  return tr(lang, 'srv.busy', { wait: n ? tr(lang, 'srv.busyWait', { n }) : '' });
}
export const busyBanner = (eta: number, sig: string, lang: Lang = 'ru'): BannerView => ({ id: 'busy', sig, level: 'info', text: busyText(eta, lang) });

export function busyOn(mode: BusyMode, auto: boolean): boolean {
  return mode === 'on' ? true : mode === 'off' ? false : auto;
}

export type QueueRow = { key: string; name: string; active: number; queued: number; limit: number; avg: number; etaNext: number };
export type BusySnap = { mode: BusyMode; on: boolean; auto: boolean; eta: number; since: number | null; checkedAt: number | null; now: number; etaNow?: number; queues?: QueueRow[] };
