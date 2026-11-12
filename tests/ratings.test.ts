import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let setRating: typeof import('@/lib/ratings').setRating, ratingsFor: typeof import('@/lib/ratings').ratingsFor;
let analytics: typeof import('@/lib/analytics').analytics, quantile: typeof import('@/lib/analytics').quantile, buckets: typeof import('@/lib/analytics').buckets;

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const ans = (id: string, thread: string, meta: Record<string, unknown>, at = NOW - 3_600_000, parentId: string | null = null) =>
  db.insert(schema.messages).values({ id, threadId: thread, seq: Math.floor(Math.random() * 1e6), parentId, session: null, role: 'assistant', content: 'ответ ' + id, reasoning: null, reasoningMs: null, meta, createdAt: at }).run();
const ask = (id: string, thread: string, at = NOW - 3_600_000, meta: Record<string, unknown> | null = null) =>
  db.insert(schema.messages).values({ id, threadId: thread, seq: Math.floor(Math.random() * 1e6), parentId: null, session: thread, role: 'user', content: 'вопрос', reasoning: null, reasoningMs: null, meta, createdAt: at }).run();

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  for (const u of ['u1', 'u2', 'u3']) db.insert(schema.users).values({ id: u, email: `${u}@t`, name: u.toUpperCase(), passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  db.insert(schema.threads).values({ id: 't1', userId: 'u1', title: 'T1', modelId: 'alpha', effort: 'low', createdAt: NOW - 7_200_000, updatedAt: 1 }).run();
  db.insert(schema.threads).values({ id: 't2', userId: 'u2', title: 'T2', modelId: 'beta', effort: 'off', createdAt: NOW - 10 * 864e5, updatedAt: 1 }).run();
  ask('q1', 't1'); ask('q2', 't2'); ask('qa', 't1', NOW - 1000, { auto: { id: 'a', name: 'A' } });
  ans('m1', 't1', { modelId: 'alpha', levelId: 'low', durationMs: 1000, usage: { prompt_tokens: 100, completion_tokens: 20 } });
  ans('m2', 't1', { modelId: 'alpha', levelId: 'low', durationMs: 3000, usage: { prompt_tokens: 50, completion_tokens: 10 } });
  ans('m3', 't1', { modelId: 'alpha', levelId: 'max', durationMs: 9000, error: '502: нет связи', usage: null });
  ans('m4', 't2', { modelId: 'beta', levelId: 'off', durationMs: 500, usage: { prompt_tokens: 7, completion_tokens: 3 } });
  ans('old', 't2', { modelId: 'beta', levelId: 'off', durationMs: 500 }, NOW - 20 * 864e5);
  ({ setRating, ratingsFor } = await import('@/lib/ratings'));
  ({ analytics, quantile, buckets } = await import('@/lib/analytics'));
});

describe('оценки ответов', () => {
  it('чужой ответ или сообщение пользователя — не найдено', () => {
    expect(setRating('u2', 'm1', { value: 1 })).toBe('not-found');
    expect(setRating('u1', 'q1', { value: 1 })).toBe('not-found');
    expect(setRating('u1', 'nope', { value: -1 })).toBe('not-found');
  });
  it('ставится со снимком модели, уровня, времени и токенов', () => {
    expect(setRating('u1', 'm1', { value: 1 })).toEqual({ value: 1, reasons: [], comment: '' });
    const r = db.select().from(schema.ratings).all().find((x) => x.messageId === 'm1')!;
    expect(r).toMatchObject({ userId: 'u1', threadId: 't1', modelId: 'alpha', levelId: 'low', durationMs: 1000, promptTokens: 100, completionTokens: 20, value: 1 });
  });
  it('смена на 👎 с причиной; неизвестные причины отбрасываются; тот же знак без причин их не стирает', () => {
    setRating('u1', 'm1', { value: -1 });
    expect(setRating('u1', 'm1', { value: -1, reasons: ['wrong', 'hack', 'wrong', 'slow'], comment: '  цифры не те  ' })).toEqual({ value: -1, reasons: ['wrong', 'slow'], comment: 'цифры не те' });
    expect(setRating('u1', 'm1', { value: -1 })).toEqual({ value: -1, reasons: ['wrong', 'slow'], comment: 'цифры не те' });
    expect(db.select().from(schema.ratings).all().filter((x) => x.messageId === 'm1')).toHaveLength(1);
  });
  it('смена знака сбрасывает причину; 0 снимает оценку', () => {
    expect(setRating('u1', 'm1', { value: 1 })).toEqual({ value: 1, reasons: [], comment: '' });
    expect(setRating('u1', 'm1', { value: 0 })).toBeNull();
    expect(ratingsFor('u1', ['m1']).size).toBe(0);
  });
  it('ratingsFor отдаёт только свои', () => {
    setRating('u1', 'm2', { value: -1, reasons: ['format'] });
    setRating('u2', 'm4', { value: 1 });
    expect([...ratingsFor('u1', ['m2', 'm4']).keys()]).toEqual(['m2']);
  });
});

describe('аналитика', () => {
  it('квантили', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1000, 3000], 0.5)).toBe(2000);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });
  it('корзины: 24 часа или полночи дней в поясе администратора', () => {
    const h = buckets(1, NOW, 'Europe/Moscow');
    expect(h.kind).toBe('hour'); expect(h.starts).toHaveLength(24); expect(h.starts[23]).toBe(NOW);
    const d = buckets(7, NOW, 'Europe/Moscow');
    expect(d.kind).toBe('day'); expect(d.starts).toHaveLength(7);
    expect(d.starts[6]).toBe(Date.UTC(2026, 9, 27, 21, 0, 0));
    expect(d.starts[6] - d.starts[5]).toBe(864e5);
  });
  it('счётчики за 7 дней: активные без автоматизаций, ответы, токены, ошибки, время, оценки по моделям', () => {
    const a = analytics(7, 'Europe/Moscow', NOW);
    expect(a.users).toEqual({ total: 3, active: 2, added: 0 });
    expect(a.chats).toBe(1);
    expect(a.messages).toEqual({ user: 3, assistant: 4 });
    expect(a.tokens).toEqual({ prompt: 157, completion: 33 });
    expect(a.errors).toBe(1);
    expect(a.latency.medianMs).toBe(1000);
    expect(a.ratings).toEqual({ up: 1, down: 1 });
    const low = a.byModel.find((r) => r.modelId === 'alpha' && r.levelId === 'low')!;
    expect(low).toMatchObject({ answers: 2, promptTokens: 150, completionTokens: 30, medianMs: 2000, errors: 0, down: 1, up: 0 });
    expect(a.byModel.find((r) => r.levelId === 'max')).toMatchObject({ answers: 1, errors: 1, medianMs: null });
    expect(a.series.reduce((s, b) => s + b.answers, 0)).toBe(4);
    expect(a.downFeed).toHaveLength(1);
    expect(a.downFeed[0]).toMatchObject({ messageId: 'm2', userName: 'U1', reasons: ['format'], exists: true });
  });
  it('за 30 дней попадает старый ответ; неизвестный период -> 7', () => {
    expect(analytics(30, 'UTC', NOW).messages.assistant).toBe(5);
    expect(analytics(5, 'UTC', NOW).days).toBe(7);
  });
  it('удалённый ответ остаётся в статистике, в ленте — «удалён»', () => {
    db.delete(schema.messages).where(eq(schema.messages.id, 'm2')).run();
    const a = analytics(7, 'UTC', NOW);
    expect(a.ratings.down).toBe(1);
    expect(a.downFeed[0].exists).toBe(false);
  });
});
