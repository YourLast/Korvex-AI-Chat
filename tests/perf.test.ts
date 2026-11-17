import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
import type { MsgView } from '@/lib/types';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let T: typeof import('@/lib/tree'), L: typeof import('@/lib/load');
let eq: typeof import('drizzle-orm').eq;
const uid = randomUUID(), tid = randomUUID();

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  T = await import('@/lib/tree'); L = await import('@/lib/load');
  ({ eq } = await import('drizzle-orm'));
  const now = Date.now();
  db.insert(schema.users).values({ id: uid, email: 'perf@x.local', name: 'P', passwordHash: 'x', role: 'user', createdAt: now }).run();
  db.insert(schema.threads).values({ id: tid, userId: uid, title: 'Длинный', modelId: 'alpha', effort: 'low', createdAt: now, updatedAt: now }).run();
});

describe('jsonz: gzip и ETag', () => {
  const req = (h: Record<string, string> = {}) => new Request('http://x/api/threads', { headers: h });
  it('сжатие не в маршруте (next 16.4.6 снимает Content-Encoding): тело — сам JSON при любом Accept-Encoding', async () => {
    const { jsonz } = await import('@/lib/api');
    const big = { threads: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, title: `Чат номер ${i}` })) };
    const r = jsonz(req({ 'accept-encoding': 'gzip, deflate, br' }), big);
    expect(r.headers.get('content-encoding')).toBeNull();
    expect(await r.json()).toEqual(big);
    expect(await jsonz(req(), { ok: true }, { status: 202 }).json()).toEqual({ ok: true });
  });
  it('ETag: тот же ответ на If-None-Match -> 304 без тела; другой — 200', async () => {
    const { jsonz } = await import('@/lib/api');
    const a = jsonz(req(), { n: 1 }, { etag: true });
    const tag = a.headers.get('etag')!;
    expect(tag).toMatch(/^W\/"/);
    expect(a.headers.get('cache-control')).toBe('private, no-cache');
    const b = jsonz(req({ 'if-none-match': tag }), { n: 1 }, { etag: true });
    expect(b.status).toBe(304);
    expect(await b.text()).toBe('');
    expect(jsonz(req({ 'if-none-match': tag }), { n: 2 }, { etag: true }).status).toBe(200);
  });
});

describe('каркас дерева и ветка чата', () => {
  it('ветка из каркаса = ветка из полной выборки: тексты, шаги, версии, файлы, хвост и «раньше»', () => {
    const now = Date.now();
    let parent: string | null = null, seq = 0;
    const ids: string[] = [];
    const fid = randomUUID();
    db.insert(schema.files).values({ id: fid, userId: uid, threadId: tid, name: 'отчёт.xlsx', mime: 'application/vnd.ms-excel', size: 10, sha256: 'x', text: 'abc', createdAt: now }).run();
    for (let i = 0; i < 30; i++) {
      const q = randomUUID(), a = randomUUID();
      db.insert(schema.messages).values({ id: q, threadId: tid, seq: ++seq, parentId: parent, session: tid, role: 'user', content: `вопрос ${i}`, meta: i === 3 ? { fileIds: [fid] } : null, createdAt: now + i }).run();
      db.insert(schema.messages).values({ id: a, threadId: tid, seq: ++seq, parentId: q, role: 'assistant', content: `ответ ${i}`, reasoning: `мысль ${i}`, reasoningMs: 100,
        meta: { modelId: 'alpha', levelId: 'low', steps: [{ id: `s${i}`, kind: 'web', title: 'Ищет', status: 'ok', at: { r: 0, c: 0 }, round: 0, t0: 1 }], agent: { big: 'x'.repeat(5000) } }, createdAt: now + i }).run();
      ids.push(q, a);
      parent = a;
    }
    const alt = randomUUID();
    db.insert(schema.messages).values({ id: alt, threadId: tid, seq: ++seq, parentId: ids[58], role: 'assistant', content: 'ответ 29 (вторая версия)', meta: { modelId: 'alpha', levelId: 'low' }, createdAt: now + 99 }).run();
    db.update(schema.threads).set({ leafId: alt }).where(eq(schema.threads.id, tid)).run();

    const sk = T.messageSkeleton(tid);
    const full = T.allMessages(tid);
    expect(sk.map((m) => [m.id, m.parentId, m.role, m.seq])).toEqual(full.map((m) => [m.id, m.parentId, m.role, m.seq]));
    expect(sk.every((m) => m.content === '' && m.reasoning === null)).toBe(true);
    expect(sk.find((m) => m.id === ids[6])!.meta).toEqual({ fileIds: [fid] });
    expect(sk.find((m) => m.id === ids[7])!.meta).toEqual({});
    expect(T.messagesById([ids[5], ids[1], 'нет-такого']).map((m) => m.id)).toEqual([ids[5], ids[1]]);
    expect(T.lastSeq(tid)).toBe(61);

    const d = L.loadThread(uid, tid, { turns: 8 })!;
    expect(d.hasMore).toBe(true);
    expect(d.messages).toHaveLength(16);
    const last = d.messages.at(-1)!;
    expect(last.id).toBe(alt);
    expect(last.siblings).toEqual({ ids: [ids[59], alt], index: 1 });
    const prev = d.messages.at(-3)! as MsgView;
    expect(prev.content).toBe('ответ 28');
    expect(prev.reasoning).toBe('мысль 28');
    expect(prev.steps?.[0].id).toBe('s28');
    expect((prev.meta as Record<string, unknown>).agent).toBeUndefined();
    const all = L.loadThread(uid, tid, { turns: 0 })!;
    expect(all.messages).toHaveLength(60);
    expect(all.fileNames).toEqual(['отчёт.xlsx']);
    expect(all.messages.find((m) => m.id === ids[6])!.files?.map((f) => f.name)).toEqual(['отчёт.xlsx']);
    const older = L.loadThread(uid, tid, { turns: 8, before: d.messages[0].id })!;
    expect(older.messages.at(-1)!.id).toBe(ids[43]);
  });
});

describe('длинная лента: что рисовать сразу', () => {
  const msgs = (n: number): MsgView[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' } as MsgView));
  it('до 40 элементов — всё сразу; длиннее — конец (16) и ±8 вокруг сообщения из поиска', async () => {
    const { deferredKeys } = await import('@/lib/feed');
    expect(deferredKeys(msgs(40)).size).toBe(0);
    const d = deferredKeys(msgs(200), 'm20');
    expect(d.has('m199')).toBe(false);
    expect(d.has('m184')).toBe(false);
    expect(d.has('m183')).toBe(true);
    for (const k of ['m12', 'm20', 'm28']) expect(d.has(k)).toBe(false);
    expect(d.has('m11')).toBe(true);
    expect(d.has('m29')).toBe(true);
    expect(deferredKeys(msgs(200)).has('m0')).toBe(true);
  });
});

describe('миниатюры', () => {
  it('только ширины из списка', async () => {
    const { thumbWidth } = await import('@/lib/thumbs');
    expect(thumbWidth('480')).toBe(480);
    expect(thumbWidth('960')).toBe(960);
    for (const v of ['481', '0', '', null, '99999', 'abc']) expect(thumbWidth(v)).toBeNull();
  });
  it('адрес копии — у файлов чата и файлов модели, не у gif и чужих адресов', async () => {
    const { thumbSrc } = await import('@/components/OutImage');
    expect(thumbSrc('/api/files/abc', 480)).toBe('/api/files/abc?w=480');
    expect(thumbSrc('/out/' + 'a'.repeat(32) + '/c.png', 960)).toBe('/out/' + 'a'.repeat(32) + '/c.png?w=960');
    expect(thumbSrc('/out/' + 'a'.repeat(32) + '/c.gif', 960)).toBe('/out/' + 'a'.repeat(32) + '/c.gif');
    expect(thumbSrc('data:image/png;base64,xx', 960)).toBe('data:image/png;base64,xx');
  });
});

describe('очередь: люди вперёд фона', () => {
  it('человек — раньше API и автоматизаций, внутри класса — по приходу; долгое ожидание поднимает фон', async () => {
    const { orderQueue, queueClass } = await import('@/lib/jobs');
    const j = (id: string, kind: 'chat' | 'automation' | 'api', createdAt: number, depth = 0, apiKeyId: string | null = null) => ({ id, kind, depth, apiKeyId, createdAt });
    expect(queueClass(j('a', 'chat', 0))).toBe(0);
    expect(queueClass(j('b', 'api', 0, 0, 'k'))).toBe(1);
    expect(queueClass(j('c', 'automation', 0))).toBe(2);
    expect(queueClass(j('d', 'chat', 0, 1))).toBe(2);
    const q = [j('auto', 'automation', 1000), j('api', 'api', 1100, 0, 'k'), j('mail', 'chat', 1200, 1), j('h1', 'chat', 1300), j('h2', 'chat', 1400)];
    expect(orderQueue(q, 2000, 90_000)).toEqual(['h1', 'h2', 'api', 'auto', 'mail']);
    expect(orderQueue(q, 1000 + 180_000, 90_000)[0]).toBe('auto');
  });
});
