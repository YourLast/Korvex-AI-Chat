import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db';
import { getModels, isClaudeDirect } from './models';
import type { Lang } from './i18n/core';
import type { LoadEvent, LoadPersist } from './loadWatch';
import { standDefault } from './cfg';
import { modelKey } from './providers';
import { LOCAL_ID, localBanner, localReady } from './localModel';
import {
  ALL, BUSY_MODES, MAX_TEXT, PROBE_DOWN_AFTER, altModel, busyBanner, busyInit, busyOn, busyStep, downNotice, entryFor, loadBanner, manualBanner, modelLive,
  type BannerLevel, type BusyAuto, type BusyMode, type LoadMap, type LoadState, type ManualBanner, type ModelLive, type Probe, type StatusView,
} from './announce';

type Store = { rev: number; banner: ManualBanner; load: LoadMap; busyMode: BusyMode; busyRev: number; maxAdminOnly: boolean; loadAlerts: boolean; alertLog: LoadEvent[]; alertState: LoadPersist | null };
export const ALERT_LOG_MAX = 30;
type G = { file: string; store: Store; probes: Map<string, Probe>; timer?: ReturnType<typeof setInterval>; busy: BusyAuto };
const g = globalThis as unknown as { __kxStatus?: G };

export class StatusError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const empty = (): Store => ({ rev: 0, banner: { enabled: false, text: '', level: 'info', until: null, rev: 0, at: 0 }, load: {}, busyMode: 'auto', busyRev: 0, maxAdminOnly: true, loadAlerts: true, alertLog: [], alertState: null });

function st(): G {
  const file = path.join(dataDir(), 'status.json');
  if (g.__kxStatus && g.__kxStatus.file === file) return g.__kxStatus;
  let store = empty();
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Store>;
    store = { ...store, ...j, banner: { ...store.banner, ...(j.banner ?? {}) }, load: j.load ?? {} };
    if (!BUSY_MODES.includes(store.busyMode)) store.busyMode = 'auto';
    if (typeof store.maxAdminOnly !== 'boolean') store.maxAdminOnly = true;
    if (typeof store.loadAlerts !== 'boolean') store.loadAlerts = true;
    if (!Array.isArray(store.alertLog)) store.alertLog = [];
    store.alertLog = store.alertLog.slice(-ALERT_LOG_MAX);
    if (!store.alertState || typeof store.alertState !== 'object') store.alertState = null;
  } catch {  }
  g.__kxStatus = { file, store, probes: g.__kxStatus?.probes ?? new Map(), timer: g.__kxStatus?.timer, busy: g.__kxStatus?.busy ?? busyInit() };
  return g.__kxStatus;
}

function save(s: G) {
  try {
    fs.mkdirSync(path.dirname(s.file), { recursive: true, mode: 0o700 });
    const tmp = `${s.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s.store), { mode: 0o600 });
    fs.renameSync(tmp, s.file);
  } catch (e) { console.error('[status] не записан', (e as Error).message); }
}

const refs = () => getModels().map((m) => ({ id: m.id, name: m.name }));
const shown = () => getModels().filter((m) => !m.hidden && !m.roles).map((m) => ({ id: m.id, name: m.name }));
const probesObj = (s: G) => Object.fromEntries(s.probes);

export type BannerPatch = { text?: string; level?: BannerLevel; until?: number | null; enabled?: boolean };

export function setBanner(p: BannerPatch, now = Date.now()): ManualBanner {
  const s = st();
  const b = { ...s.store.banner };
  if (p.text !== undefined) {
    const t = p.text.replace(/\s+/g, ' ').trim();
    if (t.length > MAX_TEXT) throw new StatusError(400, `Текст — не длиннее ${MAX_TEXT} символов`);
    b.text = t;
  }
  if (p.level !== undefined) b.level = p.level;
  if (p.until !== undefined) {
    if (p.until !== null && p.until <= now) throw new StatusError(400, 'Срок показа уже прошёл');
    b.until = p.until;
  }
  if (p.enabled !== undefined) b.enabled = p.enabled;
  if (b.enabled && !b.text) throw new StatusError(400, 'Укажите текст объявления');
  if (b.enabled && b.until !== null && b.until <= now) throw new StatusError(400, 'Срок показа уже прошёл');
  s.store.banner = { ...b, rev: ++s.store.rev, at: now };
  save(s);
  return s.store.banner;
}

export function setLoad(p: { state: LoadState; model?: string | null; until?: number | null }, now = Date.now()): LoadMap {
  const s = st();
  const key = p.model ? p.model : ALL;
  if (key !== ALL && !getModels().some((m) => m.id === key)) throw new StatusError(400, `Нет такой модели: ${key}`);
  if (p.until != null && p.until <= now) throw new StatusError(400, 'Срок уже прошёл');
  if (p.state === 'normal') {
    if (key === ALL) s.store.load = {}; else delete s.store.load[key];
  } else {
    s.store.load[key] = { state: p.state, until: p.until ?? null, rev: ++s.store.rev, at: now };
  }
  for (const [k, e] of Object.entries(s.store.load)) if (e.until !== null && e.until <= now) delete s.store.load[k];
  save(s);
  return s.store.load;
}

export const maxAdminOnly = (): boolean => st().store.maxAdminOnly !== false;
export function setMaxAdminOnly(on: boolean): boolean {
  const s = st();
  if (s.store.maxAdminOnly !== on) { s.store.maxAdminOnly = on; s.store.rev++; save(s); }
  return s.store.maxAdminOnly;
}

export const loadAlertsOn = (): boolean => st().store.loadAlerts !== false;
export function setLoadAlerts(on: boolean): boolean {
  const s = st();
  if (s.store.loadAlerts !== on) { s.store.loadAlerts = on; s.store.rev++; save(s); }
  return s.store.loadAlerts;
}
export const alertLog = (): LoadEvent[] => st().store.alertLog.slice();
export function recordAlerts(events: LoadEvent[], persist?: LoadPersist) {
  const s = st();
  if (!events.length && !persist) return;
  if (events.length) s.store.alertLog = [...s.store.alertLog, ...events].slice(-ALERT_LOG_MAX);
  if (persist) s.store.alertState = persist;
  save(s);
}
export const alertState = (): LoadPersist | null => st().store.alertState;

export function setBusyMode(mode: BusyMode): BusyMode {
  if (!BUSY_MODES.includes(mode)) throw new StatusError(400, 'Режим — auto, off или on');
  const s = st();
  if (s.store.busyMode !== mode) { s.store.busyMode = mode; s.store.busyRev = ++s.store.rev; save(s); }
  return s.store.busyMode;
}

export function busyTick(eta: number, now = Date.now()): BusyAuto {
  const s = st();
  s.busy = busyStep(s.busy, eta, now);
  return s.busy;
}

export function busyView(now = Date.now()) {
  const s = st();
  const auto = s.busy.on;
  return { mode: s.store.busyMode, on: busyOn(s.store.busyMode, auto), auto, eta: s.busy.eta, since: s.busy.since, checkedAt: s.busy.at || null, now };
}

export function modelStates(now = Date.now()): Record<string, ModelLive> {
  const s = st();
  return Object.fromEntries(refs().map((m) => [m.id, modelLive(m.id, s.store.load, s.probes.get(m.id), now)]));
}

export function statusFor(tz: string, now = Date.now(), lang: Lang = 'ru'): StatusView {
  const s = st();
  const busy = busyOn(s.store.busyMode, s.busy.on)
    ? busyBanner(s.busy.eta, s.store.busyMode === 'on' ? `bf${s.store.busyRev}` : `b${s.busy.since ?? 0}`, lang) : null;
  const banners = [localBanner(lang), manualBanner(s.store.banner, now), loadBanner(shown(), s.store.load, probesObj(s), tz, now, lang), busy].filter((b): b is NonNullable<typeof b> => !!b);
  return { now, banners, models: modelStates(now) };
}

export function adminSnapshot(now = Date.now()) {
  const s = st();
  const states = modelStates(now);
  return {
    now,
    banner: s.store.banner,
    busy: busyView(now),
    maxAdminOnly: s.store.maxAdminOnly !== false,
    loadAlerts: s.store.loadAlerts !== false,
    load: Object.fromEntries(Object.entries(s.store.load).filter(([, e]) => e.until === null || e.until > now)),
    models: refs().map((m) => ({ ...m, ...states[m.id], probe: s.probes.get(m.id) ?? null, flag: entryFor(s.store.load, m.id, now)?.state ?? 'normal' })),
  };
}

export function modelUnavailable(modelId: string, tz: string, now = Date.now(), lang: Lang = 'ru'): { text: string; alt: { id: string; name: string } | null } | null {
  const states = modelStates(now);
  if (states[modelId]?.state !== 'down') return null;
  const m = refs().find((x) => x.id === modelId);
  if (!m) return null;
  const alt = altModel(shown(), states, modelId);
  return { text: downNotice(m, states[modelId].until, alt, tz, now, lang), alt };
}

export const maintFile = () => process.env.KX_MAINT_FILE ?? standDefault('KX_MAINT_FILE');
const MAINT_TEXT = /обслуживан|maintenance|перезапуск|обновлени/i;

export function maintenance(modelId?: string, now = Date.now()): { retryAfter: number; reason: 'file' | 'banner' | 'down' } | null {
  const clampS = (ms: number | null | undefined) => (ms && ms > now ? Math.min(600, Math.max(10, Math.round((ms - now) / 1000))) : 60);
  const b = st().store.banner;
  const bannerOn = b.enabled && (b.until === null || b.until > now) && b.level === 'warn' && MAINT_TEXT.test(b.text);
  let file = false;
  try { file = !!maintFile() && fs.existsSync(/*turbopackIgnore: true*/ maintFile()); } catch { file = false; }
  if (bannerOn) return { retryAfter: clampS(b.until), reason: 'banner' };
  if (file) return { retryAfter: 60, reason: 'file' };
  if (modelId) {
    const m = modelStates(now)[modelId];
    if (m?.state === 'down') return { retryAfter: clampS(m.until), reason: 'down' };
  }
  return null;
}

function setProbe(id: string, ok: boolean) {
  const s = st();
  const old = s.probes.get(id);
  s.probes.set(id, { ok, fails: ok ? 0 : (old?.fails ?? 0) + 1, at: Date.now() });
}

export async function probeOnce(fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<void> {
  await Promise.all(getModels().filter((m) => !isClaudeDirect(m)).map(async (m) => {
    let ok = false;
    if (m.id === LOCAL_ID && !localReady()) { st().probes.set(m.id, { ok: false, fails: PROBE_DOWN_AFTER, at: Date.now() }); return; }
    try {
      const key = modelKey(m);
      const r = await fetchImpl(m.baseUrl.replace(/\/+$/, '') + '/models', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) });
      ok = r.ok;
      try { await r.body?.cancel(); } catch {  }
    } catch { ok = false; }
    setProbe(m.id, ok);
  }));
}

export function startProbe() {
  if (process.env.KX_PROBE === '0') return;
  const s = st();
  if (s.timer) return;
  const every = Math.max(1000, Number(process.env.KX_PROBE_MS) || 15_000);
  void probeOnce().catch(() => {});
  s.timer = setInterval(() => { void probeOnce().catch(() => {}); }, every);
  s.timer.unref?.();
}
export function stopProbe() { const s = st(); if (s.timer) { clearInterval(s.timer); s.timer = undefined; } }
