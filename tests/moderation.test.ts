import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { tmpData } from './helpers';

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
const outDir = fs.mkdtempSync(path.join(dir, 'out-'));
process.env.KX_OUT_DIR = outDir;
let srv: http.Server;
const aborted: string[] = [];
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let M: typeof import('@/lib/moderation'), A: typeof import('@/lib/auth'), J: typeof import('@/lib/jobs'), B: typeof import('@/lib/bus'), K: typeof import('@/lib/apikeys');
let POST_MOD: typeof import('@/app/api/admin/users/[id]/moderate/route').POST, POST_BULK: typeof import('@/app/api/admin/invites/[id]/bulk/route').POST, GET_AUDIT: typeof import('@/app/api/admin/audit/route').GET;
let PATCH_USER: typeof import('@/app/api/admin/users/[id]/route').PATCH, POST_LOGIN: typeof import('@/app/api/auth/login/route').POST;
let cur: { id: string; role: string } | null = null;
const T0 = 1_790_000_000_000;

vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, adminOnly: async (_req: Request) => (cur && cur.role === 'admin' ? { user: (await import('@/lib/db')).getDb().select().from((await import('@/lib/db')).schema.users).all().find((u) => u.id === cur!.id)! } : { res: cur ? m.fail(403, 'Только для администратора') : m.fail(401, 'unauthorized') }) };
});

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      let closed = false;
      res.on('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
      for (let i = 0; i < 400 && !closed; i++) { res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { content: `ч${i}.` }, finish_reason: null }] })}\n\n`); await new Promise((r) => setTimeout(r, 25)); }
      if (closed) aborted.push(b.slice(0, 20)); else res.end('data: [DONE]\n\n');
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
  M = await import('@/lib/moderation'); A = await import('@/lib/auth'); J = await import('@/lib/jobs'); B = await import('@/lib/bus'); K = await import('@/lib/apikeys');
  ({ POST: POST_MOD } = await import('@/app/api/admin/users/[id]/moderate/route'));
  ({ POST: POST_BULK } = await import('@/app/api/admin/invites/[id]/bulk/route'));
  ({ GET: GET_AUDIT } = await import('@/app/api/admin/audit/route'));
  ({ PATCH: PATCH_USER } = await import('@/app/api/admin/users/[id]/route'));
  ({ POST: POST_LOGIN } = await import('@/app/api/auth/login/route'));
  const pw = await A.hashPassword('пароль-12345');
  const u = (id: string, name: string, role: 'admin' | 'user' = 'user', source = '') =>
    db.insert(schema.users).values({ id, email: `${id}@t.rs`, name, passwordHash: pw, role, source, createdAt: T0 }).run();
  u('adm1', 'Админ Один', 'admin'); u('adm2', 'Админ Два', 'admin');
  u('u1', 'Анна Орлова'); u('u2', 'Борис Куликов'); u('u3', 'Вера Седова'); u('u4', 'Глеб (создан админом)', 'user', 'admin'); u('u5', 'Дарья (без ссылки)'); u('u6', 'Иван с поста'); u('adm3', 'Админ по ссылке', 'admin');
  db.insert(schema.invites).values({ id: 'inv1', tokenHash: 'h1', role: 'user', note: 'Класс (Сербия)', createdBy: 'adm1', expiresAt: T0 + 9e9, maxUses: 30, uses: 4, createdAt: T0 }).run();
  db.insert(schema.invites).values({ id: 'inv2', tokenHash: 'h2', role: 'user', note: 'Пост TT', createdBy: 'adm1', expiresAt: T0 + 9e9, maxUses: 30, uses: 1, createdAt: T0 }).run();
  for (const [i, uid, inv] of [['a', 'u1', 'inv1'], ['b', 'u2', 'inv1'], ['c', 'u3', 'inv1'], ['d', 'adm3', 'inv1'], ['e', 'u6', 'inv2']] as const)
    db.insert(schema.inviteUses).values({ id: `iu-${i}`, inviteId: inv, userId: uid, name: uid, createdAt: T0 }).run();
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const user = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost' }, body: JSON.stringify(body) });
const mod = (id: string, body: unknown) => POST_MOD(post(`/api/admin/users/${id}/moderate`, body), { params: Promise.resolve({ id }) });

describe('откуда пришёл человек', () => {
  it('ссылка (по названию), «создан админом», «без ссылки»; счётчики по источникам', () => {
    const s = M.sourceMap();
    expect(s.get('u1')).toMatchObject({ kind: 'invite', label: 'Класс (Сербия)', inviteId: 'inv1', key: 'inv:inv1' });
    expect(s.get('u6')).toMatchObject({ kind: 'invite', label: 'Пост TT' });
    expect(s.get('u4')).toMatchObject({ kind: 'admin', label: 'создан админом' });
    expect(s.get('u5')).toMatchObject({ kind: 'none', label: 'без ссылки' });
    const rows = M.sourcesList();
    expect(rows.map((r) => [r.label, r.n])).toEqual([['Класс (Сербия)', 4], ['Пост TT', 1], ['создан админом', 1], ['без ссылки', 3]]);
  });
  it('люди в админке получают источник и статус блокировки', async () => {
    const { people } = await import('@/lib/adminView');
    const p = people().find((x) => x.id === 'u2')!;
    expect(p.source.label).toBe('Класс (Сербия)'); expect(p.blockKind).toBe('');
  });
});

describe('блокировка: человек отрезан сразу и везде', () => {
  it('сессия, ключ API, push, идущий ответ, живая страница, вход', async () => {
    jar.clear();
    await A.startSession('u1');
    const hash = (await A.currentSessionHash())!;
    expect((await A.currentUser())?.id).toBe('u1');
    expect(A.sessionAlive(hash)).toBe(true);
    const k = K.createKey(user('u1'), { name: 'k', models: ['alpha'] }) as { key: string };
    expect(K.authKey(new Request('http://x', { headers: { authorization: `Bearer ${k.key}` } }))).toHaveProperty('user');
    db.insert(schema.pushSubs).values({ id: 'ps1', userId: 'u1', device: 'd', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', createdAt: T0 }).run();
    db.insert(schema.threads).values({ id: 'tu1', userId: 'u1', title: 'Т', modelId: 'alpha', effort: 'low', createdAt: T0, updatedAt: T0 }).run();
    const run = J.submitTurn({ thread: db.select().from(schema.threads).where(eq(schema.threads.id, 'tu1')).get()!, userId: 'u1', mode: 'send', text: 'длинный ответ', modelId: 'alpha', levelId: 'low' });
    await new Promise((r) => setTimeout(r, 400));
    expect(db.select().from(schema.jobs).where(eq(schema.jobs.id, run.jobId)).get()!.status).toBe('running');
    const events: string[] = [];
    const sub = B.subscribe('u1', null, (e) => events.push(e.t));

    cur = { id: 'adm1', role: 'admin' };
    const r = await mod('u1', { action: 'ban', reason: 'спам' });
    expect(r.status).toBe(200);
    const body = await r.json() as { cut: { sessions: number; apiKeys: number; pushSubs: number; jobs: number } };
    expect(body.cut).toMatchObject({ sessions: 1, apiKeys: 1, pushSubs: 1, jobs: 1 });

    expect(await A.currentUser()).toBeNull();
    expect(A.sessionAlive(hash)).toBe(false);
    expect(K.authKey(new Request('http://x', { headers: { authorization: `Bearer ${k.key}` } }))).toMatchObject({ status: 401 });
    expect(db.select().from(schema.pushSubs).where(eq(schema.pushSubs.userId, 'u1')).all()).toHaveLength(0);
    expect(events).toContain('logout');
    sub.unsubscribe();
    const res = await J.waitJob(run.jobId);
    expect(res?.status ?? 'cancelled').toBe('cancelled');
    await new Promise((r2) => setTimeout(r2, 100));
    expect(aborted.length).toBeGreaterThan(0);
    expect(user('u1')).toMatchObject({ disabled: 1, blockKind: 'ban', blockReason: 'спам', blockedBy: 'adm1' });

    const login = await POST_LOGIN(post('/api/auth/login', { email: 'u1@t.rs', password: 'пароль-12345' }));
    expect(login.status).toBe(401);
    expect(await A.currentUser()).toBeNull();
  });

  it('разблокировка возвращает вход; ключи и подписки остаются отозванными; вид и причина очищены', async () => {
    cur = { id: 'adm1', role: 'admin' };
    expect((await mod('u1', { action: 'unblock' })).status).toBe(200);
    expect(user('u1')).toMatchObject({ disabled: 0, blockKind: '', blockReason: '' });
    const login = await POST_LOGIN(post('/api/auth/login', { email: 'u1@t.rs', password: 'пароль-12345' }));
    expect(login.status).toBe(200);
    expect(db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, 'u1')).all().every((k) => k.revokedAt)).toBe(true);
  });

  it('пауза («забрать доступ»): тот же срез, вид pause; бан поверх паузы меняет вид; повтор — без изменений', async () => {
    cur = { id: 'adm1', role: 'admin' };
    const a = await (await mod('u2', { action: 'pause', reason: 'на время' })).json() as { changed: boolean };
    expect(a.changed).toBe(true); expect(user('u2')).toMatchObject({ disabled: 1, blockKind: 'pause', blockReason: 'на время' });
    expect((await (await mod('u2', { action: 'pause' })).json() as { changed: boolean }).changed).toBe(false);
    expect((await (await mod('u2', { action: 'ban', reason: 'хуже' })).json() as { changed: boolean }).changed).toBe(true);
    expect(user('u2').blockKind).toBe('ban');
    await mod('u2', { action: 'unblock' });
    expect(user('u2').disabled).toBe(0);
  });

  it('прежняя ручка PATCH {disabled} — это пауза с журналом; роль и пароль тоже в журнале', async () => {
    cur = { id: 'adm1', role: 'admin' };
    const patch = (id: string, body: unknown) => PATCH_USER(new Request(`http://localhost/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    expect((await patch('u3', { disabled: true })).status).toBe(200);
    expect(user('u3')).toMatchObject({ disabled: 1, blockKind: 'pause' });
    expect((await patch('u3', { disabled: false })).status).toBe(200);
    expect((await patch('u3', { role: 'admin' })).status).toBe(200); await patch('u3', { role: 'user' });
    expect((await patch('u3', { password: 'новый-пароль-123' })).status).toBe(200);
    const acts = M.auditLog({ userId: 'u3' }).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['pause', 'unblock', 'role', 'password']));
  });
});

describe('защита: себя и последнего администратора тронуть нельзя', () => {
  it('себя — 409 на блокировку, паузу и удаление', async () => {
    cur = { id: 'adm1', role: 'admin' };
    for (const action of ['ban', 'pause'] as const) expect((await mod('adm1', { action })).status).toBe(409);
    expect((await mod('adm1', { action: 'delete', confirm: 'Админ Один' })).status).toBe(409);
    expect(user('adm1').disabled).toBe(0);
  });
  it('последний действующий администратор — 409; когда есть другой — можно', async () => {
    cur = { id: 'adm1', role: 'admin' };
    expect((await mod('adm3', { action: 'ban' })).status).toBe(200);
    expect((await mod('adm2', { action: 'pause' })).status).toBe(200);
    cur = { id: 'adm2', role: 'admin' };
    expect((await mod('adm1', { action: 'ban' })).status).toBe(409);
    expect((await mod('adm1', { action: 'delete', confirm: 'Админ Один' })).status).toBe(409);
    expect(user('adm1').disabled).toBe(0);
    cur = { id: 'adm1', role: 'admin' };
    await mod('adm2', { action: 'unblock' }); await mod('adm3', { action: 'unblock' });
  });
});

describe('удаление аккаунта', () => {
  it('только с верным именем; уходят человек, чаты, сообщения, файлы (БД и диск), файлы модели, ключи, память, оценки; ссылка и запись о регистрации остаются', async () => {
    db.insert(schema.threads).values({ id: 'td1', userId: 'u5', title: 'Чат', modelId: 'alpha', effort: 'low', createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.messages).values({ id: 'md1', threadId: 'td1', seq: 1, parentId: null, session: null, role: 'user', content: 'привет', reasoning: null, reasoningMs: null, meta: null, createdAt: T0 }).run();
    const fdir = path.join(dir, 'files', 'fd1'); fs.mkdirSync(fdir, { recursive: true }); fs.writeFileSync(path.join(fdir, 'a.txt'), 'x');
    db.insert(schema.files).values({ id: 'fd1', userId: 'u5', threadId: 'td1', name: 'a.txt', size: 1, sha256: 'x', createdAt: T0 }).run();
    const TOKEN = 'b'.repeat(32); const odir = path.join(outDir, TOKEN); fs.mkdirSync(odir, { recursive: true }); fs.writeFileSync(path.join(odir, 'r.png'), 'x');
    db.insert(schema.outFiles).values({ token: TOKEN, userId: 'u5', threadId: 'td1', messageId: 'md1', source: 'job', createdAt: T0 }).run();
    db.insert(schema.ratings).values({ id: 'rd1', userId: 'u5', threadId: 'td1', messageId: 'md1', value: 1, createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.userMemory).values({ id: 'um1', userId: 'u5', section: 'facts', text: 'любит чай', origin: 'auto', createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.invites).values({ id: 'inv-u5', tokenHash: 'h5', role: 'user', note: 'создана человеком', createdBy: 'u5', expiresAt: T0 + 9e9, maxUses: 5, uses: 1, createdAt: T0 }).run();
    db.insert(schema.inviteUses).values({ id: 'iu-z', inviteId: 'inv-u5', userId: 'u3', name: 'Вера', createdAt: T0 }).run();
    cur = { id: 'adm1', role: 'admin' };

    expect((await mod('u5', { action: 'delete' })).status).toBe(400);
    expect((await mod('u5', { action: 'delete', confirm: 'не то имя' })).status).toBe(400);
    expect(user('u5')).toBeTruthy();
    const ok = await mod('u5', { action: 'delete', confirm: '  дарья (БЕЗ ссылки) ', reason: 'ошибочная регистрация' });
    expect(ok.status).toBe(200);
    expect(db.select().from(schema.users).where(eq(schema.users.id, 'u5')).get()).toBeUndefined();
    for (const [t, col, v] of [[schema.threads, schema.threads.id, 'td1'], [schema.messages, schema.messages.id, 'md1'], [schema.files, schema.files.id, 'fd1'], [schema.outFiles, schema.outFiles.token, TOKEN], [schema.ratings, schema.ratings.id, 'rd1'], [schema.userMemory, schema.userMemory.id, 'um1']] as const)
      expect(db.select().from(t as never).where(eq(col as never, v as never)).all(), String(v)).toHaveLength(0);
    expect(fs.existsSync(fdir)).toBe(false); expect(fs.existsSync(odir)).toBe(false);
    expect(db.select().from(schema.invites).where(eq(schema.invites.id, 'inv-u5')).get()?.createdBy).toBe('adm1');
    expect(db.select().from(schema.inviteUses).where(eq(schema.inviteUses.id, 'iu-z')).get()).toBeTruthy();
    const a = M.auditLog({ limit: 1 })[0];
    expect(a).toMatchObject({ action: 'delete', adminId: 'adm1', targetName: 'Дарья (без ссылки)', targetEmail: 'u5@t.rs', reason: 'ошибочная регистрация' });
    expect(a.detail).toContain('чатов 1');
  });
  it('запись о регистрации остаётся: у удалённого — имя на момент регистрации', async () => {
    db.insert(schema.inviteUses).values({ id: 'iu-g', inviteId: 'inv2', userId: 'gone-user', name: 'Ушедший', createdAt: T0 }).run();
    const { inviteStats } = await import('@/lib/inviteStats');
    expect(inviteStats('inv2', 'UTC', T0 + 1)!.people.find((p) => p.id === 'gone-user')).toMatchObject({ gone: true, name: 'Ушедший' });
  });
});

describe('массовая блокировка по ссылке и журнал', () => {
  it('блокирует всех по ссылке, кроме администраторов и уже заблокированных; ссылку можно отозвать; чужие люди не задеты', async () => {
    cur = { id: 'adm1', role: 'admin' };
    await mod('u3', { action: 'pause' });
    const r = await POST_BULK(post('/api/admin/invites/inv1/bulk', { action: 'ban', reason: 'спам по ссылке', revoke: true }), { params: Promise.resolve({ id: 'inv1' }) });
    expect(r.status).toBe(200);
    const j = await r.json() as { blocked: number; skipped: number; revoked: boolean };
    expect(j).toMatchObject({ blocked: 2, revoked: true });
    expect(user('u1')).toMatchObject({ disabled: 1, blockKind: 'ban', blockReason: 'спам по ссылке' });
    expect(user('u2').blockKind).toBe('ban');
    expect(user('u3').blockKind).toBe('pause'); expect(user('adm3').disabled).toBe(0);
    expect(user('u6').disabled).toBe(0);
    expect(db.select().from(schema.invites).where(eq(schema.invites.id, 'inv1')).get()?.revokedAt).toBeTruthy();
    const log = M.auditLog({ inviteId: 'inv1', limit: 50 });
    expect(log.map((x) => x.action)).toEqual(expect.arrayContaining(['ban', 'bulk_ban', 'invite_revoke']));
    expect(log.find((x) => x.action === 'bulk_ban')!.detail).toContain('заблокировано 2');
  });
  it('неизвестная ссылка — 404', async () => {
    cur = { id: 'adm1', role: 'admin' };
    expect((await POST_BULK(post('/api/admin/invites/nope/bulk', { action: 'ban' }), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
  });
  it('журнал: новые первыми, у каждой записи кто / что / когда / над кем; фильтр по человеку', async () => {
    cur = { id: 'adm1', role: 'admin' };
    const all = M.auditLog({ limit: 200 });
    expect(all.length).toBeGreaterThan(8);
    expect(all.every((x, i) => i === 0 || all[i - 1].at >= x.at)).toBe(true);
    const mine = M.auditLog({ userId: 'u1' });
    expect(mine.every((x) => x.targetId === 'u1')).toBe(true);
    expect(mine.some((x) => x.action === 'ban' && x.adminName === 'Админ Один' && x.targetName === 'Анна Орлова')).toBe(true);
    const r = await GET_AUDIT(new Request('http://localhost/api/admin/audit?limit=3&user=u1'));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { items: unknown[] }).items.length).toBeLessThanOrEqual(3);
  });
});

describe('только администратор', () => {
  it('обычный пользователь и аноним: 403 / 401 на все ручки', async () => {
    for (const [who, code] of [[{ id: 'u6', role: 'user' }, 403], [null, 401]] as const) {
      cur = who;
      expect((await mod('u2', { action: 'ban' })).status).toBe(code);
      expect((await POST_BULK(post('/api/admin/invites/inv2/bulk', { action: 'ban' }), { params: Promise.resolve({ id: 'inv2' }) })).status).toBe(code);
      expect((await GET_AUDIT(new Request('http://localhost/api/admin/audit'))).status).toBe(code);
    }
    expect(user('u6').disabled).toBe(0);
  });
});

void and;
