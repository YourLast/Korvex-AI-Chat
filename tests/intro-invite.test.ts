import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type IV = typeof import('@/lib/introInvite');
let I: IV;
const DAY = 864e5;
const USEFUL = 'Итог: НДС к уплате 12 400 ₽. '.repeat(10);
beforeAll(async () => {
  I = await import('@/lib/introInvite');
  const { getDb, schema } = await import('@/lib/db');
  const now = Date.now();
  const u = (id: string, at: number) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: at, lastTz: 'Europe/Moscow' });
  getDb().insert(schema.users).values([u('n1', now - DAY), u('n2', now), u('old', now - 90 * DAY), u('d1', now), u('s1', now)]).run();
});

describe('styleRequest — просьба отвечать иначе', () => {
  it('ловит просьбы, не ловит вопросы и обычные задачи', () => {
    for (const t of ['пиши короче', 'Давай на ты', 'отвечай, пожалуйста, без воды', 'отвечай таблицей', 'Без воды!', 'пиши подробнее', 'давайте на «вы»', 'объясняй проще', 'please be more concise'])
      expect(I.styleRequest(t), t).not.toBeNull();
    for (const t of ['как писать короче в письмах?', 'сделай таблицу продаж за март', 'короче, у меня вопрос по НДС с аванса', 'посчитай НДС 20% от 120 000', 'привет', 'можно подробнее про НДС?', 'давай подробнее', 'покороче'])
      expect(I.styleRequest(t), t).toBeNull();
    expect(I.styleNote('пиши короче', 'ru')).toContain('«Понял, буду так.»');
  });
});

describe('inviteReply — «не предлагай знакомиться»', () => {
  it('просьба не звать — навсегда; обычное «нет» — не ответ на приглашение', () => {
    expect(I.inviteReply('и не предлагай больше знакомиться')).toBe('never');
    expect(I.inviteReply('нет, не хочу')).toBeNull();
    expect(I.inviteReply('посчитай НДС')).toBeNull();
  });
});

describe('строка-приглашение под полезным ответом (v4)', () => {
  it('только под полезным ответом, не чаще раза в сутки; модель не зовёт', () => {
    const now = Date.now();
    expect(I.inviteUnder('n1', 'm-short', 'Привет! Чем помочь?', now)).toBe(false);
    expect(I.inviteUnder('n1', 'm1', USEFUL, now)).toBe(true);
    expect(I.inviteLineOn('n1', 'm1')).toBe(true);
    expect(I.inviteLineOn('n1', 'm-other')).toBe(false);
    expect(I.inviteUnder('n1', 'm2', USEFUL, now + 60_000)).toBe(false);
    expect(I.inviteWhy('n1', now + 60_000)).toBe('today');
    expect(I.inviteUnder('n1', 'm3', USEFUL, now + DAY + 1)).toBe(true);
    expect(I.inviteLineOn('n1', 'm1')).toBe(false);
    for (const lvl of ['medium', 'xhigh']) expect(I.turnNotes('n1', { content: 'привет' }, null, lvl, now)).toEqual([]);
  });
  it('«Позже»: не раньше чем через день и под новым ответом; после второго — больше не зовём', () => {
    const now = Date.now();
    expect(I.inviteUnder('old', 'o1', USEFUL, now)).toBe(true);
    I.inviteLater('old', now + 1000);
    expect(I.inviteLineOn('old', 'o1')).toBe(false);
    expect(I.inviteWhy('old', now + 2 * 3600_000)).toBe('later');
    expect(I.inviteUnder('old', 'o2', USEFUL, now + DAY + 2000)).toBe(true);
    I.inviteLater('old', now + DAY + 3000);
    expect(I.inviteWhy('old', now + 5 * DAY)).toBe('later-max');
    expect(I.inviteUnder('old', 'o3', USEFUL, now + 5 * DAY)).toBe(false);
  });
  it('«не предлагай знакомиться» и «Не предлагать» — навсегда; знакомство начато или закончено — строки нет', async () => {
    const now = Date.now();
    expect(I.turnNotes('d1', { content: 'не предлагай мне знакомиться' }, null, 'medium', now)).toEqual([]);
    expect(I.inviteWhy('d1', now + DAY)).toBe('never');
    expect(I.inviteUnder('n2', 'x1', USEFUL, now)).toBe(true);
    I.inviteNever('n2', now);
    expect(I.inviteLineOn('n2', 'x1')).toBe(false);
    const M = await import('@/lib/memory');
    M.setMemoryMeta('s1', { introEnd: now });
    expect(I.inviteWhy('s1', now)).toBe('done');
    expect(I.inviteUnder('s1', 's-1', USEFUL, now)).toBe(false);
  });
  it('просьба о манере — заметка «Понял, буду так» в этом же ходе', () => {
    const now = Date.now();
    const n = I.turnNotes('s1', { content: 'пиши короче' }, null, 'medium', now);
    expect(n).toHaveLength(1);
    expect(n[0]).toContain('пиши короче');
    expect(n[0]).toContain('Понял, буду так');
  });
});

describe('«правильно?» — проверка посылки (B 18.11)', () => {
  it('просит подтвердить цифру или норму — да; просто вопрос или «да?» без цифры — нет', async () => {
    const I = await import('@/lib/introInvite');
    for (const t of ['МРОТ 22 440, правильно?', 'НДС у нас 20 %, верно?', 'Срок уплаты 28-е, так ведь?', 'Подтверди, что лимит по УСН 450 млн', 'The rate is 6 %, right?'])
      expect(I.asksToConfirm(t), t).toBe(true);
    for (const t of ['Сколько НДС с 1000?', 'Привет, как дела?', 'Ну что, да?', 'Посчитай УСН за квартал'])
      expect(I.asksToConfirm(t), t).toBe(false);
    expect(I.confirmNote('ru')).toMatch(/по существу/);
  });
});
