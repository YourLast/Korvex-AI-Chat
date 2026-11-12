import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const dir = tmpData();
let S: typeof import('@/lib/status');
let Bz: typeof import('@/lib/busy');
let J: typeof import('@/lib/jobs');
let route: typeof import('@/app/api/admin/busy/route');
let adminKey = '', userKey = '';

beforeAll(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = 'http://127.0.0.1:9/v1'; delete m.systemPromptFile; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  process.env.KX_PROBE = '0';
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb();
  db.insert(schema.users).values([
    { id: 'adm', email: 'a@t', name: 'Админ', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'usr', email: 'u@t', name: 'Пользователь', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  const K = await import('@/lib/apikeys');
  const users = db.select().from(schema.users).all();
  adminKey = (K.createKey(users.find((u) => u.id === 'adm')!, { name: 'скрипт', models: ['alpha'], rpm: 1000 }) as { key: string }).key;
  userKey = (K.createKey(users.find((u) => u.id === 'usr')!, { name: 'обычный', models: ['alpha'], rpm: 1000 }) as { key: string }).key;
  S = await import('@/lib/status');
  Bz = await import('@/lib/busy');
  J = await import('@/lib/jobs');
  route = await import('@/app/api/admin/busy/route');
});
afterEach(() => { Bz.stopBusyWatch(); vi.useRealTimers(); });
afterAll(() => { Bz.stopBusyWatch(); });

const req = (method: 'GET' | 'POST', key: string | null, body?: unknown) =>
  new Request('http://x/api/admin/busy', { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const busyBanner = () => S.statusFor('UTC').banners.find((b) => b.id === 'busy');
const T0 = Date.parse('2026-11-02T10:00:00Z');

describe('режим высокой нагрузки: баннер для всех по таймеру', () => {
  it('по умолчанию режим авто, очередь пуста — баннера нет', () => {
    expect(S.busyView().mode).toBe('auto');
    expect(busyBanner()).toBeUndefined();
  });

  it('ожидание ≥ 60 с держится 20 с -> баннер (info, точный текст); меньше 20 с держится 2 минуты -> баннер пропадает сам', () => {
    vi.useFakeTimers({ now: T0 });
    let eta = 75;
    Bz.startBusyWatch(() => eta, 5_000);
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(5_000); expect(busyBanner()).toBeUndefined(); }
    vi.advanceTimersByTime(5_000);
    expect(busyBanner()).toMatchObject({ id: 'busy', level: 'info', text: 'Сейчас высокая нагрузка — ответы могут задерживаться (~1 мин). Сообщения обрабатываются по очереди, место в очереди видно в чате.' });
    eta = 150; vi.advanceTimersByTime(5_000);
    expect(busyBanner()!.text).toContain('(~3 мин)');
    eta = 10; vi.advanceTimersByTime(5_000);
    for (let i = 0; i < 23; i++) { vi.advanceTimersByTime(5_000); expect(busyBanner()).toBeDefined(); }
    vi.advanceTimersByTime(5_000);
    expect(busyBanner()).toBeUndefined();
    expect(S.busyView().auto).toBe(false);
  });

  it('один таймер на процесс: повторный запуск не плодит проверки', () => {
    vi.useFakeTimers({ now: T0 });
    let calls = 0;
    Bz.startBusyWatch(() => { calls++; return 0; }, 5_000);
    Bz.startBusyWatch(() => { calls += 100; return 0; }, 5_000);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(calls).toBe(3);
  });

  it('KX_BUSY=0 — проверка не запускается', () => {
    process.env.KX_BUSY = '0';
    let calls = 0;
    Bz.startBusyWatch(() => { calls++; return 0; }, 50);
    delete process.env.KX_BUSY;
    expect(calls).toBe(0);
  });
});

describe('выбор администратора: Авто / Выкл / Вкл', () => {
  it('«Выкл» гасит баннер, даже когда авто-режим включён; «Авто» возвращает; «Вкл» показывает при пустой очереди (без числа)', () => {
    S.setBusyMode('auto');
    S.busyTick(120, T0); S.busyTick(120, T0 + 25_000);
    expect(S.busyView(T0 + 25_000)).toMatchObject({ mode: 'auto', on: true, auto: true });
    expect(S.statusFor('UTC', T0 + 25_000).banners.some((b) => b.id === 'busy')).toBe(true);
    S.setBusyMode('off');
    expect(S.busyView()).toMatchObject({ mode: 'off', on: false, auto: true });
    expect(busyBanner()).toBeUndefined();
    S.setBusyMode('auto');
    expect(busyBanner()).toBeDefined();
    S.busyTick(0, T0 + 30_000); S.busyTick(0, T0 + 30_000 + 121_000);
    expect(S.busyView()).toMatchObject({ on: false, auto: false });
    expect(busyBanner()).toBeUndefined();
    S.setBusyMode('on');
    expect(S.busyView()).toMatchObject({ mode: 'on', on: true, auto: false });
    expect(busyBanner()).toMatchObject({ id: 'busy', level: 'info' });
    expect(busyBanner()!.text).toBe('Сейчас высокая нагрузка — ответы могут задерживаться. Сообщения обрабатываются по очереди, место в очереди видно в чате.');
    S.setBusyMode('auto');
    expect(busyBanner()).toBeUndefined();
  });

  it('подпись баннера меняется при новом включении — скрывшие прошлый раз увидят снова', () => {
    S.setBusyMode('on'); const a = busyBanner()!.sig;
    S.setBusyMode('off'); S.setBusyMode('on'); const b = busyBanner()!.sig;
    expect(b).not.toBe(a);
    S.setBusyMode('on'); expect(busyBanner()!.sig).toBe(b);
    S.setBusyMode('auto');
  });

  it('выбор переживает перезапуск (data/status.json), неверный режим — ошибка 400', () => {
    S.setBusyMode('off');
    const f = path.join(dir, 'status.json');
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).busyMode).toBe('off');
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(() => S.setBusyMode('maybe' as never)).toThrow(S.StatusError);
    (globalThis as { __kxStatus?: unknown }).__kxStatus = undefined;
    expect(S.busyView().mode).toBe('off');
    S.setBusyMode('auto');
    fs.writeFileSync(f, JSON.stringify({ busyMode: 'зелёный' }));
    (globalThis as { __kxStatus?: unknown }).__kxStatus = undefined;
    expect(S.busyView().mode).toBe('auto');
  });

  it('три баннера вместе: объявление, нагрузка моделей и высокая нагрузка — в этом порядке', () => {
    S.setBanner({ text: 'Плановые работы', enabled: true });
    S.setLoad({ state: 'training' });
    S.setBusyMode('on');
    expect(S.statusFor('UTC').banners.map((b) => b.id)).toEqual(['manual', 'load', 'busy']);
    S.setBanner({ enabled: false }); S.setLoad({ state: 'normal' }); S.setBusyMode('auto');
  });
});

describe('/api/admin/busy и живые числа очереди', () => {
  it('без ключа 401, ключ обычного пользователя 403; режим не меняется', async () => {
    expect((await route.POST(req('POST', null, { mode: 'on' }))).status).toBe(401);
    expect((await route.POST(req('POST', userKey, { mode: 'on' }))).status).toBe(403);
    expect((await route.GET(req('GET', userKey))).status).toBe(403);
    expect(S.busyView().mode).toBe('auto');
  });

  it('администратор: выбор принимается и отражается в баннере; неверный режим — 400', async () => {
    const r = await route.POST(req('POST', adminKey, { mode: 'on' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mode: 'on', on: true });
    expect(busyBanner()).toBeDefined();
    expect((await route.POST(req('POST', adminKey, { mode: 'вкл' }))).status).toBe(400);
    expect((await route.POST(req('POST', adminKey, {}))).status).toBe(400);
    const off = await route.POST(req('POST', adminKey, { mode: 'off' }));
    expect(await off.json()).toMatchObject({ mode: 'off', on: false });
    expect(busyBanner()).toBeUndefined();
    await route.POST(req('POST', adminKey, { mode: 'auto' }));
  });

  it('GET: в работе / лимит, в очереди, среднее время хода, ожидание для нового — по очередям выбираемых моделей', async () => {
    const j = (await (await route.GET(req('GET', adminKey))).json()) as { mode: string; on: boolean; queues: { key: string; name: string; active: number; queued: number; limit: number; avg: number; etaNext: number }[] };
    expect(j).toMatchObject({ mode: 'auto', on: false });
    const alpha = j.queues.find((q) => q.key === 'alpha')!;
    expect(alpha).toMatchObject({ name: 'Alpha', active: 0, queued: 0, limit: 5, avg: 30, etaNext: 0 });
    expect(J.queuesStats().find((q) => q.key === 'beta-mac')).toMatchObject({ limit: 1, name: 'Beta' });
  });

  it('судят по очередям с лимитом ≥ 2: у Mac с лимитом 1 своя карточка очереди, режим она не включает', () => {
    expect(Bz.busyQueues().every((q) => q.limit >= 2)).toBe(true);
    expect(Bz.busyQueues().map((q) => q.key)).toContain('alpha');
    expect(Bz.busyQueues().map((q) => q.key)).not.toContain('beta-mac');
    expect(Bz.sampleEta()).toBe(0);
  });
});
