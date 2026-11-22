import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tmpData } from './helpers';

tmpData();
const HOUR = 3_600_000;
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const now = Date.now();
  getDb().insert(schema.users).values(['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now, lang: 'ru' }))).run();
});

const row = (o: Record<string, unknown>) => ({ id: 'g', userId: 'z', section: 'work', key: null, origin: 'auto', sure: 0, threadId: null, messageId: null, createdAt: Date.now(), updatedAt: Date.now(), ...o });

describe('W1: догадки, на которые опирался ответ', () => {
  it('опорные слова: режим, программа, ставка; ответ их назвал — догадка в строке', async () => {
    const G = await import('@/lib/guessConfirm');
    expect(G.anchors('Возможно, на УСН 6 % и ведёт учёт в 1С:Бухгалтерии')).toEqual(expect.arrayContaining(['усн', '6%', '1с']));
    expect(G.anchors('Любит короткие ответы')).toEqual([]);
    expect(G.usedIn('На УСН 6 %', 'Учла УСН 6%: налог 6 000 ₽.')).toBe(true);
    expect(G.usedIn('Ведёт учёт в 1C', 'В 1С это делается так: …')).toBe(true);
    expect(G.usedIn('На УСН 6 %', 'Налог считается по ставке 15 %.')).toBe(false);
    expect(G.usedIn('Работает с ИП', 'Типичный случай')).toBe(false);
    const now = Date.now();
    const rows = [
      row({ id: 'a', text: 'Возможно, на УСН 6 %' }),
      row({ id: 'b', text: 'Ведёт учёт в 1С:Бухгалтерии', sure: 1 }),
      row({ id: 'c', text: 'Пишет коротко, на «ты»', section: 'style' }),
      row({ id: 'd', text: 'Клиенты на ОСНО', updatedAt: now - 61 * 24 * HOUR }),
      row({ id: 'e', text: 'Работает в Контуре' }),
    ];
    const got = G.guessesUsed(rows as never, 'На УСН 6 % налог 6 000 ₽; в Контуре отчёт уйдёт за день. ОСНО тут ни при чём.', now);
    expect(got.map((g) => g.id)).toEqual(['a', 'e']);
    expect(got[0].text).toBe('на УСН 6 %');
    expect(G.guessesUsed(rows as never, '', now)).toEqual([]);
  });
  it('строка под ответом: «Учла: … Верно? Да · Исправить» — текстовыми ссылками', async () => {
    const { GuessLine } = await import('@/components/AnswerLines');
    const { I18nProvider } = await import('@/lib/i18n/react');
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang: 'ru' } as never, createElement(GuessLine, { items: [{ id: 'a', text: 'УСН 6 %' }, { id: 'e', text: '1С:Бухгалтерия' }] })));
    expect(html).toContain('Учла: УСН 6 %, 1С:Бухгалтерия. Верно?');
    expect(html).toMatch(/data-testid="guess-yes"[^>]*>Да</);
    expect(html).toMatch(/data-testid="guess-fix"[^>]*>Исправить</);
    expect(html).toContain('class="ans-link"');
  });
});

describe('поздний конец знакомства (кластер 18.11: 6–7 ответов, конца нет)', () => {
  async function intro(userId: string, answers: number, lastAgo: number, lastRole: 'assistant' | 'user' = 'assistant') {
    const { getDb, schema } = await import('@/lib/db');
    const M = await import('@/lib/memory');
    const th = `th-${userId}`, now = Date.now();
    getDb().insert(schema.threads).values({ id: th, userId, title: 'Знакомство', modelId: 'alpha', createdAt: now - 10 * HOUR, updatedAt: now, temporary: M.INTRO }).run();
    let seq = 0;
    const put = (role: 'user' | 'assistant', content: string, at: number, meta: Record<string, unknown> = {}) =>
      getDb().insert(schema.messages).values({ id: `${th}-${++seq}`, threadId: th, role, content, seq, createdAt: at, parentId: null, meta: { status: 'done', ...meta } } as never).run();
    put('user', 'Давай познакомимся.', now - 9 * HOUR, { hidden: true });
    put('assistant', 'Чем занимаетесь?', now - 9 * HOUR);
    for (let i = 0; i < answers; i++) { put('user', `ответ ${i}`, now - 8 * HOUR + i); if (i < answers - 1 || lastRole === 'assistant') put('assistant', `вопрос ${i}?`, now - lastAgo); }
    M.setMemoryMeta(userId, { introDone: now - 9 * HOUR });
    return th;
  }
  it('ответов на ядро хватает, час тишины — конец по плану (reason=late), один раз', async () => {
    const M = await import('@/lib/memory');
    const th = await intro('v1', 7, 2 * HOUR);
    expect(M.lateIntroEnd('v1')).toBe(true);
    expect(M.memoryMeta('v1')).toMatchObject({ endReason: 'late' });
    expect(M.memoryMeta('v1').rules?.pending).toBeGreaterThan(0);
    expect(M.lateIntroEnd('v1')).toBe(false);
    void th;
  });
  it('мало ответов, недавно или последний — его ответ без ответа модели — не трогаем', async () => {
    const M = await import('@/lib/memory');
    await intro('v2', 2, 2 * HOUR);
    expect(M.lateIntroEnd('v2')).toBe(false);
    await intro('v3', 4, 10 * 60_000);
    expect(M.lateIntroEnd('v3')).toBe(false);
    await intro('v4', 4, 2 * HOUR, 'user');
    expect(M.lateIntroEnd('v4')).toBe(false);
    expect(M.memoryMeta('v4').introEnd).toBeUndefined();
  });
});

describe('B1: вопрос в момент нужды — в системной части', () => {
  it('память включена — абзац целиком; выключена или временный чат — без последней фразы; в знакомстве — нет', async () => {
    const M = await import('@/lib/memory');
    const on = M.renderBlock([], 600, { lang: 'ru' }).text;
    expect(on).toContain('задай ОДИН вопрос');
    expect(on).toContain('коротко назови, что учла');
    expect(on).toContain('Ответ человека на такой вопрос — подтверждённый факт о нём.');
    for (const why of ['off', 'temp'] as const) {
      const off = M.memoryOffNote(why, 'ru');
      expect(off).toContain('задай ОДИН вопрос');
      expect(off).not.toContain('подтверждённый факт');
      expect(off).toContain('Молча не угадывай.');
    }
    expect(M.renderBlock([], 600, { lang: 'en' }).text).toContain('ask ONE question');
    expect(M.renderBlock([], 600, { lang: 'ru', intro: M.INTRO_RULES }).text).not.toContain('задай ОДИН вопрос');
    expect(M.renderBlock([row({ text: 'на УСН 6 %' })] as never, 600, { lang: 'ru' }).text).toContain('если ответ от догадки зависит — коротко назови, что учла');
  });
});
