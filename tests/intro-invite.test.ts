import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type IV = typeof import('@/lib/introInvite');
let I: IV;
const DAY = 864e5;
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

describe('inviteReply — ответ на приглашение', () => {
  const inv = 'Готово. Кстати, давай [познакомимся](/settings/memory#intro) — пара минут.';
  it('«нет, не хочу» после приглашения — навсегда; «не сейчас» — до завтра; без приглашения «нет» — не ответ на него', () => {
    expect(I.inviteReply('нет, не хочу', inv)).toBe('never');
    expect(I.inviteReply('Не надо', inv)).toBe('never');
    expect(I.inviteReply('не сейчас', inv)).toBe('later');
    expect(I.inviteReply('нет, это не так, пересчитай', 'Итог: 120')).toBeNull();
    expect(I.inviteReply('и не предлагай больше знакомиться', null)).toBe('never');
    expect(I.inviteReply('посчитай НДС', inv)).toBeNull();
  });
});

describe('inviteState и turnNotes', () => {
  it('новый: раз в день, только лёгкий ход, ≤ 7 раз, 7 дней с регистрации', () => {
    const now = Date.now();
    const s0 = I.inviteState('n1', now);
    expect(s0).toMatchObject({ eligible: true, widget: true, modelDue: true });
    expect(I.turnNotes('n1', { content: 'разбери отчёт' }, null, 'xhigh', now)).toEqual([]);
    expect(I.turnNotes('n1', { content: 'разбери', meta: { fileIds: ['f'] } }, null, 'medium', now)).toEqual([]);
    const a = I.turnNotes('n1', { content: 'привет' }, null, 'medium', now);
    expect(a).toHaveLength(1);
    expect(a[0]).toContain('/settings/memory#intro');
    expect(a[0]).toContain('без рекламы'.replace('без р', 'Без р'));
    expect(a[0]).toContain('сначала полностью ответь');
    expect(I.turnNotes('n1', { content: 'ещё вопрос' }, null, 'medium', now + 60_000)).toEqual([]);
    expect(I.inviteState('n1', now + 60_000)).toMatchObject({ widget: true, modelDue: false });
    let shown = 1;
    for (let d = 1; d < 5; d++) { if (I.turnNotes('n1', { content: 'привет' }, null, 'low', now + d * DAY).length) shown++; }
    expect(shown).toBe(5);
    expect(I.inviteState('n1', now + 6 * DAY).eligible).toBe(false);
  });
  it('давний аккаунт: 7 дней — с первой проверки (с выкатки)', () => {
    const now = Date.now();
    expect(I.inviteState('old', now)).toMatchObject({ eligible: true });
    expect(I.inviteState('old', now + 6 * DAY).eligible).toBe(true);
    expect(I.inviteState('old', now + 7 * DAY + 1000).eligible).toBe(false);
  });
  it('«Не сейчас» — до завтра; «Не предлагать» и «нет, не хочу» — навсегда; после знакомства — нет', async () => {
    const now = Date.now();
    I.inviteLater('n2', now);
    expect(I.inviteState('n2', now)).toMatchObject({ eligible: true, widget: false, modelDue: false });
    expect(I.inviteState('n2', now + DAY)).toMatchObject({ widget: true, modelDue: true });
    I.inviteNever('n2', now);
    expect(I.inviteState('n2', now + DAY)).toMatchObject({ eligible: false, why: 'never' });
    const inv = 'Ответ. Давай [познакомимся](/settings/memory#intro).';
    expect(I.turnNotes('d1', { content: 'нет, не хочу' }, inv, 'medium', now)).toEqual([]);
    expect(I.inviteState('d1', now + DAY).why).toBe('never');
    const M = await import('@/lib/memory');
    M.setMemoryMeta('s1', { introEnd: now });
    expect(I.inviteState('s1', now).why).toBe('done');
  });
  it('просьба о манере — заметка «Понял, буду так» в этом же ходе (и приглашение, если день не тратился)', () => {
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

describe('приглашение: пример в форме обращения человека (B 18.11: «вы» человеку на «ты»)', () => {
  it('на «ты» — пример на «ты», на «вы» — на «вы», неизвестно — безлично (этап 2 B: «расскажете» людям на «ты» без подсказки)', async () => {
    const I = await import('@/lib/introInvite');
    const ty = I.inviteNote('ru', 'в этом сообщении — на «ты»');
    expect(ty).toContain('если расскажешь'); expect(ty).not.toContain('если расскажете'); expect(ty).toContain('ни одного «вы»');
    const vy = I.inviteNote('ru', 'обращение: Обращаться на «вы»');
    expect(vy).toContain('если расскажете'); expect(vy).not.toContain('если расскажешь');
    const n = I.inviteNote('ru', '');
    expect(n).not.toMatch(/если расскаж/); expect(n).toContain('безлично'); expect(n).toContain('/settings/memory#intro');
  });
  it('приглашение по теме вопроса: правило и второй пример не про НДС (B: «по контексту» 29 из 39)', async () => {
    const I = await import('@/lib/introInvite');
    for (const m of ['в этом сообщении — на «ты»', 'обращение: на «вы»', '']) {
      const t = I.inviteNote('ru', m);
      expect(t).toContain('по теме его вопроса'); expect(t).toContain('Не «чем занимаешься» вообще');
      expect(t).toMatch(/после вопроса про расход топлива/);
    }
    expect(I.inviteNote('ru', 'в этом сообщении — на «ты»')).toContain('для чего считаешь расход');
    expect(I.inviteNote('ru', 'обращение: на «вы»')).toContain('для чего считаете расход');
    expect(I.inviteNote('ru', '')).toContain('для чего нужен такой расчёт');
  });
  it('манера по сообщению: «привет» и «выдели» — на «ты», «Добрый день» и «Выделите» — на «вы», без подсказки — пусто', async () => {
    const I = await import('@/lib/introInvite');
    const U = 'inv-manner-' + Math.random().toString(36).slice(2);
    const { getDb, schema } = await import('@/lib/db');
    getDb().insert(schema.users).values({ id: U, email: `${U}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user', createdAt: Date.now(), lang: 'ru' }).run();
    for (const t of ['привет, выдели НДС из 468 319,20.', 'Выдели НДС из 1 096 260,74.', 'Привет! Сколько НДС с медуслуг?', 'переведи 95 дюймов в мм'])
      expect(I.mannerOf(U, t), t).toMatch(/на «ты»/);
    for (const t of ['Добрый день. Выделите НДС из 6 622 320,02.', 'Здравствуйте, клиент просит счёт', 'Посчитайте скидку 12 %'])
      expect(I.mannerOf(U, t), t).toMatch(/на «вы»/);
    for (const t of ['Клиент просит счет на 8 769 900,28 с НДС. Что ему ответить?', 'Скидка 12 % от 36 000,00 — сколько выйдет?', 'Цена на сайте 500 ₽?'])
      expect(I.mannerOf(U, t), t).toBe('');
  });
  it('строка заканчивается явным действием: «нажми сюда» на «ты», «нажмите сюда» на «вы», «начать знакомство» без формы, «tap here» в EN', async () => {
    const I = await import('@/lib/introInvite');
    expect(I.inviteNote('ru', 'на «ты»')).toContain('[нажми сюда](/settings/memory#intro)');
    expect(I.inviteNote('ru', 'на «вы»')).toContain('[нажмите сюда](/settings/memory#intro)');
    expect(I.inviteNote('ru', '')).toContain('[начать знакомство](/settings/memory#intro)');
    expect(I.inviteNote('en')).toContain('[tap here](/settings/memory#intro)');
  });
});
