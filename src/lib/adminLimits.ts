import { sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { User } from './db/schema';
import { cfg } from './cfg';
import { getModels } from './models';
import { seatConf } from './seat';
import { ORG_DAY_LIMIT } from './orgIngest';
import { rateFor } from './blocks/cbr';
import { CARD, tzOf, weekHard, weekLimit, weekMode, weekRange, weekState, weekUsed, type WeekMode } from './week';

export type Price = { amount: number; cur: 'USD' | 'RUB' };
export function parsePrices(s: string): Price[] {
  const out: Price[] = [];
  for (const p of s.split(',')) {
    const m = p.trim().match(/^(\d+(?:[.]\d+)?)\s*(USD|RUB)$/i);
    if (m) out.push({ amount: Number(m[1]), cur: m[2].toUpperCase() as Price['cur'] });
  }
  return out;
}

export const cardUsd = (s: number) => s / CARD.usd;

export type Lane = { id: string; name: string; claude: boolean; turns: number; cardS: number; usd: number };
export function lanesOf(userId: string, from: number, to: number): Lane[] {
  const rows = getDb().all<{ m: string; n: number; s: number | null; c: number | null }>(sql`
    select j.model_id m, count(*) n,
      sum(coalesce(j.card_s, case when coalesce(j.cost_usd, 0) > 0 then j.cost_usd * ${CARD.usd}
        else max(0, coalesce(j.prompt_tokens, 0) - coalesce(j.cache_read_tokens, 0)) * ${CARD.cold} + coalesce(j.cache_read_tokens, 0) * ${CARD.cache} + coalesce(j.completion_tokens, 0) * ${CARD.out} end)) s,
      sum(case when coalesce(j.cost_usd, 0) > 0 then j.cost_usd else 0 end) c
    from jobs j left join messages m on m.id = j.user_message_id
    where j.user_id = ${userId} and j.kind = 'chat' and j.status in ('done', 'error', 'cancelled') and j.created_at >= ${from} and j.created_at < ${to}
      and (m.id is null or json_extract(m.meta, '$.from') is null)
    group by j.model_id`);
  const names = new Map(getModels().map((m) => [m.id, m.name]));
  return rows.map((r) => {
    const cardS = Math.round(Number(r.s ?? 0)), c = Number(r.c ?? 0);
    return { id: r.m, name: names.get(r.m) ?? r.m, claude: c > 0, turns: Number(r.n), cardS, usd: c > 0 ? c : cardUsd(cardS) };
  }).sort((a, b) => b.cardS - a.cardS);
}

export type PersonWeek = { id: string; name: string; role: string; limited: boolean; mult: number; used: number; soft: number; hard: number; usd: number };
export type AdminLimits = {
  mode: WeekMode; soft: number; hard: number; used: number; resetAt: number; tz: string;
  lanes: Lane[]; usd: number; hourUsd: number;
  rate: { value: number; date: string; stale: boolean } | null;
  prices: Price[];
  seat: ReturnType<typeof seatConf>;
  orgDay: number;
  people: PersonWeek[]; idle: number;
  view: 'admin' | 'alpha';
};

function personWeek(u: User, now: number): PersonWeek {
  const s = weekState(u, now), w = weekRange(now, tzOf(u));
  const used = s.limited ? s.used : weekUsed(u.id, Math.max(w.start, u.weekResetAt ?? 0), w.end);
  return { id: u.id, name: u.name, role: u.role, limited: s.limited, mult: u.weekMult, used,
    soft: s.limited ? s.limit : weekLimit(), hard: s.limited ? s.hard : weekHard(), usd: cardUsd(used) };
}

export async function adminLimits(me: User, now = Date.now()): Promise<AdminLimits> {
  const tz = tzOf(me), w = weekRange(now, tz);
  const from = Math.max(w.start, me.weekResetAt ?? 0);
  const lanes = lanesOf(me.id, from, w.end);
  const used = weekUsed(me.id, from, w.end);
  const prices = parsePrices(cfg('KX_ADMIN_PRICES'));
  let rate: AdminLimits['rate'] = null;
  if (prices.some((p) => p.cur === 'RUB')) {
    const r = await rateFor('USD', null, null, { now }).catch(() => null);
    if (r && r.value && r.date) rate = { value: Number(r.value), date: r.date, stale: r.state === 'stale' };
  }
  const all = getDb().select().from(schema.users).all().filter((u) => !u.disabled);
  const people = all.map((u) => personWeek(u, now)).filter((p) => p.used > 0).sort((a, b) => b.used - a.used);
  return {
    mode: weekMode(), soft: weekLimit(), hard: weekHard(), used, resetAt: w.end, tz,
    lanes, usd: lanes.reduce((a, l) => a + l.usd, 0), hourUsd: cardUsd(3600), rate, prices, seat: seatConf(), orgDay: ORG_DAY_LIMIT,
    people, idle: all.length - people.length, view: 'admin',
  };
}

export function alphaLimits(me: User, now = Date.now()): AdminLimits {
  const w = weekRange(now, tzOf(me));
  const used = weekUsed(me.id, Math.max(w.start, me.weekResetAt ?? 0), w.end);
  return { mode: weekMode(), soft: weekLimit(), hard: weekHard(), used, resetAt: w.end, tz: tzOf(me), lanes: [], usd: 0, hourUsd: 0, rate: null, prices: [],
    seat: { on: false, roles: [], switches: 0, concurrent: 0, windowMin: 0 }, orgDay: 0, people: [], idle: 0, view: 'alpha' };
}
