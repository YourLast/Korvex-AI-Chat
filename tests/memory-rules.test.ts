import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_ENGINE_URL = 'http://127.0.0.1:9/v1';
process.env.KX_RULES_IDLE_MS = '50';
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const u = (id: string) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: Date.now(), lastTz: 'Europe/Moscow', lang: 'ru' });
  getDb().insert(schema.users).values([u('r1'), u('r2'), u('k1')]).run();
});
const reply = (rules: unknown) => (async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules }) } }] }) })) as unknown as typeof fetch;

describe('parseRules', () => {
  it('отсекает секреты, чувствительное, данные клиентов, дубли и длинное; не больше 15', async () => {
    const R = await import('@/lib/memoryRules');
    const out = R.parseRules(JSON.stringify({ rules: ['Считать НДС до копеек', 'считать ндс до копеек', 'Пароль от 1С: 12345', 'Учитывать его диабет', 'ИНН клиента 7701234567 — всегда проверять', 'x'.repeat(200), 'Сначала итог, потом расчёт'] }), ['Сначала итог, потом расчёт']);
    expect(out).toEqual(['Считать НДС до копеек']);
    expect(R.parseRules('не json', [])).toEqual([]);
    expect(R.parseRules(JSON.stringify({ rules: Array.from({ length: 30 }, (_, i) => `Правило номер ${i + 1}`) }), [])).toHaveLength(15);
  });
});

describe('runRules / rulesTick', () => {
  it('в простое: правила — записи раздела «Как со мной работать», строка «Добавила N правил»; повтор заменяет прежние', async () => {
    const R = await import('@/lib/memoryRules');
    const M = await import('@/lib/memory');
    R.queueRules('r1');
    expect(await R.runRules('r1', { fetchImpl: reply(['Считать НДС до копеек', '«Закрыть месяц» = сверка банка, НДС и зарплата']) })).toBe('done');
    const rows = M.listMemory('r1').filter((r) => r.section === 'rules');
    expect(rows.map((r) => r.text)).toEqual(expect.arrayContaining(['Считать НДС до копеек']));
    expect(R.rulesNotice('r1')).toBe(2);
    R.rulesSeen('r1');
    expect(R.rulesNotice('r1')).toBe(0);
    expect(M.memoryMeta('r1').rules?.pending).toBeUndefined();
    expect(await R.runRules('r1', { fetchImpl: reply(['Ставки сверять по nalog.gov.ru']) })).toBe('done');
    expect(M.listMemory('r1').filter((r) => r.section === 'rules').map((r) => r.text)).toEqual(['Ставки сверять по nalog.gov.ru']);
  });
  it('ход человека посреди — запрос обрывается, задача ждёт следующего простоя', async () => {
    const R = await import('@/lib/memoryRules');
    const J = await import('@/lib/jobs');
    const M = await import('@/lib/memory');
    R.queueRules('r2');
    const live = (J as unknown as { liveTotal: () => number });
    const orig = live.liveTotal;
    let human = 0;
    const slow = (async (_u: string, i: RequestInit) => new Promise((res, rej) => { i.signal?.addEventListener('abort', () => rej(new Error('aborted'))); setTimeout(() => { human = 1; }, 50); setTimeout(() => res({ ok: true, json: async () => ({ choices: [{ message: { content: '{"rules":["x x x x"]}' } }] }) }), 5000); })) as unknown as typeof fetch;
    const spy = await import('vitest').then((v) => v.vi.spyOn(J, 'liveTotal').mockImplementation(() => human));
    try {
      expect(await R.runRules('r2', { fetchImpl: slow })).toBe('yield');
      expect(M.memoryMeta('r2').rules?.pending).toBeGreaterThan(0);
    } finally { spy.mockRestore(); void orig; }
  });
});

describe('«Знания и правила» куратора', () => {
  it('только с источником ответа; дата — кодом; данные клиентов — никогда', async () => {
    const C = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const answer = 'Ставка НДС на УСН при доходе до 250 млн ₽ — 5 % (https://www.nalog.gov.ru/rn77/taxation/taxes/nds/).';
    const op = (text: string) => ({ op: 'add' as const, id: '', section: 'knowledge', key: 'none', text, sensitive: 'no', asked: false, sure: true });
    const r = C.applyOps('k1', [op('НДС на УСН до 250 млн ₽ дохода — 5 %, nalog.gov.ru'), op('Лимит по патенту 60 млн ₽ — glavbukh.ru'), op('ИНН 7701234567: ООО «Ромашка» на УСН — nalog.gov.ru')], new Map(),
      { user: 'спасибо, то что нужно', auto: true, threadId: null, messageId: null, answer, now: Date.UTC(2026, 10, 18) });
    expect(r.applied.map((a) => a.text)).toEqual(['НДС на УСН до 250 млн ₽ дохода — 5 %, nalog.gov.ru (сверено 18.11.2026)']);
    expect(r.skipped.map((s) => s.why)).toEqual(['nosource', 'workdata']);
    expect(M.listMemory('k1').find((x) => x.section === 'knowledge')).toBeTruthy();
    expect(C.answerSources(answer)).toEqual(['https://www.nalog.gov.ru/rn77/taxation/taxes/nds/']);
  });
});

describe('куратор: термины человека с цифрами (B 18.11)', () => {
  it('«рейс» — одна поездка фуры 20 т — пишется в «Как со мной работать»; остатки склада в rules — нет', async () => {
    const C = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const op = (text: string) => ({ op: 'add' as const, id: '', section: 'rules', key: 'none', text, sure: true, sensitive: 'no', asked: false });
    const r = C.applyOps('k1', [op('«Рейс» — одна поездка фуры 20 т'), op('Остатки склада: щебень 1240 т')], new Map(), { user: '«рейс» — одна поездка фуры 20 т', auto: true, threadId: null, messageId: null });
    expect(r.applied.map((a) => a.text)).toEqual(['«Рейс» — одна поездка фуры 20 т']);
    expect(r.skipped.map((x) => x.why)).toEqual(['workdata']);
    expect(M.listMemory('k1').some((x) => x.section === 'rules' && /Рейс/.test(x.text))).toBe(true);
  });
});

