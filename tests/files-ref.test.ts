import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
const U = 'fr-u', O = 'fr-o', TH = 'fr-th', TO = 'fr-to';
const F1 = randomUUID(), F2 = randomUUID(), FO = randomUUID();
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb(); const now = Date.now();
  for (const id of [U, O]) db.insert(schema.users).values({ id, email: `${id}@example.com`, name: id, passwordHash: 'x', role: 'user', createdAt: now, lang: 'ru' }).run();
  db.insert(schema.threads).values([{ id: TH, userId: U, title: 'Счёт', modelId: 'alpha', effort: 'off', createdAt: now, updatedAt: now }, { id: TO, userId: O, title: 'Чужой', modelId: 'alpha', effort: 'off', createdAt: now, updatedAt: now }]).run();
  const f = (id: string, userId: string, threadId: string, name: string, text: string) => ({ id, userId, threadId, name, mime: 'application/pdf', size: 1000, sha256: id, text, createdAt: now });
  db.insert(schema.files).values([f(F1, U, TH, 'bill_0425.pdf', 'Счёт на оплату: итого 1 200,00'), f(F2, U, TH, 'notice.pdf', 'Уведомление: срок 28 ноября'), f(FO, O, TO, 'secret.pdf', 'чужой текст')]).run();
  db.insert(schema.messages).values({ id: 'fr-m1', threadId: TH, seq: 1, parentId: null, role: 'user', content: 'Сколько к оплате?', meta: { fileIds: [F1, F2] }, createdAt: now }).run();
});
const ctx = () => ({ userId: U, threadId: TH, folderId: null, jobId: randomUUID(), messageId: null, callId: 'c', kind: 'chat' as const, modelId: 'alpha',
  signal: new AbortController().signal, emit: () => {}, confirm: async () => true, attach: async () => { throw new Error('no'); }, depth: 0 });
const run = async (name: string, args: Record<string, unknown>) => {
  await import('@/lib/tools/chats');
  const { getTool } = await import('@/lib/tools/registry');
  return getTool(name)!.run(args as never, ctx() as never);
};

describe('files_get: ссылка модели на файл', () => {
  it('uuid, номер источника, имя, имя без расширения — текст файла этого чата', async () => {
    expect((await run('files_get', { id: F1, attach: false })).content).toContain('итого 1 200,00');
    expect((await run('files_get', { id: '1', attach: false })).content).toContain('итого 1 200,00');
    expect((await run('files_get', { id: '2', attach: false })).content).toContain('срок 28 ноября');
    expect((await run('files_get', { id: 'notice.pdf', attach: false })).content).toContain('срок 28 ноября');
    expect((await run('files_get', { id: 'BILL_0425', attach: false })).content).toContain('итого 1 200,00');
  });
  it('не нашли — ошибка со списком файлов этого чата (с id); чужой файл по имени — нет', async () => {
    const r = await run('files_get', { id: 'счёт.pdf', attach: false });
    expect(r.error).toBe(true);
    expect(r.content).toContain(`bill_0425.pdf (id ${F1})`);
    const o = await run('files_get', { id: 'secret.pdf', attach: false });
    expect(o.error).toBe(true);
    expect(o.content).not.toContain('чужой текст');
    expect((await run('files_get', { id: '3', attach: false })).error).toBe(true);
  });
});

describe('files_list: слова не совпали с именами', () => {
  it('«счёт» при bill_0425.pdf — файлы этого чата, а не «нет файлов»', async () => {
    const r = await run('files_list', { query: 'счёт оплата' });
    expect(r.content).toContain('Файлы этого чата');
    expect(r.content).toContain('bill_0425.pdf');
    expect(r.content).not.toContain('secret.pdf');
  });
});

describe('files_get: текста у инструмента нет (сканы)', () => {
  it('файл сообщения этого чата с одними заглушками — «содержимое в запросе выше», не «не извлечён»', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const id = randomUUID();
    getDb().insert(schema.files).values({ id, userId: U, threadId: TH, name: 'scan.pdf', mime: 'application/pdf', size: 1000, sha256: id, text: '[page 1]\n[страница 1: скан без текстового слоя, текст не распознан]', createdAt: Date.now() }).run();
    const r = await run('files_get', { id, attach: false });
    expect(r.content).toContain('в запросе выше');
    expect(r.content).not.toContain('не извлечён');
  });
});
