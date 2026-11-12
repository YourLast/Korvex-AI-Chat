import { sql } from 'drizzle-orm';
import { getDb } from './db';

export type ModelRow = {
  modelId: string; levelId: string; answers: number; promptTokens: number; completionTokens: number;
  medianMs: number | null; p90Ms: number | null; errors: number; up: number; down: number;
};
export type Bucket = { t: number; answers: number; errors: number; tokens: number };
export type DownItem = {
  id: string; messageId: string; threadId: string | null; threadTitle: string | null; userName: string; modelId: string | null; levelId: string | null; reasons: string[]; comment: string;
  at: number; durationMs: number | null; exists: boolean;
};
export type PairRow = {
  a: { modelId: string; levelId: string }; b: { modelId: string; levelId: string };
  votes: number; aWins: number; bWins: number; ties: number; bad: number; medianA: number | null; medianB: number | null;
};
export type RunItem = { id: string; name: string; status: string; trigger: string; startedAt: number; durationMs: number | null; error: string | null };
export type Analytics = {
  days: number; since: number; now: number; tz: string; bucket: 'hour' | 'day';
  users: { total: number; active: number; added: number };
  chats: number;
  messages: { user: number; assistant: number };
  tokens: { prompt: number; completion: number };
  latency: { medianMs: number | null; p90Ms: number | null; n: number };
  errors: number; stopped: number;
  ratings: { up: number; down: number };
  byModel: ModelRow[];
  compare: { questions: number; votes: number; pairs: PairRow[] };
  series: Bucket[];
  downFeed: DownItem[];
  automations: { runs: number; ok: number; error: number; running: number; manual: number; schedule: number; recent: RunItem[] };
  api: { requests: number; errors: number; promptTokens: number; completionTokens: number; keys: { keyId: string; name: string; owner: string; requests: number; errors: number; promptTokens: number; completionTokens: number; medianMs: number | null }[] };
  claude: ClaudeStats;
};
export type ClaudeRow = { modelId: string; answers: number; requests: number; input: number; cacheRead: number; cacheWrite: number; output: number; usd: number; cacheShare: number | null };
export type ClaudeStats = { rows: ClaudeRow[]; total: ClaudeRow | null; byKey: { n: number; usd: number }[] };

export function claudeStats(since: number): ClaudeStats {
  type R = { model: string | null; pt: number | null; cr: number | null; cw: number | null; ct: number | null; usd: number | null; req: number | null; keys: string | null };
  const rows = getDb().all<R>(sql`select coalesce(json_extract(m.meta, '$.modelId'), t.model_id) model, json_extract(m.meta, '$.usage.prompt_tokens') pt,
      json_extract(m.meta, '$.usage.prompt_tokens_details.cached_tokens') cr, json_extract(m.meta, '$.usage.cache_write_tokens') cw, json_extract(m.meta, '$.usage.completion_tokens') ct,
      json_extract(m.meta, '$.usage.cost_usd') usd, json_extract(m.meta, '$.usage.claude.requests') req, json_extract(m.meta, '$.usage.claude.usd_by_key') keys
    from messages m join threads t on t.id = m.thread_id where m.role = 'assistant' and m.created_at >= ${since} and json_extract(m.meta, '$.usage.claude') is not null`);
  const by = new Map<string, ClaudeRow>();
  const keys = new Map<number, number>();
  const blank = (modelId: string): ClaudeRow => ({ modelId, answers: 0, requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, usd: 0, cacheShare: null });
  const total = blank('*');
  for (const r of rows) {
    const x = by.get(r.model ?? '?') ?? blank(r.model ?? '?');
    by.set(x.modelId, x);
    for (const y of [x, total]) { y.answers++; y.requests += n(r.req); y.input += n(r.pt); y.cacheRead += n(r.cr); y.cacheWrite += n(r.cw); y.output += n(r.ct); y.usd += n(r.usd); }
    try { for (const [k, v] of Object.entries(JSON.parse(r.keys ?? '{}') as Record<string, number>)) keys.set(Number(k), (keys.get(Number(k)) ?? 0) + n(v)); } catch {  }
  }
  const fin = (y: ClaudeRow) => ({ ...y, usd: Math.round(y.usd * 1e4) / 1e4, cacheShare: y.input ? y.cacheRead / y.input : null });
  return { rows: [...by.values()].map(fin).sort((a, b) => b.usd - a.usd), total: total.answers ? fin(total) : null, byKey: [...keys.entries()].sort((a, b) => a[0] - b[0]).map(([k, usd]) => ({ n: k, usd: Math.round(usd * 1e4) / 1e4 })) };
}

export const PERIODS = [1, 7, 30] as const;

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

export function tzOffset(ts: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ts)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

export function buckets(days: number, now: number, tz: string): { starts: number[]; kind: 'hour' | 'day' } {
  if (days <= 1) {
    const h = Math.floor(now / 3_600_000) * 3_600_000;
    return { starts: Array.from({ length: 24 }, (_, i) => h - (23 - i) * 3_600_000), kind: 'hour' };
  }
  const starts: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 864e5;
    const off = tzOffset(ts, tz);
    const local = ts + off;
    const mid = local - (((local % 864e5) + 864e5) % 864e5);
    starts.push(mid - tzOffset(mid - off, tz));
  }
  return { starts, kind: 'day' };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export function analytics(daysIn: number, tz = 'Europe/Moscow', now = Date.now()): Analytics {
  const days = (PERIODS as readonly number[]).includes(daysIn) ? daysIn : 7;
  const since = now - days * 864e5;
  const db = getDb();
  const one = <T,>(q: ReturnType<typeof sql>) => db.get<T>(q);
  const all = <T,>(q: ReturnType<typeof sql>) => db.all<T>(q);

  const total = n(one<{ c: number }>(sql`select count(*) c from users`)?.c);
  const added = n(one<{ c: number }>(sql`select count(*) c from users where created_at >= ${since}`)?.c);
  const active = n(one<{ c: number }>(sql`select count(distinct t.user_id) c from messages m join threads t on t.id = m.thread_id
    where m.role = 'user' and m.created_at >= ${since} and json_extract(m.meta, '$.auto') is null`)?.c);
  const chats = n(one<{ c: number }>(sql`select count(distinct coalesce(group_id, id)) c from threads where created_at >= ${since}`)?.c);
  const userMsgs = n(one<{ c: number }>(sql`select count(*) c from messages where role = 'user' and created_at >= ${since}`)?.c);

  type A = { model: string | null; level: string | null; created: number; dur: number | null; pt: number | null; ct: number | null; err: string | null; stopped: number | null; status: string | null };
  const answers: A[] = all<A>(sql`select coalesce(json_extract(m.meta, '$.modelId'), t.model_id) model, json_extract(m.meta, '$.levelId') level, m.created_at created,
      json_extract(m.meta, '$.durationMs') dur, json_extract(m.meta, '$.usage.prompt_tokens') pt, json_extract(m.meta, '$.usage.completion_tokens') ct,
      json_extract(m.meta, '$.error') err, json_extract(m.meta, '$.stopped') stopped, json_extract(m.meta, '$.status') status
    from messages m join threads t on t.id = m.thread_id where m.role = 'assistant' and m.created_at >= ${since}`);
  type AJ = { model: string; level: string; created: number; dur: number | null; pt: number | null; ct: number | null; err: string | null; status: string; key: string | null; kname: string | null; owner: string | null };
  const apiJobs = all<AJ>(sql`select j.model_id model, j.level_id level, j.created_at created, j.duration_ms dur, j.prompt_tokens pt, j.completion_tokens ct, j.error err, j.status status,
      j.api_key_id key, k.name kname, u.name owner from jobs j left join api_keys k on k.id = j.api_key_id left join users u on u.id = j.user_id
    where j.kind = 'api' and j.created_at >= ${since} and j.status in ('done', 'error', 'cancelled')`);
  for (const j of apiJobs) answers.push({ model: j.model, level: j.level, created: j.created, dur: j.dur, pt: j.pt, ct: j.ct, err: j.status === 'error' ? j.err ?? 'error' : null, stopped: j.status === 'cancelled' ? 1 : 0, status: j.status });
  const done = answers.filter((a) => a.status !== 'queued' && a.status !== 'running');

  type R = { model: string | null; level: string | null; value: number; c: number };
  const rates = all<R>(sql`select model_id model, level_id level, value, count(*) c from ratings where updated_at >= ${since} group by model_id, level_id, value`);

  const key = (m: string | null, l: string | null) => `${m ?? '?'}\u0000${l ?? '?'}`;
  const rows = new Map<string, ModelRow & { durs: number[] }>();
  const row = (m: string | null, l: string | null) => {
    const k = key(m, l);
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { modelId: m ?? '?', levelId: l ?? '?', answers: 0, promptTokens: 0, completionTokens: 0, medianMs: null, p90Ms: null, errors: 0, up: 0, down: 0, durs: [] }));
    return r;
  };
  const allDurs: number[] = [];
  let errors = 0, stopped = 0, pt = 0, ct = 0;
  for (const a of done) {
    const r = row(a.model, a.level);
    r.answers++;
    r.promptTokens += n(a.pt); r.completionTokens += n(a.ct);
    pt += n(a.pt); ct += n(a.ct);
    if (a.err) { r.errors++; errors++; }
    if (a.stopped) stopped++;
    if (!a.err && a.dur != null && n(a.dur) > 0) { r.durs.push(n(a.dur)); allDurs.push(n(a.dur)); }
  }
  let up = 0, down = 0;
  for (const x of rates) {
    const r = row(x.model, x.level);
    if (x.value > 0) { r.up += n(x.c); up += n(x.c); } else { r.down += n(x.c); down += n(x.c); }
  }
  const byModel: ModelRow[] = [...rows.values()].map(({ durs, ...r }) => {
    durs.sort((a, b) => a - b);
    return { ...r, medianMs: quantile(durs, 0.5), p90Ms: quantile(durs, 0.9) };
  }).sort((a, b) => a.modelId.localeCompare(b.modelId) || a.levelId.localeCompare(b.levelId));
  allDurs.sort((a, b) => a - b);

  const { starts, kind } = buckets(days, now, tz);
  const series: Bucket[] = starts.map((t) => ({ t, answers: 0, errors: 0, tokens: 0 }));
  for (const a of done) {
    let i = starts.length - 1;
    while (i > 0 && a.created < starts[i]) i--;
    if (a.created < starts[0]) continue;
    series[i].answers++;
    if (a.err) series[i].errors++;
    series[i].tokens += n(a.pt) + n(a.ct);
  }

  const qIn = n(one<{ c: number }>(sql`select count(*) c from messages where role = 'assistant' and created_at >= ${since} and json_extract(meta, '$.lane') = 'a'`)?.c);
  const qOld = n(one<{ c: number }>(sql`select count(*) c from messages m join threads t on t.id = m.thread_id where m.role = 'user' and m.created_at >= ${since} and t.side = 'a'`)?.c);
  type V = { ma: string | null; la: string | null; mb: string | null; lb: string | null; w: string; da: number | null; db: number | null };
  const vs = all<V>(sql`select model_a ma, level_a la, model_b mb, level_b lb, winner w, duration_a da, duration_b db from compare_votes where updated_at >= ${since}`);
  const pairMap = new Map<string, PairRow & { da: number[]; db: number[] }>();
  for (const v of vs) {
    const ka = `${v.ma ?? '?'}\u0000${v.la ?? '?'}`, kb = `${v.mb ?? '?'}\u0000${v.lb ?? '?'}`;
    const flip = ka > kb;
    const A = flip ? { m: v.mb, l: v.lb, d: v.db } : { m: v.ma, l: v.la, d: v.da }, Bs = flip ? { m: v.ma, l: v.la, d: v.da } : { m: v.mb, l: v.lb, d: v.db };
    const w = flip ? (v.w === 'a' ? 'b' : v.w === 'b' ? 'a' : v.w) : v.w;
    const k = flip ? `${kb}|${ka}` : `${ka}|${kb}`;
    let r = pairMap.get(k);
    if (!r) pairMap.set(k, (r = { a: { modelId: A.m ?? '?', levelId: A.l ?? '?' }, b: { modelId: Bs.m ?? '?', levelId: Bs.l ?? '?' }, votes: 0, aWins: 0, bWins: 0, ties: 0, bad: 0, medianA: null, medianB: null, da: [], db: [] }));
    r.votes++;
    if (w === 'a') r.aWins++; else if (w === 'b') r.bWins++; else if (w === 'tie') r.ties++; else r.bad++;
    if (A.d) r.da.push(n(A.d)); if (Bs.d) r.db.push(n(Bs.d));
  }
  const pairRows: PairRow[] = [...pairMap.values()].map(({ da, db: dbb, ...r }) => {
    da.sort((x, y) => x - y); dbb.sort((x, y) => x - y);
    return { ...r, medianA: quantile(da, 0.5), medianB: quantile(dbb, 0.5) };
  }).sort((x, y) => y.votes - x.votes);

  type D = { id: string; mid: string; tid: string | null; ttitle: string | null; uname: string | null; model: string | null; level: string | null; reasons: string | null; comment: string | null; at: number; dur: number | null; ex: string | null };
  const downFeed: DownItem[] = all<D>(sql`select r.id id, r.message_id mid, u.name uname, r.model_id model, r.level_id level, r.reasons reasons, r.comment comment, r.updated_at at,
      r.duration_ms dur, m.id ex, t.id tid, t.title ttitle from ratings r left join users u on u.id = r.user_id left join messages m on m.id = r.message_id
      left join threads t on t.id = m.thread_id
    where r.value < 0 and r.updated_at >= ${since} order by r.updated_at desc limit 30`).map((d) => {
    let reasons: string[] = [];
    try { reasons = d.reasons ? (JSON.parse(d.reasons) as string[]) : []; } catch { reasons = []; }
    return { id: d.id, messageId: d.mid, threadId: d.tid, threadTitle: d.ttitle, userName: d.uname ?? '—', modelId: d.model, levelId: d.level, reasons, comment: d.comment ?? '', at: d.at, durationMs: d.dur, exists: !!d.ex };
  });

  type AR = { status: string; trigger: string; c: number };
  const ar = all<AR>(sql`select status, trigger, count(*) c from automation_runs where started_at >= ${since} group by status, trigger`);
  const auto = { runs: 0, ok: 0, error: 0, running: 0, manual: 0, schedule: 0 };
  for (const x of ar) {
    const c = n(x.c);
    auto.runs += c;
    if (x.status === 'ok') auto.ok += c; else if (x.status === 'error') auto.error += c; else auto.running += c;
    if (x.trigger === 'manual') auto.manual += c; else auto.schedule += c;
  }
  type RR = { id: string; name: string | null; status: string; trigger: string; started: number; dur: number | null; error: string | null };
  const recent: RunItem[] = all<RR>(sql`select r.id id, a.name name, r.status status, r.trigger trigger, r.started_at started, r.duration_ms dur, r.error error
    from automation_runs r left join automations a on a.id = r.automation_id where r.started_at >= ${since} order by r.started_at desc limit 12`)
    .map((r) => ({ id: r.id, name: r.name ?? '—', status: r.status, trigger: r.trigger, startedAt: r.started, durationMs: r.dur, error: r.error }));

  const keyMap = new Map<string, Analytics['api']['keys'][number] & { durs: number[] }>();
  for (const j of apiJobs) {
    const k = j.key ?? '?';
    let r = keyMap.get(k);
    if (!r) keyMap.set(k, (r = { keyId: k, name: j.kname ?? '—', owner: j.owner ?? '—', requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, medianMs: null, durs: [] }));
    r.requests++; if (j.status === 'error') r.errors++;
    r.promptTokens += n(j.pt); r.completionTokens += n(j.ct);
    if (j.status === 'done' && j.dur) r.durs.push(n(j.dur));
  }
  const apiKeysRows = [...keyMap.values()].map(({ durs, ...r }) => { durs.sort((x, y) => x - y); return { ...r, medianMs: quantile(durs, 0.5) }; }).sort((x, y) => y.requests - x.requests);
  const api = { requests: apiJobs.length, errors: apiJobs.filter((j) => j.status === 'error').length, promptTokens: apiJobs.reduce((s2, j) => s2 + n(j.pt), 0), completionTokens: apiJobs.reduce((s2, j) => s2 + n(j.ct), 0), keys: apiKeysRows };

  return {
    days, since, now, tz, bucket: kind, api, claude: claudeStats(since),
    users: { total, active, added },
    chats,
    messages: { user: userMsgs, assistant: done.length },
    tokens: { prompt: pt, completion: ct },
    latency: { medianMs: quantile(allDurs, 0.5), p90Ms: quantile(allDurs, 0.9), n: allDurs.length },
    errors, stopped,
    ratings: { up, down },
    byModel, series, downFeed,
    compare: { questions: qIn + qOld, votes: vs.length, pairs: pairRows },
    automations: { ...auto, recent },
  };
}
