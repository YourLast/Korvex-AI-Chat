import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
import { brokenText, isUnreachable, unavailableText } from '@/lib/unavailable';

describe('isUnreachable: какие ошибки считаются «не отвечает»', () => {
  const chain = (code: string, msg = 'connect failed') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(msg), { code }) });
  it('отказ соединения, сброс, таймаут, обрыв сокета — да (по коду, по тексту, по цепочке причин)', () => {
    for (const c of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT']) expect(isUnreachable(chain(c)), c).toBe(true);
    expect(isUnreachable(new Error('Cannot connect to API: connect ECONNREFUSED 127.0.0.1:8099'))).toBe(true);
    expect(isUnreachable(new TypeError('fetch failed'))).toBe(true);
    expect(isUnreachable(new TypeError('terminated'))).toBe(true);
    expect(isUnreachable(new Error('socket hang up'))).toBe(true);
    expect(isUnreachable(new Error('The operation timed out'))).toBe(true);
  });
  it('кадр шлюза upstream_cut (поток серва кончился без [DONE], 12.11) — да, как обрыв; другой код в кадре — нет', () => {
    expect(isUnreachable({ message: 'The answer stream was cut (IncompleteRead).', type: 'server_error', param: null, code: 'upstream_cut' })).toBe(true);
    expect(isUnreachable({ message: 'context too long', type: 'invalid_request_error', param: null, code: 'context_length_exceeded' })).toBe(false);
  });
  it('502 / 503 / 504 — да', () => {
    for (const s of [502, 503, 504]) expect(isUnreachable({ statusCode: s, message: 'x' }), String(s)).toBe(true);
  });
  it('поток оборвался на середине (код 200, причина — terminated / сокет) — да; 200 без сетевой причины — нет', () => {
    expect(isUnreachable({ statusCode: 200, message: 'Failed to process successful response', cause: Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }) })).toBe(true);
    expect(isUnreachable({ statusCode: 200, message: 'Failed to process successful response', cause: new Error('Invalid JSON') })).toBe(false);
  });
  it('ответ серва с причиной — нет: 400, 413, 429, 500; даже если в тексте есть «timeout»', () => {
    for (const s of [400, 401, 413, 429, 500]) expect(isUnreachable({ statusCode: s, message: 'лимит памяти исчерпан' }), String(s)).toBe(false);
    expect(isUnreachable({ statusCode: 400, message: 'request timed out upstream' })).toBe(false);
    expect(isUnreachable(new Error('Превышено время ответа (30 минут)'))).toBe(false);
    expect(isUnreachable(null)).toBe(false);
    expect(isUnreachable('строка')).toBe(false);
  });
});

describe('фразы', () => {
  const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha 0 r9 Preview' }, { id: 'beta', name: 'Beta', fullName: 'Beta 0 4B' }];
  it('по умолчанию: «<полное имя> временно недоступна, попробуйте <другая>.»', () => {
    expect(unavailableText(models[1], models)).toBe('Beta 0 4B временно недоступна, попробуйте Alpha.');
    expect(unavailableText(models[0], models)).toBe('Alpha 0 r9 Preview временно недоступна, попробуйте Beta.');
    expect(unavailableText(models[0], [models[0]])).toBe('Alpha 0 r9 Preview временно недоступна, попробуйте позже.');
  });
  it('unavailableText из конфигурации важнее', () => {
    expect(unavailableText({ ...models[1], unavailableText: 'Beta временно недоступна, попробуйте Alpha.' }, models)).toBe('Beta временно недоступна, попробуйте Alpha.');
  });
  it('конфигурация вебки: у Beta ровно «Beta временно недоступна, попробуйте Alpha.»', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, '')) as { models: { id: string; name: string; fullName: string; unavailableText?: string }[] };
    const beta = cfg.models.find((m) => m.id === 'beta')!;
    expect(unavailableText(beta, cfg.models)).toBe('Beta временно недоступна, попробуйте Alpha.');
  });
  it('оборвался посреди ответа — короткая пометка', () => {
    expect(brokenText(models[1])).toBe('Ответ оборвался: Beta перестала отвечать. Показано то, что успело прийти.');
  });
});

const dir = tmpData();
const seen: { model: string; tz: string | undefined; system: string | undefined; q: string }[] = [];
let srv: http.Server;
let closedPort = 0;
const sysFile = path.join(dir, 'solo_system_prompt.txt');
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs');
let eq: typeof import('drizzle-orm').eq;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b) as { model: string; messages: { role: string; content: unknown }[] };
      const last = [...body.messages].reverse().find((m) => m.role === 'user');
      const q = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
      const sys = body.messages.find((m) => m.role === 'system');
      seen.push({ model: body.model, tz: req.headers['x-user-timezone'] as string | undefined, system: typeof sys?.content === 'string' ? sys.content : undefined, q });
      if (q.includes('[502]')) { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'serve upstream: connection refused' } })); }
      if (q.includes('[503]')) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'busy' } })); }
      if (q.includes('[400]')) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Лимит памяти чата исчерпан' } })); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown, fin: string | null = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }], ...extra })}\n\n`);
      ch({ role: 'assistant', content: 'Начало ' });
      if (q.includes('[break]')) { setTimeout(() => res.destroy(), 40); return; }
      ch({ content: 'ответа.' });
      ch({}, 'stop', { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const tmpSrv = net.createServer();
  await new Promise<void>((r) => tmpSrv.listen(0, '127.0.0.1', r));
  closedPort = (tmpSrv.address() as AddressInfo).port;
  await new Promise<void>((r) => tmpSrv.close(() => r()));
  const live = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) {
    m.baseUrl = m.id === 'beta' ? `http://127.0.0.1:${closedPort}/v1` : live;
    delete m.systemPromptFile;
  }
  cfg.models.push({ ...cfg.models.find((m: { id: string }) => m.id === 'beta'), id: 'beta2', name: 'Beta2', fullName: 'Beta2', upstreamModel: 'up-beta2', baseUrl: live, unavailableText: undefined, systemPromptFile: sysFile });
  fs.writeFileSync(sysFile, 'Ты — Korvex. Пояс пользователя: {{CURRENT_TIMEZONE}}.\n');
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  db.insert(schema.users).values({ id: 'u2', email: 'u2@t', name: 'U2', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  for (let i = 0; i < 12; i++) db.insert(schema.threads).values({ id: `t${i}`, userId: i < 10 ? 'u' : 'u2', title: 'T', modelId: 'beta', effort: 'off', createdAt: 1, updatedAt: 1 }).run();
  J = await import('@/lib/jobs');
});
afterAll(() => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }));

async function turn(t: string, text: string, modelId: string, extra: { timezone?: string; userId?: string } = {}) {
  const thread = db.select().from(schema.threads).where(eq(schema.threads.id, t)).get()!;
  seen.length = 0;
  const r = await J.runTurn({ thread, userId: extra.userId ?? 'u', mode: 'send', text, modelId, levelId: 'off', timezone: extra.timezone });
  const row = db.select().from(schema.messages).where(eq(schema.messages.id, r.assistantId)).get()!;
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.messageId, r.assistantId)).get()!;
  return { r, meta: (row.meta ?? {}) as { error?: string | null; errorUser?: string | null; status?: string }, content: row.content, job };
}

describe('сообщение при недоступной модели', () => {
  it('Beta не отвечает (отказ соединения): в ответе фраза про Alpha, техническая причина — в error и jobs.error', async () => {
    const x = await turn('t0', 'Привет', 'beta');
    expect(x.meta.status).toBe('error');
    expect(x.meta.errorUser).toBe('Beta временно недоступна, попробуйте Alpha.');
    expect(x.meta.error).toMatch(/ECONNREFUSED|Cannot connect|fetch failed/i);
    expect(x.job.error).toBe(x.meta.error);
    expect(x.content).toBe('');
  });
  it('шлюз отвечает 502 / 503 — то же самое (Alpha: фраза из конфигурации, Beta свёрнута — не предлагаем)', async () => {
    for (const [i, tag] of [[1, '[502]'], [2, '[503]']] as const) {
      const x = await turn(`t${i}`, `привет ${tag}`, 'alpha');
      expect(x.meta.errorUser, tag).toBe('Alpha временно недоступна, попробуйте чуть позже.');
      expect(x.meta.error, tag).toMatch(/^50[23]:/);
    }
  });
  it('ответ серва с причиной (4xx: лимит памяти) остаётся как есть — без «временно недоступна»', async () => {
    const x = await turn('t3', 'привет [400]', 'alpha');
    expect(x.meta.errorUser).toBeNull();
    expect(x.meta.error).toBe('400: Лимит памяти чата исчерпан');
  });
  it('оборвалось посреди ответа: то, что пришло, сохранено, ниже — короткая пометка', async () => {
    const x = await turn('t4', 'привет [break]', 'alpha');
    expect(x.content).toContain('Начало');
    expect(x.meta.status).toBe('error');
    expect(x.meta.errorUser).toBe('Ответ оборвался: Alpha перестала отвечать. Показано то, что успело прийти.');
    expect(x.meta.error).toBeTruthy();
  });
  it('успешный ход: errorUser пуст', async () => {
    const x = await turn('t5', 'привет', 'alpha');
    expect(x.meta.status).toBe('done');
    expect(x.meta.errorUser ?? null).toBeNull();
    expect(x.meta.error ?? null).toBeNull();
  });
});

describe('часовой пояс в ходе чата', () => {
  it('пояс браузера уходит шлюзу заголовком X-User-Timezone и в системный промпт вместо {{CURRENT_TIMEZONE}}; запоминается у пользователя', async () => {
    await turn('t6', 'привет', 'beta2', { timezone: 'Asia/Dubai' });
    expect(seen[0].tz).toBe('Asia/Dubai');
    expect(String(seen[0].system).split('\n\n')[0]).toBe('Ты — Korvex. Пояс пользователя: Asia/Dubai.');
    expect(db.select().from(schema.users).where(eq(schema.users.id, 'u')).get()!.lastTz).toBe('Asia/Dubai');
  });
  it('без пояса в запросе (автоматизация, API) — последний запомненный', async () => {
    await turn('t7', 'привет', 'beta2');
    expect(seen[0].tz).toBe('Asia/Dubai');
    expect(seen[0].system).toContain('Пояс пользователя: Asia/Dubai.');
  });
  it('новый пояс заменяет запомненный', async () => {
    await turn('t8', 'привет', 'beta2', { timezone: 'America/New_York' });
    expect(seen[0].tz).toBe('America/New_York');
    expect(db.select().from(schema.users).where(eq(schema.users.id, 'u')).get()!.lastTz).toBe('America/New_York');
  });
  it('невалидный пояс игнорируется: берётся запомненный, а не мусор', async () => {
    await turn('t9', 'привет', 'beta2', { timezone: 'Europe/Moscow\r\nX-Evil: 1' });
    expect(seen[0].tz).toBe('America/New_York');
    expect(seen[0].system).toContain('America/New_York');
  });
  it('пользователь, у которого пояса никогда не было: UTC', async () => {
    await turn('t10', 'привет', 'beta2', { userId: 'u2' });
    expect(seen[0].tz).toBe('UTC');
    expect(String(seen[0].system).split('\n\n')[0]).toBe('Ты — Korvex. Пояс пользователя: UTC.');
    expect(db.select().from(schema.users).where(eq(schema.users.id, 'u2')).get()!.lastTz).toBeNull();
  });
  it('заголовок есть и у модели без системного промпта (Alpha)', async () => {
    await turn('t11', 'привет', 'alpha', { userId: 'u2', timezone: 'Asia/Yekaterinburg' });
    expect(seen[0].tz).toBe('Asia/Yekaterinburg');
    expect(String(seen[0].system ?? '').startsWith('## Правила Korvex')).toBe(true);
  });
});
