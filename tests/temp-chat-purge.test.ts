import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpData } from './helpers';

let cur: { id: string; role: string } | null = null;
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), currentUser: async () => cur }));

const dataDir = tmpData();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-out-'));
process.env.KX_OUT_DIR = outDir;

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let T: typeof import('@/lib/tempChat');
let POST: typeof import('@/app/api/threads/[id]/temp/route').POST;
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const TOKEN = 'a'.repeat(32);

const th = (id: string, userId: string, temporary: number, at = T0, title = id) =>
  db.insert(schema.threads).values({ id, userId, title, modelId: 'alpha', effort: 'medium', temporary, createdAt: at, updatedAt: at }).run();
const msg = (id: string, threadId: string, at = T0, content = 'привет мир') =>
  db.insert(schema.messages).values({ id, threadId, seq: Math.floor(Math.random() * 1e6), parentId: null, session: threadId, role: 'user', content, reasoning: null, reasoningMs: null, meta: null, createdAt: at }).run();
const job = (id: string, threadId: string, status: string, at = T0) =>
  db.insert(schema.jobs).values({ id, userId: 'u1', threadId, kind: 'chat', mode: 'send', modelId: 'alpha', levelId: 'medium', status, createdAt: at }).run();
const has = (id: string) => !!db.select({ id: schema.threads.id }).from(schema.threads).all().find((t) => t.id === id);
const req = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/threads/${id}/temp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost', ...headers }, body: JSON.stringify(body) });
const call = (id: string, body: unknown, headers?: Record<string, string>) => POST(req(id, body, headers), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  for (const u of ['u1', 'u2']) db.insert(schema.users).values({ id: u, email: `${u}@t`, name: u, passwordHash: 'x', role: 'user', createdAt: T0 }).run();
  T = await import('@/lib/tempChat');
  ({ POST } = await import('@/app/api/threads/[id]/temp/route'));
});
afterAll(() => { fs.rmSync(outDir, { recursive: true, force: true }); });
beforeEach(() => {
  T._resetTemp(); cur = { id: 'u1', role: 'user' };
  db.delete(schema.automations).run(); db.delete(schema.threads).run();
  for (const t of [schema.ratings, schema.compareVotes, schema.outFiles, schema.agentMsgs, schema.adminViews]) db.delete(t).run();
});

describe('удаление временного чата целиком', () => {
  it('стирает тред, сообщения, задачи, оценки, голоса, файлы (строки и диск), файлы модели, обмен между чатами и строки поиска', async () => {
    th('p1', 'u1', 1, T0, 'Приветствие'); th('keep', 'u1', 0, T0, 'Обычный'); th('other', 'u2', 1, T0, 'Чужой временный');
    msg('p1-m1', 'p1', T0, 'уникальноеслововременного'); msg('keep-m1', 'keep'); msg('other-m1', 'other');
    job('p1-j1', 'p1', 'done');
    const fdir = path.join(dataDir, 'files', 'p1-f1'); fs.mkdirSync(fdir, { recursive: true }); fs.writeFileSync(path.join(fdir, 'a.txt'), 'x');
    db.insert(schema.files).values({ id: 'p1-f1', userId: 'u1', threadId: 'p1', name: 'a.txt', size: 1, sha256: 'x', createdAt: T0 }).run();
    const odir = path.join(outDir, TOKEN); fs.mkdirSync(odir, { recursive: true }); fs.writeFileSync(path.join(odir, 'r.png'), 'x');
    const tdir = path.join(dataDir, 'thumbs', TOKEN); fs.mkdirSync(tdir, { recursive: true }); fs.writeFileSync(path.join(tdir, '1.webp'), 'x');
    db.insert(schema.outFiles).values({ token: TOKEN, userId: 'u1', threadId: 'p1', messageId: 'p1-m1', source: 'job', createdAt: T0 }).run();
    db.insert(schema.ratings).values({ id: 'r1', userId: 'u1', threadId: 'p1', messageId: 'p1-m1', value: 1, createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.ratings).values({ id: 'r2', userId: 'u1', threadId: 'keep', messageId: 'keep-m1', value: 1, createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.compareVotes).values({ id: 'v1', userId: 'u1', threadId: 'p1', messageA: 'a', messageB: 'b', winner: 'a', createdAt: T0, updatedAt: T0 }).run();
    db.insert(schema.agentMsgs).values({ id: 'am1', userId: 'u1', kind: 'ask', fromThread: 'keep', toThread: 'p1', question: 'q', status: 'answered', createdAt: T0 }).run();
    db.insert(schema.adminViews).values({ id: 'av1', adminId: 'adm', ownerId: 'u1', kind: 'chat', target: 'p1', threadId: 'p1', createdAt: T0 }).run();
    db.insert(schema.adminViews).values({ id: 'av2', adminId: 'adm', ownerId: 'u1', kind: 'chat', target: 'keep', threadId: 'keep', createdAt: T0 }).run();
    const { syncIndex } = await import('@/lib/search');
    const { sql } = await import('drizzle-orm');
    syncIndex();
    expect(Number(db.get<{ c: number }>(sql`select count(*) c from search_docs where thread_id = 'p1'`)?.c)).toBeGreaterThan(0);

    expect(T.purgeTemp('u1', 'p1')).toEqual({ ok: true, messages: 1, files: 1, outFiles: 1 });

    expect(has('p1')).toBe(false);
    expect(db.select().from(schema.messages).all().map((m) => m.id).sort()).toEqual(['keep-m1', 'other-m1']);
    expect(db.select().from(schema.jobs).all()).toHaveLength(0);
    expect(db.select().from(schema.files).all()).toHaveLength(0);
    expect(db.select().from(schema.outFiles).all()).toHaveLength(0);
    expect(db.select().from(schema.ratings).all().map((r) => r.id)).toEqual(['r2']);
    expect(db.select().from(schema.compareVotes).all()).toHaveLength(0);
    expect(db.select().from(schema.agentMsgs).all()).toHaveLength(0);
    expect(db.select().from(schema.adminViews).all().map((r) => r.id)).toEqual(['av2']);
    expect(fs.existsSync(fdir)).toBe(false);
    expect(fs.existsSync(odir)).toBe(false);
    expect(fs.existsSync(tdir)).toBe(false);
    expect(Number(db.get<{ c: number }>(sql`select count(*) c from search_docs where thread_id = 'p1'`)?.c)).toBe(0);
    expect(has('keep')).toBe(true); expect(has('other')).toBe(true);
  });

  it('обычный чат, чужой чат и несуществующий — не удаляются', () => {
    th('n1', 'u1', 0); th('o1', 'u2', 1);
    expect(T.purgeTemp('u1', 'n1')).toEqual({ ok: false, why: 'normal' });
    expect(T.purgeTemp('u1', 'o1')).toEqual({ ok: false, why: 'none' });
    expect(T.purgeTemp('u1', 'nope')).toEqual({ ok: false, why: 'none' });
    expect(has('n1') && has('o1')).toBe(true);
  });

  it('идущий и стоящий в очереди ответ — не удаляем; чат — цель автоматизации — тоже', () => {
    th('b1', 'u1', 1); job('b1-run', 'b1', 'running');
    th('b2', 'u1', 1); job('b2-q', 'b2', 'queued');
    th('b3', 'u1', 1);
    db.insert(schema.automations).values({ id: 'au1', userId: 'u1', name: 'А', prompt: 'p', modelId: 'alpha', levelId: 'low', cron: '0 * * * *', timezone: 'UTC', targetThreadId: 'b3', createdAt: T0 }).run();
    expect(T.purgeTemp('u1', 'b1')).toEqual({ ok: false, why: 'busy' });
    expect(T.purgeTemp('u1', 'b2')).toEqual({ ok: false, why: 'busy' });
    expect(T.purgeTemp('u1', 'b3')).toEqual({ ok: false, why: 'automation' });
    expect(has('b1') && has('b2') && has('b3')).toBe(true);
  });
});

describe('подметание: 15 минут без активности', () => {
  it('14:59 — жив, 15:00 — удалён; обычный чат любого возраста не трогается', () => {
    th('s-old', 'u1', 1, T0); th('s-new', 'u1', 1, T0 + 5 * MIN); th('s-norm', 'u1', 0, T0 - 999 * MIN);
    const r1 = T.sweepTemp(T0 + 14 * MIN + 59_000);
    expect(r1.swept).toEqual([]);
    const r2 = T.sweepTemp(T0 + 15 * MIN);
    expect(r2.swept).toEqual(['s-old']);
    expect(has('s-old')).toBe(false); expect(has('s-new')).toBe(true); expect(has('s-norm')).toBe(true);
    expect(T.sweepTemp(T0 + 20 * MIN - 1).swept).toEqual([]);
    expect(T.sweepTemp(T0 + 20 * MIN).swept).toEqual(['s-new']);
    expect(has('s-norm')).toBe(true);
  });

  it('новое сообщение сдвигает отсчёт', () => {
    th('m-1', 'u1', 1, T0); msg('m-1-a', 'm-1', T0 + 10 * MIN);
    expect(T.sweepTemp(T0 + 24 * MIN).swept).toEqual([]);
    expect(T.sweepTemp(T0 + 25 * MIN).swept).toEqual(['m-1']);
  });

  it('пока идёт или ждёт ответ — не удаляется, как бы давно ни было; после конца — на следующем проходе', () => {
    th('j-1', 'u1', 1, T0); job('j-1-j', 'j-1', 'running', T0);
    th('j-2', 'u1', 1, T0); job('j-2-j', 'j-2', 'queued', T0);
    const r = T.sweepTemp(T0 + 600 * MIN);
    expect(r.swept).toEqual([]); expect(r.waiting).toBe(2);
    expect(has('j-1') && has('j-2')).toBe(true);
    db.update(schema.jobs).set({ status: 'done', finishedAt: T0 + 600 * MIN }).run();
    expect(T.sweepTemp(T0 + 601 * MIN).swept).toEqual([]);
    expect(T.sweepTemp(T0 + 616 * MIN).swept.sort()).toEqual(['j-1', 'j-2']);
  });

  it('пульс открытой страницы продлевает жизнь; без пульса — подметается', () => {
    th('h-1', 'u1', 1, T0);
    expect(T.reopenTemp('u1', 'h-1', T0 + 10 * MIN)).toBe('ok');
    expect(T.sweepTemp(T0 + 24 * MIN).swept).toEqual([]);
    expect(T.sweepTemp(T0 + 25 * MIN).swept).toEqual(['h-1']);
  });

  it('после запуска процесса отсчёт идёт от запуска (страницы ещё не успели прислать пульс)', () => {
    th('b-1', 'u1', 1, T0);
    const s = (globalThis as unknown as { __kxTemp: { boot: number } }).__kxTemp; s.boot = T0 + 100 * MIN;
    expect(T.sweepTemp(T0 + 105 * MIN).swept).toEqual([]);
    expect(T.sweepTemp(T0 + 115 * MIN).swept).toEqual(['b-1']);
  });
});

describe('закрытие по маяку', () => {
  it('удаляется после паузы; до неё — жив; open в паузу отменяет закрытие', () => {
    th('c-1', 'u1', 1, T0); th('c-2', 'u1', 1, T0);
    expect(T.closeTemp('u1', 'c-1', T0 + 1000)).toBe('ok'); expect(T.closeTemp('u1', 'c-2', T0 + 1000)).toBe('ok');
    expect(T.sweepTemp(T0 + 1000 + T.CLOSE_GRACE_MS() - 1, { idle: false }).closed).toEqual([]);
    expect(T.reopenTemp('u1', 'c-2', T0 + 5000)).toBe('ok');
    expect(T.sweepTemp(T0 + 1000 + T.CLOSE_GRACE_MS(), { idle: false }).closed).toEqual(['c-1']);
    expect(has('c-1')).toBe(false); expect(has('c-2')).toBe(true);
    expect(T.sweepTemp(T0 + 10 * MIN, { idle: false }).closed).toEqual([]);
  });

  it('закрыли, пока идёт ответ: ждём его конца и удаляем сразу после', () => {
    th('w-1', 'u1', 1, T0); job('w-1-j', 'w-1', 'running');
    T.closeTemp('u1', 'w-1', T0);
    for (let i = 1; i <= 5; i++) { const r = T.sweepTemp(T0 + i * MIN, { idle: false }); expect(r.closed).toEqual([]); expect(r.waiting).toBe(1); }
    expect(has('w-1')).toBe(true);
    db.update(schema.jobs).set({ status: 'done', finishedAt: T0 + 5 * MIN }).run();
    expect(T.sweepTemp(T0 + 5 * MIN + 5000, { idle: false }).closed).toEqual(['w-1']);
    expect(has('w-1')).toBe(false);
  });

  it('обычный чат закрыть нельзя: ответ «normal», запись о закрытии не создаётся', () => {
    th('x-n', 'u1', 0, T0);
    expect(T.closeTemp('u1', 'x-n', T0)).toBe('normal');
    expect(T.sweepTemp(T0 + 600 * MIN).closed).toEqual([]);
    expect(has('x-n')).toBe(true);
    expect(T.closeTemp('u2', 'x-n', T0)).toBe('none');
  });
});

describe('поиск, уведомления', () => {
  it('поиск по чатам не находит временный чат, обычный находит', async () => {
    th('q-t', 'u1', 1, T0, 'Редкийзаголовок'); msg('q-t-m', 'q-t', T0, 'зюзябликово в временном');
    th('q-n', 'u1', 0, T0, 'Обычный'); msg('q-n-m', 'q-n', T0, 'зюзябликово в обычном');
    for (const id of ['q-t', 'q-n']) db.update(schema.threads).set({ leafId: `${id}-m` }).where(eq(schema.threads.id, id)).run();
    const { searchChats } = await import('@/lib/search');
    const hits = searchChats('u1', 'зюзябликово').hits.map((h) => h.key);
    expect(hits).toContain('q-n'); expect(hits).not.toContain('q-t');
    expect(searchChats('u1', 'Редкийзаголовок').hits).toHaveLength(0);
  });

  it('о готовом ответе временного чата не уведомляем и «новым ответом» не считаем', async () => {
    th('nt', 'u1', 1, T0); th('nn', 'u1', 0, T0);
    db.update(schema.threads).set({ answeredAt: T0 + 1, readAt: 0 }).run();
    const N = await import('@/lib/notify');
    expect(N.unreadCount('u1')).toBe(db.select().from(schema.threads).all().filter((t) => t.userId === 'u1' && !t.temporary && t.answeredAt).length);
    const fin = (threadId: string) => ({ threadId, userId: 'u1', kind: 'chat', status: 'done', createdAt: T0 }) as never;
    expect(N.policy(fin('nt'))).toBe('none');
  });
});

describe('конечная точка /api/threads/<id>/temp', () => {
  it('close: свой временный — 200 и закрытие отложено; чужой и несуществующий — 404; обычный — 409 и остаётся', async () => {
    th('e-t', 'u1', 1, T0); th('e-n', 'u1', 0, T0); th('e-o', 'u2', 1, T0);
    expect((await call('e-t', { op: 'close' })).status).toBe(200);
    expect(T.tempStats().closing).toBe(1);
    expect((await call('e-o', { op: 'close' })).status).toBe(404);
    expect((await call('nope', { op: 'close' })).status).toBe(404);
    expect((await call('e-n', { op: 'close' })).status).toBe(409);
    expect(T.tempStats().closing).toBe(1);
    T.sweepTemp(Date.now() + 10 * MIN, { idle: false });
    expect(has('e-t')).toBe(false); expect(has('e-n')).toBe(true); expect(has('e-o')).toBe(true);
  });

  it('open: отменяет закрытие; удалённого чата нет — 404 (страница уходит на главную)', async () => {
    th('e-r', 'u1', 1, T0);
    await call('e-r', { op: 'close' });
    expect((await call('e-r', { op: 'open' })).status).toBe(200);
    expect(T.tempStats().closing).toBe(0);
    T.purgeTemp('u1', 'e-r');
    expect((await call('e-r', { op: 'open' })).status).toBe(404);
  });

  it('без входа — 401, чужой Origin — 403, плохое тело — 400', async () => {
    th('e-a', 'u1', 1, T0);
    cur = null;
    expect((await call('e-a', { op: 'close' })).status).toBe(401);
    cur = { id: 'u1', role: 'user' };
    expect((await call('e-a', { op: 'close' }, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await call('e-a', { op: 'wipe' })).status).toBe(400);
    expect(T.tempStats().closing).toBe(0);
    expect(has('e-a')).toBe(true);
  });
});
