import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
import { eq } from 'drizzle-orm';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dir = tmpData();
process.env.KX_LOGIN_DELAY_MS = '40';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const PW = 'правильный-пароль-1';

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
      ch({ role: 'assistant', content: '' }); ch({ content: 'ok' }); ch({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  expect(cfg.models.some((m: { hidden?: boolean }) => m.hidden)).toBe(true);
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const H = { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' };
const rq = (url: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('регистрация на пустой БД — один админ', () => {
  it('8 одновременных регистраций (регистрация закрыта): ровно один пользователь, он админ; остальные — 403', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    delete process.env.ALLOW_SIGNUP;
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => POST(rq('/api/auth/register', 'POST', { email: `boss${i}@t.ru`, password: PW }))));
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 403)).toHaveLength(7);
    const users = db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe('admin');
  });
  it('открытая регистрация: одновременно — один админ, остальные user; одна почта дважды — один аккаунт', async () => {
    db.delete(schema.sessions).run(); db.delete(schema.users).run();
    process.env.ALLOW_SIGNUP = '1';
    const { POST } = await import('@/app/api/auth/register/route');
    const rs = await Promise.all([...Array.from({ length: 5 }, (_, i) => POST(rq('/api/auth/register', 'POST', { email: `u${i}@t.ru`, password: PW }))),
      POST(rq('/api/auth/register', 'POST', { email: 'same@t.ru', password: PW })), POST(rq('/api/auth/register', 'POST', { email: 'same@t.ru', password: PW }))]);
    expect(rs.map((r) => r.status).filter((c) => c === 409)).toHaveLength(1);
    const users = db.select().from(schema.users).all();
    expect(users.filter((u) => u.role === 'admin')).toHaveLength(1);
    expect(users).toHaveLength(6);
    delete process.env.ALLOW_SIGNUP;
  });
});

describe('вход: перебор с разных адресов не закрывает аккаунт (С5)', () => {
  const login = async (email: string, password: string, ip: string, opts: { keepJar?: boolean } = {}) => {
    const { POST } = await import('@/app/api/auth/login/route');
    if (!opts.keepJar) jar.clear();
    const t0 = Date.now();
    const r = await POST(rq('/api/auth/login', 'POST', { email, password }, { 'Cf-Connecting-Ip': ip }));
    return { status: r.status, ms: Date.now() - t0 };
  };
  let admin = '';
  beforeAll(async () => {
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    admin = db.select().from(schema.users).all().find((u) => u.role === 'admin')!.email;
  });
  it('20 неудач по почте админа с 20 адресов: правильный пароль с нового адреса — 200 (с мягкой задержкой), не 429', async () => {
    for (let i = 0; i < 20; i++) expect((await login(admin, 'не тот', `203.0.113.${i}`)).status).toBe(401);
    const ok = await login(admin, PW, '198.51.100.7');
    expect(ok.status).toBe(200);
    expect(ok.ms).toBeGreaterThanOrEqual(500);
    const { loginDelayMs, loginKeys } = await import('@/lib/auth');
    const d = loginDelayMs(loginKeys(rq('/x', 'POST', {}, { 'Cf-Connecting-Ip': '1.1.1.1' }), admin));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(8000);
  }, 60_000);
  it('пара (адрес, почта): 6 неудач — 429 с этого адреса; с другого адреса — вход', async () => {
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    for (let i = 0; i < 6; i++) expect((await login(admin, 'не тот', '192.0.2.10')).status).toBe(401);
    expect((await login(admin, PW, '192.0.2.10')).status).toBe(429);
    expect((await login(admin, PW, '192.0.2.11')).status).toBe(200);
  });
  it('адрес: 30 неудач по разным почтам — 429 с этого адреса на любую почту', async () => {
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    for (let i = 0; i < 30; i++) expect((await login(`nobody${i}@t.ru`, 'x', '192.0.2.50')).status).toBe(401);
    expect((await login(admin, PW, '192.0.2.50')).status).toBe(429);
  });
  it('своё устройство (cookie устройства с прошлого входа): правильный пароль проходит даже с заблокированного адреса; чужая/поддельная cookie — нет', async () => {
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    expect((await login(admin, PW, '192.0.2.77')).status).toBe(200);
    const dev = jar.get('kx_dev')!;
    expect(dev).toMatch(/^[0-9a-f-]+\.\d+\.[\w-]+$/);
    for (let i = 0; i < 6; i++) expect((await login(admin, 'не тот', '192.0.2.77')).status).toBe(401);
    expect((await login(admin, PW, '192.0.2.77')).status).toBe(429);
    jar.clear(); jar.set('kx_dev', dev);
    expect((await login(admin, PW, '192.0.2.77', { keepJar: true })).status).toBe(200);
    jar.clear(); jar.set('kx_dev', dev);
    expect((await login(admin, 'не тот', '192.0.2.77', { keepJar: true })).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await login(admin, 'не тот', '192.0.2.77')).status).toBe(401);
    const [uid, at] = dev.split('.');
    jar.clear(); jar.set('kx_dev', `${uid}.${at}.${randomBytes(32).toString('base64url')}`);
    expect((await login(admin, PW, '192.0.2.77', { keepJar: true })).status).toBe(429);
    const other = db.select().from(schema.users).all().find((u) => u.role !== 'admin')!;
    jar.clear(); jar.set('kx_dev', `${other.id}.${at}.x`);
    expect((await login(admin, PW, '192.0.2.77', { keepJar: true })).status).toBe(429);
    expect(fs.statSync(path.join(dir, 'device.key')).mode & 0o777).toBe(0o600);
  });
  it('подделка X-Forwarded-For при одном настоящем адресе (Cf-Connecting-Ip) лимит не обходит', async () => {
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    const { POST } = await import('@/app/api/auth/login/route');
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      jar.clear();
      codes.push((await POST(rq('/api/auth/login', 'POST', { email: admin, password: 'не тот' }, { 'Cf-Connecting-Ip': '192.0.2.99', 'X-Forwarded-For': `10.0.0.${i}` }))).status);
    }
    expect(codes.slice(0, 6).every((c) => c === 401)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
  });
});

describe('свёрнутые модели (hidden) закрыты на сервере', () => {
  const tok = randomBytes(32).toString('base64url');
  let uid = '', tSolo = '', tAlpha = '';
  beforeAll(() => {
    uid = db.select().from(schema.users).all().find((u) => u.role !== 'admin')!.id;
    db.insert(schema.sessions).values({ id: sha(tok), userId: uid, createdAt: Date.now(), expiresAt: Date.now() + 864e5 }).run();
    tSolo = randomUUID(); tAlpha = randomUUID();
    db.insert(schema.threads).values([
      { id: tSolo, userId: uid, title: 'Старый чат Beta', modelId: 'beta', effort: 'off', createdAt: Date.now(), updatedAt: Date.now() },
      { id: tAlpha, userId: uid, title: 'Alpha', modelId: 'alpha', effort: 'low', createdAt: Date.now(), updatedAt: Date.now() },
    ]).run();
  });
  const as = () => { jar.clear(); jar.set('kx_session', tok); };
  it('новый чат, ход, смена модели, сравнение, автоматизация с Beta — 400; с Alpha — работает', async () => {
    as();
    const threads = await import('@/app/api/threads/route');
    expect((await threads.POST(rq('/api/threads', 'POST', { modelId: 'beta', levelId: 'off' }))).status).toBe(400);
    expect((await threads.POST(rq('/api/threads', 'POST', { modelId: 'alpha', levelId: 'low', compare: { on: true, a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'beta-plain', levelId: 'off' } } }))).status).toBe(400);
    expect((await threads.POST(rq('/api/threads', 'POST', { modelId: 'alpha', levelId: 'low' }))).status).toBe(200);
    const chat = (await import('@/app/api/chat/route')).POST;
    const r1 = await chat(rq('/api/chat', 'POST', { threadId: tSolo, text: 'привет', modelId: 'beta', levelId: 'off' }));
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { code?: string }).code).toBe('model_hidden');
    const r2 = await chat(rq('/api/chat', 'POST', { threadId: tAlpha, text: 'привет', modelId: 'beta-plain', levelId: 'off', compare: { a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'beta-plain', levelId: 'off' } } }));
    expect(r2.status).toBe(400);
    expect((await chat(rq('/api/chat', 'POST', { threadId: tSolo, text: 'привет', modelId: 'alpha', levelId: 'low' }))).status).toBe(202);
    const one = await import('@/app/api/threads/[id]/route');
    expect((await one.PATCH(rq(`/api/threads/${tAlpha}`, 'PATCH', { modelId: 'beta', levelId: 'off' }), P({ id: tAlpha }))).status).toBe(400);
    const cmp = await import('@/app/api/threads/[id]/compare/route');
    expect((await cmp.PUT(rq(`/api/threads/${tAlpha}/compare`, 'PUT', { on: true, a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'beta', levelId: 'off' } }), P({ id: tAlpha }))).status).toBe(400);
    const auto = await import('@/app/api/automations/route');
    expect((await auto.POST(rq('/api/automations', 'POST', { name: 'x', prompt: 'x', modelId: 'beta', levelId: 'off', cron: '0 9 * * *', targetThreadId: tAlpha }))).status).toBe(403);
    db.update(schema.users).set({ role: 'alpha' }).where(eq(schema.users.id, uid)).run();
    expect((await auto.POST(rq('/api/automations', 'POST', { name: 'x', prompt: 'x', modelId: 'beta', levelId: 'off', cron: '0 9 * * *', targetThreadId: tAlpha }))).status).toBe(400);
    db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, uid)).run();
    const { activeJobs } = await import('@/lib/jobs');
    for (let i = 0; i < 200 && activeJobs(uid).length; i++) await new Promise((r) => setTimeout(r, 10));
  });
  it('ключ API: свёрнутая модель в ключ не попадает', async () => {
    const K = await import('@/lib/apikeys');
    const u = db.select().from(schema.users).all().find((x) => x.id === uid)!;
    const r = K.createKey(u, { name: 'k', models: ['alpha', 'beta'] });
    if ('error' in r) throw new Error(r.error);
    expect(r.view.models).toEqual(['alpha']);
  });
});
