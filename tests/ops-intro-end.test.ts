import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_ENGINE_URL = 'http://127.0.0.1:9/v1';
process.env.KX_RULES_IDLE_MS = '600000';
const CHAT = '7d501c8b-faad-48e4-b75f-6debf2736a83', PLAIN = '11111111-2222-3333-4444-555555555555';
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const { INTRO } = await import('@/lib/memory');
  const now = Date.now();
  getDb().insert(schema.users).values([{ id: 'opsuser1', email: 'ops1@example.com', name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now, lastTz: 'Europe/Moscow', lang: 'ru' }]).run();
  getDb().insert(schema.threads).values([
    { id: CHAT, userId: 'opsuser1', title: 'Знакомство', modelId: 'alpha', createdAt: now, updatedAt: now, temporary: INTRO },
    { id: PLAIN, userId: 'opsuser1', title: 'Чат', modelId: 'alpha', createdAt: now, updatedAt: now, temporary: 0 },
  ]).run();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('служебный конец знакомства', () => {
  it('ставит конец и «сейчас», запускает вывод правил; повтор ничего не меняет', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules: ['Сначала итог, потом детали.', 'НДС показывать отдельной строкой.'] }) } }] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const R = await import('@/lib/memoryRules');
    R.registerRules();
    const { opsIntroEnd, opsRules } = await import('@/lib/ops');
    const M = await import('@/lib/memory');
    expect(M.memoryMeta('opsuser1').introEnd).toBeUndefined();
    const r = opsIntroEnd(CHAT);
    expect(r.status).toBe(200);
    expect(r.body.set).toBe(true);
    expect(M.memoryMeta('opsuser1').introEnd).toBeGreaterThan(0);
    expect(M.memoryMeta('opsuser1').rules?.now).toBeGreaterThan(0);
    await vi.waitFor(() => expect(M.memoryMeta('opsuser1').rules?.done).toBeGreaterThan(0), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const s = opsRules(CHAT).body as { rules: { n: number }; view: { state: string; n: number } };
    expect(s.rules.n).toBe(2);
    expect(s.view).toMatchObject({ state: 'done', n: 2 });
    expect(opsIntroEnd(CHAT).body.set).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('не чат знакомства, не uuid, нет чата — отказ', async () => {
    const { opsIntroEnd } = await import('@/lib/ops');
    expect(opsIntroEnd(PLAIN).status).toBe(409);
    expect(opsIntroEnd('x').status).toBe(400);
    expect(opsIntroEnd('99999999-2222-3333-4444-555555555555').status).toBe(404);
  });
  it('ключ: data/ops.key 0600, мост проверяет его', async () => {
    const { registerOps } = await import('@/lib/ops');
    const { dataDir } = await import('@/lib/db');
    registerOps();
    const f = path.join(dataDir(), 'ops.key');
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    const key = fs.readFileSync(f, 'utf8').trim();
    const ops = (globalThis as unknown as { __kxOps: { ok: (k: unknown) => boolean; run: (n: string, q: URLSearchParams) => { status: number } } }).__kxOps;
    expect(ops.ok(key)).toBe(true);
    expect(ops.ok('x'.repeat(key.length))).toBe(false);
    expect(ops.ok(undefined)).toBe(false);
    expect(ops.run('nope', new URLSearchParams()).status).toBe(404);
  });
});

describe('тестовая учетка: подсчет и удаление штатным deleteUser', () => {
  it('только @example.com, роль user, созданная за сутки; dry — только числа; удаление — вместе с чатами и памятью', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const { opsTestUser } = await import('@/lib/ops');
    const M = await import('@/lib/memory');
    const now = Date.now();
    getDb().insert(schema.users).values([
      { id: 'synth1', email: 'ie-intro-x1@example.com', name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now, lang: 'ru' },
      { id: 'synth2', email: 'old-x@example.com', name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now - 3 * 864e5, lang: 'ru' },
      { id: 'synth3', email: 'adm-x@example.com', name: 'Тест', passwordHash: 'x', role: 'admin' as const, createdAt: now, lang: 'ru' },
      { id: 'real1', email: 'person@mail.test', name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now, lang: 'ru' },
    ]).run();
    getDb().insert(schema.threads).values({ id: '22222222-2222-4222-8222-222222222222', userId: 'synth1', title: 'Знакомство', modelId: 'alpha', createdAt: now, updatedAt: now, temporary: M.INTRO }).run();
    M.addMemory('synth1', { section: 'work', text: 'Бухгалтер на аутсорсе', origin: 'auto', sure: true });
    expect(opsTestUser('person@mail.test', { dry: true }).status).toBe(400);
    expect(opsTestUser('old-x@example.com', { dry: false }).status).toBe(409);
    expect(opsTestUser('adm-x@example.com', { dry: false }).status).toBe(409);
    expect(opsTestUser('nobody@example.com', { dry: true }).status).toBe(404);
    const d = opsTestUser('ie-intro-x1@example.com', { dry: true });
    expect(d.body).toMatchObject({ dry: true, chats: 1, memory: 1, files: 0 });
    expect(getDb().select().from(schema.users).where((await import('drizzle-orm')).eq(schema.users.id, 'synth1')).get()).toBeTruthy();
    const r = opsTestUser('ie-intro-x1@example.com', { dry: false });
    expect(r.body).toMatchObject({ deleted: true, chats: 1, memory: 1 });
    const { eq } = await import('drizzle-orm');
    expect(getDb().select().from(schema.threads).where(eq(schema.threads.userId, 'synth1')).all()).toHaveLength(0);
    expect(getDb().select().from(schema.userMemory).where(eq(schema.userMemory.userId, 'synth1')).all()).toHaveLength(0);
    expect(getDb().select().from(schema.users).where(eq(schema.users.id, 'real1')).get()).toBeTruthy();
    const audit = getDb().select().from(schema.adminAudit).all().filter((a) => a.targetEmail === 'ie-intro-x1@example.com');
    expect(audit[0]).toMatchObject({ adminId: 'system:ops', action: 'delete', adminName: 'Система' });
  });
});
