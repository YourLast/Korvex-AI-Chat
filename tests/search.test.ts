import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, S: typeof import('@/lib/search');
let eq: typeof import('drizzle-orm').eq;
const U1 = 'u1', U2 = 'u2';
let seq = 0;

function thread(userId: string, title: string, o: { updatedAt?: number; groupId?: string; side?: string; modelId?: string } = {}) {
  const id = randomUUID();
  const now = o.updatedAt ?? Date.now();
  db.insert(schema.threads).values({ id, userId, title, modelId: o.modelId ?? 'alpha', effort: 'off', groupId: o.groupId ?? null, side: o.side ?? null, createdAt: now, updatedAt: now }).run();
  return id;
}
function msg(threadId: string, role: 'user' | 'assistant', content: string, parentId: string | null, meta: Record<string, unknown> | null = null) {
  const id = randomUUID();
  db.insert(schema.messages).values({ id, threadId, seq: ++seq, parentId, role, content, meta, createdAt: Date.now() }).run();
  db.update(schema.threads).set({ leafId: id }).where(eq(schema.threads.id, threadId)).run();
  return id;
}
const keys = (q: string, u = U1) => S.searchChats(u, q).hits.map((h) => h.key);

let tZed: string, tQwerty: string, tDog: string, tTomsk: string, tFile: string, tOther: string, mZedAnswer: string, fileId: string, tOld: string, tNew: string;

beforeAll(async () => {
  const D = await import('@/lib/db');
  db = D.getDb(); schema = D.schema; eq = (await import('drizzle-orm')).eq;
  S = await import('@/lib/search');
  for (const [id, email] of [[U1, 'a@x'], [U2, 'b@x']]) db.insert(schema.users).values({ id, email, name: id, passwordHash: 'x', createdAt: 1 }).run();

  tZed = thread(U1, 'ya normalno nastroil to? Korvex AI');
  let p = msg(tZed, 'user', 'ya normalno nastroil to? Korvex AI v Zed Code', null);
  mZedAnswer = msg(tZed, 'assistant', 'Да, настройка верная: в **Zed** провайдер указан правильно, ключ берётся из файла.', p);

  tQwerty = thread(U1, 'Po gugli koroce model Qwerty 3.6');
  p = msg(tQwerty, 'user', 'Po gugli koroce model Qwerty 3.6 35b A3B - ctobi ona rabotala bystree', null);
  msg(tQwerty, 'assistant', 'Чтобы Qwerty 3.6 работала быстрее на одной видеокарте, включите квантование.', p);

  tDog = thread(U1, 'Напиши, короче. А-а-а, сто раз я собака');
  p = msg(tDog, 'user', 'Напиши, короче. А-а-а, сто раз я собака в текст-файл', null);
  msg(tDog, 'assistant', 'Готово: файл с текстом «Я собака» сто раз.', p);

  tTomsk = thread(U1, 'Склад компании');
  p = msg(tTomsk, 'user', 'Запомни: главный склад компании — в Томске.', null);
  msg(tTomsk, 'assistant', 'Запомнил: главный склад находится в Томске.', p);

  tFile = thread(U1, 'Счёт на оплату');
  const fid = randomUUID(); fileId = fid;
  db.insert(schema.files).values({ id: fid, userId: U1, threadId: tFile, name: 'invoice_2026-10.pdf', mime: 'application/pdf', size: 10, sha256: 'x', text: 'секретное содержимое файла не индексируется', createdAt: Date.now() }).run();
  p = msg(tFile, 'user', 'Какая сумма к оплате и какой номер счёта?', null, { fileIds: [fid] });
  msg(tFile, 'assistant', 'Сумма к оплате — 12 400 ₽, номер счёта 77.', p);

  tOther = thread(U2, 'Чужой чат про собака и Томск');
  p = msg(tOther, 'user', 'собака Томск настроил', null);

  tOld = thread(U1, 'Овощ', { updatedAt: Date.now() - 20 * 864e5 });
  p = msg(tOld, 'user', 'Назови один овощ одним словом.', null);
  tNew = thread(U1, 'Овощ', { updatedAt: Date.now() - 864e5 });
  p = msg(tNew, 'user', 'Назови один овощ одним словом.', null);
});

describe('поиск по чатам', () => {
  it('индекс собирается из очереди триггеров', () => {
    expect(S.syncIndex()).toBeGreaterThan(10);
    expect(S.syncIndex()).toBe(0);
  });
  it('словоформы: «настроил» находит «настройка» (и транслит nastroil)', () => {
    expect(keys('настроил')[0]).toBe(tZed);
    expect(keys('настройку')[0]).toBe(tZed);
  });
  it('транслит в обе стороны', () => {
    expect(keys('nastroil')[0]).toBe(tZed);
    expect(keys('koroche')).toEqual(expect.arrayContaining([tQwerty, tDog]));
    expect(keys('гугли')[0]).toBe(tQwerty);
    expect(keys('кверти')[0]).toBe(tQwerty);
    expect(keys('sobaka')[0]).toBe(tDog);
    expect(keys('tomsk')[0]).toBe(tTomsk);
  });
  it('опечатка в одну букву', () => {
    expect(keys('Томкс')[0]).toBe(tTomsk);
    expect(keys('насторил')[0]).toBe(tZed);
    expect(keys('квантвоание')[0]).toBe(tQwerty);
  });
  it('фраза в кавычках — подряд идущие слова', () => {
    expect(keys('"номер счёта"')).toEqual([tFile]);
    expect(keys('"счёта номер"')).toEqual([]);
  });
  it('имя файла, но не его содержимое', () => {
    const r = S.searchChats(U1, 'invoice');
    expect(r.hits[0].key).toBe(tFile);
    expect(r.hits[0].where).toBe('file');
    expect(r.hits[0].href).toContain('?m=');
    expect(keys('секретное')).toEqual([]);
  });
  it('только свои чаты', () => {
    expect(keys('собака')).not.toContain(tOther);
    expect(keys('собака', U2)).toEqual([tOther]);
  });
  it('слова запроса могут быть в разных сообщениях одного чата; каждое должно найтись', () => {
    expect(keys('Zed ключ')[0]).toBe(tZed);
    expect(keys('Zed Томск')).toEqual([]);
  });
  it('название выше текста; свежий выше при равенстве', () => {
    const t = thread(U1, 'Квантование моделей');
    msg(t, 'user', 'расскажи', null);
    expect(keys('квантование').slice(0, 2)).toEqual([t, tQwerty]);
    expect(keys('овощ').slice(0, 2)).toEqual([tNew, tOld]);
  });
  it('фрагмент с подсветкой, ссылка на сообщение, найденные слова', () => {
    const h = S.searchChats(U1, 'провайдер').hits[0];
    expect(h.key).toBe(tZed);
    expect(h.msgId).toBe(mZedAnswer);
    expect(h.href).toBe(`/c/${tZed}?m=${mZedAnswer}#m-${mZedAnswer}`);
    expect(h.snippet?.some(([t, on]) => on === 1 && t === 'провайдер')).toBe(true);
    expect(h.snippet?.map(([t]) => t).join('')).not.toContain('**');
    expect(h.marks).toEqual(['провайдер']);
    expect(h.model).toBe('Alpha');
  });
  it('правка, переименование и удаление видны сразу', () => {
    db.update(schema.messages).set({ content: 'теперь про ананас' }).where(eq(schema.messages.id, mZedAnswer)).run();
    expect(keys('ананас')).toEqual([tZed]);
    expect(keys('провайдер')).toEqual([]);
    db.update(schema.threads).set({ title: 'Настройка Zed Code' }).where(eq(schema.threads.id, tZed)).run();
    expect(S.searchChats(U1, 'Zed').hits[0].title).toEqual([['Настройка ', 0], ['Zed', 1], [' Code', 0]]);
    db.delete(schema.threads).where(eq(schema.threads.id, tDog)).run();
    expect(keys('собака')).toEqual([]);
    expect(Number(((db as unknown as { $client: import('better-sqlite3').Database }).$client.prepare('SELECT count(*) n FROM search_docs WHERE thread_id = ?').get(tDog) as { n: number }).n)).toBe(0);
  });
  it('другая версия сообщения (не на активной ветке) не находится', () => {
    const t = thread(U1, 'Ветки');
    const u1 = msg(t, 'user', 'первый вариант про бегемота', null);
    msg(t, 'user', 'второй вариант про жирафа', null);
    expect(keys('жираф')).toEqual([t]);
    expect(keys('бегемот')).toEqual([]);
    db.update(schema.threads).set({ leafId: u1 }).where(eq(schema.threads.id, t)).run();
    expect(keys('бегемот')).toEqual([t]);
  });
  it('сравнение — одна строка на группу, ссылка на /g/', () => {
    const gid = randomUUID();
    const a = thread(U1, 'Сколько будет 17 умножить на 23?', { groupId: gid, side: 'a', modelId: 'alpha' });
    const b = thread(U1, 'Сколько будет 17 умножить на 23?', { groupId: gid, side: 'b', modelId: 'beta' });
    msg(a, 'user', 'Сколько будет 17 умножить на 23?', null);
    msg(b, 'user', 'Сколько будет 17 умножить на 23?', null);
    const r = S.searchChats(U1, 'умножить');
    expect(r.hits.filter((h) => h.key === gid)).toHaveLength(1);
    expect(r.hits[0].href.startsWith(`/g/${gid}`)).toBe(true);
    expect(r.hits[0].model).toBe('Alpha и Beta');
  });
  it('сравнение внутри чата: находится ответ любой дорожки, модель — та, что ответила', () => {
    const t = thread(U1, 'Пара внутри чата');
    const q = msg(t, 'user', 'Сравни два ответа', null);
    const a = msg(t, 'assistant', 'Дорожка A: ответ про ежевику', q, { lane: 'a', modelId: 'alpha' });
    const b = msg(t, 'assistant', 'Дорожка B: ответ про голубику', q, { lane: 'b', modelId: 'beta' });
    db.update(schema.messages).set({ meta: { pair: { a, b } } }).where(eq(schema.messages.id, q)).run();
    db.update(schema.threads).set({ leafId: a }).where(eq(schema.threads.id, t)).run();
    const h = S.searchChats(U1, 'голубика').hits[0];
    expect(h.key).toBe(t);
    expect(h.msgId).toBe(b);
    expect(h.model).toBe('Beta');
    expect(S.searchChats(U1, 'ежевика').hits[0].msgId).toBe(a);
  });
  it('пустой и мусорный запрос', () => {
    expect(S.searchChats(U1, '').hits).toEqual([]);
    expect(S.searchChats(U1, '  ?!  ').hits).toEqual([]);
    expect(S.searchChats(U1, 'AND OR NOT "').hits).toEqual([]);
  });
});
