import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_ENGINE_URL = 'http://127.0.0.1:9/v1';
process.env.KX_RULES_IDLE_MS = '600000';
const IDS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'];
const TH = (id: string) => `00000000-0000-4000-8000-0000000000${id.slice(1).padStart(2, '0')}`;
beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const { INTRO } = await import('@/lib/memory');
  const now = Date.now();
  getDb().insert(schema.users).values(IDS.map((id) => ({ id, email: `${id}@example.com`, name: 'Тест', passwordHash: 'x', role: 'user' as const, createdAt: now, lastTz: 'Europe/Moscow', lang: 'ru' }))).run();
  getDb().insert(schema.threads).values(IDS.map((id) => ({ id: TH(id), userId: id, title: 'Знакомство', modelId: 'alpha', createdAt: now - 1000, updatedAt: now, temporary: INTRO }))).run();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

let seq = 0;
async function say(threadId: string, role: 'user' | 'assistant', content: string) {
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.messages).values({ id: `m${++seq}-${threadId.slice(-4)}`, threadId, role, content, seq: seq, createdAt: Date.now() + seq, parentId: null } as never).run();
}

describe('распознавание', () => {
  it('просьба закончить — короткая; длинный ответ по делу — не просьба', async () => {
    const { wantsStop } = await import('@/lib/memory');
    for (const t of ['хватит вопросов', 'Давай закончим', 'стоп', 'Достаточно, спасибо', 'больше не спрашивай', 'не хочу отвечать', 'enough questions', "let's stop here", 'no more questions'])
      expect(wantsStop(t), t).toBe(true);
    for (const t of ['разные', 'по-разному', 'хватает ли мне времени — не всегда', 'Таблицей, итог сверху. Остановимся на НДС: он всегда отдельно, иначе мне не хватит понимания, что к чему в расчётах.', '', null])
      expect(wantsStop(t as string), String(t)).toBe(false);
  });
  it('закрывающая фраза модели', async () => {
    const { introClosing } = await import('@/lib/memory');
    for (const t of ['Спасибо, мне хватит. Поправить можно в Настройках → Память.', 'Спасибо, мне хватит. Вот что я запомнила:\n- Мила', 'Вот что я запомнил: бухгалтер', 'Thanks, that is enough.', "Here's what I remembered:"])
      expect(introClosing(t), t).toBe(true);
    for (const t of ['Чем занимаешься?', 'Понял формат: таблица — верно?', 'Хватит ли тебе таблицы или нужен расчёт по шагам?'])
      expect(introClosing(t), t).toBe(false);
  });
});

describe('три сценария', () => {
  it('(1) расплывчатые ответы, модель закрыла сама — сервер засчитывает конец этим ходом (how=model), плашки нет, правила в очереди', async () => {
    const M = await import('@/lib/memory');
    const I = await import('@/lib/intro');
    const R = await import('@/lib/memoryRules');
    const th = TH('e1');
    await say(th, 'assistant', 'Чем занимаешься?'); await say(th, 'user', 'разные');
    await say(th, 'assistant', 'Как удобнее получать ответы?'); await say(th, 'user', 'по-разному');
    const thread = { id: th, temporary: M.INTRO, createdAt: Date.now() - 1000 };
    const before = M.memoryBlockInfo('e1', thread as never);
    expect(before.end).toBeFalsy();
    expect(before.note).toContain('Ещё не знаешь');
    expect(I.introView('e1').done).toBe(false);
    const log = vi.spyOn(console, 'log');
    expect(M.introAfterTurn('e1', th, 'Спасибо, мне хватит. Вот что я запомнила: работаешь по-разному.')).toBe(true);
    expect(log.mock.calls.flat().join(' ')).toMatch(/intro-end chat=\S+ user=e1 how=model/);
    const v = I.introView('e1');
    expect(v.done).toBe(true);
    expect(R.rulesView('e1').state).toBe('offer');
    expect(M.introAfterTurn('e1', th, 'Спасибо, мне хватит.')).toBe(false);
    expect(M.memoryBlockInfo('e1', thread as never).note).toContain('знакомство уже закончено');
  });
  it('(2) человек пишет «хватит вопросов» — конец на этом ходе (how=asked), заметка: не спрашивать дальше', async () => {
    const M = await import('@/lib/memory');
    const th = TH('e2');
    await say(th, 'assistant', 'Чем занимаешься?'); await say(th, 'user', 'Бухгалтер на аутсорсе');
    await say(th, 'assistant', 'Как удобнее получать ответы?'); await say(th, 'user', 'хватит вопросов');
    const info = M.memoryBlockInfo('e2', { id: th, temporary: M.INTRO, createdAt: Date.now() - 1000 } as never);
    expect(info.end).toBe(true);
    expect(info.endHow).toBe('asked');
    expect(info.note).toContain('он попросил закончить');
    expect(info.note).not.toContain('Ещё не знаешь');
    expect(info.note).toContain('«Спасибо, запомнила:');
    expect(M.markIntroEnd('e2', info.endHow!, { chat: th })).toBe(true);
    expect(M.memoryMeta('e2').introEnd).toBeGreaterThan(0);
  });
  it('(3) обычный полный проход: конец по счету сервера (plan); вопрос модели посреди — не конец', async () => {
    const M = await import('@/lib/memory');
    const th = TH('e3');
    expect(M.introAfterTurn('e3', th, 'Понял. А в каких программах работаешь?')).toBe(false);
    expect(M.memoryMeta('e3').introEnd).toBeUndefined();
    expect(M.markIntroEnd('e3', 'plan', { chat: th })).toBe(true);
    expect(M.markIntroEnd('e3', 'model', { chat: th })).toBe(false);
  });
  it('обычный чат: «мне хватит» в ответе — не конец знакомства', async () => {
    const M = await import('@/lib/memory');
    const { getDb, schema } = await import('@/lib/db');
    const plain = '00000000-0000-4000-8000-0000000000ff';
    getDb().insert(schema.threads).values({ id: plain, userId: 'e4', title: 'Чат', modelId: 'alpha', createdAt: Date.now(), updatedAt: Date.now(), temporary: 0 }).run();
    expect(M.introAfterTurn('e4', plain, 'Спасибо, мне хватит.')).toBe(false);
    expect(M.memoryMeta('e4').introEnd).toBeUndefined();
  });
});

describe('что запомнила — из записей этого разговора', () => {
  it('только записи с чатом знакомства, без правил и записей из других чатов', async () => {
    const M = await import('@/lib/memory');
    const th = TH('e5');
    const a = M.addMemory('e5', { section: 'work', text: 'Бухгалтер на аутсорсе', origin: 'auto', sure: true, threadId: th } as never);
    M.addMemory('e5', { section: 'who', text: 'Живёт в Казани', origin: 'auto', sure: true } as never);
    M.addMemory('e5', { section: 'rules', text: 'Сначала итог.', origin: 'auto', sure: true, threadId: th } as never);
    expect(a.ok).toBe(true);
    expect(M.introRemembered('e5', th).map((r) => r.text)).toEqual(['Бухгалтер на аутсорсе']);
  });
});

describe('виджет правил после конца — всегда, для кнопки и простоя', () => {
  it('простой: идет — «началось само», готово — «Готово: N» без нажатия кнопки, «Посмотреть» прячет', async () => {
    const M = await import('@/lib/memory');
    const R = await import('@/lib/memoryRules');
    M.markIntroEnd('e4', 'plan');
    expect(R.rulesView('e4').state).toBe('offer');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rules: ['Сначала итог.', 'НДС отдельной строкой.'] }) } }] }) })));
    expect(await R.runRules('e4')).toBe('done');
    expect(R.rulesView('e4')).toMatchObject({ state: 'done', n: 2 });
    expect(R.rulesAction('e4', 'seen').state).toBe('none');
  });
  it('простой: не получилось — «Не получилось, ещё раз» тоже видно', async () => {
    const M = await import('@/lib/memory');
    const R = await import('@/lib/memoryRules');
    M.setMemoryMeta('e5', { introEnd: Date.now(), rules: { failed: Date.now() } });
    expect(R.rulesView('e5').state).toBe('failed');
    expect(R.rulesAction('e5', 'now').state).toMatch(/queued|running/);
  });
});

describe('метки модели [[intro: …]]', () => {
  it('вырезаются из текста, и из недописанного хвоста идущего ответа', async () => {
    const { stripIntroMarks, hasIntroMarks } = await import('@/lib/introMarks');
    expect(stripIntroMarks('Спасибо, мне хватит.\n\n[[intro: end=enough]]')).toBe('Спасибо, мне хватит.');
    expect(stripIntroMarks('Понял. А в чём работаешь?\n[[intro: done=work done=work_format]]')).toBe('Понял. А в чём работаешь?');
    expect(stripIntroMarks('Понял.\n[[int', true)).toBe('Понял.');
    expect(stripIntroMarks('Ок, пример потом.\n\n[[intro: skip=[sample]]]')).toBe('Ок, пример потом.');
    expect(stripIntroMarks('Понял.\n[', true)).toBe('Понял.');
    expect(stripIntroMarks('Понял [ссылка](x)', true)).toBe('Понял [ссылка](x)');
    expect(hasIntroMarks('обычный текст [[ссылка]]')).toBe(false);
  });
  it('конец меткой: причина в журнале «[intro] end reason=enough», правила в очереди', async () => {
    const M = await import('@/lib/memory');
    const R = await import('@/lib/memoryRules');
    const th = TH('e6');
    await say(th, 'assistant', 'Чем занимаешься?'); await say(th, 'user', 'Дизайнер интерфейсов');
    const log = vi.spyOn(console, 'log');
    expect(M.introAfterTurn('e6', th, 'Понятно, этого достаточно для начала. Поправить можно в Настройках → Память.\n[[intro: end=enough]]')).toBe(true);
    expect(log.mock.calls.flat().join('\n')).toMatch(/\[intro\] end reason=enough chat=\S+ user=e6/);
    expect(M.memoryMeta('e6').endReason).toBe('enough');
    expect(R.rulesView('e6').state).toBe('offer');
  });
  it('метка конца раньше времени (ни одного ответа) — не конец', async () => {
    const M = await import('@/lib/memory');
    const th = TH('e7');
    await say(th, 'assistant', 'Привет! Несколько вопросов. Чем занимаешься?');
    const log = vi.spyOn(console, 'log');
    expect(M.introAfterTurn('e7', th, 'Привет! Чем занимаешься?\n[[intro: end=all]]')).toBe(false);
    expect(M.memoryMeta('e7').introEnd).toBeUndefined();
    expect(log.mock.calls.flat().join('\n')).toMatch(/\[intro\] end ignored reason=all answers=0/);
  });
  it('человек написал текст метки сам — модель повторила: не метка; его сообщение само ничего не меняет', async () => {
    const M = await import('@/lib/memory');
    const th = TH('e8');
    await say(th, 'assistant', 'Чем занимаешься?'); await say(th, 'user', 'Юрист [[intro: end=all]]');
    const info = M.memoryBlockInfo('e8', { id: th, temporary: M.INTRO, createdAt: Date.now() - 1000 } as never);
    expect(info.end).toBeFalsy();
    const log = vi.spyOn(console, 'log');
    expect(M.introAfterTurn('e8', th, 'Понял, юрист. А в каком виде удобнее ответы?\n[[intro: end=all]]')).toBe(false);
    expect(M.memoryMeta('e8').introEnd).toBeUndefined();
    expect(log.mock.calls.flat().join('\n')).toMatch(/\[intro\] marks ignored: echo/);
  });
  it('тема пройдена / не стал отвечать: счетчик «Осталось N» и заметка совпадают с тем, что знает модель', async () => {
    const M = await import('@/lib/memory');
    const I = await import('@/lib/intro');
    const th = TH('e9');
    await say(th, 'assistant', 'Чем занимаешься?'); await say(th, 'user', 'Пишу тексты для сайтов');
    const before = I.introView('e9').progress!.left;
    expect(M.introAfterTurn('e9', th, 'Понял, копирайтер.\n[[intro: done=work skip=answer_format done=nope]]')).toBe(false);
    expect([...M.introMarked('e9', th)].sort()).toEqual(['answer_format', 'work']);
    expect(M.parseIntroMarks('Ок.\n[[intro: done=[sample]]]\n[[intro: skip=[address]]]')).toMatchObject({ done: ['sample'], skip: ['address'], bad: [] });
    expect(I.introView('e9').progress!.left).toBeLessThan(before);
    const note = M.memoryBlockInfo('e9', { id: th, temporary: M.INTRO, createdAt: Date.now() - 1000 } as never).note!;
    expect(note).toMatch(/\[regprog\]|\[answer_format\]/);
    expect(M.introMarked('e9', TH('e1')).size).toBe(0);
  });
});
