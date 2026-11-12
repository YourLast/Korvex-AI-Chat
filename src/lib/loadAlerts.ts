import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { arrivalsIn, queuesStats, waitingJobs } from './jobs';
import { sendPush, subsOf, type PushPayload } from './push';
import { inQuiet } from './notify';
import { asLang, type Lang } from './i18n/core';
import { alertLog, alertState, busyView, loadAlertsOn, recordAlerts } from './status';
import { cfgFromEnv, eventText, persistOf, watchInit, watchStep, type LoadCfg, type LoadEvent, type LoadWatch } from './loadWatch';

type Q = { key: string; active: number; queued: number; etaNext: number };
type Sub = ReturnType<typeof subsOf>[number];
export type Deps = {
  send: (sub: Sub, p: PushPayload, who: { userId: string }) => Promise<'ok' | 'gone' | 'error'>;
  waiting: typeof waitingJobs;
  arrivals: typeof arrivalsIn;
};

type G = { w: LoadWatch; sig: string; cfg: LoadCfg };
const g = globalThis as unknown as { __kxLoadAlerts?: G };
function gs(): G {
  if (!g.__kxLoadAlerts) {
    const p = alertState();
    const w = watchInit(p);
    g.__kxLoadAlerts = { w, sig: JSON.stringify(persistOf(w)), cfg: cfgFromEnv(process.env.KX_LOADWATCH_CFG) };
  }
  return g.__kxLoadAlerts;
}
export function _resetLoadAlerts() { g.__kxLoadAlerts = undefined; }

const sinkFile = () => (process.env.KX_PUSH_SINK ? path.join(dataDir(), 'push-sink.jsonl') : null);
export async function defaultSend(sub: Sub, p: PushPayload, who: { userId: string }): Promise<'ok' | 'gone' | 'error'> {
  const f = sinkFile();
  if (f) { fs.appendFileSync(f, JSON.stringify({ at: Date.now(), userId: who.userId, device: sub.device, payload: p }) + '\n', { mode: 0o600 }); return 'ok'; }
  return sendPush(sub, p);
}
const DEPS: Deps = { send: defaultSend, waiting: waitingJobs, arrivals: arrivalsIn };

function namesOf(ids: string[]): Map<string, string> {
  const u = [...new Set(ids)];
  if (!u.length) return new Map();
  return new Map(getDb().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, u)).all().map((r) => [r.id, r.name || '?']));
}

export function liveWaiting(queues: Q[], now = Date.now(), waiting: Deps['waiting'] = waitingJobs): { name: string; sec: number; n: number }[] {
  const w = waiting(queues.map((q) => q.key), now);
  const names = namesOf(w.map((x) => x.userId));
  const by = new Map<string, { name: string; sec: number; n: number }>();
  for (const x of w) {
    const name = names.get(x.userId) ?? '?', sec = Math.round(x.sinceMs / 1000), e = by.get(x.userId);
    by.set(x.userId, { name, sec: Math.max(sec, e?.sec ?? 0), n: (e?.n ?? 0) + 1 });
  }
  return [...by.values()].sort((a, b) => b.sec - a.sec || a.name.localeCompare(b.name));
}

export async function deliver(e: LoadEvent, now = Date.now(), send: Deps['send'] = defaultSend, maxNames = gs().cfg.names): Promise<number> {
  if (!loadAlertsOn()) return 0;
  const admins = getDb().select({ id: schema.users.id, lang: schema.users.lang, tz: schema.users.timezone, quiet: schema.users.notifyQuiet }).from(schema.users)
    .where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, 0))).all();
  let sent = 0;
  for (const a of admins) {
    if (inQuiet(a.quiet, a.tz, now)) continue;
    const subs = subsOf(a.id);
    if (!subs.length) continue;
    const t = eventText(asLang(a.lang) ?? 'ru', e, maxNames);
    const payload: PushPayload = { title: t.title, body: t.body, url: '/admin#state', tag: `ops-${e.kind}` };
    for (const sub of subs) { if ((await send(sub, payload, { userId: a.id }).catch(() => 'error')) === 'ok') sent++; }
  }
  return sent;
}

export function loadAlertsTick(queues: Q[], now = Date.now(), deps: Partial<Deps> = {}): { events: LoadEvent[]; push: LoadEvent | null; sent: Promise<number> } | null {
  try {
    const d = { ...DEPS, ...deps };
    const w = gs();
    const keys = queues.map((q) => q.key);
    const raw = d.waiting(keys, now);
    const names = namesOf(raw.map((x) => x.userId));
    const pushOn = loadAlertsOn();
    const r = watchStep(w.w, {
      now, running: queues.reduce((n, q) => n + q.active, 0), queued: queues.reduce((n, q) => n + q.queued, 0), etaNext: queues.reduce((m, q) => Math.max(m, q.etaNext), 0),
      busyAuto: busyView(now).auto, waiting: raw.map((x) => ({ name: names.get(x.userId) ?? '?', sinceMs: x.sinceMs })), turnsLastMinute: d.arrivals(keys, 60_000, now), pushOn,
    }, w.cfg);
    w.w = r.state;
    const p = persistOf(r.state), sig = JSON.stringify(p);
    if (r.events.length || sig !== w.sig) { w.sig = sig; recordAlerts(r.events, p); }
    const sent = r.push ? deliver(r.push, now, d.send, w.cfg.names).catch((e) => { console.error('[loadalerts]', (e as Error).message); return 0; }) : Promise.resolve(0);
    return { events: r.events, push: r.push, sent };
  } catch (e) {
    console.error('[loadalerts]', (e as Error).message);
    return null;
  }
}

export function adminAlerts(lang: Lang = 'ru', now = Date.now()) {
  const log = alertLog().reverse().map((e) => {
    const t = eventText(lang, e, 5);
    return { at: e.at, kind: e.kind, push: e.push, title: t.title, body: t.body, line: t.line, running: e.running, queued: e.queued, eta: e.eta, who: e.waiting.map((x) => x.name) };
  });
  let waiting: { name: string; sec: number; n: number }[] = [];
  try { waiting = liveWaiting(queuesStats().filter((q) => q.limit >= 2 && !q.claude), now); } catch { waiting = []; }
  return { now, on: loadAlertsOn(), waiting, log };
}
export type AlertsSnap = ReturnType<typeof adminAlerts>;
