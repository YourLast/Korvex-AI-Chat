import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let T: typeof import('@/lib/turn');
let eq: typeof import('drizzle-orm').eq;

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  T = await import('@/lib/turn');
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  db.insert(schema.users).values({ id: 'v', email: 'v@t', name: 'V', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  db.insert(schema.threads).values({ id: 't', userId: 'u', title: 'T', modelId: 'alpha', effort: 'medium', createdAt: 1, updatedAt: 1 }).run();
  const file = (id: string, userId: string, threadId: string | null) => db.insert(schema.files).values({ id, userId, threadId, name: `${id}.pdf`, mime: 'application/pdf', size: 10, sha256: id, text: id, createdAt: 1 }).run();
  file('f-old1', 'u', 't'); file('f-old2', 'u', 't'); file('f-new', 'u', null); file('f-alien', 'v', null);
  db.insert(schema.messages).values({ id: 'm1', threadId: 't', seq: 1, parentId: null, session: 't', role: 'user', content: 'Вопрос', meta: { fileIds: ['f-old1', 'f-old2'] }, createdAt: 1 }).run();
  db.insert(schema.messages).values({ id: 'm2', threadId: 't', seq: 2, parentId: 'm1', session: null, role: 'assistant', content: 'Ответ', meta: {}, createdAt: 2 }).run();
  db.update(schema.threads).set({ leafId: 'm2' }).where(eq(schema.threads.id, 't')).run();
});

const thread = () => db.select().from(schema.threads).where(eq(schema.threads.id, 't')).get()!;
const edit = (p: { text?: string; fileIds?: string[]; replaceFiles?: boolean }) => T.prepare({ thread: thread(), userId: 'u', mode: 'edit', editId: 'm1', modelId: 'alpha', levelId: 'medium', text: p.text ?? 'Правка', fileIds: p.fileIds, replaceFiles: p.replaceFiles });
const fileIdsOf = (m: { meta: unknown } | null) => ((m?.meta as { fileIds?: string[] } | null)?.fileIds ?? []);

describe('правка и вложения', () => {
  it('без replaceFiles (компьютер, старые клиенты) — вложения исходного, fileIds запроса не важны', () => {
    const p = edit({ fileIds: [] });
    expect(p.userMsg!.parentId).toBeNull();
    expect(fileIdsOf(p.userMsg)).toEqual(['f-old1', 'f-old2']);
    expect(p.fileIds).toEqual(['f-old1', 'f-old2']);
  });
  it('replaceFiles: убрали один файл исходного, добавили новый — у новой версии ровно они; новый файл привязан к чату', () => {
    const p = edit({ text: 'Правка с файлами', fileIds: ['f-old2', 'f-new'], replaceFiles: true });
    expect(p.userMsg!.content).toBe('Правка с файлами');
    expect(fileIdsOf(p.userMsg).sort()).toEqual(['f-new', 'f-old2']);
    expect(db.select().from(schema.files).where(eq(schema.files.id, 'f-new')).get()!.threadId).toBe('t');
  });
  it('порядок вложений — как в запросе, а не как вернула база (12.11: после отправки файлы не перемешиваются)', () => {
    for (const id of ['f-z1', 'f-a2', 'f-m3']) db.insert(schema.files).values({ id, userId: 'u', threadId: null, name: `${id}.pdf`, mime: 'application/pdf', size: 10, sha256: id, text: id, createdAt: 1 }).run();
    const p = edit({ text: 'Три файла', fileIds: ['f-m3', 'f-z1', 'f-a2'], replaceFiles: true });
    expect(fileIdsOf(p.userMsg)).toEqual(['f-m3', 'f-z1', 'f-a2']);
    expect(p.fileIds).toEqual(['f-m3', 'f-z1', 'f-a2']);
  });
  it('replaceFiles: все файлы убрали — вопрос без вложений; пустой текст и без файлов — 400', () => {
    const p = edit({ text: 'Только текст', fileIds: [], replaceFiles: true });
    expect(p.userMsg!.meta).toBeNull();
    expect(() => edit({ text: '  ', fileIds: [], replaceFiles: true })).toThrow(/empty message/);
    expect(fileIdsOf(edit({ text: '', fileIds: ['f-old1'], replaceFiles: true }).userMsg)).toEqual(['f-old1']);
  });
  it('replaceFiles: чужой файл — 400, сообщение не создано', () => {
    const n0 = db.select().from(schema.messages).all().length;
    expect(() => edit({ fileIds: ['f-alien'], replaceFiles: true })).toThrow(/bad files/);
    expect(db.select().from(schema.messages).all().length).toBe(n0);
  });
});
