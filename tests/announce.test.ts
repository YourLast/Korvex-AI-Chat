import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
import { ALL, entryFor, fmtUntil, loadBanner, manualBanner, modelLive, parseUntil, downNotice, type LoadMap } from '@/lib/announce';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const models = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }];
const NOW = Date.parse('2026-10-29T10:00:00Z');
const ent = (state: 'training' | 'down', until: number | null = null, rev = 1) => ({ state, until, rev, at: NOW });

describe('тексты баннера из флага нагрузки', () => {
  it('обучение у всех: готовая фраза про замедление, уровень info', () => {
    const b = loadBanner(models, { [ALL]: ent('training') }, {}, 'UTC', NOW)!;
    expect(b.text).toBe('Идёт дообучение моделей — ответы могут приходить медленнее');
    expect(b.level).toBe('info');
  });
  it('обучение одной модели называет её', () => {
    expect(loadBanner(models, { alpha: ent('training') }, {}, 'UTC', NOW)!.text).toBe('Идёт дообучение Alpha — ответы могут приходить медленнее');
  });
  it('Alpha недоступна: срок «до ~ЧЧ:ММ» в поясе пользователя и совет другой модели, уровень warn', () => {
    const until = Date.parse('2026-10-29T14:30:00Z');
    expect(loadBanner(models, { alpha: ent('down', until) }, {}, 'UTC', NOW)!.text).toBe('Alpha временно недоступна (обучение), до ~14:30 — попробуйте Beta');
    expect(loadBanner(models, { alpha: ent('down', until) }, {}, 'Europe/Moscow', NOW)!.text).toContain('до ~17:30');
    expect(loadBanner(models, { alpha: ent('down', until) }, {}, 'UTC', NOW)!.level).toBe('warn');
  });
  it('без срока — без «до»; недоступны обе — «попробуйте позже»', () => {
    expect(loadBanner(models, { alpha: ent('down') }, {}, 'UTC', NOW)!.text).toBe('Alpha временно недоступна (обучение) — попробуйте Beta');
    expect(loadBanner(models, { [ALL]: ent('down') }, {}, 'UTC', NOW)!.text).toBe('Alpha и Beta временно недоступны (обучение) — попробуйте позже');
  });
  it('одна недоступна, другая учится: обе фразы; если Beta не отвечает по шлюзу — её не предлагаем', () => {
    const load: LoadMap = { alpha: ent('down'), beta: ent('training', null, 2) };
    expect(loadBanner(models, load, {}, 'UTC', NOW)!.text).toBe('Alpha временно недоступна (обучение) — попробуйте Beta. Идёт дообучение Beta — ответы могут приходить медленнее');
    expect(loadBanner(models, load, { beta: { ok: false, fails: 3, at: NOW } }, 'UTC', NOW)!.text).toContain('попробуйте позже');
  });
  it('норма и просроченные записи — баннера нет; подпись меняется с каждой правкой', () => {
    expect(loadBanner(models, {}, {}, 'UTC', NOW)).toBeNull();
    expect(loadBanner(models, { [ALL]: ent('down', NOW - 1) }, {}, 'UTC', NOW)).toBeNull();
    expect(loadBanner(models, { [ALL]: ent('training', null, 5) }, {}, 'UTC', NOW)!.sig).not.toBe(loadBanner(models, { [ALL]: ent('training', null, 6) }, {}, 'UTC', NOW)!.sig);
  });
});

describe('состояние модели', () => {
  it('флаг down или шлюз не отвечает два раза подряд -> недоступна; training -> медленно; один сбой шлюза — ещё работает', () => {
    expect(modelLive('alpha', {}, undefined, NOW).state).toBe('ok');
    expect(modelLive('alpha', { [ALL]: ent('training') }, undefined, NOW).state).toBe('slow');
    expect(modelLive('alpha', { alpha: ent('down') }, undefined, NOW).state).toBe('down');
    expect(modelLive('beta', { alpha: ent('down') }, undefined, NOW).state).toBe('ok');
    expect(modelLive('alpha', {}, { ok: false, fails: 1, at: NOW }, NOW).state).toBe('ok');
    expect(modelLive('alpha', {}, { ok: false, fails: 2, at: NOW }, NOW).state).toBe('down');
    expect(modelLive('alpha', { [ALL]: ent('training') }, { ok: false, fails: 2, at: NOW }, NOW).state).toBe('down');
  });
  it('худшая запись побеждает; срок истёк — запись не действует', () => {
    expect(entryFor({ [ALL]: ent('training'), alpha: ent('down') }, 'alpha', NOW)!.state).toBe('down');
    expect(entryFor({ alpha: ent('down', NOW - 1) }, 'alpha', NOW)).toBeNull();
  });
  it('отказ при отправке: фраза с другой моделью и сроком', () => {
    expect(downNotice(models[0], Date.parse('2026-10-29T14:30:00Z'), models[1], 'UTC', NOW)).toBe('Alpha временно недоступна до ~14:30. Попробуйте Beta.');
    expect(downNotice(models[0], null, null, 'UTC', NOW)).toBe('Alpha временно недоступна. Попробуйте чуть позже.');
  });
});

describe('баннер администратора и сроки', () => {
  const b = { enabled: true, text: ' Плановые работы ', level: 'warn' as const, until: null, rev: 3, at: NOW };
  it('показывается, пока включён, с текстом и не истёк', () => {
    expect(manualBanner(b, NOW)).toMatchObject({ id: 'manual', level: 'warn', text: 'Плановые работы', sig: 'm3' });
    expect(manualBanner({ ...b, enabled: false }, NOW)).toBeNull();
    expect(manualBanner({ ...b, text: '  ' }, NOW)).toBeNull();
    expect(manualBanner({ ...b, until: NOW - 1 }, NOW)).toBeNull();
    expect(manualBanner({ ...b, until: NOW + 1 }, NOW)).not.toBeNull();
  });
  it('срок: ISO, миллисекунды, минуты, пусто, мусор', () => {
    expect(parseUntil('2026-10-30T18:00:00+03:00')).toBe(Date.parse('2026-10-30T15:00:00Z'));
    expect(parseUntil(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(parseUntil(undefined, 90, NOW)).toBe(NOW + 90 * 60_000);
    expect(parseUntil(null)).toBeNull();
    expect(parseUntil(undefined)).toBeUndefined();
    expect(parseUntil('когда-нибудь')).toBe('bad');
  });
  it('время в поясе пользователя; не сегодня — с датой', () => {
    expect(fmtUntil(Date.parse('2026-10-29T14:30:00Z'), 'Europe/Moscow', NOW)).toBe('17:30');
    expect(fmtUntil(Date.parse('2026-10-30T14:30:00Z'), 'UTC', NOW)).toBe('30.10 14:30');
  });
});

const dir = tmpData();
let srv: http.Server;
let modelsOk = true;
const hits: string[] = [];
let S: typeof import('@/lib/status');
let K: typeof import('@/lib/apikeys');
let bannerRoute: typeof import('@/app/api/admin/banner/route');
let loadRoute: typeof import('@/app/api/admin/load-state/route');
let chatApi: typeof import('@/app/v1/chat/completions/route').POST;
let adminKey = '', userKey = '';

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') { hits.push('models'); res.writeHead(modelsOk ? 200 : 503); return res.end('{}'); }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      hits.push('chat');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: 'Привет' }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  process.env.KX_PROBE = '0';
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb();
  db.insert(schema.users).values([
    { id: 'adm', email: 'a@t', name: 'Админ', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'usr', email: 'u@t', name: 'Пользователь', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  K = await import('@/lib/apikeys');
  const users = db.select().from(schema.users).all();
  adminKey = (K.createKey(users.find((u) => u.id === 'adm')!, { name: 'скрипт', models: ['alpha', 'beta'], rpm: 100 }) as { key: string }).key;
  userKey = (K.createKey(users.find((u) => u.id === 'usr')!, { name: 'обычный', models: ['alpha', 'beta'], rpm: 100 }) as { key: string }).key;
  S = await import('@/lib/status');
  bannerRoute = await import('@/app/api/admin/banner/route');
  loadRoute = await import('@/app/api/admin/load-state/route');
  chatApi = (await import('@/app/v1/chat/completions/route')).POST;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const post = (url: string, key: string | null, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
const ask = (model: string) => chatApi(post('/v1/chat/completions', userKey, { model, messages: [{ role: 'user', content: 'Привет' }] }));

describe('API объявлений: ключ администратора', () => {
  it('без ключа и с ключом обычного пользователя — отказ, баннер не меняется', async () => {
    expect((await bannerRoute.POST(post('/api/admin/banner', null, { text: 'x', enabled: true }))).status).toBe(401);
    expect((await bannerRoute.POST(post('/api/admin/banner', userKey, { text: 'x', enabled: true }))).status).toBe(403);
    expect((await loadRoute.POST(post('/api/admin/load-state', userKey, { state: 'down' }))).status).toBe(403);
    expect(S.statusFor('UTC').banners).toEqual([]);
  });
  it('включить и выключить баннер; пустой текст, прошедший срок, мусор — 400', async () => {
    expect((await bannerRoute.POST(post('/api/admin/banner', adminKey, { enabled: true }))).status).toBe(400);
    expect((await bannerRoute.POST(post('/api/admin/banner', adminKey, { text: 'Работы', enabled: true, until: '2020-01-01T00:00:00Z' }))).status).toBe(400);
    expect((await bannerRoute.POST(post('/api/admin/banner', adminKey, { text: 'Работы', enabled: true, until: 'завтра' }))).status).toBe(400);
    const on = await bannerRoute.POST(post('/api/admin/banner', adminKey, { text: 'Плановые работы до утра', level: 'warning', minutes: 60, enabled: true }));
    expect(on.status).toBe(200);
    const b1 = S.statusFor('UTC').banners.find((b) => b.id === 'manual')!;
    expect(b1).toMatchObject({ text: 'Плановые работы до утра', level: 'warn' });
    await bannerRoute.POST(post('/api/admin/banner', adminKey, { text: 'Плановые работы до обеда' }));
    expect(S.statusFor('UTC').banners.find((b) => b.id === 'manual')!.sig).not.toBe(b1.sig);
    await bannerRoute.POST(post('/api/admin/banner', adminKey, { enabled: false }));
    expect(S.statusFor('UTC').banners.find((b) => b.id === 'manual')).toBeUndefined();
  });
  it('состояние переживает перезапуск: лежит в data/status.json (0600)', () => {
    const f = path.join(dir, 'status.json');
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).banner.text).toBe('Плановые работы до обеда');
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe('флаг нагрузки -> баннер и метки', () => {
  it('training для всех: баннер и «медленно» у обеих; normal снимает всё', async () => {
    const r = await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'training' }));
    expect(r.status).toBe(200);
    const s = S.statusFor('UTC');
    expect(s.banners.find((b) => b.id === 'load')!.text).toBe('Идёт дообучение моделей — ответы могут приходить медленнее');
    expect(s.models.alpha.state).toBe('slow');
    expect(s.models.beta.state).toBe('slow');
    await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'normal' }));
    expect(S.statusFor('UTC').banners.find((b) => b.id === 'load')).toBeUndefined();
    expect(S.statusFor('UTC').models.alpha.state).toBe('ok');
  });
  it('неизвестная модель или состояние — 400', async () => {
    expect((await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'down', model: 'gpt' }))).status).toBe(400);
    expect((await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'sleep' }))).status).toBe(400);
  });
  it('флаг со сроком гаснет сам', async () => {
    await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'down', model: 'alpha', minutes: 5 }));
    expect(S.statusFor('UTC').models.alpha.state).toBe('down');
    expect(S.statusFor('UTC', Date.now() + 6 * 60_000).models.alpha.state).toBe('ok');
    await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'normal' }));
  });
});

describe('отправка в недоступную модель: понятный отказ, не 500', () => {
  it('флаг down: 503 model_unavailable с предложением Beta; в шлюз ничего не ушло; другая модель отвечает', async () => {
    await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'down', model: 'alpha', minutes: 60 }));
    const before = hits.filter((h) => h === 'chat').length;
    const r = await ask('alpha');
    expect(r.status).toBe(503);
    const j = (await r.json()) as { error: { message: string; code: string } };
    expect(j.error.code).toBe('model_unavailable');
    expect(j.error.message).toMatch(/^Alpha временно недоступна до ~(\d\d\.\d\d )?\d\d:\d\d\. Попробуйте Beta\.$/)
    expect(hits.filter((h) => h === 'chat').length).toBe(before);
    const ok = await ask('beta');
    expect(ok.status).toBe(200);
    await loadRoute.POST(post('/api/admin/load-state', adminKey, { state: 'normal' }));
    expect((await ask('alpha')).status).toBe(200);
  });
});

describe('проверка шлюзов', () => {
  it('один сбой — ещё работает, второй подряд — недоступна, ответ шлюза — снова работает', async () => {
    await S.probeOnce(fetch, 2000);
    expect(S.statusFor('UTC').models.beta.state).toBe('ok');
    modelsOk = false;
    await S.probeOnce(fetch, 2000);
    expect(S.statusFor('UTC').models.beta.state).toBe('ok');
    await S.probeOnce(fetch, 2000);
    expect(S.statusFor('UTC').models.beta.state).toBe('down');
    expect(S.modelUnavailable('beta', 'UTC')!.text).toContain('Попробуйте');
    expect((await ask('beta')).status).toBe(503);
    modelsOk = true;
    await S.probeOnce(fetch, 2000);
    expect(S.statusFor('UTC').models.beta.state).toBe('ok');
  });
  it('шлюз не поднимает соединение — тоже сбой, без исключения', async () => {
    await S.probeOnce(() => Promise.reject(new TypeError('fetch failed')), 500);
    await S.probeOnce(() => Promise.reject(new TypeError('fetch failed')), 500);
    expect(S.statusFor('UTC').models.alpha.state).toBe('down');
    await S.probeOnce(fetch, 2000);
    expect(S.statusFor('UTC').models.alpha.state).toBe('ok');
  });
});
