import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';

let cur: { id: string; role: string; timezone?: string } | null = null;
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), currentUser: async () => cur }));

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, S: typeof import('@/lib/inviteStats');
let GET: typeof import('@/app/api/admin/invites/[id]/stats/route').GET;
const H = 3_600_000, D = 864e5;
const NOW = Date.UTC(2026, 10, 3, 12, 30, 0);

const ans = (id: string, thread: string, at: number, meta: Record<string, unknown>) =>
  db.insert(schema.messages).values({ id, threadId: thread, seq: Math.floor(Math.random() * 1e6), parentId: null, session: null, role: 'assistant', content: 'ответ', reasoning: null, reasoningMs: null, meta, createdAt: at }).run();
const ask = (id: string, thread: string, at: number, meta: Record<string, unknown> | null = null) =>
  db.insert(schema.messages).values({ id, threadId: thread, seq: Math.floor(Math.random() * 1e6), parentId: null, session: thread, role: 'user', content: 'вопрос', reasoning: null, reasoningMs: null, meta, createdAt: at }).run();
const job = (id: string, userId: string, o: { kind?: string; status?: string; created: number; started?: number; finished?: number; pt?: number; ct?: number; thread?: string | null }) =>
  db.insert(schema.jobs).values({ id, userId, threadId: o.thread ?? null, kind: o.kind ?? 'chat', mode: 'send', modelId: 'alpha', levelId: 'medium', status: o.status ?? 'done', createdAt: o.created, startedAt: o.started ?? o.created, finishedAt: o.finished ?? null, promptTokens: o.pt ?? null, completionTokens: o.ct ?? null }).run();

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  S = await import('@/lib/inviteStats');
  ({ GET } = await import('@/app/api/admin/invites/[id]/stats/route'));
  const u = (id: string, name: string, role: 'admin' | 'user' = 'user', created = NOW - 5 * D) => db.insert(schema.users).values({ id, email: `${id}@t.rs`, name, passwordHash: 'x', role, createdAt: created }).run();
  u('adm', 'Админ', 'admin'); u('a', 'Анна'); u('b', 'Борис'); u('c', 'Вера'); u('x', 'Посторонний');
  db.insert(schema.invites).values({ id: 'inv1', tokenHash: 'h1', role: 'user', note: 'Класс 9Б', createdBy: 'adm', expiresAt: NOW + 5 * D, maxUses: 5, uses: 4, createdAt: NOW - 2 * D - H }).run();
  db.insert(schema.inviteUses).values({ id: 'u1', inviteId: 'inv1', userId: 'a', name: 'Анна', createdAt: NOW - 2 * D }).run();
  db.insert(schema.inviteUses).values({ id: 'u2', inviteId: 'inv1', userId: 'b', name: 'Борис', createdAt: NOW - 3 * H }).run();
  db.insert(schema.inviteUses).values({ id: 'u3', inviteId: 'inv1', userId: 'c', name: 'Вера', createdAt: NOW - 20 * 60_000 }).run();
  db.insert(schema.inviteUses).values({ id: 'u4', inviteId: 'inv1', userId: 'gone', name: 'Ушедший', createdAt: NOW - 10 * H }).run();

  db.insert(schema.threads).values({ id: 'ta1', userId: 'a', title: 'Чат А1', modelId: 'alpha', effort: 'medium', createdAt: NOW - 2 * D, updatedAt: NOW - H }).run();
  db.insert(schema.threads).values({ id: 'ta2', userId: 'a', title: 'Чат А2', modelId: 'alpha', effort: 'high', createdAt: NOW - D, updatedAt: NOW - 2 * H }).run();
  db.insert(schema.threads).values({ id: 'tb1', userId: 'b', title: 'Чат Б1', modelId: 'alpha', effort: 'low', createdAt: NOW - 2 * H, updatedAt: NOW - 30 * 60_000 }).run();
  db.insert(schema.threads).values({ id: 'tx1', userId: 'x', title: 'Чужой', modelId: 'alpha', effort: 'low', createdAt: NOW - H, updatedAt: NOW - H }).run();
  ask('qa1', 'ta1', NOW - 2 * D + 60_000); ask('qa2', 'ta1', NOW - 5 * H); ask('qa3', 'ta2', NOW - 3 * H, { auto: { id: 'z' } });
  ans('aa1', 'ta1', NOW - 5 * H + 1000, { modelId: 'alpha', levelId: 'medium', usage: { prompt_tokens: 10_000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 8_000 }, completion_tokens_details: { reasoning_tokens: 300 } } });
  ans('aa2', 'ta1', NOW - 4 * H, { modelId: 'alpha', levelId: 'high', usage: { prompt_tokens: 20_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 15_000 }, completion_tokens_details: { reasoning_tokens: 700 } } });
  ans('aa3', 'ta2', NOW - 3 * H, { modelId: 'alpha', levelId: 'high', usage: { prompt_tokens: 4_000, completion_tokens: 100 } });
  ans('aa4', 'ta2', NOW - 2 * H, { modelId: 'alpha', levelId: 'high', error: '502: нет связи' });
  ask('qb1', 'tb1', NOW - 40 * 60_000); ans('ab1', 'tb1', NOW - 39 * 60_000, { modelId: 'alpha', levelId: 'low', usage: { prompt_tokens: 3_000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1_000 } } });
  db.insert(schema.ratings).values({ id: 'r1', userId: 'b', threadId: 'tb1', messageId: 'ab1', value: -1, createdAt: NOW - 38 * 60_000, updatedAt: NOW - 38 * 60_000 }).run();
  db.insert(schema.ratings).values({ id: 'r2', userId: 'a', threadId: 'ta1', messageId: 'aa1', value: 1, createdAt: NOW - 4 * H, updatedAt: NOW - 4 * H }).run();
  ask('qx1', 'tx1', NOW - H); ans('ax1', 'tx1', NOW - H + 1000, { modelId: 'alpha', levelId: 'low', usage: { prompt_tokens: 999_999, completion_tokens: 999_999 } });
  job('j1', 'a', { created: NOW - 90 * 60_000, started: NOW - 90 * 60_000, finished: NOW - 80 * 60_000, thread: 'ta1' });
  job('j2', 'b', { created: NOW - 85 * 60_000, started: NOW - 85 * 60_000, finished: NOW - 70 * 60_000, thread: 'tb1' });
  job('j3', 'c', { kind: 'api', created: NOW - 10 * 60_000, finished: NOW - 9 * 60_000, pt: 2_000, ct: 100 });
  job('j4', 'b', { status: 'running', created: NOW - 60_000, started: NOW - 60_000, thread: 'tb1' });
});
afterAll(() => { cur = null; });

describe('вспомогательные', () => {
  it('стоимость по прайсу: вход 0,083, кэш 0,008, выход 0,274 $ за млн', () => {
    expect(S.COST_PER_M).toEqual({ input: 0.083, cached: 0.008, output: 0.274 });
    expect(S.costOf({ input: 1e6, cached: 0, output: 0 })).toBeCloseTo(0.083, 9);
    expect(S.costOf({ input: 0, cached: 1e6, output: 0 })).toBeCloseTo(0.008, 9);
    expect(S.costOf({ input: 0, cached: 0, output: 1e6 })).toBeCloseTo(0.274, 9);
    expect(S.costOf({ input: 2e6, cached: 5e6, output: 1e6 })).toBeCloseTo(0.166 + 0.04 + 0.274, 9);
  });
  it('пик одновременных интервалов: концы не пересекаются с началами в тот же миг', () => {
    expect(S.peakOverlap([])).toEqual({ peak: 0, at: null });
    expect(S.peakOverlap([{ from: 0, to: 10 }, { from: 5, to: 20 }, { from: 8, to: 9 }])).toEqual({ peak: 3, at: 8 });
    expect(S.peakOverlap([{ from: 0, to: 10 }, { from: 10, to: 20 }])).toEqual({ peak: 1, at: 0 });
  });
  it('корзины: по часам и по местным суткам, моменты распределяются, чужие границы отбрасываются', () => {
    const hours = S.bucketStarts('hour', 3, NOW, 'UTC');
    expect(hours).toEqual([NOW - 2.5 * H, NOW - 1.5 * H, NOW - 0.5 * H].map((x) => Math.floor(x / H) * H));
    const pts = S.fillBuckets(hours, [{ t: hours[0] + 5 }, { t: hours[0] + 10 }, { t: hours[2] + 1 }, { t: hours[0] - 1 }, { t: NOW + H }], NOW + 1);
    expect(pts.map((p) => p.v)).toEqual([2, 0, 1]);
    const days = S.bucketStarts('day', 3, NOW, 'Europe/Moscow');
    expect(days).toHaveLength(3);
    expect(days[2] - days[1]).toBe(D); expect(S.dayStart(NOW, 'Europe/Moscow')).toBe(days[2]);
    expect(new Date(days[2]).getUTCHours()).toBe(21);
  });
});

describe('статистика ссылки', () => {
  const stats = () => S.inviteStats('inv1', 'Europe/Moscow', NOW)!;

  it('места и состояние: 4 из 5, осталось 1, действует; неизвестная ссылка — null', () => {
    const s = stats();
    expect(s.invite).toMatchObject({ note: 'Класс 9Б', group: true, maxUses: 5, uses: 4, left: 1, status: 'active', createdBy: 'Админ' });
    expect(S.inviteStats('nope', 'UTC', NOW)).toBeNull();
    db.update(schema.invites).set({ uses: 5 }).where(sqlEq('inv1')).run();
    expect(stats().invite).toMatchObject({ status: 'used_up', left: 0 });
    db.update(schema.invites).set({ uses: 4, revokedAt: NOW - H }).where(sqlEq('inv1')).run();
    expect(stats().invite.status).toBe('revoked');
    db.update(schema.invites).set({ revokedAt: null, expiresAt: NOW - 1 }).where(sqlEq('inv1')).run();
    expect(stats().invite.status).toBe('expired');
    db.update(schema.invites).set({ expiresAt: NOW + 5 * D }).where(sqlEq('inv1')).run();
  });

  it('люди: только зарегистрировавшиеся по ссылке; удалённый аккаунт — по имени из записи, без чужих данных', () => {
    const s = stats();
    expect(s.people.map((p) => p.name).sort()).toEqual(['Анна', 'Борис', 'Вера', 'Ушедший']);
    const g = s.people.find((p) => p.id === 'gone')!;
    expect(g).toMatchObject({ gone: true, messages: 0, chats: 0, answers: 0 });
    expect(JSON.stringify(s)).not.toContain('Чужой');
    expect(s.totals.tokens.input + s.totals.tokens.cached + s.totals.tokens.output).toBeLessThan(100_000);
  });

  it('сообщения и чаты (запросы автоматизаций не в счёт), ответы, ошибки, оценки', () => {
    const a = stats().people.find((p) => p.id === 'a')!;
    expect(a).toMatchObject({ messages: 2, chats: 2, answers: 4, errors: 1, up: 1, down: 0 });
    const b = stats().people.find((p) => p.id === 'b')!;
    expect(b).toMatchObject({ messages: 1, chats: 1, answers: 1, errors: 0, up: 0, down: 1 });
  });

  it('токены: вход посчитанный = prompt − кэш, из кэша, выход; без сведений о кэше — всё «посчитанное», с пометкой', () => {
    const a = stats().people.find((p) => p.id === 'a')!;
    expect(a.tokens).toEqual({ input: 2000 + 5000 + 4000, cached: 8000 + 15000, output: 1600, reasoning: 1000 });
    expect(a.costUsd).toBeCloseTo(S.costOf(a.tokens), 9);
    const c = stats().people.find((p) => p.id === 'c')!;
    expect(c).toMatchObject({ apiRequests: 1, tokens: { input: 2000, cached: 0, output: 100 } });
    const t = stats().totals;
    expect(t.noCacheInfo).toBe(2);
    expect(stats().gaps.join(' ')).toContain('Кэш входа движок сообщил не для всех ответов (2 из 5');
    expect(t.costUsd).toBeCloseTo(S.costOf(t.tokens), 9);
    expect(t.tokens.input).toBe(11_000 + 2_000 + 2_000);
  });

  it('уровни рассуждения: сколько ответов на каком (модель · уровень)', () => {
    const lv = stats().levels;
    expect(lv.find((l) => l.level === 'high')?.n).toBe(3);
    expect(lv.find((l) => l.level === 'medium')?.n).toBe(1);
    expect(lv.find((l) => l.level === 'low')?.n).toBe(1);
  });

  it('графики: ссылке меньше трёх суток — регистрации по часам, сумма равна числу регистраций; сообщения по часам за 48 ч; активные люди по дням', () => {
    const s = stats();
    expect(s.series.regs.kind).toBe('hour');
    expect(s.series.regs.points.reduce((x, p) => x + p.v, 0)).toBe(4);
    expect(s.series.messages.points).toHaveLength(48);
    expect(s.series.messages.points.reduce((x, p) => x + p.v, 0)).toBe(2);
    expect(s.series.active.points).toHaveLength(14);
    expect(Math.max(...s.series.active.points.map((p) => p.v))).toBe(2);
  });

  it('пик одновременных ответов и «сейчас»: двое с 11:05 до 11:10; у Бориса сейчас идёт ответ', () => {
    const o = stats().online;
    expect(o.peak).toBe(2);
    expect(o.peakAt).toBe(NOW - 85 * 60_000);
    expect(o.generating).toBe(1);
    expect(o.now).toBe(0);
  });

  it('последняя активность: сообщение, задача или вход (сессия)', () => {
    db.insert(schema.sessions).values({ id: 's1', userId: 'c', expiresAt: NOW + D, createdAt: NOW - 5 * 60_000 }).run();
    const c = stats().people.find((p) => p.id === 'c')!;
    expect(c.lastAt).toBe(NOW - 5 * 60_000);
    expect(stats().people.find((p) => p.id === 'b')!.lastAt).toBe(NOW - 60_000);
  });
});

describe('маршрут /api/admin/invites/<id>/stats', () => {
  const call = (id: string) => GET(new Request(`http://localhost/api/admin/invites/${id}/stats`, { headers: { Host: 'localhost' } }), { params: Promise.resolve({ id }) });
  it('только администратор: без входа 401, обычный пользователь 403, админ — данные; неизвестная ссылка — 404', async () => {
    cur = null; expect((await call('inv1')).status).toBe(401);
    cur = { id: 'a', role: 'user' }; expect((await call('inv1')).status).toBe(403);
    cur = { id: 'adm', role: 'admin', timezone: 'Europe/Moscow' };
    const r = await call('inv1'); expect(r.status).toBe(200);
    const j = await r.json() as { invite: { note: string }; people: unknown[] };
    expect(j.invite.note).toBe('Класс 9Б'); expect(j.people).toHaveLength(4);
    expect((await call('nope')).status).toBe(404);
  });
  it('в ответе нет токена ссылки и хеша', async () => {
    cur = { id: 'adm', role: 'admin' };
    const txt = await (await call('inv1')).text();
    expect(txt).not.toContain('h1"'); expect(txt).not.toMatch(/tokenHash|token_hash/);
  });
});

function sqlEq(id: string) { return eq(schema.invites.id, id); }
