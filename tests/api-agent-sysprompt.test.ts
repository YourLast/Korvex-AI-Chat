import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
const bodies: { messages: { role: string; content: unknown }[]; agent?: string }[] = [];
let srv: http.Server;
let key = '';
let chat: typeof import('@/app/v1/chat/completions/route').POST;
const sysFile = path.join(dir, 'system_prompt.txt');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      bodies.push({ ...JSON.parse(b), agent: req.headers['x-korvex-agent'] as string | undefined });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ок' }, finish_reason: null }] });
      ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  for (const m of cfg.models) { m.baseUrl = base; m.systemPromptFile = m.id === 'alpha' ? sysFile : undefined; }
  fs.writeFileSync(sysFile, 'Про новинки ищи в интернете.\n');
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  const user = getDb().select().from(schema.users).get()!;
  const K = await import('@/lib/apikeys');
  K.registerKeyUsage();
  const r = K.createKey(user, { name: 'агент', models: ['alpha'], levels: { alpha: 'low' }, rpm: 100 });
  if ('error' in r) throw new Error(r.error);
  key = r.key;
  chat = (await import('@/app/v1/chat/completions/route')).POST;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const req = (body: unknown) => new Request('http://x/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
});
const tools = [{ type: 'function', function: { name: 'read_file', description: 'Прочитать файл', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

describe('системный промпт модели и агентный ход API', () => {
  it('ход с инструментами без системного промпта клиента — без system вовсе', async () => {
    bodies.length = 0;
    const res = await chat(req({ model: 'alpha', stream: true, messages: [{ role: 'user', content: 'Что в a.txt?' }], tools }));
    await res.text();
    expect(bodies[0].messages.some((m) => m.role === 'system')).toBe(false);
  });
  it('обычный запрос API (без инструментов, например сжатие истории OpenCode) — тоже только системный промпт клиента', async () => {
    bodies.length = 0;
    const res = await chat(req({ model: 'alpha', stream: true, messages: [{ role: 'system', content: 'Summarize the conversation.' }, { role: 'user', content: 'Привет' }] }));
    await res.text();
    expect(bodies[0].agent).toBeUndefined();
    expect(JSON.stringify(bodies[0].messages)).not.toMatch(/новинк/);
    expect(bodies[0].messages.filter((m) => m.role === 'system')).toEqual([{ role: 'system', content: 'Summarize the conversation.' }]);
    bodies.length = 0;
    const r2 = await chat(req({ model: 'alpha', stream: true, messages: [{ role: 'user', content: 'Привет' }] }));
    await r2.text();
    expect(bodies[0].messages.some((m) => m.role === 'system')).toBe(false);
  });
});
