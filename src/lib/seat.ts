import { createHmac, randomUUID } from 'node:crypto';
import net from 'node:net';
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { User } from './db/schema';
import { clientIp, currentSessionHash, deviceKey } from './auth';
import { publish } from './bus';
import { blockUser, logAudit, SEAT_REASON, unblockUser } from './moderation';
import { subsOf, type PushPayload } from './push';
import { inQuiet } from './quiet';
import { defaultSend } from './loadAlerts';
import { dayOf, tzOf } from './week';
import { localeOf, tr, type Lang } from './i18n/core';
import { withSupport } from './support';

export const SYSTEM_SEAT = 'system:seat';
export const SYSTEM_SEAT24 = 'system:seat24';
const HOUR = 3_600_000, DAY = 86_400_000;
const num = (name: string, def: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : def; };
export const seatOn = () => process.env.KX_SEAT !== '0';
const seatRoles = () => (process.env.KX_SEAT_ROLES ?? 'user,alpha').split(',').map((x) => x.trim()).filter(Boolean);
export const seatApplies = (role: string | null | undefined) => seatOn() && !!role && role !== 'admin' && seatRoles().includes(role);
const switches = () => num('KX_SHARE_SWITCHES', 6);
const concurrents = () => num('KX_SHARE_CONCURRENT', 3);

let netKey: Buffer | null = null;
const subKey = () => (netKey ??= createHmac('sha256', deviceKey()).update('kx-seat-net').digest());
export function netOf(ip: string): string {
  let id: string;
  const v6 = ip.split('%')[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v6);
  if (mapped || net.isIPv4(ip)) id = '4:' + (mapped ? mapped[1] : ip).split('.').slice(0, 3).join('.');
  else if (net.isIPv6(v6)) {
    const [l, r = ''] = v6.split('::');
    const L = l ? l.split(':') : [], R = r ? r.split(':') : [];
    const g = v6.includes('::') ? [...L, ...Array(Math.max(0, 8 - L.length - R.length)).fill('0'), ...R] : L;
    id = '6:' + g.slice(0, 3).map((x) => parseInt(x || '0', 16).toString(16)).join(':');
  } else id = 'x:' + ip.slice(0, 64);
  return createHmac('sha256', subKey()).update(id).digest('hex').slice(0, 16);
}
export function uaFamily(ua: string | null | undefined): string {
  const s = String(ua ?? '');
  const b = /Edg(e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /YaBrowser/.test(s) ? 'Yandex' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : s ? 'Other' : '?';
  const o = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux|X11/.test(s) ? 'Linux' : s ? 'Other' : '?';
  return `${b}/${o}`.slice(0, 40);
}

export function addNotice(userId: string, kind: string, key: string, now = Date.now()): boolean {
  const r = getDb().insert(schema.userNotices).values({ id: randomUUID(), userId, kind, key, at: now }).onConflictDoNothing().run();
  if (r.changes) publish(userId, { t: 'notice', kind });
  return r.changes > 0;
}
export function pendingNotices(userId: string) {
  return getDb().select({ id: schema.userNotices.id, kind: schema.userNotices.kind, at: schema.userNotices.at }).from(schema.userNotices)
    .where(and(eq(schema.userNotices.userId, userId), sql`${schema.userNotices.seenAt} is null`)).orderBy(asc(schema.userNotices.at)).all();
}
export function dismissNotice(userId: string, id: string, now = Date.now()): boolean {
  return getDb().update(schema.userNotices).set({ seenAt: now }).where(and(eq(schema.userNotices.id, id), eq(schema.userNotices.userId, userId))).run().changes > 0;
}

export async function pushAdmins(p: PushPayload, send: typeof defaultSend = defaultSend, now = Date.now()): Promise<number> {
  let sent = 0;
  try {
    const admins = getDb().select({ id: schema.users.id, tz: schema.users.timezone, quiet: schema.users.notifyQuiet }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, 0))).all();
    for (const a of admins) {
      if (inQuiet(a.quiet, a.tz, now)) continue;
      for (const sub of subsOf(a.id)) if ((await send(sub, p, { userId: a.id }).catch(() => 'error')) === 'ok') sent++;
    }
  } catch (e) { console.error('[seat] push', (e as Error).message); }
  return sent;
}

const g = globalThis as unknown as { __kxSeatPrune?: number };
export function pruneSignals(now = Date.now(), force = false): number {
  if (!force && g.__kxSeatPrune && now - g.__kxSeatPrune < HOUR) return 0;
  g.__kxSeatPrune = now;
  return getDb().delete(schema.seatSignals).where(lt(schema.seatSignals.at, now - 30 * DAY)).run().changes;
}

export type Signal = { session: string; net: string; ua: string; jobs: string[] };

export function recordSignal(user: Pick<User, 'id' | 'role' | 'timezone' | 'seatResetAt'>, s: Signal, now = Date.now()): { event: 'switch' | 'concurrent' | null; strike: number | null } {
  const none = { event: null, strike: null } as const;
  if (!seatApplies(user.role)) return none;
  try {
    const db = getDb();
    const live = new Set(db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.userId, user.id), eq(schema.jobs.kind, 'chat'), inArray(schema.jobs.status, ['queued', 'running']))).all().map((r) => r.id));
    for (const id of s.jobs) live.delete(id);
    let ov = 0;
    if (live.size) {
      const prev = db.select({ session: schema.seatSignals.session, jobs: schema.seatSignals.jobs }).from(schema.seatSignals).where(and(eq(schema.seatSignals.userId, user.id), gt(schema.seatSignals.at, now - 6 * HOUR))).all();
      ov = prev.some((p) => p.session !== s.session && p.jobs.split(',').some((id) => live.has(id))) ? 1 : 0;
    }
    db.insert(schema.seatSignals).values({ id: randomUUID(), userId: user.id, session: s.session, net: s.net, ua: s.ua.slice(0, 40), jobs: s.jobs.join(','), ov, at: now }).run();
    pruneSignals(now);
    const ev = detect(user, now);
    if (!ev) return none;
    return { event: ev, strike: considerStrike(user.id, now) };
  } catch (e) { console.error('[seat]', (e as Error).message); return none; }
}

export function detect(user: Pick<User, 'id' | 'timezone'>, now = Date.now()): 'switch' | 'concurrent' | null {
  const db = getDb();
  const rows = db.select({ session: schema.seatSignals.session, ov: schema.seatSignals.ov }).from(schema.seatSignals)
    .where(and(eq(schema.seatSignals.userId, user.id), gt(schema.seatSignals.at, now - HOUR))).orderBy(asc(schema.seatSignals.at), sql`rowid`).all();
  let alt = 0, overlaps = 0;
  const sessions = new Set<string>();
  rows.forEach((r, i) => { sessions.add(r.session); if (i && rows[i - 1].session !== r.session) alt++; overlaps += r.ov; });
  const kind = alt >= switches() && sessions.size >= 2 ? 'switch' : overlaps >= concurrents() ? 'concurrent' : null;
  if (!kind) return null;
  if (db.select({ id: schema.seatEvents.id }).from(schema.seatEvents).where(and(eq(schema.seatEvents.userId, user.id), gt(schema.seatEvents.at, now - HOUR))).get()) return null;
  db.insert(schema.seatEvents).values({ id: randomUUID(), userId: user.id, day: dayOf(now, tzOf(user)), kind, at: now, detail: JSON.stringify({ alt, sessions: sessions.size, overlaps }) }).run();
  return kind;
}

const sinceOf = (reset: number | null | undefined, from: number) => Math.max(from, reset ?? 0);
const activeStrikes = (userId: string, reset: number | null | undefined, now: number) =>
  getDb().select().from(schema.seatStrikes).where(and(eq(schema.seatStrikes.userId, userId), gt(schema.seatStrikes.at, sinceOf(reset, now - 90 * DAY)))).orderBy(asc(schema.seatStrikes.at)).all();

export function strikeDue(user: Pick<User, 'id' | 'seatResetAt'>, now = Date.now()): number | null {
  const ev = getDb().select({ day: schema.seatEvents.day }).from(schema.seatEvents).where(and(eq(schema.seatEvents.userId, user.id), gt(schema.seatEvents.at, sinceOf(user.seatResetAt, now - 7 * DAY)))).all();
  if (new Set(ev.map((e) => e.day)).size < 2) return null;
  const st = activeStrikes(user.id, user.seatResetAt, now);
  const last = st.at(-1);
  if (last && now - last.at < 7 * DAY) return null;
  return st.length + 1;
}

export function considerStrike(userId: string, now = Date.now()): number | null {
  const db = getDb();
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u || !seatApplies(u.role)) return null;
  const n = strikeDue(u, now);
  if (!n) return null;
  const kind = n === 1 ? 'warn' : n === 2 ? 'pause24' : 'pause';
  const id = randomUUID();
  db.insert(schema.seatStrikes).values({ id, userId, kind, at: now }).run();
  const target = { id: u.id, name: u.name, email: u.email };
  const who = u.name || u.email;
  let body: string;
  if (kind === 'warn') {
    addNotice(userId, 'seat_warn', id, now);
    logAudit({ adminId: SYSTEM_SEAT, action: 'seat_warn', target, detail: 'предупреждение 1 (первый раз прощаем): события в ≥ 2 днях за 7 дней' }, now);
    body = `${who}: предупреждение (первый раз, доступ не тронут)`;
  } else {
    if (!u.disabled) {
      const r = blockUser(kind === 'pause24' ? SYSTEM_SEAT24 : SYSTEM_SEAT, userId, { kind: 'pause', reason: SEAT_REASON, logout: { seat: { until: kind === 'pause24' ? now + DAY : 0, tz: tzOf(u) } } }, now);
      if (!r.ok) console.error('[seat] пауза не поставлена:', r.error);
    }
    body = kind === 'pause24' ? `${who}: пауза на 24 часа (вернётся сама)` : `${who}: пауза до решения администратора (поддержка)`;
  }
  void pushAdmins({ title: 'Совместное использование аккаунта', body, url: `/admin/users/${userId}`, tag: `seat-${userId}` });
  return n;
}

export function seatAutoUnblock(userId: string, now = Date.now()): boolean {
  const u = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u || !u.disabled || u.blockKind !== 'pause' || u.blockReason !== SEAT_REASON || u.blockedBy !== SYSTEM_SEAT24 || !u.blockedAt || u.blockedAt + DAY > now) return false;
  const r = unblockUser(SYSTEM_SEAT24, userId, now);
  return r.ok && r.changed;
}
export function seatSweep(now = Date.now()): number {
  let n = 0;
  const rows = getDb().select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.disabled, 1), eq(schema.users.blockReason, SEAT_REASON), eq(schema.users.blockedBy, SYSTEM_SEAT24), lt(schema.users.blockedAt, now - DAY + 1))).all();
  for (const r of rows) if (seatAutoUnblock(r.id, now)) n++;
  pruneSignals(now);
  return n;
}
const gt2 = globalThis as unknown as { __kxSeatTimer?: NodeJS.Timeout };
export function startSeatSweeper() {
  if (gt2.__kxSeatTimer || !seatOn()) return;
  gt2.__kxSeatTimer = setInterval(() => { try { seatSweep(); } catch (e) { console.error('[seat] sweep', (e as Error).message); } }, 60_000);
  gt2.__kxSeatTimer.unref?.();
  setTimeout(() => { try { seatSweep(); } catch {  } }, 5_000).unref?.();
}

export async function recordTurn(user: User, req: Request, jobs: (string | null | undefined)[], now = Date.now()) {
  if (!seatApplies(user.role)) return;
  try {
    const session = await currentSessionHash();
    if (!session) return;
    recordSignal(user, { session, net: netOf(clientIp(req)), ua: uaFamily(req.headers.get('user-agent')), jobs: jobs.filter((x): x is string => !!x) }, now);
  } catch (e) { console.error('[seat]', (e as Error).message); }
}

export type SeatStats = { events7: number; warns: number; pauses: number };
export function seatStats(u: Pick<User, 'id' | 'seatResetAt'>, now = Date.now()): SeatStats {
  const db = getDb();
  const events7 = db.select({ id: schema.seatEvents.id }).from(schema.seatEvents).where(and(eq(schema.seatEvents.userId, u.id), gt(schema.seatEvents.at, sinceOf(u.seatResetAt, now - 7 * DAY)))).all().length;
  const st = activeStrikes(u.id, u.seatResetAt, now);
  return { events7, warns: st.filter((x) => x.kind === 'warn').length, pauses: st.filter((x) => x.kind !== 'warn').length };
}
export function clearSeat(adminId: string, userId: string, now = Date.now()): boolean {
  const u = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u) return false;
  const was = seatStats(u, now);
  getDb().update(schema.users).set({ seatResetAt: now }).where(eq(schema.users.id, userId)).run();
  logAudit({ adminId, action: 'seat_clear', target: { id: u.id, name: u.name, email: u.email }, detail: `событий за 7 дней ${was.events7}, предупреждений ${was.warns}, пауз ${was.pauses}` }, now);
  return true;
}

export const whenText = (ts: number, tz: string, lang: Lang) => new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts));

export function seatPauseText(u: Pick<User, 'disabled' | 'blockReason' | 'blockedBy' | 'blockedAt' | 'timezone'>, lang: Lang): string | null {
  if (!u.disabled || u.blockReason !== SEAT_REASON) return null;
  if (u.blockedBy === SYSTEM_SEAT24 && u.blockedAt) return withSupport(lang, tr(lang, 'seat.pause24', { when: whenText(u.blockedAt + DAY, tzOf(u), lang) }));
  return withSupport(lang, tr(lang, 'seat.pause'));
}
