import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
const L = (to: string, subject: string) => '```letter\n' + JSON.stringify({ to, subject, body: 'Добрый день!\nПришлите акт.', short: 'Пришлите акт.' }) + '\n```';
let M: typeof import('@/lib/letterRemind');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
beforeAll(async () => {
  M = await import('@/lib/letterRemind');
  ({ schema } = await import('@/lib/db'));
  db = (await import('@/lib/db')).getDb();
  const now = Date.now();
  db.insert(schema.users).values(['u1', 'u2'].map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1, lang: 'ru' }))).run();
  db.insert(schema.threads).values([
    { id: 't1', userId: 'u1', title: 'Ч', modelId: 'alpha', createdAt: now, updatedAt: now },
    { id: 'tt', userId: 'u1', title: 'Врем', modelId: 'alpha', createdAt: now, updatedAt: now, temporary: 1 },
  ]).run();
  db.insert(schema.messages).values([
    { id: 'm1', threadId: 't1', seq: 1, role: 'assistant', content: `Чего не хватает — 1\n\n${L('ООО «Ромашка-Тест»', 'Документы за октябрь')}`, createdAt: now },
    { id: 'mt', threadId: 'tt', seq: 1, role: 'assistant', content: L('ИП Орлов', 'Акт'), createdAt: now },
  ]).run();
});

describe('напоминание о письме', () => {
  it('ставится и снимается только своим ответом; временный чат и чужой — нельзя', () => {
    const tag = M.letterTag('ООО «Ромашка-Тест»', 'Документы за октябрь');
    expect(M.setReminder('u2', 'm1', tag, true)).toBe(false);
    expect(M.setReminder('u1', 'mt', tag, true)).toBe(false);
    const at = M.setReminder('u1', 'm1', tag, true, 1000) as number;
    expect(at).toBe(1000 + M.REMIND_MS);
    expect(M.remindersOf('u1', 'm1')).toEqual({ [tag]: at });
    expect(M.setReminder('u1', 'm1', tag, false)).toBeNull();
    expect(M.remindersOf('u1', 'm1')).toEqual({});
  });
  it('в срок: push с «кому» и ссылкой на ответ, у чата точка «новое»; повторный такт — не напоминает; до срока — ничего', async () => {
    const tag = M.letterTag('ООО «Ромашка-Тест»', 'Документы за октябрь');
    db.insert(schema.pushSubs).values({ id: 's1', userId: 'u1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a', device: 'тест', createdAt: 1 } as never).run();
    const at = M.setReminder('u1', 'm1', tag, true, Date.UTC(2026, 10, 22, 9, 0)) as number;
    const sent: { title: string; body: string; url: string }[] = [];
    const send = async (_s: unknown, p: { title: string; body: string; url: string }) => { sent.push(p); return 'ok' as const; };
    expect(await M.remindTick(at - 1, send)).toEqual([]);
    expect(await M.remindTick(at + 1, send)).toEqual([`m1:${tag}`]);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Письмо клиенту · ООО «Ромашка-Тест»');
    expect(sent[0].url).toBe('/c/t1#m-m1');
    expect(db.select().from(schema.threads).all().find((t) => t.id === 't1')!.answeredAt).toBe(at + 1);
    expect(await M.remindTick(at + 2, send)).toEqual([]);
    expect(M.remindersOf('u1', 'm1')).toEqual({});
  });
  it('тихие часы — напомнит после них', async () => {
    const { eq } = await import('drizzle-orm');
    db.update(schema.users).set({ notifyQuiet: '00:00-23:59', timezone: 'UTC' } as never).where(eq(schema.users.id, 'u1')).run();
    const tag = M.letterTag('x', 'y');
    const at = M.setReminder('u1', 'm1', tag, true, 0) as number;
    const noon = Date.UTC(2026, 10, 22, 12, 0) ;
    expect(await M.remindTick(Math.max(at + 1, noon), async () => 'ok' as const)).toEqual([]);
    expect(Object.keys(M.remindersOf('u1', 'm1'))).toEqual([tag]);
  });
});

describe('строка под письмом', () => {
  it('в своём ответе — «Напомнить через 3 дня»; без id ответа (поток, чужой чат) — строки нет', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { LetterRemindProvider, LetterView } = await import('@/components/blocks/Letter');
    const l = { to: 'ООО «Ромашка-Тест»', subject: 'Документы', body: 'Добрый день!', short: '' };
    const html = (id: string | null) => renderToStaticMarkup(createElement(LetterRemindProvider, { messageId: id, on: true }, createElement(LetterView, { l })));
    expect(html('m1')).toContain('Напомнить через 3 дня');
    expect(html(null)).not.toContain('letter-remind');
  });
});
