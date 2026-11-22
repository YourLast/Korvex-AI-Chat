import { effectiveWeekMult } from './inviteFlags';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import type { User } from './db/schema';
import { cleanTz } from './tz';

export type WeekMode = 'soft' | 'hard' | 'off';
export const weekMode = (): WeekMode => { const v = (process.env.KX_WEEK_MODE ?? 'soft').trim().toLowerCase(); return v === 'hard' || v === 'off' ? v : 'soft'; };
const posInt = (name: string, def: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? Math.round(v) : def; };
export const weekLimit = () => posInt('KX_WEEK_LIMIT', 54_000);
export const weekHard = () => Math.max(weekLimit(), posInt('KX_WEEK_HARD', 108_000));
export const WEEK_DEFAULT_TZ = 'Europe/Moscow';

const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const fmts = new Map<string, Intl.DateTimeFormat>();
function parts(ts: number, tz: string) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' })));
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday] ?? 0 };
}
function offsetAt(ts: number, tz: string): number {
  const p = parts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}
export function localMidnight(y: number, m: number, d: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - offsetAt(wall, tz);
  t = wall - offsetAt(t, tz);
  return t;
}
export const dayOf = (ts: number, tz: string): string => { const p = parts(ts, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
export const tzOf = (u: Pick<User, 'timezone'>): string => cleanTz(u.timezone) ?? WEEK_DEFAULT_TZ;

export function weekRange(now: number, tz: string): { start: number; end: number; key: string } {
  const p = parts(now, tz);
  const back = p.wd;
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d - back + 7));
  const start = localMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), tz);
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { start, end, key: `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}` };
}

export const CARD = { cold: 1.044 / 1000, cache: 0.1 / 1000, out: 3.448 / 1000, usd: 1 / 0.000106, browserAction: 1 } as const;
export type CardIn = { promptTokens?: number | null; completionTokens?: number | null; cacheReadTokens?: number | null; costUsd?: number | null; browserActions?: number };
export function cardSeconds(j: CardIn): number {
  const n = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  const cache = n(j.cacheReadTokens), cold = Math.max(0, n(j.promptTokens) - cache);
  const llm = n(j.costUsd) > 0 ? n(j.costUsd) * CARD.usd : cold * CARD.cold + cache * CARD.cache + n(j.completionTokens) * CARD.out;
  return llm + n(j.browserActions) * CARD.browserAction;
}

export function weekUsed(userId: string, from: number, to: number): number {
  const r = getDb().get<{ n: number | null }>(sql`
    select sum(coalesce(j.card_s, case when coalesce(j.cost_usd, 0) > 0 then j.cost_usd * ${CARD.usd}
      else max(0, coalesce(j.prompt_tokens, 0) - coalesce(j.cache_read_tokens, 0)) * ${CARD.cold} + coalesce(j.cache_read_tokens, 0) * ${CARD.cache} + coalesce(j.completion_tokens, 0) * ${CARD.out} end)) n
    from jobs j left join messages m on m.id = j.user_message_id
    where j.user_id = ${userId} and j.kind = 'chat' and j.status in ('done', 'error', 'cancelled') and j.created_at >= ${from} and j.created_at < ${to}
      and (m.id is null or json_extract(m.meta, '$.from') is null)`);
  return Math.round(Number(r?.n ?? 0));
}

export type WeekPhase = 'ok' | 'warn' | 'over' | 'blocked';
export type WeekState = {
  mode: WeekMode;
  limited: boolean;
  used: number; limit: number; hard: number; pct: number;
  phase: WeekPhase;
  resetAt: number; key: string;
};

export function weekState(u: Pick<User, 'id' | 'role' | 'timezone' | 'weekMult' | 'weekResetAt'>, now = Date.now()): WeekState {
  const mode = weekMode();
  const tz = tzOf(u);
  const w = weekRange(now, tz);
  const mult = effectiveWeekMult(u);
  const limited = mode !== 'off' && u.role !== 'admin' && mult > 0;
  const limit = Math.max(1, Math.round(weekLimit() * (mult || 1))), hard = Math.max(limit, Math.round(weekHard() * (mult || 1)));
  if (!limited) return { mode, limited, used: 0, limit, hard, pct: 0, phase: 'ok', resetAt: w.end, key: w.key };
  const used = weekUsed(u.id, Math.max(w.start, u.weekResetAt ?? 0), w.end);
  const pct = Math.floor((used / limit) * 100);
  const stop = mode === 'hard' ? limit : hard;
  const phase: WeekPhase = used >= stop ? 'blocked' : used >= limit ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return { mode, limited, used, limit, hard, pct, phase, resetAt: w.end, key: w.key };
}

export function resetDay(ts: number, tz: string, locale: string): string {
  try { return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: tz }); } catch { return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long' }); }
}

export type WeekView = { limited: boolean; pct: number; phase: WeekPhase; resetAt: number; tz: string; hours?: number; hard?: boolean };
export function weekView(u: Pick<User, 'id' | 'role' | 'timezone' | 'weekMult' | 'weekResetAt'>, now = Date.now()): WeekView {
  const s = weekState(u, now), tz = tzOf(u);
  if (s.limited) return { limited: true, pct: s.pct, phase: s.phase, resetAt: s.resetAt, tz, ...(s.mode === 'hard' ? { hard: true, hours: Math.round(s.limit / 3600) } : {}) };
  const w = weekRange(now, tz);
  const used = weekUsed(u.id, Math.max(w.start, u.weekResetAt ?? 0), w.end);
  return { limited: false, pct: Math.floor((used / weekLimit()) * 100), phase: 'ok', resetAt: w.end, tz };
}
