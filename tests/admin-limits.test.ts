import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
tmpData();
let L: typeof import('@/lib/adminLimits'), W: typeof import('@/lib/week');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
beforeAll(async () => { const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema; L = await import('@/lib/adminLimits'); W = await import('@/lib/week'); });
afterEach(() => { for (const k of ['KX_ADMIN_PRICES', 'KX_WEEK_LIMIT', 'KX_WEEK_HARD']) delete process.env[k]; });

let n = 0, jn = 0;
const user = (o: Partial<typeof import('@/lib/db').schema.users.$inferInsert> = {}) => {
  const id = `u${++n}`;
  db.insert(schema.users).values({ id, email: `${id}@t`, name: `Человек ${n}`, passwordHash: 'x', createdAt: 1, ...o }).run();
  return db.select().from(schema.users).all().find((u) => u.id === id)!;
};
const job = (userId: string, at: number, o: Partial<typeof import('@/lib/db').schema.jobs.$inferInsert> = {}) =>
  db.insert(schema.jobs).values({ id: `j${++jn}`, userId, kind: 'chat', modelId: 'alpha', levelId: 'high', status: 'done', createdAt: at, ...o }).run();
const NOW = Date.UTC(2026, 10, 11, 12);

describe('цены по умолчанию', () => {
  it('разбор: доллары и рубли, мусор пропускается', () => {
    expect(L.parsePrices('25 USD, 15 usd, 1500 RUB, x, 10 EUR,900RUB')).toEqual([
      { amount: 25, cur: 'USD' }, { amount: 15, cur: 'USD' }, { amount: 1500, cur: 'RUB' }, { amount: 900, cur: 'RUB' }]);
    expect(L.parsePrices('')).toEqual([]);
  });
  it('секунды карты -> $: час ≈ $0,38', () => { expect(L.cardUsd(3600)).toBeCloseTo(0.3816, 3); });
});

describe('страница администратора', () => {
  it('пороги, дорожки, люди; админ считается, но без лимита', async () => {
    process.env.KX_WEEK_LIMIT = '36000'; process.env.KX_WEEK_HARD = '72000';
    process.env.KX_ADMIN_PRICES = '25 USD';
    const admin = user({ role: 'admin' }), a = user(), b = user({ weekMult: 2 }), idle = user();
    job(admin.id, NOW - 3_600_000, { cardS: 3600 });
    job(admin.id, NOW - 3_000_000, { modelId: 'gamma', costUsd: 1.5, cardS: 1.5 * W.CARD.usd });
    job(admin.id, NOW - 2_000_000, { cardS: 999, status: 'running' });
    job(a.id, NOW - 3_600_000, { cardS: 18_000 });
    job(b.id, NOW - 3_600_000, { cardS: 36_000 });
    job(a.id, NOW - 30 * 86_400_000, { cardS: 50_000 });
    const d = await L.adminLimits(admin, NOW);
    expect(d.soft).toBe(36000); expect(d.hard).toBe(72000);
    expect(d.used).toBe(Math.round(3600 + 1.5 * W.CARD.usd));
    const gamma = d.lanes.find((l) => l.id === 'gamma')!, alpha = d.lanes.find((l) => l.id === 'alpha')!;
    expect(gamma.claude).toBe(true); expect(gamma.usd).toBeCloseTo(1.5, 6);
    expect(alpha.claude).toBe(false); expect(alpha.turns).toBe(1); expect(alpha.usd).toBeCloseTo(L.cardUsd(3600), 6);
    expect(d.usd).toBeCloseTo(1.5 + L.cardUsd(3600), 6);
    expect(d.rate).toBeNull(); expect(d.prices).toEqual([{ amount: 25, cur: 'USD' }]);
    expect(d.people.map((p) => p.id)).toEqual([b.id, a.id, admin.id]);
    const pb = d.people[0], pa = d.people[1], pm = d.people[2];
    expect([pb.soft, pb.hard]).toEqual([72000, 144000]);
    expect([pa.soft, pa.hard, pa.used]).toEqual([36000, 72000, 18000]);
    expect(pm.limited).toBe(false); expect(pm.soft).toBe(36000);
    expect(d.idle).toBe(1); expect(d.people.some((p) => p.id === idle.id)).toBe(false);
    expect(d.seat.switches).toBeGreaterThan(0); expect(d.orgDay).toBeGreaterThan(0);
  });
  it('«Альфа»: свои часы и лимиты тарифов, без цен, людей и технических порогов (в данных их нет)', async () => {
    process.env.KX_WEEK_LIMIT = '36000'; process.env.KX_ADMIN_PRICES = '25 USD';
    const al = user({ role: 'alpha' }), other = user();
    job(al.id, NOW - 3_600_000, { cardS: 7200 });
    job(other.id, NOW - 3_600_000, { cardS: 9000 });
    const d = L.alphaLimits(al, NOW);
    expect(d).toMatchObject({ view: 'alpha', used: 7200, soft: 36000, prices: [], people: [], lanes: [], usd: 0, rate: null, orgDay: 0 });
  });
});
