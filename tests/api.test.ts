import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
type Body = { model: string; reasoning_effort?: string; messages: Record<string, unknown>[]; chat: string | undefined; agent: string | undefined;
  tools?: unknown[]; tool_choice?: unknown; parallel_tool_calls?: boolean; max_tokens?: number; stream?: boolean };
const bodies: Body[] = [];
let srv: http.Server;

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let K: typeof import('@/lib/apikeys');
let chat: typeof import('@/app/v1/chat/completions/route').POST, models: typeof import('@/app/v1/models/route').GET;
let user: import('@/lib/db/schema').User;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      const agent = req.headers['x-korvex-agent'] as string | undefined;
      bodies.push({ ...body, chat: req.headers['x-korvex-chat-id'] as string | undefined, agent });
      const ch = (delta: unknown, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`);
      if (agent === '1') { await agentReply(body, res, ch); return; }
      const lastQ = JSON.stringify(body.messages?.[body.messages.length - 1]?.content ?? '');
      if (lastQ.includes('ENGINE502')) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'engine is restarting' } })); return; }
      const merr = { message: 'Модель на обслуживании', type: 'server_error', param: null, code: 'maintenance' };
      if (lastQ.includes('MAINT503')) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: merr, retry_after: 7 })); return; }
      if (lastQ.includes('SLOWAPI')) await new Promise((r) => setTimeout(r, 400));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (lastQ.includes('MAINTMID')) { ch({ role: 'assistant', content: '' }); ch({ content: 'Начал' }); res.write(`data: ${JSON.stringify({ object: 'maintenance', retry_after: 9, error: merr })}\n\n`); res.end('data: [DONE]\n\n'); return; }
      if (lastQ.includes('ENGINECUT')) { ch({ role: 'assistant', content: '' }); ch({ content: 'Начал' }); setTimeout(() => res.destroy(), 20); return; }
      ch({ role: 'assistant', content: '' });
      if (body.reasoning_effort !== 'none') ch({ reasoning_content: 'думаю. ' });
      for (const w of ['При', 'вет', '!']) { ch({ content: w }); await new Promise((r) => setTimeout(r, 10)); }
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14, memory: { total_tokens: 40, limit_tokens: 1000, remaining_tokens: 960 } } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'Владелец', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  user = db.select().from(schema.users).get()!;
  K = await import('@/lib/apikeys');
  K.registerKeyUsage();
  chat = (await import('@/app/v1/chat/completions/route')).POST;
  models = (await import('@/app/v1/models/route')).GET;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

async function agentReply(body: Body & { messages: { role: string; content: unknown }[] }, res: http.ServerResponse, ch: (d: unknown, extra?: object) => void) {
  const last = body.messages.at(-1)!;
  const q = JSON.stringify(body.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
  const fin = (f: string) => {
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: f }], ext: { agent: { messages: body.messages.length, dropped: 0 } } })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  };
  if (q.includes('JSONREPLY')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: body.model, usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_j', type: 'function', function: { name: 'read_file', arguments: '{"path":"j.txt"}' } }] }, finish_reason: 'tool_calls' }] }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  ch({ role: 'assistant' });
  res.write(': thinking\n\n');
  if (body.reasoning_effort !== 'none') ch({ reasoning_content: 'нужно прочитать файл. ' });
  if (q.includes('BROKEN')) { res.end(`data: ${JSON.stringify({ error: { message: 'engine stream aborted', type: 'internal_error' } })}\n\ndata: [DONE]\n\n`); return; }
  if (last.role === 'tool' || !body.tools?.length) {
    for (const w of ['В файле ', 'написано: ', String(last.role === 'tool' ? last.content : '—')]) { ch({ content: w }); await new Promise((r) => setTimeout(r, 5)); }
    fin('stop');
    return;
  }
  ch({ tool_calls: [{ index: 0, id: 'call_r1', type: 'function', function: { name: 'read_file', arguments: '' } }] });
  for (const a of ['{"path"', ': "a', '.txt"}']) { ch({ tool_calls: [{ index: 0, function: { arguments: a } }] }); await new Promise((r) => setTimeout(r, 5)); }
  if (q.includes('PARALLEL')) {
    ch({ tool_calls: [{ index: 1, id: 'call_l2', type: 'function', function: { name: 'list_dir', arguments: '{"path": "."}' } }] });
  }
  fin('tool_calls');
}

const req = (key: string | null, body?: unknown, headers: Record<string, string> = {}) => new Request('http://x/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify(body ?? {}),
});
const hi = { model: 'beta', messages: [{ role: 'user', content: 'Привет' }] };

describe('ключи API', () => {
  it('создаётся: ключ kx-… один раз, в БД — только хеш; отзывается — дальше 401', async () => {
    const r = K.createKey(user, { name: 'тест', models: ['beta'] });
    if ('error' in r) throw new Error(r.error);
    expect(r.key).toMatch(/^kx-[A-Za-z0-9_-]{40}$/);
    const row = db.select().from(schema.apiKeys).get()!;
    expect(row.keyHash).not.toContain(r.key.slice(3));
    expect(JSON.stringify(row)).not.toContain(r.key);
    expect(row.levels).toEqual({ beta: 'off' });
    expect((await chat(req(r.key, hi))).status).toBe(200);
    expect(K.revokeKey(user, r.view.id)).toBe(true);
    const res = await chat(req(r.key, hi));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_api_key');
  });
  it('без ключа, неверный, истёкший — 401 в формате OpenAI', async () => {
    expect((await chat(req(null, hi))).status).toBe(401);
    expect((await chat(req('kx-nope', hi))).status).toBe(401);
    const r = K.createKey(user, { name: 'срок', models: ['beta'], expiresDays: 1 });
    if ('error' in r) throw new Error(r.error);
    db.update(schema.apiKeys).set({ expiresAt: Date.now() - 1 }).run();
    const res = await chat(req(r.key, hi));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { type: 'authentication_error', message: 'Срок действия ключа истёк' } });
  });
});

describe('/v1', () => {
  let key = '', keyId = '';
  beforeAll(() => {
    const r = K.createKey(user, { name: 'рабочий', models: ['beta'], levels: { beta: 'on' }, rpm: 4 });
    if ('error' in r) throw new Error(r.error);
    key = r.key; keyId = r.view.id;
  });
  it('чужая модель -> 403, неизвестная -> 404, неверный уровень -> 400', async () => {
    const a = await chat(req(key, { ...hi, model: 'alpha' }));
    expect(a.status).toBe(403);
    expect(((await a.json()) as { error: { code: string } }).error.code).toBe('model_not_allowed');
    expect((await chat(req(key, { ...hi, model: 'gpt-9' }))).status).toBe(404);
    const c = await chat(req(key, { ...hi, reasoning_effort: 'banana' }));
    expect(c.status).toBe(400);
    expect(((await c.json()) as { error: { message: string } }).error.message).toMatch(/none, on/);
  });
  it('без стрима: ответ, размышление, finish_reason, usage с memory; уровень ключа по умолчанию уходит в шлюз', async () => {
    bodies.length = 0;
    const res = await chat(req(key, hi));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { object: string; model: string; choices: { message: { content: string; reasoning_content?: string }; finish_reason: string }[]; usage: Record<string, unknown> };
    expect(j.object).toBe('chat.completion');
    expect(j.choices[0].message.content).toBe('Привет!');
    expect(j.choices[0].message.reasoning_content).toBe('думаю. ');
    expect(j.choices[0].finish_reason).toBe('stop');
    expect(j.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 3, total_tokens: 14, memory: { total_tokens: 40 } });
    expect(bodies[0]).toMatchObject({ model: 'up-beta-0-4b', reasoning_effort: 'on' });
  });
  it('reasoning_effort "none" -> off; stream: чанки, размышления нет, usage-чанк и [DONE]', async () => {
    bodies.length = 0;
    const res = await chat(req(key, { ...hi, reasoning_effort: 'none', stream: true, stream_options: { include_usage: true } }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const datas = text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
    expect(datas.at(-1)).toBe('[DONE]');
    const chunks = datas.slice(0, -1).map((d) => JSON.parse(d) as { object: string; choices: { delta: { content?: string; reasoning_content?: string }; finish_reason: string | null }[]; usage?: Record<string, unknown> });
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true);
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('')).toBe('Привет!');
    expect(chunks.some((c) => c.choices[0]?.delta?.reasoning_content)).toBe(false);
    expect(chunks.find((c) => c.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe('stop');
    expect(chunks.at(-1)!.usage).toMatchObject({ total_tokens: 14, memory: { remaining_tokens: 960 } });
    expect(bodies[0].reasoning_effort).toBe('none');
  });
  it('лимит ключа в минуту -> 429 с Retry-After', async () => {
    expect((await chat(req(key, hi))).status).toBe(200);
    expect((await chat(req(key, hi))).status).toBe(200);
    const res = await chat(req(key, hi));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rate_limit_exceeded');
  });
  it('предел одновременных задач на пользователя (6, как у вебки) действует и для ключей API: седьмой запрос — 429 too_many_concurrent', async () => {
    const r = K.createKey(user, { name: 'много', models: ['beta'], levels: { beta: 'on' }, rpm: 600 });
    if ('error' in r) throw new Error(r.error);
    const slow = { model: 'beta', messages: [{ role: 'user', content: 'SLOWAPI' }] };
    const all = await Promise.all(Array.from({ length: 7 }, () => chat(req(r.key, slow))));
    const codes = all.map((x) => x.status).sort();
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 429]);
    const bad = all.find((x) => x.status === 429)!;
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('too_many_concurrent');
    await Promise.all(all.filter((x) => x.status === 200).map((x) => x.text()));
  });
});

describe('инструменты (tools / tool_calls)', () => {
  let key = '';
  const tools = [
    { type: 'function', function: { name: 'read_file', description: 'Прочитать файл', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_dir', description: 'Файлы каталога', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  ];
  const sys = { role: 'system', content: 'Ты агент в редакторе. Проект: /work/demo' };
  const ask = { role: 'user', content: 'Что в a.txt?' };
  const call = { role: 'assistant', content: null, tool_calls: [{ id: 'call_r1', type: 'function', function: { name: 'read_file', arguments: { path: 'a.txt' } } }] };
  const result = { role: 'tool', tool_call_id: 'call_r1', content: [{ type: 'text', text: 'привет из a.txt' }] };
  const sse = async (res: Response) => (await res.text()).split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
  type Chunk = { choices: { delta: { content?: string | null; reasoning_content?: string; tool_calls?: { index: number; id?: string; type?: string; function: { name?: string; arguments: string } }[] }; finish_reason: string | null }[]; usage?: unknown };
  beforeAll(() => {
    const r = K.createKey(user, { name: 'агент', models: ['alpha', 'beta'], levels: { alpha: 'low' }, rpm: 100 });
    if ('error' in r) throw new Error(r.error);
    key = r.key;
  });

  it('без стрима: tools и tool_choice уходят в шлюз с X-Korvex-Agent, обратно message.tool_calls (аргументы собраны из кусков), content null, finish_reason tool_calls', async () => {
    bodies.length = 0;
    const res = await chat(req(key, { model: 'alpha', messages: [sys, ask], tools, tool_choice: 'auto', max_completion_tokens: 4096, reasoning_effort: 'high' }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { choices: { message: { content: string | null; reasoning_content?: string; tool_calls?: unknown[] }; finish_reason: string }[]; usage: Record<string, unknown> };
    expect(j.choices[0].finish_reason).toBe('tool_calls');
    expect(j.choices[0].message.content).toBeNull();
    expect(j.choices[0].message.reasoning_content).toBe('нужно прочитать файл. ');
    expect(j.choices[0].message.tool_calls).toEqual([{ id: 'call_r1', type: 'function', function: { name: 'read_file', arguments: '{"path": "a.txt"}' } }]);
    expect(j.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 });
    const up = bodies[0];
    expect(up.agent).toBe('1');
    expect(up).toMatchObject({ model: 'up-alpha-35b', stream: true, tool_choice: 'auto', max_tokens: 4096, reasoning_effort: 'xhigh' });
    expect(up.tools).toEqual(tools);
    expect(up.messages).toEqual([sys, ask]);
  });

  it('поток: delta.tool_calls по стандарту — index, id, type и function.name в первом куске, аргументы кусками; finish_reason tool_calls; два вызова — index 0 и 1', async () => {
    bodies.length = 0;
    const res = await chat(req(key, { model: 'alpha', stream: true, stream_options: { include_usage: true }, messages: [sys, { role: 'user', content: 'PARALLEL: что в a.txt и в каталоге?' }], tools, parallel_tool_calls: true }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const datas = await sse(res);
    expect(datas.at(-1)).toBe('[DONE]');
    const chunks = datas.slice(0, -1).map((d) => JSON.parse(d) as Chunk);
    const tcs = chunks.flatMap((c) => c.choices[0]?.delta?.tool_calls ?? []);
    const first0 = tcs.find((t) => t.index === 0)!;
    expect(first0).toEqual({ index: 0, id: 'call_r1', type: 'function', function: { name: 'read_file', arguments: '' } });
    expect(tcs.filter((t) => t.index === 0).slice(1).every((t) => t.id === undefined && t.function.name === undefined)).toBe(true);
    expect(tcs.filter((t) => t.index === 0).map((t) => t.function.arguments).join('')).toBe('{"path": "a.txt"}');
    expect(tcs.filter((t) => t.index === 0).length).toBe(4);
    expect(tcs.find((t) => t.index === 1)).toMatchObject({ id: 'call_l2', type: 'function', function: { name: 'list_dir', arguments: '{"path": "."}' } });
    expect(chunks.find((c) => c.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe('tool_calls');
    expect(chunks.some((c) => c.choices[0]?.delta?.reasoning_content)).toBe(true);
    expect(chunks.at(-1)!.usage).toMatchObject({ total_tokens: 129 });
    expect(bodies[0]).toMatchObject({ parallel_tool_calls: true });
  });

  it('история: assistant.tool_calls (аргументы объектом -> строка JSON) и role=tool (части -> текст) уходят серву как есть; ответ текстом, finish_reason stop', async () => {
    bodies.length = 0;
    const res = await chat(req(key, { model: 'alpha', stream: true, reasoning_effort: 'none', messages: [sys, ask, { ...call, reasoning_content: 'думал' }, result], tools }));
    const chunks = (await sse(res)).slice(0, -1).map((d) => JSON.parse(d) as Chunk);
    expect(chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('')).toBe('В файле написано: привет из a.txt');
    expect(chunks.find((c) => c.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe('stop');
    expect(chunks.some((c) => c.choices[0]?.delta?.tool_calls)).toBe(false);
    expect(bodies[0].messages).toEqual([sys, ask,
      { role: 'assistant', content: null, reasoning_content: 'думал', tool_calls: [{ id: 'call_r1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
      { role: 'tool', tool_call_id: 'call_r1', content: 'привет из a.txt' }]);
    expect(bodies[0]).toMatchObject({ agent: '1', reasoning_effort: 'none' });
  });

  it('ответ серва JSON вместо потока — тоже tool_calls; ошибка в потоке — 502, не «пустой ответ»', async () => {
    const j = (await (await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'JSONREPLY' }], tools }))).json()) as { choices: { message: { tool_calls: { id: string }[] }; finish_reason: string }[] };
    expect(j.choices[0]).toMatchObject({ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'call_j', function: { name: 'read_file', arguments: '{"path":"j.txt"}' } }] } });
    const bad = await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'BROKEN' }], tools }));
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('upstream_error');
  });

  it('Beta без поддержки инструментов: tools или история с вызовами -> 400 tools_not_supported с понятным текстом (не молча)', async () => {
    bodies.length = 0;
    for (const body of [{ model: 'beta', messages: [ask], tools }, { model: 'beta', messages: [ask, call, result] }]) {
      const res = await chat(req(key, body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: unknown }).error).toMatchObject({ code: 'tools_not_supported', message: 'Beta пока не поддерживает инструменты, выберите alpha', param: 'tools' });
    }
    expect(bodies.length).toBe(0);
    expect((await chat(req(key, { model: 'beta', messages: [ask], tools: [] }))).status).toBe(200);
    expect(bodies[0].agent).toBeUndefined();
  });

  it('проверка тела: tool без tool_call_id, вызов без имени, неизвестный tool_choice, плохой max_tokens, инструмент не function -> 400', async () => {
    const cases: [unknown, string][] = [
      [{ messages: [ask, call, { role: 'tool', content: 'x' }], tools }, 'messages[2].tool_call_id'],
      [{ messages: [ask, { role: 'assistant', tool_calls: [{ id: 'c1', function: {} }] }], tools }, 'messages[1].tool_calls[0]'],
      [{ messages: [ask], tools, tool_choice: 'always' }, 'tool_choice'],
      [{ messages: [ask], tools, tool_choice: { type: 'function', function: { name: 'rm_rf' } } }, 'tool_choice'],
      [{ messages: [ask], tools, max_tokens: 1.5 }, 'max_tokens'],
      [{ messages: [ask], tools: [{ type: 'code_interpreter' }] }, 'tools[0]'],
      [{ messages: [ask], tools: 'read_file' }, 'tools'],
    ];
    for (const [body, param] of cases) {
      const res = await chat(req(key, { model: 'alpha', ...(body as object) }));
      expect(res.status, param).toBe(400);
      expect(((await res.json()) as { error: { param: string } }).error.param).toBe(param);
    }
  });

  it('беседа агента: prompt_cache_key (id треда Zed) — одна сессия; без id — отпечаток начала беседы, тот же на всех шагах цикла', async () => {
    bodies.length = 0;
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools, prompt_cache_key: 'thread-1' }));
    await chat(req(key, { model: 'alpha', messages: [sys, ask, call, result], tools, prompt_cache_key: 'thread-1' }));
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools, prompt_cache_key: 'thread-2' }));
    const step1 = await chat(req(key, { model: 'alpha', messages: [sys, ask], tools }));
    const step2 = await chat(req(key, { model: 'alpha', messages: [sys, ask, call, result], tools }));
    await chat(req(key, { model: 'alpha', messages: [sys, { role: 'user', content: 'Другая задача' }], tools }));
    await chat(req(key, { model: 'alpha', messages: [{ role: 'system', content: 'Ты агент в редакторе. Проект: /work/other' }, ask], tools }));
    const s = bodies.map((b) => b.chat);
    expect(s[0]).toBe(s[1]);
    expect(s[2]).not.toBe(s[0]);
    expect(s[3]).toBe(s[4]);
    expect(new Set([s[0], s[2], s[3], s[5], s[6]]).size).toBe(5);
    const d1 = ((await step1.json()) as { ext: { conversation: string; auto?: boolean } }).ext;
    const d2 = ((await step2.json()) as { ext: { conversation: string; auto?: boolean } }).ext;
    expect(d1).toEqual(d2);
    expect(d1.auto).toBe(true);
    expect(d1.conversation).toMatch(/^auto-[0-9a-f]{16}$/);
  });

  it('OpenCode: x-session-id входит в ключ беседы — та же сессия на всех шагах; другая сессия с тем же заданием — новая беседа; служебный запрос сессии — отдельно', async () => {
    bodies.length = 0;
    const h1 = { 'x-session-id': 'ses_A' }, h2 = { 'x-session-id': 'ses_B' };
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools }, h1));
    await chat(req(key, { model: 'alpha', messages: [sys, ask, call, result], tools }, h1));
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools }, h2));
    await chat(req(key, { model: 'alpha', messages: [{ role: 'system', content: 'You are a title generator.' }, ask], tools }, h1));
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools }, { 'x-conversation-id': 'conv-9' }));
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools, metadata: { session_id: 'ses_A' } }));
    await chat(req(key, { model: 'alpha', messages: [sys, ask], tools }));
    const s = bodies.map((b) => b.chat);
    expect(s[0]).toBe(s[1]);
    expect(new Set([s[0], s[2], s[3], s[4], s[6]]).size).toBe(5);
    expect(s[5]).toBe(s[0]);
  });

  it('обслуживание движка: баннер kx_banner.sh или MAINTENANCE -> 503 + Retry-After (оценка до конца баннера), понятный текст; обычный баннер — не мешает', async () => {
    const S = await import('@/lib/status');
    S.setBanner({ enabled: true, level: 'warn', text: 'Alpha на обслуживании, может отвечать с перерывами', until: Date.now() + 5 * 60_000 });
    try {
      const r = await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'Привет' }] }));
      expect(r.status).toBe(503);
      const ra = Number(r.headers.get('Retry-After'));
      expect(ra).toBeGreaterThanOrEqual(290); expect(ra).toBeLessThanOrEqual(300);
      const j = (await r.json()) as { error: { code: string; type: string; message: string } };
      expect(j.error).toMatchObject({ code: 'service_unavailable', type: 'server_error' });
      expect(j.error.message).toMatch(/^Модель на обслуживании, повторите через \d+ с$/);
      const n0 = bodies.length;
      const rs = await chat(req(key, { model: 'alpha', stream: true, messages: [{ role: 'user', content: 'Привет' }] }));
      expect(rs.status).toBe(503);
      expect(bodies.length).toBe(n0);
    } finally { S.setBanner({ enabled: false }); }
    S.setBanner({ enabled: true, level: 'info', text: 'Новая функция: папки', until: null });
    try { expect((await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'Привет' }] }))).status).toBe(200); } finally { S.setBanner({ enabled: false }); }
    const f = path.join(dir, 'MAINTENANCE');
    process.env.KX_MAINT_FILE = f;
    fs.writeFileSync(f, '');
    try {
      const r = await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'Привет' }] }));
      expect(r.status).toBe(503);
      expect(r.headers.get('Retry-After')).toBe('60');
    } finally { fs.rmSync(f, { force: true }); }
    expect((await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'Привет' }] }))).status).toBe(200);
    process.env.KX_MAINT_FILE = '';
  });

  it('движок недоступен посреди запроса: без потока -> 503 + Retry-After; обрыв потока посреди ответа -> ошибка в потоке (service_unavailable), не тишина', async () => {
    const r = await chat(req(key, { model: 'alpha', messages: [{ role: 'user', content: 'ENGINE502' }] }));
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('60');
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('service_unavailable');
    const rs = await chat(req(key, { model: 'alpha', stream: true, messages: [{ role: 'user', content: 'ENGINECUT' }] }));
    expect(rs.status).toBe(200);
    const datas = (await rs.text()).split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
    expect(datas.some((d) => d.includes('Начал'))).toBe(true);
    const err = datas.map((d) => { try { return JSON.parse(d) as { error?: { code: string; retry_after?: number; message: string } }; } catch { return {}; } }).find((d) => d.error)!;
    expect(err.error).toMatchObject({ code: "service_unavailable", retry_after: 60 });
    expect(datas.at(-1)).toBe('[DONE]');
  });

  it('max через API закрыт: явный запрос -> 400 с понятной причиной; в /v1/models уровня max нет', async () => {
    const r = await chat(req(key, { model: 'up-alpha-0-preview', messages: [ask], reasoning_effort: 'max' }));
    expect(r.status).toBe(400);
    const e = ((await r.json()) as { error: { code: string; message: string } }).error;
    expect(e.code).toBe('reasoning_effort_unavailable');
    expect(e.message).toMatch(/max через API временно недоступен/);
    const j = (await (await models(new Request('http://x/v1/models', { headers: { Authorization: `Bearer ${key}` } }))).json()) as { data: { id: string; ext: { reasoning_effort: string[] } }[] };
    expect(j.data.find((m) => m.id === 'up-alpha-0-preview')!.ext.reasoning_effort).not.toContain('max');
  });
  it('обычный запрос (без инструментов) — прежний путь: без X-Korvex-Agent; /v1/models — признак tools и окно беседы', async () => {
    bodies.length = 0;
    expect((await chat(req(key, { model: 'alpha', messages: [ask] }))).status).toBe(200);
    expect(bodies[0].agent).toBeUndefined();
    expect(bodies[0].tools).toBeUndefined();
    const j = (await (await models(new Request('http://x/v1/models', { headers: { Authorization: `Bearer ${key}` } }))).json()) as { data: { id: string; ext: { tools: boolean; context_window: number } }[] };
    expect(Object.fromEntries(j.data.map((m) => [m.id, m.ext.tools]))).toEqual({ 'up-alpha-0-preview': true, 'up-alpha-latest': true, beta: false });
    expect(j.data.find((m) => m.id === 'up-alpha-0-preview')!.ext.context_window).toBe(5767168);
    expect(JSON.stringify(j)).not.toMatch(/up-alpha-35b|"alpha"/);
    expect(j.data.find((m) => m.id === 'up-alpha-latest')!.ext).toMatchObject({ aliases: ['up-alpha-0-preview'] });
    expect(((await (await chat(req(key, { model: 'up-alpha-latest', messages: [ask] }))).json()) as { model: string }).model).toBe('up-alpha-latest');
    expect(((await (await chat(req(key, { model: 'alpha', messages: [ask] }))).json()) as { model: string }).model).toBe('up-alpha-0-preview');
    const e = j.data.find((m) => m.id === 'up-alpha-0-preview')! as unknown as Record<string, unknown> & { top_provider: Record<string, number>; ext: Record<string, unknown> };
    expect(e).toMatchObject({ context_length: 5767168, max_context_length: 5767168, max_model_len: 5767168, context_window: 5767168, max_input_tokens: 5767168, max_output_tokens: 32000, max_completion_tokens: 32000 });
    expect(e.top_provider).toMatchObject({ context_length: 5767168, max_completion_tokens: 32000 });
    expect(e.ext).toMatchObject({ engine_context_length: 49152, max_output_tokens: 32000, history: 'server' });
    expect(j.data.find((m) => m.id === 'beta')!.ext.context_window).toBe(1769472);
  });
});
