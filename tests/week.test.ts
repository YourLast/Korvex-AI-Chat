import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
tmpData();
let W: typeof import('@/lib/week'), J: typeof import('@/lib/jobs');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
let n = 0;
beforeAll(async () => { const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema; W = await import('@/lib/week'); J = await import('@/lib/jobs'); });
afterEach(() => { for (const k of ['KX_WEEK_MODE', 'KX_WEEK_LIMIT', 'KX_WEEK_HARD']) delete process.env[k]; });

const user = (o: Partial<typeof schema.users.$inferInsert> = {}) => {
  const id = `u${++n}`;
  db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', createdAt: 1, ...o }).run();
  return db.select().from(schema.users).all().find((u) => u.id === id)!;
};
const refresh = (id: string) => db.select().from(schema.users).all().find((u) => u.id === id)!;
let jn = 0;
const job = (userId: string, at: number, o: Partial<typeof schema.jobs.$inferInsert> = {}) =>
  db.insert(schema.jobs).values({ id: `j${++jn}`, userId, kind: 'chat', modelId: 'm', levelId: 'high', status: 'done', createdAt: at, ...o }).run();
const MON = Date.UTC(2026, 10, 9, 12);
const NOW = MON + 2 * 86_400_000;

describe('цена хода (секунды карты)', () => {
  it('вход без кэша / из кэша / выход по замеренным скоростям', () => {
    expect(W.cardSeconds({ promptTokens: 1000, completionTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(1.044, 3);
    expect(W.cardSeconds({ promptTokens: 1000, completionTokens: 0, cacheReadTokens: 1000 })).toBeCloseTo(0.1, 3);
    expect(W.cardSeconds({ promptTokens: 0, completionTokens: 1000 })).toBeCloseTo(3.448, 3);
  });
  it('prompt_tokens ВКЛЮЧАЕТ кэш: заново посчитанный вход = prompt − cache, не меньше нуля', () => {
    expect(W.cardSeconds({ promptTokens: 10_000, cacheReadTokens: 9_000 })).toBeCloseTo(1 * 1.044 + 9 * 0.1, 3);
    expect(W.cardSeconds({ promptTokens: 5_000, cacheReadTokens: 8_000 })).toBeCloseTo(8 * 0.1, 3);
  });
  it('Claude: $ / 0,000106; токены при этом не считаются дважды', () => {
    expect(W.cardSeconds({ costUsd: 0.0106, promptTokens: 99_999, completionTokens: 99_999 })).toBeCloseTo(100, 3);
  });
  it('браузер: 1 с за действие; пустые и мусорные поля — 0', () => {
    expect(W.cardSeconds({ completionTokens: 1000, browserActions: 5 })).toBeCloseTo(3.448 + 5, 3);
    expect(W.cardSeconds({ promptTokens: null, completionTokens: undefined, costUsd: NaN })).toBe(0);
  });
});

describe('неделя в поясе человека', () => {
  it('понедельник 00:00 — следующий понедельник 00:00 (Москва, Нью-Йорк, Токио)', () => {
    const w = W.weekRange(Date.UTC(2026, 10, 11, 12), 'Europe/Moscow');
    expect(w.key).toBe('2026-11-09');
    expect(w.start).toBe(Date.UTC(2026, 10, 8, 21));
    expect(w.end - w.start).toBe(7 * 86_400_000);
    expect(W.weekRange(Date.UTC(2026, 10, 9, 4, 30), 'America/New_York').key).toBe('2026-11-02');
    expect(W.weekRange(Date.UTC(2026, 10, 9, 4, 30), 'Asia/Tokyo').key).toBe('2026-11-09');
  });
  it('переход на летнее время: неделя на час короче / длиннее', () => {
    const fall = W.weekRange(Date.UTC(2026, 9, 22), 'Europe/Berlin');
    expect(fall.key).toBe('2026-10-19');
    expect((fall.end - fall.start) / 3_600_000).toBe(169);
    const spring = W.weekRange(Date.UTC(2026, 2, 4), 'America/New_York');
    expect(spring.key).toBe('2026-03-02');
    expect((spring.end - spring.start) / 3_600_000).toBe(167);
  });
  it('день по поясу человека', () => { expect(W.dayOf(Date.UTC(2026, 10, 10, 22), 'Asia/Tokyo')).toBe('2026-11-11'); });
});

describe('состояние лимита', () => {
  it('считаются завершённые ходы чата этой недели; отменённый без токенов, API, автоматизация и письмо агента — нет; пара — обе дорожки', () => {
    const u = user();
    job(u.id, NOW, { promptTokens: 1000, completionTokens: 1000 });
    job(u.id, NOW, { status: 'error', completionTokens: 1000 });
    job(u.id, NOW, { status: 'cancelled' });
    job(u.id, NOW, { status: 'queued', completionTokens: 5000 });
    job(u.id, NOW, { kind: 'api', completionTokens: 9000 });
    job(u.id, NOW, { kind: 'automation', completionTokens: 9000 });
    job(u.id, MON - 7 * 86_400_000, { completionTokens: 9000 });
    const lane = (i: number) => job(u.id, NOW, { id: `pa${n}${i}`, completionTokens: 1000 });
    lane(1); lane(2);
    db.insert(schema.threads).values({ id: 't1', userId: u.id, modelId: 'm', createdAt: 1, updatedAt: 1 }).run();
    db.insert(schema.messages).values({ id: 'mail', threadId: 't1', seq: 1, role: 'user', content: '', meta: { from: { depth: 1 } }, createdAt: 1 }).run();
    job(u.id, NOW, { userMessageId: 'mail', completionTokens: 9000 });
    expect(W.weekUsed(u.id, W.weekRange(NOW, 'Europe/Moscow').start, W.weekRange(NOW, 'Europe/Moscow').end)).toBe(Math.round(1.044 + 3.448 + 3.448 + 2 * 3.448));
  });
  it('старые ходы без card_s считаются по токенам, с card_s — по нему', () => {
    const u = user();
    job(u.id, NOW, { promptTokens: 2000, cacheReadTokens: 1000, completionTokens: 0 });
    job(u.id, NOW, { cardS: 100 });
    expect(W.weekState(u, NOW).used).toBe(Math.round(1.044 + 0.1 + 100));
  });
  it('мягкий режим: 80 % -> warn, лимит -> over (ходы принимаются), жёсткий порог -> blocked', () => {
    process.env.KX_WEEK_LIMIT = '1000'; process.env.KX_WEEK_HARD = '2000';
    const u = user();
    expect(W.weekState(u, NOW).phase).toBe('ok');
    job(u.id, NOW, { cardS: 800 });
    expect(W.weekState(u, NOW)).toMatchObject({ phase: 'warn', pct: 80, limited: true });
    job(u.id, NOW, { cardS: 200 });
    expect(W.weekState(u, NOW).phase).toBe('over');
    job(u.id, NOW, { cardS: 1000 });
    expect(W.weekState(u, NOW).phase).toBe('blocked');
  });
  it('жёсткий режим — отказ уже на лимите; off — без лимита; значения по умолчанию 54 000 / 108 000 с', () => {
    process.env.KX_WEEK_LIMIT = '1000';
    const u = user();
    job(u.id, NOW, { cardS: 1000 });
    process.env.KX_WEEK_MODE = 'hard';
    expect(W.weekState(u, NOW).phase).toBe('blocked');
    process.env.KX_WEEK_MODE = 'off';
    expect(W.weekState(u, NOW)).toMatchObject({ phase: 'ok', limited: false });
    delete process.env.KX_WEEK_LIMIT; delete process.env.KX_WEEK_MODE;
    expect([W.weekLimit(), W.weekHard(), W.weekMode()]).toEqual([54_000, 108_000, 'soft']);
  });
  it('жёсткий режим: человеку — часы лимита (15 ч, ×2 — 30 ч, ×5 — 75 ч); мягкий — без часов', () => {
    process.env.KX_WEEK_MODE = 'hard';
    const u = user(), u2 = user({ weekMult: 2 } as never), u5 = user({ weekMult: 5 } as never);
    expect(W.weekView(u, NOW)).toMatchObject({ limited: true, hard: true, hours: 15 });
    expect(W.weekView(u2, NOW).hours).toBe(30);
    expect(W.weekView(u5, NOW).hours).toBe(75);
    expect(W.weekView(user({ role: 'admin' } as never), NOW)).toMatchObject({ limited: false });
    delete process.env.KX_WEEK_MODE;
    expect(W.weekView(u, NOW).hours).toBeUndefined();
    expect(W.resetDay(Date.UTC(2026, 10, 23, 21), 'Europe/Moscow', 'ru-RU')).toBe('24 ноября');
  });
  it('жёсткий режим: исчерпан до понедельника 00:00 в поясе человека, с понедельника — снова можно', () => {
    process.env.KX_WEEK_MODE = 'hard'; process.env.KX_WEEK_LIMIT = '1000';
    const u = user({ timezone: 'Europe/Moscow' } as never);
    job(u.id, NOW, { cardS: 1000 });
    const s = W.weekState(u, NOW);
    expect(s.phase).toBe('blocked');
    expect(W.weekState(u, s.resetAt - 60_000).phase).toBe('blocked');
    expect(W.weekState(u, s.resetAt + 60_000)).toMatchObject({ phase: 'ok', used: 0 });
  });
  it('администратор не ограничен; множитель ×2 / без лимита; «сбросить эту неделю»', () => {
    process.env.KX_WEEK_LIMIT = '1000'; process.env.KX_WEEK_HARD = '2000';
    const a = user({ role: 'admin' });
    job(a.id, NOW, { cardS: 99_999 });
    expect(W.weekState(a, NOW)).toMatchObject({ limited: false, phase: 'ok' });
    const u = user();
    job(u.id, NOW, { cardS: 1500 });
    expect(W.weekState(u, NOW).phase).toBe('over');
    db.update(schema.users).set({ weekMult: 2 }).where(eq(schema.users.id, u.id)).run();
    expect(W.weekState(refresh(u.id), NOW)).toMatchObject({ phase: 'ok', limit: 2000, hard: 4000, pct: 75 });
    db.update(schema.users).set({ weekMult: 0 }).where(eq(schema.users.id, u.id)).run();
    expect(W.weekState(refresh(u.id), NOW).limited).toBe(false);
    db.update(schema.users).set({ weekMult: 1, weekResetAt: NOW + 1000 }).where(eq(schema.users.id, u.id)).run();
    expect(W.weekState(refresh(u.id), NOW + 2000)).toMatchObject({ used: 0, phase: 'ok' });
  });
  it('пояс человека двигает границу недели', () => {
    const u = user({ timezone: 'America/New_York' });
    const sunEve = Date.UTC(2026, 10, 9, 3);
    job(u.id, sunEve, { cardS: 50 });
    expect(W.weekState(u, Date.UTC(2026, 10, 9, 20)).used).toBe(0);
    expect(W.weekState(u, Date.UTC(2026, 10, 9, 4)).used).toBe(50);
  });
});

describe('очередь', () => {
  it('человек сверх лимита — класс 1 (после людей, раньше фона), но «повзрослевший» не голодает', () => {
    const base = { kind: 'chat' as const, depth: 0, apiKeyId: null };
    expect(J.queueClass(base)).toBe(0);
    expect(J.queueClass({ ...base, over: true })).toBe(1);
    expect(J.queueClass({ ...base, kind: 'automation', over: true })).toBe(2);
    const t = 1_000_000;
    const q = [{ id: 'bg', ...base, kind: 'automation' as const, createdAt: t }, { id: 'over', ...base, over: true, createdAt: t + 1 }, { id: 'human', ...base, createdAt: t + 2 }];
    expect(J.orderQueue(q, t + 3, 90_000)).toEqual(['human', 'over', 'bg']);
    expect(J.orderQueue([{ id: 'over', ...base, over: true, createdAt: t }, { id: 'human', ...base, createdAt: t + 100_000 }], t + 100_001, 90_000)).toEqual(['over', 'human']);
  });
});
import { eq } from 'drizzle-orm';
