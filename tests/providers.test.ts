import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpData } from './helpers';

tmpData();
let cur: { id: string } | null = null;
vi.mock('@/lib/adminAuth', async () => {
  const m = await import('@/lib/api');
  return { adminOrKey: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); const u = getDb().select().from(schema.users).all().find((x) => x.id === cur!.id)!; return u.role === 'admin' ? { user: u, viaKey: false } : { res: m.fail(403, 'admin') }; } };
});

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let P: typeof import('@/lib/providers'), M: typeof import('@/lib/models');
const seen: { url: string; auth: string | undefined; body: string }[] = [];
let srv: http.Server, base = '';

beforeAll(async () => {
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([{ id: 'adm', email: 'adm@t', name: 'adm', passwordHash: 'x', role: 'admin', createdAt: 1 }, { id: 'usr', email: 'usr@t', name: 'usr', passwordHash: 'x', role: 'user', createdAt: 1 }]).run();
  P = await import('@/lib/providers'); M = await import('@/lib/models');
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body: b });
      if (req.url?.endsWith('/models')) {
        if (req.headers.authorization !== 'Bearer sk-test-123') { res.writeHead(401); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'gpt-mini' }, { id: 'gpt-big' }] })); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'привет' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
});
afterAll(() => srv.close());
beforeEach(() => { cur = { id: 'adm' }; seen.length = 0; });

const post = async (path: string, body: unknown) => {
  const R = path === 'providers' ? await import('@/app/api/admin/providers/route') : await import('@/app/api/admin/models/route');
  return R.POST(new Request(`http://x/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
};

describe('провайдеры и модели из админки', () => {
  it('ключ — только зашифрованным в БД, в ответах — hasKey; null — убрать, без поля — оставить', async () => {
    const r = await (await post('providers', { name: 'Мой сервер', kind: 'openai-compatible', baseUrl: base + '/', key: 'sk-test-123' })).json();
    const id = r.id as string;
    expect(JSON.stringify(r)).not.toContain('sk-test-123');
    expect(r.providers.find((p: { id: string }) => p.id === id)).toMatchObject({ name: 'Мой сервер', baseUrl: base, hasKey: true });
    const row = db.select().from(schema.providers).all().find((p) => p.id === id)!;
    expect(row.keyEnc).toMatch(/^v1\./);
    expect(row.keyEnc).not.toContain('sk-test-123');
    expect(P.providerKey(id)).toBe('sk-test-123');
    await post('providers', { id, name: 'Мой сервер 2', kind: 'openai-compatible', baseUrl: base });
    expect(P.providerKey(id)).toBe('sk-test-123');
    await post('providers', { id, name: 'Мой сервер 2', kind: 'openai-compatible', baseUrl: base, key: null });
    expect(P.providerKey(id)).toBeNull();
    await post('providers', { id, name: 'Мой сервер', kind: 'openai-compatible', baseUrl: base, key: 'sk-test-123' });
    cur = { id: 'usr' };
    expect((await post('providers', { name: 'x', kind: 'openai' })).status).toBe(403);
  });

  it('пресет: адрес по виду, если не задан; проверка связи — /models с ключом', async () => {
    const r = await (await post('providers', { name: 'OpenAI', kind: 'openai' })).json();
    expect(r.providers.find((p: { id: string }) => p.id === r.id).baseUrl).toBe('https://api.openai.com/v1');
    const own = r.providers.find((p: { name: string }) => p.name === 'Мой сервер');
    const T = await import('@/app/api/admin/providers/test/route');
    const ok = await (await T.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ id: own.id }) }))).json();
    expect(ok).toEqual({ ok: true, models: ['gpt-mini', 'gpt-big'] });
    const bad = await (await T.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'openai-compatible', baseUrl: base, key: 'wrong' }) }))).json();
    expect(bad).toEqual({ ok: false, error: 'HTTP 401' });
    const { DELETE } = await import('@/app/api/admin/providers/route');
    await DELETE(new Request(`http://x/api/admin/providers?id=${r.id}`, { method: 'DELETE' }));
  });

  it('модель из админки — в общем списке; тот же id перекрывает конфиг; удаление провайдера уносит модели', async () => {
    const own = P.listProviders().find((p) => p.name === 'Мой сервер')!;
    const cfgFirst = M.getModels()[0];
    expect((await post('models', { id: 'mini', providerId: own.id, upstreamModel: 'gpt-mini', name: 'Mini', tools: true, contextTokens: 128000 })).status).toBe(200);
    const m = M.getModel('mini')!;
    expect(m).toMatchObject({ name: 'Mini', baseUrl: base, upstreamModel: 'gpt-mini', providerId: own.id, tools: true, contextTokens: 128000, defaultLevel: 'off' });
    expect(M.getModels().filter((x) => x.id === cfgFirst.id)).toHaveLength(1);
    await post('models', { id: cfgFirst.id, providerId: own.id, upstreamModel: 'gpt-big', name: 'Перекрыта' });
    expect(M.getModels().filter((x) => x.id === cfgFirst.id)).toEqual([expect.objectContaining({ name: 'Перекрыта', providerId: own.id })]);
    expect((await post('models', { id: 'Плохой id', providerId: own.id, upstreamModel: 'x', name: 'x' })).status).toBe(400);
    expect((await post('models', { id: 'x1', providerId: 'нет', upstreamModel: 'x', name: 'x' })).status).toBe(400);
    const { DELETE } = await import('@/app/api/admin/models/route');
    await DELETE(new Request(`http://x/api/admin/models?id=${cfgFirst.id}`, { method: 'DELETE' }));
    expect(M.getModel(cfgFirst.id)!.name).toBe(cfgFirst.name);
  });

  it('ход модели из админки идёт с ключом провайдера', async () => {
    const { streamChat } = await import('@/lib/upstream');
    const m = M.getModel('mini')!;
    const ev: string[] = [];
    for await (const e of streamChat({ model: m, level: m.levels[0], chatId: 't1', messages: [{ role: 'user', content: 'привет' }], signal: new AbortController().signal })) ev.push(e.t === 'c' ? e.d : e.t);
    expect(ev).toContain('привет');
    const call = seen.find((s) => s.url.endsWith('/chat/completions'))!;
    expect(call.auth).toBe('Bearer sk-test-123');
    expect(JSON.parse(call.body).model).toBe('gpt-mini');
  });

  it('удаление провайдера уносит его модели', async () => {
    const own = P.listProviders().find((p) => p.name === 'Мой сервер')!;
    const { DELETE } = await import('@/app/api/admin/providers/route');
    await DELETE(new Request(`http://x/api/admin/providers?id=${own.id}`, { method: 'DELETE' }));
    expect(M.getModel('mini')).toBeUndefined();
    expect(db.select().from(schema.adminModels).all()).toHaveLength(0);
  });
});

describe('без models.config.json', () => {
  it('файла нет — моделей из конфига нет, приложение живо; модели — из админки', async () => {
    const prev = process.env.MODELS_CONFIG;
    process.env.MODELS_CONFIG = '/nonexistent/korvex-models.json';
    M._resetModelsForTests();
    try {
      expect(M.getModels().filter((m) => !m.providerId)).toEqual([]);
    } finally { process.env.MODELS_CONFIG = prev; if (prev === undefined) delete process.env.MODELS_CONFIG; M._resetModelsForTests(); }
  });
});
