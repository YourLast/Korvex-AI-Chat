import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tmpData } from './helpers';
import { eq } from 'drizzle-orm';

const jar = { token: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.token ? { name: n, value: jar.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
  notFound: () => { throw new Error('NOTFOUND'); },
  useRouter: () => ({ push: () => {} }),
}));

const dir = tmpData();
const OUT = path.join(dir, 'up-out');
fs.mkdirSync(OUT, { recursive: true });
process.env.KX_OUT_DIR = OUT;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ADMIN = { id: 'adm', token: 'tok-admin' }, ADMIN2 = { id: 'adm2', token: 'tok-admin2' }, A = { id: 'usr-a', token: 'tok-a' }, B = { id: 'usr-b', token: 'tok-b' };
const TOKEN = 'a'.repeat(32);
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const T0 = 1_760_000_000_000;

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  for (const [u, role] of [[ADMIN, 'admin'], [ADMIN2, 'admin'], [A, 'user'], [B, 'user']] as const) {
    db.insert(schema.users).values({ id: u.id, email: `${u.id}@t`, name: u.id === 'usr-a' ? 'Анна' : u.id === 'usr-b' ? 'Борис' : u.id, passwordHash: 'x', role, createdAt: T0 }).run();
    db.insert(schema.sessions).values({ id: sha(u.token), userId: u.id, createdAt: T0, expiresAt: Date.now() + 864e5 }).run();
  }
  db.insert(schema.threads).values({ id: 'th-a1', userId: A.id, title: 'Отчёт по складу', modelId: 'alpha', effort: 'off', leafId: 'a3', readAt: 5, createdAt: T0, updatedAt: T0 + 9000 }).run();
  const msg = (id: string, seq: number, parent: string | null, role: 'user' | 'assistant', content: string, meta: Record<string, unknown> | null = null) =>
    db.insert(schema.messages).values({ id, threadId: 'th-a1', seq, parentId: parent, role, content, meta, createdAt: T0 + seq * 1000 }).run();
  msg('u1', 1, null, 'user', 'Сделай сводку по добыче');
  msg('a1', 2, 'u1', 'assistant', 'Сводка: **1210 т**', { modelId: 'alpha', levelId: 'low' });
  msg('a1b', 3, 'u1', 'assistant', 'Другая версия сводки', { modelId: 'alpha', levelId: 'low' });
  msg('u2', 4, 'a1', 'user', 'А за август?');
  msg('a2', 5, 'u2', 'assistant', 'Август: 1188 т', { modelId: 'alpha', levelId: 'low' });
  msg('u3', 6, 'a2', 'user', 'Спасибо, а выводы?');
  msg('a3', 7, 'u3', 'assistant', 'Выводы: добыча падает', { modelId: 'alpha', levelId: 'low' });
  const rate = (id: string, msgId: string, value: number, reasons: string[], comment: string | null, at: number) =>
    db.insert(schema.ratings).values({ id, userId: A.id, threadId: 'th-a1', messageId: msgId, value, reasons, comment, modelId: 'alpha', levelId: 'low', createdAt: at, updatedAt: at }).run();
  rate('r1', 'a1', -1, ['wrong'], 'Цифра не та', T0 + 100);
  rate('r1b', 'a1b', -1, [], null, T0 + 200);
  rate('r2', 'a2', 1, [], null, T0 + 300);
  rate('r3', 'a3', -1, ['incomplete', 'format'], 'Нет таблицы', T0 + 400);
  db.insert(schema.threads).values({ id: 'th-a2', userId: A.id, title: 'Пустяк', modelId: 'alpha', effort: 'off', leafId: 'b1', createdAt: T0, updatedAt: T0 + 100 }).run();
  db.insert(schema.messages).values({ id: 'b1', threadId: 'th-a2', seq: 1, parentId: null, role: 'user', content: 'привет', createdAt: T0 }).run();
  db.insert(schema.threads).values({ id: 'th-b1', userId: B.id, title: 'Договор аренды', modelId: 'beta', effort: 'off', leafId: 'c2', createdAt: T0, updatedAt: T0 + 50_000 }).run();
  db.insert(schema.messages).values({ id: 'c1', threadId: 'th-b1', seq: 1, parentId: null, role: 'user', content: 'Проверь договор', createdAt: T0 }).run();
  db.insert(schema.messages).values({ id: 'c2', threadId: 'th-b1', seq: 2, parentId: 'c1', role: 'assistant', content: 'Договор в порядке', meta: { modelId: 'beta', levelId: 'off' }, createdAt: T0 + 1 }).run();
  db.insert(schema.ratings).values({ id: 'r4', userId: B.id, threadId: 'th-b1', messageId: 'c2', value: 1, reasons: [], comment: null, modelId: 'beta', levelId: 'off', createdAt: T0 + 500, updatedAt: T0 + 500 }).run();
  db.insert(schema.files).values({ id: '11111111-1111-4111-8111-111111111111', userId: A.id, threadId: 'th-a1', name: 'wells.csv', mime: 'text/csv', size: 12, sha256: 'x', text: 'позиция;июль\nW-07;1210', createdAt: T0 + 10 }).run();
  const fd = path.join(dir, 'files', '11111111-1111-4111-8111-111111111111');
  fs.mkdirSync(fd, { recursive: true });
  fs.writeFileSync(path.join(fd, 'original.csv'), 'позиция;июль\nW-07;1210');
  db.insert(schema.outFiles).values({ token: TOKEN, userId: A.id, threadId: 'th-a1', messageId: 'a1', source: 'job', createdAt: T0 + 20 }).run();
  fs.mkdirSync(path.join(OUT, TOKEN));
  fs.writeFileSync(path.join(OUT, TOKEN, 'report.csv'), 'a;b\n1;2');
});

const req = (url: string) => new Request(`http://localhost${url}`);
const as = (u: { token: string } | null) => { jar.token = u?.token ?? ''; };
const ctx = <T,>(p: T) => ({ params: Promise.resolve(p) });
const views = () => db.select().from(schema.adminViews).all();
const rows = (t: 'threads' | 'messages' | 'ratings' | 'files' | 'users' | 'userMemory') => JSON.stringify(db.select().from(schema[t]).all());

describe('права: только администратор, проверка на сервере', () => {
  const routes: { name: string; call: () => Promise<Response> }[] = [
    { name: 'GET /api/admin/people', call: async () => (await import('@/app/api/admin/people/route')).GET(req('/api/admin/people')) },
    { name: 'GET /api/admin/people/[id]/chats', call: async () => (await import('@/app/api/admin/people/[id]/chats/route')).GET(req('/api/admin/people/usr-a/chats'), ctx({ id: 'usr-a' })) },
    { name: 'GET /api/admin/people/[id]/files', call: async () => (await import('@/app/api/admin/people/[id]/files/route')).GET(req('/api/admin/people/usr-a/files'), ctx({ id: 'usr-a' })) },
    { name: 'GET /api/admin/people/[id]/memory', call: async () => (await import('@/app/api/admin/people/[id]/memory/route')).GET(req('/api/admin/people/usr-a/memory'), ctx({ id: 'usr-a' })) },
    { name: 'GET /api/admin/ratings', call: async () => (await import('@/app/api/admin/ratings/route')).GET(req('/api/admin/ratings')) },
    { name: 'GET /api/admin/files/[id]', call: async () => (await import('@/app/api/admin/files/[id]/route')).GET(req('/api/admin/files/x'), ctx({ id: '11111111-1111-4111-8111-111111111111' })) },
    { name: 'GET /api/admin/views', call: async () => (await import('@/app/api/admin/views/route')).GET(req('/api/admin/views')) },
  ];
  for (const r of routes) {
    it(`${r.name}: без входа 401, обычный пользователь 403, администратор 200`, async () => {
      const before = views().length;
      as(null);
      expect((await r.call()).status).toBe(401);
      as(B);
      expect((await r.call()).status).toBe(403);
      as(A);
      expect((await r.call()).status).toBe(403);
      expect(views().length).toBe(before);
      as(ADMIN);
      expect((await r.call()).status).toBe(200);
    });
  }

  const pages: { name: string; call: () => Promise<unknown>; adminTo?: string }[] = [
    { name: '/admin', call: async () => (await import('@/app/(app)/admin/page')).default() },
    { name: '/admin/users/[id]', call: async () => (await import('@/app/(app)/admin/users/[id]/page')).default({ params: Promise.resolve({ id: 'usr-a' }) }) },
    { name: '/admin/answer/[id]', call: async () => (await import('@/app/(app)/admin/answer/[id]/page')).default({ params: Promise.resolve({ id: 'a2' }) }), adminTo: '/admin/chat/' },
    { name: '/admin/chat/[id]', call: async () => (await import('@/app/(app)/admin/chat/[id]/page')).default({ params: Promise.resolve({ id: 'th-a1' }), searchParams: Promise.resolve({ m: 'a3' }) }) },
  ];
  for (const p of pages) {
    it(`${p.name}: без входа — на вход, обычный пользователь — на главную, администратору — страница`, async () => {
      const before = views().length;
      as(null);
      await expect(p.call()).rejects.toThrow('REDIRECT:/login');
      as(B);
      await expect(p.call()).rejects.toThrow('REDIRECT:/');
      as(A);
      await expect(p.call()).rejects.toThrow('REDIRECT:/');
      expect(views().length).toBe(before);
      as(ADMIN);
      if (p.adminTo) await expect(p.call()).rejects.toThrow(`REDIRECT:${p.adminTo}`);
      else expect(await p.call()).toBeTruthy();
    });
  }

  it('несуществующие человек и чат — «не найдено», в журнал не пишется', async () => {
    as(ADMIN);
    const before = views().length;
    await expect((await import('@/app/(app)/admin/users/[id]/page')).default({ params: Promise.resolve({ id: 'нет' }) })).rejects.toThrow('NOTFOUND');
    await expect((await import('@/app/(app)/admin/chat/[id]/page')).default({ params: Promise.resolve({ id: 'нет' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NOTFOUND');
    expect((await (await import('@/app/api/admin/people/[id]/chats/route')).GET(req('/x'), ctx({ id: 'нет' }))).status).toBe(404);
    expect(views().length).toBe(before);
  });

  it('файлы человека: администратор открывает и загруженный, и созданный моделью; обычный пользователь чужие — нет', async () => {
    const F = await import('@/app/api/files/[id]/route');
    const O = await import('@/app/out/[token]/[...name]/route');
    const fid = '11111111-1111-4111-8111-111111111111';
    as(B);
    expect((await F.GET(req(`/api/files/${fid}`), ctx({ id: fid }))).status).toBe(404);
    expect((await O.GET(req(`/out/${TOKEN}/report.csv`), ctx({ token: TOKEN, name: ['report.csv'] }))).status).toBe(404);
    as(A);
    expect((await F.GET(req(`/api/files/${fid}`), ctx({ id: fid }))).status).toBe(200);
    expect((await O.GET(req(`/out/${TOKEN}/report.csv`), ctx({ token: TOKEN, name: ['report.csv'] }))).status).toBe(200);
    db.delete(schema.adminViews).run();
    const own = views().length;
    as(ADMIN);
    const r1 = await F.GET(req(`/api/files/${fid}`), ctx({ id: fid }));
    expect(r1.status).toBe(200);
    expect(await r1.text()).toContain('W-07');
    const r2 = await O.GET(req(`/out/${TOKEN}/report.csv`), ctx({ token: TOKEN, name: ['report.csv'] }));
    expect(r2.status).toBe(200);
    expect(await r2.text()).toContain('1;2');
    const log = views().slice(own);
    expect(log.map((v) => [v.adminId, v.ownerId, v.kind, v.target])).toEqual([[ADMIN.id, A.id, 'file', fid], [ADMIN.id, A.id, 'file', TOKEN]]);
    expect((await O.GET(req(`/out/${'b'.repeat(32)}/x.csv`), ctx({ token: 'b'.repeat(32), name: ['x.csv'] }))).status).toBe(404);
  });
});

describe('выборки администратора', () => {
  it('люди: числа чатов, сообщений, файлов, оценок и последняя активность', async () => {
    const { people } = await import('@/lib/adminView');
    const p = people();
    const a = p.find((x) => x.id === A.id)!, b = p.find((x) => x.id === B.id)!, adm = p.find((x) => x.id === ADMIN.id)!;
    expect(a).toMatchObject({ chats: 2, messages: 4, files: 2, up: 1, down: 3 });
    expect(a.lastAt).toBe(T0 + 9000);
    expect(b).toMatchObject({ chats: 1, messages: 1, files: 0, up: 1, down: 0 });
    expect(adm).toMatchObject({ chats: 0, messages: 0, up: 0, down: 0, lastAt: null });
    expect(p[0].id).toBe(B.id);
  });

  it('чаты человека: поиск по названию без учёта регистра, фильтр по оценкам, страницы', async () => {
    const { userChats } = await import('@/lib/adminView');
    const all = userChats(A.id);
    expect(all.total).toBe(2);
    expect(all.rows[0]).toMatchObject({ id: 'th-a1', messages: 7, up: 1, down: 3 });
    expect(userChats(A.id, { q: 'ОТЧЁТ' }).rows.map((r) => r.id)).toEqual(['th-a1']);
    expect(userChats(A.id, { filter: 'down' }).rows.map((r) => r.id)).toEqual(['th-a1']);
    expect(userChats(A.id, { filter: 'up' }).total).toBe(1);
    expect(userChats(A.id, { limit: 1, offset: 1 }).rows.map((r) => r.id)).toEqual(['th-a2']);
    expect(userChats(B.id).rows.map((r) => r.id)).toEqual(['th-b1']);
  });

  it('файлы человека: загруженные и созданные моделью; текст файла — только по id', async () => {
    const { userUploads, userOutFiles, uploadText } = await import('@/lib/adminView');
    expect(userUploads(A.id).map((f) => f.name)).toEqual(['wells.csv']);
    expect(userUploads(B.id)).toEqual([]);
    const outs = userOutFiles(A.id);
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ name: 'report.csv', token: TOKEN, url: `/out/${TOKEN}/report.csv`, threadTitle: 'Отчёт по складу' });
    expect(uploadText('11111111-1111-4111-8111-111111111111')?.text).toContain('W-07');
    expect(uploadText('нет')).toBeNull();
  });

  it('лента оценок: знак, человек, модель, период, страницы; счётчики вкладок', async () => {
    const { ratingsFeed } = await import('@/lib/adminView');
    const all = ratingsFeed({ now: T0 + 1000 });
    expect(all.rows).toHaveLength(5);
    expect(all.rows[0].id).toBe('r4');
    expect([all.up, all.down]).toEqual([2, 3]);
    const down = ratingsFeed({ value: -1 });
    expect(down.rows.map((r) => r.id)).toEqual(['r3', 'r1b', 'r1']);
    expect(down.rows[0]).toMatchObject({ userName: 'Анна', threadTitle: 'Отчёт по складу', reasons: ['incomplete', 'format'], comment: 'Нет таблицы', exists: true, value: -1 });
    expect(down.rows[0].answer).toContain('Выводы');
    expect(down.rows[0].question).toContain('выводы');
    expect(ratingsFeed({ value: 1 }).rows.map((r) => r.id)).toEqual(['r4', 'r2']);
    expect(ratingsFeed({ userId: B.id }).rows.map((r) => r.id)).toEqual(['r4']);
    expect(ratingsFeed({ modelId: 'beta' }).rows.map((r) => r.id)).toEqual(['r4']);
    expect(ratingsFeed({ days: 1, now: T0 + 5 * 864e5 }).rows).toHaveLength(0);
    expect(ratingsFeed({ days: 7, now: T0 + 864e5 }).rows).toHaveLength(5);
    const p1 = ratingsFeed({ limit: 2 });
    expect(p1.rows.map((r) => r.id)).toEqual(['r4', 'r3']);
    const p2 = ratingsFeed({ limit: 2, before: p1.next });
    expect(p2.rows.map((r) => r.id)).toEqual(['r2', 'r1b']);
    expect(ratingsFeed({ limit: 2, before: p2.next }).next).toBeNull();
    expect(all.users.map((u) => u.name)).toEqual(['Анна', 'Борис']);
    db.insert(schema.ratings).values({ id: 'rx', userId: A.id, threadId: 'gone', messageId: 'gone-m', value: -1, reasons: [], createdAt: T0 + 700, updatedAt: T0 + 700 }).run();
    expect(ratingsFeed({ value: -1 }).rows[0]).toMatchObject({ id: 'rx', exists: false, threadTitle: null });
    db.delete(schema.ratings).where((await import('drizzle-orm')).eq(schema.ratings.id, 'rx')).run();
  });

  it('начало текста в ленте — без разметки Markdown', async () => {
    const { plain } = await import('@/lib/adminView');
    expect(plain('## Ответ 58\n\n| Показатель | Q1 |\n|---|---|\n| W-07 | **1001** |\n\n- пункт ![график](/out/x/c.png) [ссылка](http://a.b)', 200)).toBe('Ответ 58 Показатель Q1 --- --- W-07 1001 пункт ссылка');
    expect(plain(null, 10)).toBe('');
    expect(plain('а'.repeat(50), 10)).toHaveLength(10);
  });

  it('чат для просмотра: вся ветка, все оценки человека, версии, время; оценка на другой версии — отдельно', async () => {
    const { loadAdminChat } = await import('@/lib/adminView');
    const d = loadAdminChat('th-a1')!;
    expect(d.owner).toMatchObject({ id: A.id, name: 'Анна' });
    expect(d.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(d.otherBranch).toBe(false);
    expect(d.marks.map((m) => [m.messageId, m.value, m.onPath])).toEqual([['a1', -1, true], ['a1b', -1, false], ['a2', 1, true], ['a3', -1, true]]);
    expect(d.marks.find((m) => m.messageId === 'a3')).toMatchObject({ reasons: ['incomplete', 'format'], comment: 'Нет таблицы' });
    expect(d.messages.find((m) => m.id === 'a1')!.rating).toMatchObject({ value: -1, comment: 'Цифра не та' });
    expect(d.messages.find((m) => m.id === 'a1')!.siblings).toMatchObject({ ids: ['a1', 'a1b'], index: 0 });
    expect(d.times.u1).toBe(T0 + 1000);
    const o = loadAdminChat('th-a1', 'a1b')!;
    expect(o.otherBranch).toBe(true);
    expect(o.messages.map((m) => m.id)).toEqual(['u1', 'a1b']);
    expect(o.marks.find((m) => m.messageId === 'a1b')!.onPath).toBe(true);
    expect(o.marks.find((m) => m.messageId === 'a3')!.onPath).toBe(false);
    expect(loadAdminChat('th-a1', 'a2')!.otherBranch).toBe(false);
    expect(loadAdminChat('нет')).toBeNull();
  });

  it('конец ветки ниже сообщения — самая поздняя версия на каждом шаге', async () => {
    const { branchLeaf } = await import('@/lib/adminView');
    const { allMessages } = await import('@/lib/tree');
    const all = allMessages('th-a1');
    expect(branchLeaf(all, 'a1')).toBe('a3');
    expect(branchLeaf(all, 'a1b')).toBe('a1b');
    expect(branchLeaf(all, 'u1')).toBe('a1b');
  });
});

describe('журнал просмотров', () => {
  it('кто, чей чат, когда: страницы и файлы пишут; повтор за 5 минут — одна запись; свои данные не пишутся', async () => {
    const { logView, viewLog, VIEW_DEDUPE_MS } = await import('@/lib/adminView');
    db.delete(schema.adminViews).run();
    as(ADMIN);
    const Chat = (await import('@/app/(app)/admin/chat/[id]/page')).default;
    await Chat({ params: Promise.resolve({ id: 'th-a1' }), searchParams: Promise.resolve({}) });
    await Chat({ params: Promise.resolve({ id: 'th-a1' }), searchParams: Promise.resolve({ m: 'a3' }) });
    await (await import('@/app/(app)/admin/users/[id]/page')).default({ params: Promise.resolve({ id: 'usr-a' }) });
    const log = viewLog(10);
    expect(log.map((v) => [v.adminName, v.ownerName, v.kind, v.threadTitle]).sort()).toEqual([[ADMIN.id, 'Анна', 'chat', 'Отчёт по складу'], [ADMIN.id, 'Анна', 'user', null]]);
    expect(log).toHaveLength(2);
    expect(log.find((v) => v.kind === 'chat')).toMatchObject({ adminId: ADMIN.id, ownerId: A.id, threadId: 'th-a1' });
    expect(logView({ adminId: ADMIN2.id, ownerId: A.id, kind: 'chat', target: 'th-a1', threadId: 'th-a1' })).toBe(true);
    const now = Date.now();
    expect(logView({ adminId: ADMIN.id, ownerId: A.id, kind: 'chat', target: 'th-a1', threadId: 'th-a1' }, now + 1000)).toBe(false);
    expect(logView({ adminId: ADMIN.id, ownerId: A.id, kind: 'chat', target: 'th-a1', threadId: 'th-a1' }, now + VIEW_DEDUPE_MS + 1000)).toBe(true);
    expect(logView({ adminId: ADMIN.id, ownerId: A.id, kind: 'chat', target: 'th-a2', threadId: 'th-a2' }, now + 1000)).toBe(true);
    expect(logView({ adminId: ADMIN.id, ownerId: ADMIN.id, kind: 'chat', target: 'свой' })).toBe(false);
    expect(viewLog(50, B.id)).toHaveLength(0);
    expect(viewLog(50, A.id).length).toBeGreaterThanOrEqual(5);
  });

  it('API журнала отдаёт записи с именами; чат из журнала открывается', async () => {
    as(ADMIN);
    const r = await (await import('@/app/api/admin/views/route')).GET(req('/api/admin/views?limit=3'));
    const j = (await r.json()) as { items: { adminName: string; ownerName: string; kind: string }[] };
    expect(j.items).toHaveLength(3);
    expect(j.items[0]).toMatchObject({ ownerName: 'Анна' });
  });
});

describe('память человека', () => {
  it('записи по разделам, догадки, что уходит модели; просроченная догадка не показывается и НЕ удаляется; просмотр — в журнал', async () => {
    const now = Date.now();
    const mem = (id: string, section: string, text: string, o: { key?: string; sure?: number; origin?: string; at?: number; thread?: string | null } = {}) =>
      db.insert(schema.userMemory).values({ id, userId: A.id, section, key: o.key ?? null, text, origin: o.origin ?? 'auto', sure: o.sure ?? 1,
        threadId: o.thread === undefined ? 'th-a1' : o.thread, createdAt: o.at ?? now, updatedAt: o.at ?? now }).run();
    mem('m-name', 'who', 'Зовут Анна', { key: 'name', origin: 'asked' });
    mem('m-work', 'work', 'Геолог на месторождении');
    mem('m-guess', 'interests', 'Похоже, любит горы', { sure: 0 });
    mem('m-old', 'interests', 'Старая догадка', { sure: 0, at: now - 61 * 864e5 });
    mem('m-man', 'style', 'Коротко, без воды', { origin: 'manual', thread: null });
    as(ADMIN);
    const before = views().filter((v) => v.kind === 'memory').length;
    const r = await (await import('@/app/api/admin/people/[id]/memory/route')).GET(req('/x'), ctx({ id: 'usr-a' }));
    expect(r.status).toBe(200);
    const d = (await r.json()) as import('@/lib/adminTypes').AdminMemory;
    expect(d.items.map((x) => x.id).sort()).toEqual(['m-guess', 'm-man', 'm-name', 'm-work']);
    expect(d.items.find((x) => x.id === 'm-name')!.chat).toEqual({ id: 'th-a1', title: 'Отчёт по складу', intro: false });
    expect(d.items.find((x) => x.id === 'm-guess')!.sure).toBe(false);
    expect(d.callName).toEqual({ value: 'Анна', fromProfile: false });
    expect(d.on).toBe(true);
    expect(d.prompt!.used).toBe(4);
    expect(d.prompt!.body).toContain('Зовут Анна');
    expect(d.prompt!.body).toContain('Возможно');
    expect(d.prompt!.body).not.toContain('Правила Korvex');
    expect(db.select().from(schema.userMemory).all().some((x) => x.id === 'm-old')).toBe(true);
    expect(views().filter((v) => v.kind === 'memory' && v.ownerId === A.id).length).toBe(before + 1);
    db.update(schema.users).set({ memoryOn: 0 }).where(eq(schema.users.id, A.id)).run();
    const off = (await (await (await import('@/app/api/admin/people/[id]/memory/route')).GET(req('/x'), ctx({ id: 'usr-a' }))).json()) as import('@/lib/adminTypes').AdminMemory;
    expect(off.on).toBe(false);
    expect(off.prompt).toBeNull();
    db.update(schema.users).set({ memoryOn: 1 }).where(eq(schema.users.id, A.id)).run();
  });
});

describe('только чтение: данные человека не меняются', () => {
  it('открытие карточки, чата (в том числе на другой версии), файлов, ленты и журнала не трогает ни чаты, ни сообщения, ни оценки, ни «прочитано»', async () => {
    const snap = () => ['threads', 'messages', 'ratings', 'files', 'users', 'userMemory'].map((t) => rows(t as 'threads')).join('|');
    const before = snap();
    as(ADMIN);
    await (await import('@/app/(app)/admin/chat/[id]/page')).default({ params: Promise.resolve({ id: 'th-a1' }), searchParams: Promise.resolve({ m: 'a1b' }) });
    await (await import('@/app/(app)/admin/users/[id]/page')).default({ params: Promise.resolve({ id: 'usr-a' }) });
    await (await import('@/app/api/admin/people/[id]/chats/route')).GET(req('/x?filter=down'), ctx({ id: 'usr-a' }));
    await (await import('@/app/api/admin/people/[id]/files/route')).GET(req('/x'), ctx({ id: 'usr-a' }));
    await (await import('@/app/api/admin/people/[id]/memory/route')).GET(req('/x'), ctx({ id: 'usr-a' }));
    await (await import('@/app/api/admin/files/[id]/route')).GET(req('/x'), ctx({ id: '11111111-1111-4111-8111-111111111111' }));
    await (await import('@/app/api/admin/ratings/route')).GET(req('/x?value=down'));
    expect(snap()).toBe(before);
    expect(db.select().from(schema.threads).all().find((t) => t.id === 'th-a1')!.readAt).toBe(5);
  });

  it('у просмотра нет изменяющих маршрутов: в новых маршрутах только GET', async () => {
    for (const m of [
      await import('@/app/api/admin/people/route'), await import('@/app/api/admin/people/[id]/chats/route'), await import('@/app/api/admin/people/[id]/files/route'),
      await import('@/app/api/admin/people/[id]/memory/route'), await import('@/app/api/admin/ratings/route'), await import('@/app/api/admin/files/[id]/route'), await import('@/app/api/admin/views/route'),
    ] as Record<string, unknown>[]) {
      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(m[verb]).toBeUndefined();
    }
  });
});
