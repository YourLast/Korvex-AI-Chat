import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { tzOffset } from './analytics';
import { presenceOf, subscribers } from './bus';

export const COST_PER_M = { input: 0.083, cached: 0.008, output: 0.274 } as const;
export const costOf = (t: { input: number; cached: number; output: number }) => (t.input * COST_PER_M.input + t.cached * COST_PER_M.cached + t.output * COST_PER_M.output) / 1e6;

export type Tokens = { input: number; cached: number; output: number; reasoning: number };
export type PersonStats = {
  id: string; name: string; email: string; role: string; registeredAt: number; gone: boolean; disabled: boolean; blockKind: string; lastAt: number | null; online: boolean; active: boolean;
  messages: number; chats: number; answers: number; tokens: Tokens; costUsd: number; apiRequests: number; errors: number; stopped: number; up: number; down: number;
  levels: Record<string, number>;
  claudeUsd: number;
};
export type Point = { t: number; v: number };
export type InviteStatus = 'active' | 'used_up' | 'expired' | 'revoked';
export type InviteStats = {
  now: number; tz: string;
  invite: { id: string; note: string; role: string; group: boolean; createdAt: number; createdBy: string; expiresAt: number; status: InviteStatus; revokedAt: number | null; maxUses: number; uses: number; left: number };
  people: PersonStats[];
  totals: { people: number; messages: number; chats: number; answers: number; tokens: Tokens; costUsd: number; claudeUsd: number; apiRequests: number; errors: number; stopped: number; up: number; down: number; noCacheInfo: number; withUsage: number };
  levels: { model: string; level: string; n: number }[];
  series: {
    regs: { kind: 'hour' | 'day'; points: Point[] };
    messages: { points: Point[] };
    active: { points: Point[] };
  };
  online: { now: number; visible: number; generating: number; peak: number; peakAt: number | null };
  prices: typeof COST_PER_M;
  gaps: string[];
};

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const HOUR = 3_600_000, DAY = 864e5;

export function dayStart(ts: number, tz: string): number {
  const off = tzOffset(ts, tz);
  const local = ts + off;
  const mid = local - (((local % DAY) + DAY) % DAY);
  return mid - tzOffset(mid - off, tz);
}

export function bucketStarts(kind: 'hour' | 'day', count: number, ts: number, tz: string): number[] {
  if (kind === 'hour') { const h = Math.floor(ts / HOUR) * HOUR; return Array.from({ length: count }, (_, i) => h - (count - 1 - i) * HOUR); }
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(dayStart(ts - i * DAY, tz));
  return out;
}

export function fillBuckets(starts: number[], times: { t: number; v?: number }[], end: number): Point[] {
  const pts = starts.map((t) => ({ t, v: 0 }));
  for (const x of times) {
    if (x.t < starts[0] || x.t >= end) continue;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x.t) lo = mid; else hi = mid - 1; }
    pts[lo].v += x.v ?? 1;
  }
  return pts;
}

export function peakOverlap(spans: { from: number; to: number }[]): { peak: number; at: number | null } {
  const ev: [number, number][] = [];
  for (const s of spans) if (s.to > s.from) { ev.push([s.from, 1]); ev.push([s.to, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0, at: number | null = null;
  for (const [t, d] of ev) { cur += d; if (cur > peak) { peak = cur; at = t; } }
  return { peak, at };
}

const emptyTok = (): Tokens => ({ input: 0, cached: 0, output: 0, reasoning: 0 });

export function inviteStats(id: string, tz = 'Europe/Moscow', now = Date.now()): InviteStats | null {
  const db = getDb();
  const inv = db.get<{ id: string; role: string; note: string; created_by: string; expires_at: number; revoked_at: number | null; max_uses: number; uses: number; created_at: number; creator: string | null }>(
    sql`select i.id, i.role, i.note, i.created_by, i.expires_at, i.revoked_at, i.max_uses, i.uses, i.created_at, u.name creator from invites i left join users u on u.id = i.created_by where i.id = ${id}`);
  if (!inv) return null;
  const status: InviteStatus = inv.revoked_at ? 'revoked' : inv.uses >= inv.max_uses ? 'used_up' : inv.expires_at <= now ? 'expired' : 'active';

  const reg = db.all<{ user_id: string; name: string; created_at: number }>(sql`select user_id, name, created_at from invite_uses where invite_id = ${id} order by created_at`);
  const ids = reg.map((r) => r.user_id);
  const inIds = ids.length ? sql.join(ids.map((x) => sql`${x}`), sql`, `) : sql`''`;
  const users = ids.length ? db.all<{ id: string; name: string; email: string; role: string; disabled: number; block_kind: string }>(sql`select id, name, email, role, disabled, block_kind from users where id in (${inIds})`) : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  const per = new Map<string, PersonStats>();
  for (const r of reg) {
    const u = uMap.get(r.user_id);
    per.set(r.user_id, { id: r.user_id, name: u?.name || r.name, email: u?.email ?? '', role: u?.role ?? 'user', registeredAt: r.created_at, gone: !u, disabled: !!u?.disabled, blockKind: u?.disabled ? (u.block_kind || 'pause') : '', lastAt: null, online: false, active: false,
      messages: 0, chats: 0, answers: 0, tokens: emptyTok(), costUsd: 0, apiRequests: 0, errors: 0, stopped: 0, up: 0, down: 0, levels: {}, claudeUsd: 0 });
  }
  const P = (uid: string) => per.get(uid);
  const lastOf = (uid: string, t: number | null | undefined) => { const p = P(uid); if (p && t && (!p.lastAt || t > p.lastAt)) p.lastAt = t; };

  let withUsage = 0, noCacheInfo = 0;
  const userTimes: { t: number; uid: string }[] = [];
  const spans: { from: number; to: number }[] = [];
  const levelAgg = new Map<string, { model: string; level: string; n: number }>();

  if (ids.length) {
    for (const r of db.all<{ uid: string; c: number }>(sql`select t.user_id uid, count(*) c from messages m join threads t on t.id = m.thread_id
        where t.user_id in (${inIds}) and m.role = 'user' and json_extract(m.meta, '$.auto') is null group by t.user_id`)) { const p = P(r.uid); if (p) p.messages = n(r.c); }
    for (const r of db.all<{ uid: string; c: number }>(sql`select user_id uid, count(distinct coalesce(group_id, id)) c from threads where user_id in (${inIds}) group by user_id`)) { const p = P(r.uid); if (p) p.chats = n(r.c); }
    for (const r of db.all<{ uid: string; t: number }>(sql`select t.user_id uid, m.created_at t from messages m join threads t on t.id = m.thread_id
        where t.user_id in (${inIds}) and m.role = 'user' and json_extract(m.meta, '$.auto') is null`)) { userTimes.push({ t: n(r.t), uid: r.uid }); lastOf(r.uid, n(r.t)); }

    type A = { uid: string; model: string | null; level: string | null; pt: number | null; ct: number | null; cached: number | null; reasoning: number | null; err: string | null; stopped: number | null; at: number; status: string | null; usd: number | null; cm: string | null };
    for (const a of db.all<A>(sql`select t.user_id uid, coalesce(json_extract(m.meta, '$.modelId'), t.model_id) model, json_extract(m.meta, '$.levelId') level,
        json_extract(m.meta, '$.usage.prompt_tokens') pt, json_extract(m.meta, '$.usage.completion_tokens') ct,
        json_extract(m.meta, '$.usage.prompt_tokens_details.cached_tokens') cached, json_extract(m.meta, '$.usage.completion_tokens_details.reasoning_tokens') reasoning,
        json_extract(m.meta, '$.error') err, json_extract(m.meta, '$.stopped') stopped, m.created_at at, json_extract(m.meta, '$.status') status,
        json_extract(m.meta, '$.usage.cost_usd') usd, json_extract(m.meta, '$.usage.claude.model') cm
      from messages m join threads t on t.id = m.thread_id where t.user_id in (${inIds}) and m.role = 'assistant'`)) {
      const p = P(a.uid);
      if (!p || a.status === 'queued' || a.status === 'running') continue;
      p.answers++; lastOf(a.uid, n(a.at));
      if (a.err) p.errors++;
      if (a.stopped) p.stopped++;
      if (a.cm) { withUsage++; p.claudeUsd += n(a.usd); }
      else if (a.pt != null || a.ct != null) {
        withUsage++;
        const prompt = n(a.pt), cached = a.cached == null ? 0 : Math.min(n(a.cached), prompt);
        if (a.cached == null) noCacheInfo++;
        p.tokens.input += prompt - cached; p.tokens.cached += cached; p.tokens.output += n(a.ct); p.tokens.reasoning += n(a.reasoning);
      }
      if (a.level) {
        const k = `${a.model ?? '?'}\u0000${a.level}`;
        p.levels[k] = (p.levels[k] ?? 0) + 1;
        const x = levelAgg.get(k); if (x) x.n++; else levelAgg.set(k, { model: a.model ?? '?', level: a.level, n: 1 });
      }
    }
    type J = { uid: string; kind: string; status: string; created: number; started: number | null; finished: number | null; pt: number | null; ct: number | null };
    for (const j of db.all<J>(sql`select user_id uid, kind, status, created_at created, started_at started, finished_at finished, prompt_tokens pt, completion_tokens ct from jobs where user_id in (${inIds})`)) {
      const p = P(j.uid); if (!p) continue;
      lastOf(j.uid, j.finished ?? j.started ?? j.created);
      if (j.kind === 'api') {
        p.apiRequests++;
        if (j.status === 'error') p.errors++;
        if (j.pt != null || j.ct != null) { withUsage++; noCacheInfo++; p.tokens.input += n(j.pt); p.tokens.output += n(j.ct); }
      } else if (j.kind === 'chat') spans.push({ from: j.started ?? j.created, to: j.finished ?? now });
    }
    for (const r of db.all<{ uid: string; up: number; down: number }>(sql`select user_id uid, coalesce(sum(value > 0), 0) up, coalesce(sum(value < 0), 0) down from ratings where user_id in (${inIds}) group by user_id`)) {
      const p = P(r.uid); if (p) { p.up = n(r.up); p.down = n(r.down); }
    }
    for (const r of db.all<{ uid: string; t: number }>(sql`select user_id uid, max(created_at) t from sessions where user_id in (${inIds}) group by user_id`)) lastOf(r.uid, n(r.t));
    for (const r of db.all<{ uid: string; t: number }>(sql`select user_id uid, max(last_active_at) t from push_subs where user_id in (${inIds}) group by user_id`)) lastOf(r.uid, n(r.t));
  }

  const runningNow = new Set(ids.length ? db.all<{ uid: string }>(sql`select distinct user_id uid from jobs where user_id in (${inIds}) and status in ('queued', 'running') and kind = 'chat'`).map((r) => r.uid) : []);
  let onlineN = 0, visibleN = 0;
  for (const p of per.values()) {
    p.online = subscribers(p.id) > 0;
    p.active = presenceOf(p.id).some((x) => x.visible);
    if (p.online) onlineN++;
    if (p.active) visibleN++;
  }
  const pk = peakOverlap(spans.map((s) => ({ from: s.from, to: s.to })));

  const people = [...per.values()].map((p) => ({ ...p, costUsd: costOf(p.tokens) + p.claudeUsd }));
  const sum = <T extends keyof Tokens>(k: T) => people.reduce((s, p) => s + p.tokens[k], 0);
  const tokens: Tokens = { input: sum('input'), cached: sum('cached'), output: sum('output'), reasoning: sum('reasoning') };
  const totals = {
    people: people.length, messages: people.reduce((s, p) => s + p.messages, 0), chats: people.reduce((s, p) => s + p.chats, 0), answers: people.reduce((s, p) => s + p.answers, 0), tokens,
    costUsd: costOf(tokens) + people.reduce((s, p) => s + p.claudeUsd, 0), claudeUsd: people.reduce((s, p) => s + p.claudeUsd, 0), apiRequests: people.reduce((s, p) => s + p.apiRequests, 0), errors: people.reduce((s, p) => s + p.errors, 0), stopped: people.reduce((s, p) => s + p.stopped, 0),
    up: people.reduce((s, p) => s + p.up, 0), down: people.reduce((s, p) => s + p.down, 0), noCacheInfo, withUsage,
  };

  const age = now - inv.created_at;
  const regKind: 'hour' | 'day' = age <= 3 * DAY ? 'hour' : 'day';
  const regCount = regKind === 'hour' ? Math.min(72, Math.max(6, Math.ceil(age / HOUR) + 1)) : Math.min(30, Math.max(7, Math.ceil(age / DAY) + 1));
  const regStarts = bucketStarts(regKind, regCount, now, tz);
  const regs = fillBuckets(regStarts, reg.map((r) => ({ t: r.created_at })), now + 1);
  const msgStarts = bucketStarts('hour', 48, now, tz);
  const messages = fillBuckets(msgStarts, userTimes, now + 1);
  const dayStarts = bucketStarts('day', 14, now, tz);
  const seen = new Map<number, Set<string>>();
  for (const x of userTimes) {
    if (x.t < dayStarts[0]) continue;
    let k = dayStarts[0];
    for (const s of dayStarts) if (s <= x.t) k = s; else break;
    let set = seen.get(k); if (!set) seen.set(k, (set = new Set())); set.add(x.uid);
  }
  const active = dayStarts.map((t) => ({ t, v: seen.get(t)?.size ?? 0 }));

  const gaps = [
    'Пик «одновременно» считается по ответам, которые шли у этих людей разом (история подключений не пишется); «сейчас на сайте» — живые соединения в эту минуту.',
    '«Был(а)» — последнее сообщение, вход или видимая вкладка с включёнными уведомлениями; просто заходы на страницу без действий не журналируются.',
    'Временные чаты стираются при закрытии — их сообщения и токены сюда не попадают; удалённые людьми чаты — тоже.',
  ];
  if (noCacheInfo > 0) gaps.push(`Кэш входа движок сообщил не для всех ответов (${noCacheInfo} из ${withUsage}, в том числе запросы API без разбивки): остальные учтены как «посчитанный» вход, поэтому стоимость может быть чуть завышена.`);
  if (totals.apiRequests > 0) gaps.push('Запросы API без чата учтены по записи задачи: только вход и выход.');

  return {
    now, tz,
    invite: { id: inv.id, note: inv.note, role: inv.role, group: inv.max_uses > 1, createdAt: inv.created_at, createdBy: inv.creator ?? '—', expiresAt: inv.expires_at, status, revokedAt: inv.revoked_at, maxUses: inv.max_uses, uses: inv.uses, left: Math.max(0, inv.max_uses - inv.uses) },
    people, totals, levels: [...levelAgg.values()].sort((a, b) => b.n - a.n),
    series: { regs: { kind: regKind, points: regs }, messages: { points: messages }, active: { points: active } },
    online: { now: onlineN, visible: visibleN, generating: runningNow.size, peak: pk.peak, peakAt: pk.at },
    prices: COST_PER_M, gaps,
  };
}
