import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

tmpData();
const IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'];
let n = 0;
const nextUser = () => IDS[n++];
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values(IDS.map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1 }))).run();
});

type O = { op: 'add' | 'update' | 'delete'; id?: string; section?: string; key?: string; text?: string; sure?: boolean; sensitive?: string; asked?: boolean };
const op = (o: O) => ({ op: o.op, id: o.id ?? '', section: o.section ?? 'work', key: o.key ?? 'none', text: o.text ?? '', sensitive: o.sensitive ?? 'no', asked: o.asked ?? false, sure: o.sure ?? true });
async function seed(userId: string, rows: { section: string; key?: string; text: string; sure: boolean }[]) {
  const M = await import('@/lib/memory');
  for (const r of rows) M.addMemory(userId, { section: r.section as never, key: r.key ?? null, text: r.text, origin: 'auto', sure: r.sure });
  const refs = new Map<string, string>();
  M.listMemory(userId).forEach((r, i) => refs.set(`r${i + 1}`, r.id));
  return refs;
}
const ctx = (user: string, auto = true) => ({ user, auto, threadId: null, messageId: null });

describe('refutesMemory: опровержение записи — да, обычные фразы с «не» — нет', () => {
  it('поправки: «не X, а Y», «это не так», «на самом деле я …», «неправильно понял», просьба поправить память', async () => {
    const { refutesMemory } = await import('@/lib/memory');
    for (const t of [
      'я не учусь дб. а у меня такой урок в гимназии просто',
      'я живу не в Казани, а в Казани', 'меня зовут не Иван, а Пётр', 'это не так', 'Это не так, я живу в Казани', 'это неправда!',
      'на самом деле я живу в Казани', 'я вообще-то на самом деле работаю в Сбере', 'ты неправильно понял', 'ты неправильно меня понял, кофеен у меня нет',
      'ты ошибся', 'ты перепутал', 'в памяти ошибка', 'исправь запись обо мне', 'обнови память',
      "that's not true", 'you got it wrong', 'actually I live in Kazan', "I'm not a developer, but a teacher",
    ]) expect(refutesMemory(t), t).toBe(true);
  });
  it('голое «я не X» / «у меня нет X» — только если X есть в самой записи', async () => {
    const { refutesMemory } = await import('@/lib/memory');
    expect(refutesMemory('я вообще не программист, это просто знакомому помогал', 'Программист, пишет на Next.js')).toBe(true);
    expect(refutesMemory('у меня нет кофеен', 'Владеет двумя кофейнями')).toBe(true);
    expect(refutesMemory('кофеен у меня нет', 'Владеет двумя кофейнями')).toBe(true);
    expect(refutesMemory('я не учусь', 'Учится, делает проекты по базам данных')).toBe(true);
    expect(refutesMemory('нет, я не в Яндексе, я работаю в Сбере', 'Работает в Яндексе')).toBe(true);
    expect(refutesMemory('я вообще не программист')).toBe(false);
    expect(refutesMemory('я вообще не программист', 'Живёт в Казани')).toBe(false);
    expect(refutesMemory('у меня нет доступа к серверу', 'Работает с серверами')).toBe(false);
    expect(refutesMemory('я вообще не программист, это просто знакомому помогал', 'Пишет на Next.js', true)).toBe(true);
    expect(refutesMemory('я вообще не программист, это просто знакомому помогал', 'Пишет на Next.js', false)).toBe(false);
    expect(refutesMemory('почему я вообще не программист?', 'Пишет на Next.js', true)).toBe(false);
    expect(refutesMemory('напиши письмо поставщику плитки', 'Пишет на Next.js', true)).toBe(false);
  });
  it('ложные срабатывания: «я не люблю спешить», «это не так быстро», «исправь ошибку в коде» — не опровержение', async () => {
    const { refutesMemory } = await import('@/lib/memory');
    for (const t of [
      'я не люблю спешить', 'я не люблю спешить, давай разберём всё по шагам: как настроить backup на NAS?', 'я не знаю, как это сделать', 'я не понял вопрос',
      'мне это не нужно', 'это не работает', 'это не так быстро, как хотелось', 'не так быстро', 'у меня нет времени, ответь коротко', 'не могу найти файл',
      'ты не мог бы написать короче?', 'нет, спасибо', 'я не против, давай', 'моя сестра не любит баскетбол, подскажи ей подарок',
      'объясни, на самом деле как работает DNS', 'исправь ошибку в коде', 'исправь это', 'обнови запись в таблице users', 'это неправильно с точки зрения закона',
      'Вот статья: ' + 'на самом деле я '.repeat(60),
    ]) expect(refutesMemory(t, 'Тренировки по вечерам'), t).toBe(false);
  });
});

describe('applyOps: удаление и замена опровергнутой записи', () => {
  it('догадка sure=0 и «я не учусь дб, а у меня урок в гимназии»: update по id -> sure=1, «Исправил», прежняя запись сохранена для «Отменить»', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'work', text: 'Учится, делает проекты по базам данных', sure: false }]);
    const r = applyOps(u, [op({ op: 'update', id: 'r1', section: 'work', text: 'Учится в гимназии' })], refs, ctx('я не учусь дб. а у меня такой урок в гимназии просто'));
    expect(r.skipped).toEqual([]);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({ op: 'update', text: 'Учится в гимназии', fix: true, maybe: false, prev: { text: 'Учится, делает проекты по базам данных', sure: 0 } });
    expect(M.listMemory(u).map((x) => [x.text, x.sure])).toEqual([['Учится в гимназии', 1]]);
  });
  it('нового факта нет — delete без «забудь» проходит, если человек опровергает именно эту запись', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'work', text: 'Пишет на Next.js', sure: false }, { section: 'interests', text: 'Тренировки по вечерам', sure: true }]);
    const r0 = applyOps(u, [op({ op: 'delete', id: 'r2' })], refs, ctx('я вообще не программист, это просто знакомому помогал'));
    expect(r0.applied).toHaveLength(0);
    expect(r0.skipped.map((x) => x.why)).toEqual(['delete-not-asked']);
    const r1 = applyOps(u, [op({ op: 'delete', id: 'r1', asked: true })], refs, ctx('я вообще не программист, это просто знакомому помогал'));
    expect(r1.skipped).toEqual([]);
    expect(r1.applied[0]).toMatchObject({ op: 'delete', text: 'Пишет на Next.js', fix: true, prev: { text: 'Пишет на Next.js', sure: 0 } });
    expect(M.listMemory(u).map((x) => x.text)).toEqual(['Тренировки по вечерам']);
    const u2 = nextUser();
    const refs2 = await seed(u2, [{ section: 'work', text: 'Программист, пишет на Next.js', sure: true }]);
    const r2 = applyOps(u2, [op({ op: 'delete', id: 'r1', asked: true })], refs2, ctx('я вообще не программист, это просто знакомому помогал'));
    expect(r2.applied[0]).toMatchObject({ op: 'delete', fix: true });
    expect(M.listMemory(u2)).toHaveLength(0);
  });
  it('«я не люблю спешить» запись не трогает; обычный ход без «забудь» — delete-not-asked', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'interests', text: 'Тренировки по вечерам', sure: false }]);
    for (const user of ['я не люблю спешить, давай по шагам: как настроить backup?', 'напиши письмо поставщику плитки']) {
      const r = applyOps(u, [op({ op: 'delete', id: 'r1', asked: true })], refs, ctx(user));
      expect(r.applied).toHaveLength(0);
      expect(r.skipped.map((x) => x.why)).toEqual(['delete-not-asked']);
    }
    expect(M.listMemory(u)).toHaveLength(1);
  });
  it('«забудь …» работает как раньше (без пометки fix); не больше двух записей по опровержению за ход', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'work', key: 'company', text: 'Работает в Яндексе', sure: true }]);
    const f = applyOps(u, [op({ op: 'delete', id: 'r1', asked: true })], refs, ctx('забудь, где я работаю'));
    expect(f.applied).toHaveLength(1);
    expect(f.applied[0].fix).toBeUndefined();
    expect(M.listMemory(u)).toHaveLength(0);
    const u2 = nextUser();
    const refs2 = await seed(u2, [{ section: 'interests', text: 'Баскетбол, НБА', sure: false }, { section: 'interests', text: 'Стрижки и уход за бородой', sure: false }, { section: 'interests', text: 'Тренировки по вечерам', sure: false }]);
    const r = applyOps(u2, ['r1', 'r2', 'r3'].map((id) => op({ op: 'delete', id, asked: true })), refs2, ctx('это не так, ничем из этого я не интересуюсь'));
    expect(r.applied).toHaveLength(2);
    expect(r.skipped.map((x) => x.why)).toEqual(['delete-not-asked']);
    expect(M.listMemory(u2)).toHaveLength(1);
  });
  it('«Обновлять автоматически» выключено — опровержение без явной просьбы не применяется', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'work', text: 'Пишет на Next.js', sure: false }]);
    const r = applyOps(u, [op({ op: 'delete', id: 'r1', asked: true })], refs, ctx('это не так, я не пишу на Next.js', false));
    expect(r.applied).toHaveLength(0);
    expect(r.skipped.map((x) => x.why)).toEqual(['auto-off']);
    expect(M.listMemory(u)).toHaveLength(1);
  });
});

describe('applyOps: секреты режутся как раньше, причина в журнале различается', () => {
  it('текст похож на секрет — secret; метка secret только от модели — secret-model; обе — без записи', async () => {
    const { applyOps } = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const a = applyOps(u, [op({ op: 'add', section: 'facts', text: 'Пароль от VPN — hunter2' })], new Map(), ctx('запомни пароль от VPN hunter2'));
    expect(a.skipped.map((x) => x.why)).toEqual(['secret']);
    const b = applyOps(u, [op({ op: 'add', section: 'work', text: 'Учится в гимназии', sensitive: 'secret' })], new Map(), ctx('я учусь в гимназии'));
    expect(b.skipped.map((x) => x.why)).toEqual(['secret-model']);
    const c = applyOps(u, [op({ op: 'add', section: 'facts', text: 'Код доступа в офис 4821', sensitive: 'secret' }), op({ op: 'add', section: 'facts', text: 'Карта 4276 1234 5678 9012' })], new Map(), ctx('запомни код 4821 и карту'));
    expect(c.skipped.map((x) => x.why)).toEqual(['secret-model', 'secret']);
    expect(M.listMemory(u)).toHaveLength(0);
  });
});

describe('пометка «Исправил: …» и «Отменить»', () => {
  async function note(userId: string, items: unknown[]) {
    const { getDb, schema } = await import('@/lib/db');
    const th = randomUUID(), m = randomUUID();
    getDb().insert(schema.threads).values({ id: th, userId, title: 'Новый чат', modelId: 'alpha', effort: 'off', temporary: 0, createdAt: 1, updatedAt: 1 }).run();
    getDb().insert(schema.messages).values({ id: m, threadId: th, seq: 1, role: 'assistant', content: 'ок', meta: { memUpd: items }, createdAt: 1 }).run();
    return m;
  }
  it('замена: «Исправил: учится в гимназии»; «Отменить» возвращает прежнюю догадку (текст, «Возможно», ячейку)', async () => {
    const { applyOps, _test } = await import('@/lib/curator');
    const { undoMemUpd } = await import('@/lib/memoryUndo');
    const { memUpdText } = await import('@/components/MemUpd');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'work', key: 'role', text: 'Учится, делает проекты по базам данных', sure: false }]);
    const before = M.listMemory(u)[0];
    const r = applyOps(u, [op({ op: 'update', id: 'r1', text: 'Учится в гимназии' })], refs, ctx('я не учусь дб. а у меня такой урок в гимназии просто'));
    const items = _test.itemsOf(u, r.applied);
    expect(items[0]).toMatchObject({ op: 'update', fix: true });
    expect(memUpdText(items as never)).toBe('Исправил: учится в гимназии');
    const msg = await note(u, items);
    expect(undoMemUpd(u, msg)!.undone).toBe(1);
    const back = M.listMemory(u);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: before.id, text: 'Учится, делает проекты по базам данных', sure: 0, key: 'role', section: 'work' });
  });
  it('убрана при опровержении: «Исправил: убрал …»; «Отменить» возвращает запись как была — догадка остаётся догадкой, ячейка и источник те же', async () => {
    const { applyOps, _test } = await import('@/lib/curator');
    const { undoMemUpd } = await import('@/lib/memoryUndo');
    const { memUpdText } = await import('@/components/MemUpd');
    const M = await import('@/lib/memory');
    const u = nextUser();
    const refs = await seed(u, [{ section: 'who', key: 'city', text: 'Живёт в Париже', sure: false }]);
    const r = applyOps(u, [op({ op: 'delete', id: 'r1', section: 'who', asked: true })], refs, ctx('это не так, в Париже я был в командировке'));
    expect(r.applied[0]).toMatchObject({ op: 'delete', fix: true });
    expect(M.listMemory(u)).toHaveLength(0);
    const items = _test.itemsOf(u, r.applied);
    expect(memUpdText(items as never)).toBe('Исправил: убрал живёт в Париже');
    const msg = await note(u, items);
    expect(undoMemUpd(u, msg)!.undone).toBe(1);
    const back = M.listMemory(u);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ text: 'Живёт в Париже', sure: 0, key: 'city', section: 'who', origin: 'auto' });
  });
  it('обычное «Запомнил» / «Забыл» не меняется', async () => {
    const { memUpdText } = await import('@/components/MemUpd');
    expect(memUpdText([{ op: 'add', text: 'Зовут Иван' }])).toBe('Запомнил: зовут Иван');
    expect(memUpdText([{ op: 'update', text: 'Живёт в Казани', prev: { text: 'Живёт в Нише', section: 'who', sure: 1 } }])).toBe('Запомнил: живёт в Казани');
    expect(memUpdText([{ op: 'delete', text: 'Работает в Яндексе' }])).toBe('Забыл: работает в Яндексе');
    expect(memUpdText([{ op: 'add', text: 'Баскетбол', maybe: true, section: 'interests' }])).toBe('Похоже, тебе интересно: баскетбол');
  });
});

describe('промпты', () => {
  it('куратор: правило про опровержение и узкое «secret»', async () => {
    const { curatorMessages } = await import('@/lib/curator');
    const sys = curatorMessages({ rows: [], prevAnswer: '', user: 'x', answer: '' })[0].content;
    expect(sys).toMatch(/опровергает запись/);
    expect(sys).toMatch(/update этой записи по id новым фактом \(sure=true/);
    expect(sys).toMatch(/нового факта нет — delete этой записи по id \(asked=true\)/);
    expect(sys).toMatch(/secret — только сам пароль, ключ доступа, код или номер карты/);
    expect(sys).toMatch(/«я не люблю спешить» к записи не относится/);
  });
  it('модель чата: память ведёт отдельный процесс, не говорить «записал / удалил / исправил»; прежние правила на месте', async () => {
    const M = await import('@/lib/memory');
    const text = M.renderBlock([], 600, {}).text;
    expect(text).toContain('Память о пользователе ведёт отдельный процесс системы, а не ты');
    expect(text).toContain('Не говори, что ты записал, удалил или исправил память');
    expect(text).toContain('«хорошо, учту»');
    expect(text).toContain('Сам о памяти не заговаривай');
    expect(text).toContain('Пароли, ключи и номера карт система не хранит');
    expect(text).not.toContain('Отвечай коротко и честно: «Запомнил: …»');
  });
});
