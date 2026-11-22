import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
let n = 0;
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values(['r1', 'r2', 'r3'].map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1, lang: 'ru' }))).run();
});
async function answer(userId: string, content: string, meta: Record<string, unknown> = {}) {
  const { getDb, schema } = await import('@/lib/db');
  const th = `th-${userId}-${++n}`, now = Date.now();
  getDb().insert(schema.threads).values({ id: th, userId, title: 'Ч', modelId: 'alpha', createdAt: now, updatedAt: now }).run();
  getDb().insert(schema.messages).values([
    { id: `u-${n}`, threadId: th, seq: 1, role: 'user', content: 'вопрос', createdAt: now, parentId: null },
    { id: `a-${n}`, threadId: th, seq: 2, role: 'assistant', content, createdAt: now + 1, parentId: `u-${n}`, meta: { status: 'done', ...meta } },
  ] as never).run();
  return { th, id: `a-${n}` };
}
const meta = async (id: string) => { const { getDb, schema } = await import('@/lib/db'); return getDb().select().from(schema.messages).all().find((m) => m.id === id)!.meta as Record<string, unknown>; };

describe('👎 с причиной', () => {
  it('«Длинно» — сразу «Похоже: Просит отвечать короче» под ответом; повтор в другом чате — та же запись становится точной (манера, не режим)', async () => {
    const R = await import('@/lib/ratingSignals');
    const M = await import('@/lib/memory');
    const a = await answer('r1', 'Очень длинный ответ');
    expect(R.onRating('r1', a.id, { value: -1, reasons: ['long'], comment: '' })).toContain('shorter');
    expect(M.listMemory('r1').map((r) => [r.section, r.sure, r.text])).toEqual([['style', 0, 'Просит отвечать короче']]);
    expect((await meta(a.id)).memUpd).toEqual([expect.objectContaining({ text: 'Просит отвечать короче', maybe: true })]);
    const b = await answer('r1', 'Ещё длинный');
    R.onRating('r1', b.id, { value: -1, reasons: ['long'], comment: '' });
    expect(M.listMemory('r1').map((r) => [r.text, r.sure])).toEqual([['Просит отвечать короче', 1]]);
  });
  it('«Ошибка в расчёте» / «Не понял вопрос» — пометка ночной перепроверки; без причины — ничего сразу', async () => {
    const R = await import('@/lib/ratingSignals');
    const a = await answer('r1', 'Итог 120');
    expect(R.onRating('r1', a.id, { value: -1, reasons: ['wrong'], comment: '' })).toEqual(['recheck']);
    expect((await meta(a.id)).recheck).toBe('wrong');
    const b = await answer('r1', 'Ответ');
    expect(R.onRating('r1', b.id, { value: -1, reasons: [], comment: '' })).toEqual([]);
  });
  it('память выключена или временный чат — ничего', async () => {
    const R = await import('@/lib/ratingSignals');
    const M = await import('@/lib/memory');
    M.setPrefs('r2', { on: false });
    const a = await answer('r2', 'Длинно');
    expect(R.onRating('r2', a.id, { value: -1, reasons: ['long'], comment: '' })).toEqual([]);
    expect(M.listMemory('r2')).toEqual([]);
  });
});

describe('👍 на «Учла …»', () => {
  it('первый 👍 — догадка живёт дольше, второй — точная; режим — только словом', async () => {
    const R = await import('@/lib/ratingSignals');
    const { getDb, schema } = await import('@/lib/db');
    const old = Date.now() - 30 * 864e5;
    getDb().insert(schema.userMemory).values([
      { id: 'g1', userId: 'r3', section: 'work', text: 'Ведёт учёт в Контуре', origin: 'auto', sure: 0, createdAt: old, updatedAt: old },
      { id: 'g2', userId: 'r3', section: 'work', text: 'Организация на УСН', origin: 'auto', sure: 0, createdAt: old, updatedAt: old },
    ] as never).run();
    const row = (id: string) => getDb().select().from(schema.userMemory).all().find((r) => r.id === id)!;
    const a = await answer('r3', 'Учла Контур и УСН', { guesses: [{ id: 'g1', text: 'Контур' }, { id: 'g2', text: 'УСН' }] });
    expect(R.onRating('r3', a.id, { value: 1, reasons: [], comment: '' })).toEqual(['liked', 'liked']);
    expect(row('g1').updatedAt).toBeGreaterThan(old);
    expect(row('g1').sure).toBe(0);
    const b = await answer('r3', 'Ещё ответ', { guesses: [{ id: 'g1', text: 'Контур' }, { id: 'g2', text: 'УСН' }] });
    expect(R.onRating('r3', b.id, { value: 1, reasons: [], comment: '' })).toEqual(['confirmed', 'liked']);
    expect([row('g1').sure, row('g2').sure]).toEqual([1, 0]);
  });
});

describe('закономерность по оценкам (ночь)', () => {
  it('3 из 4 👎 — длинные — «короче»; 👍 на таблицах — «любит таблицы»; одна оценка — ничего', async () => {
    const N = await import('@/lib/night');
    const { getDb, schema } = await import('@/lib/db');
    const LONG = 'Подробный разбор. '.repeat(100), TABLE = '| A | B |\n|---|---|\n| 1 | 2 |';
    const rate = async (u: string, c: string, v: 1 | -1) => { const a = await answer(u, c); getDb().insert(schema.ratings).values({ id: `rt-${a.id}`, userId: u, threadId: a.th, messageId: a.id, value: v, reasons: [], createdAt: Date.now(), updatedAt: Date.now() } as never).run(); };
    getDb().insert(schema.users).values(['p1', 'p2'].map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1 }))).run();
    await rate('p1', LONG, -1);
    expect(N.ratingPatterns('p1')).toEqual([]);
    await rate('p1', LONG, -1); await rate('p1', LONG, -1); await rate('p1', 'Коротко.', -1);
    await rate('p1', TABLE, 1); await rate('p1', TABLE, 1);
    expect(N.ratingPatterns('p1').map((x) => x.text)).toEqual(['Просит отвечать короче', 'Любит ответы таблицей']);
    await rate('p2', TABLE, 1);
    expect(N.ratingPatterns('p2')).toEqual([]);
  });
});
