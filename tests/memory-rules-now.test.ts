import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_ENGINE_URL = 'http://127.0.0.1:9/v1';
process.env.KX_RULES_IDLE_MS = '600000';
const IDS = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values(IDS.map((id) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: Date.now(), lastTz: 'Europe/Moscow', lang: 'ru' }))).run();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.KX_RULES_NOW; });

const ended = async (id: string) => { const M = await import('@/lib/memory'); const now = Date.now(); M.setMemoryMeta(id, { introEnd: now, rules: { pending: now } }); };
const answer = (rules: string[], ms = 0) => vi.fn(async () => { if (ms) await new Promise((r) => setTimeout(r, ms)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules }) } }] }) }; });

describe('виджет «Вывести правила сейчас?»', () => {
  it('только после явного конца знакомства', async () => {
    const R = await import('@/lib/memoryRules');
    const M = await import('@/lib/memory');
    expect(R.rulesView('n0').state).toBe('none');
    M.setMemoryMeta('n0', { rules: { pending: Date.now() } });
    expect(R.rulesView('n0').state).toBe('none');
    await ended('n0');
    expect(R.rulesView('n0').state).toBe('offer');
    process.env.KX_RULES_NOW = '0';
    expect(R.rulesView('n0').state).toBe('none');
  });

  it('«Позже» — виджет скрыт, задача ждёт простоя как раньше', async () => {
    const R = await import('@/lib/memoryRules');
    const M = await import('@/lib/memory');
    await ended('n1');
    expect(R.rulesAction('n1', 'later').state).toBe('none');
    expect(M.memoryMeta('n1').rules?.pending).toBeGreaterThan(0);
    expect(M.memoryMeta('n1').rules?.now).toBeUndefined();
    expect(await R.rulesTick()).toBeNull();
    M.setMemoryMeta('n1', { rules: {} });
  });

  it('«Запустить сейчас»: стартует без простоя, ход человека не обрывает, «Готово: N», повторное нажатие ничего не добавляет', async () => {
    const R = await import('@/lib/memoryRules');
    const M = await import('@/lib/memory');
    const J = await import('@/lib/jobs');
    vi.spyOn(J, 'liveTotal').mockReturnValue(2);
    const f = answer(['Считать НДС до копеек', 'Сначала итог, потом расчёт']);
    vi.stubGlobal('fetch', f);
    await ended('n2');
    expect(R.rulesAction('n2', 'now')).toMatchObject({ state: 'queued', pos: 1 });
    expect(R.rulesAction('n2', 'now')).toMatchObject({ state: 'queued', pos: 1 });
    expect(await R.rulesTick()).toBe('done');
    expect(f).toHaveBeenCalledTimes(1);
    expect(R.rulesView('n2')).toMatchObject({ state: 'done', n: 2 });
    expect(M.listMemory('n2').filter((r) => r.section === 'rules')).toHaveLength(2);
    expect(R.rulesAction('n2', 'now')).toMatchObject({ state: 'done', n: 2 });
    expect(M.memoryMeta('n2').rules?.pending).toBeUndefined();
    expect(await R.rulesTick()).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(R.rulesAction('n2', 'seen').state).toBe('none');
    expect(R.rulesNotice('n2')).toBe(0);
  });

  it('одна задача на сервер: второй — «в очереди», стартует сам после первого', async () => {
    const R = await import('@/lib/memoryRules');
    vi.stubGlobal('fetch', answer(['Ставки сверять по nalog.gov.ru'], 150));
    await ended('n3'); await ended('n4');
    R.rulesAction('n3', 'now');
    const first = R.rulesTick();
    await new Promise((r) => setTimeout(r, 20));
    expect(R.rulesView('n3').state).toBe('running');
    expect(R.rulesAction('n4', 'now')).toMatchObject({ state: 'queued', pos: 2 });
    expect(await R.rulesTick()).toBeNull();
    expect(await first).toBe('done');
    expect(R.rulesView('n4')).toMatchObject({ state: 'queued', pos: 1 });
    expect(await R.rulesTick()).toBe('done');
    expect(R.rulesView('n4')).toMatchObject({ state: 'done', n: 1 });
  });

  it('неудача — «Не получилось», «Ещё раз» ставит снова', async () => {
    const R = await import('@/lib/memoryRules');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, body: null })));
    await ended('n5');
    R.rulesAction('n5', 'now');
    expect(await R.rulesTick()).toBe('fail');
    expect(R.rulesView('n5').state).toBe('failed');
    vi.stubGlobal('fetch', answer(['Сначала итог, потом расчёт']));
    expect(R.rulesAction('n5', 'now').state).toBe('queued');
    expect(await R.rulesTick()).toBe('done');
    expect(R.rulesView('n5')).toMatchObject({ state: 'done', n: 1 });
  });

  it('движок недоступен (5xx) — задача остаётся в очереди «сейчас»', async () => {
    const R = await import('@/lib/memoryRules');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, body: null })));
    await ended('n6');
    R.rulesAction('n6', 'now');
    expect(await R.rulesTick()).toBe('yield');
    expect(R.rulesView('n6').state).toBe('queued');
  });
});
