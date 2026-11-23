import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_ENGINE_URL = 'http://127.0.0.1:9/v1';
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const u = (id: string) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: Date.now(), lastTz: 'Europe/Moscow', lang: 'ru' });
  getDb().insert(schema.users).values([u('w1'), u('w2'), u('w3')]).run();
});
const QS = ['Как закрыть месяц по 62 счёту?', 'Что такое акт сверки взаиморасчётов?', 'Как начислить пени по налогу?', 'Что такое кассовая книга?', 'Как считать резерв по сомнительным долгам?'];
async function say(userId: string, texts: string[]) {
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb(), t0 = Date.now();
  db.insert(schema.threads).values({ id: `th-${userId}`, userId, title: 'Учёт', modelId: 'alpha', effort: 'off', leafId: null, readAt: 0, createdAt: t0, updatedAt: t0 }).run();
  texts.forEach((content, i) => db.insert(schema.messages).values({ id: `${userId}-m${i}`, threadId: `th-${userId}`, seq: i + 1, parentId: null, role: 'user', content, createdAt: t0 + i }).run());
}

describe('S2: «ответь иначе — …» — догадка', () => {
  it('манера из просьбы переделать один ответ пишется с sure 0, обычная просьба — как раньше', async () => {
    const C = await import('@/lib/curator');
    const op = (text: string) => ({ op: 'add' as const, id: '', section: 'style', key: 'none', text, sensitive: 'no', asked: false, sure: true });
    const r = C.applyOps('w1', [op('Отвечать короче и списком')], new Map(), { user: 'Ответь иначе — короче и списком.', auto: true, threadId: null, messageId: null });
    expect(r.applied.map((a) => [a.text, a.maybe])).toEqual([['Отвечать короче и списком', true]]);
    const r2 = C.applyOps('w1', [op('Всегда указывать статью НК')], new Map(), { user: 'Всегда указывай статью НК, пожалуйста.', auto: true, threadId: null, messageId: null });
    expect(r2.applied[0]?.maybe).toBe(false);
  });
});

describe('S3: «Пишет: …» без повтора манеры', () => {
  it('длина уже сказана — без «коротко»; остались только «без эмодзи, по-русски» — null; без других записей — как раньше', async () => {
    const M = await import('@/lib/memory');
    expect(M.writingProfile(QS)).toBe('Пишет: коротко, без эмодзи, по-русски');
    expect(M.writingProfile(QS, { length: true })).toBeNull();
    expect(M.writingProfile(['глянь код плиз', 'норм, а щас?', 'сделай короче', 'ок', 'а ты можешь таблицей?'], { length: true })).toBe('Пишет: без эмодзи, на «ты», часто с маленькой буквы, разговорно, по-русски');
    const row = (text: string, key: string | null = null) => ({ section: 'style', key, text }) as never;
    expect(M.profileSkip([row('Хочет краткий ответ одной строкой, без вступлений')])).toEqual({ length: true, emoji: false, address: false });
    expect(M.profileSkip([row('Пишет: коротко, без эмодзи, по-русски', 'writes'), row('Хочет итог в первой строке')])).toEqual({ length: false, emoji: false, address: false });
    expect(M.profileSkip([row('Обращаться на «ты»')]).address).toBe(true);
  });
  it('строка «Пишет» уже есть, потом пришла манера о длине — строка-догадка уходит; своя правка человека остаётся', async () => {
    const M = await import('@/lib/memory');
    await say('w2', QS);
    const w0 = M.refreshWritingProfile('w2');
    expect(w0?.ok && w0.row.text).toBe('Пишет: коротко, без эмодзи, по-русски');
    M.addMemory('w2', { section: 'style', text: 'Хочет краткий ответ одной строкой, без вступлений и подробностей', origin: 'auto', sure: false });
    expect(M.refreshWritingProfile('w2')).toBeNull();
    expect(M.listMemory('w2').map((r) => r.text)).toEqual(['Хочет краткий ответ одной строкой, без вступлений и подробностей']);
    await say('w3', QS);
    const w = M.refreshWritingProfile('w3');
    if (!w?.ok) throw new Error('нет строки');
    M.updateMemory('w3', w.row.id, { text: 'Пишет коротко', origin: 'manual' });
    M.addMemory('w3', { section: 'style', text: 'Просит отвечать короче', origin: 'auto', sure: false });
    M.refreshWritingProfile('w3');
    expect(M.listMemory('w3').map((r) => r.text).sort()).toEqual(['Пишет коротко', 'Просит отвечать короче']);
  });
});
