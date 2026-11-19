import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
const MAIN = 'http://127.0.0.1:9/v1';
const HELP = 'http://127.0.0.1:10/v1';
process.env.KX_MEMORY_ENGINE_URL = MAIN;
process.env.KX_MEMORY_ENGINE_MODEL = 'main-model';
process.env.KX_TITLE_ENGINE_URL = MAIN;
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values({ id: 'b1', email: 'b1@example.com', name: 'Тест', passwordHash: 'x', role: 'user', createdAt: Date.now(), lastTz: 'Europe/Moscow', lang: 'ru' }).run();
});
afterEach(async () => {
  delete process.env.KX_BG_ENGINE_URL; delete process.env.KX_BG_ENGINE_MODEL; delete process.env.KX_BG_FALLBACK;
  (await import('@/lib/bgEngine')).bgReset();
});

describe('bgEngine', () => {
  it('без флага — старые адреса и модель', async () => {
    const C = await import('@/lib/curator');
    const T = await import('@/lib/titles');
    expect(C.curatorUrl()).toBe(MAIN);
    expect(T.gateUrl()).toBe(MAIN);
    expect(C.MODEL()).toBe('main-model');
  });

  it('флаг: куратор, названия и правила — на помощника, его модель', async () => {
    process.env.KX_BG_ENGINE_URL = HELP + '/';
    process.env.KX_BG_ENGINE_MODEL = 'small';
    const C = await import('@/lib/curator');
    const T = await import('@/lib/titles');
    const B = await import('@/lib/bgEngine');
    expect(C.curatorUrl()).toBe(HELP);
    expect(T.gateUrl()).toBe(HELP);
    expect(B.modelFor(C.curatorUrl(), C.MODEL())).toBe('small');
    expect(B.modelFor(MAIN, C.MODEL())).toBe('main-model');
    const R = await import('@/lib/memoryRules');
    let seen: { url: string; model: string } | null = null;
    const f = (async (url: string, init: { body: string }) => { seen = { url, model: JSON.parse(init.body).model }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"rules":["Сначала итог, потом расчёт"]}' } }] }) }; }) as unknown as typeof fetch;
    R.queueRules('b1');
    expect(await R.runRules('b1', { fetchImpl: f })).toBe('done');
    expect(seen).toEqual({ url: HELP + '/chat/completions', model: 'small' });
  });

  it('помощник недоступен — фон на основной движок, через паузу снова помощник', async () => {
    process.env.KX_BG_ENGINE_URL = HELP;
    const B = await import('@/lib/bgEngine');
    const C = await import('@/lib/curator');
    const now = Date.now();
    expect(B.bgDown(MAIN, 'x', now)).toBe(false);
    expect(B.bgDown(HELP, 'ECONNREFUSED', now)).toBe(true);
    expect(C.curatorUrl()).toBe(MAIN);
    expect(B.bgActive(now + 61_000)).toBe(true);
  });

  it('KX_BG_FALLBACK=0 — не уходить на основной', async () => {
    process.env.KX_BG_ENGINE_URL = HELP;
    process.env.KX_BG_FALLBACK = '0';
    const B = await import('@/lib/bgEngine');
    const C = await import('@/lib/curator');
    expect(B.bgDown(HELP, 'ECONNREFUSED')).toBe(false);
    expect(C.curatorUrl()).toBe(HELP);
  });

  it('правила на помощнике не ждут простоя основного движка', async () => {
    process.env.KX_BG_ENGINE_URL = HELP;
    const B = await import('@/lib/bgEngine');
    expect(B.bgActive()).toBe(true);
    const src = (await import('node:fs')).readFileSync('src/lib/memoryRules.ts', 'utf8');
    expect(src).toMatch(/!bgActive\(now\) && liveTotal\(\) > 0/);
    expect(src).toMatch(/!onBg && liveTotal\(\) > 0/);
  });
});
