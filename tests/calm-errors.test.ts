import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StepRow, WorkFeed } from '@/components/WorkFeed';
import { allSteps, buildFeed, countSteps, markRecovered, statusSpoken, statusText, summaryLine, turnSettled, type StepEvent } from '@/lib/work';
import { tr } from '@/lib/i18n/core';

let T = 1000;
const ev = (p: Partial<StepEvent> & { id: string }): StepEvent => ({ kind: 'browser', title: 'Открывает ozon.ru', status: 'ok', at: { r: 0, c: 0 }, round: 0, t0: T++, ...p });
const fmt = (ms: number) => `${Math.round(ms / 1000)} s`;
const FAILED_THEN_OK = [
  'Достану таблицу из PDF.',
  '▸ python: Извлекаю таблицу из PDF',
  '    [python failed, exit code 1]',
  'Не вышло, пробую иначе.',
  '▸ python: Извлекаю таблицу из PDF другим способом',
  '    строк: 41',
  '[поиск: условия выплаты]',
  '[найдено: 3 источника]',
  '',
].join('\n');
const FAILED_LAST = ['▸ python: Извлекаю таблицу из PDF', '    строк: 41', '▸ python: Считаю итог', '    [python failed, exit code 1]', ''].join('\n');

describe('пройденная ошибка шага (recovered)', () => {
  it('упал, потом получилось, ход кончился нормально: шаг помечен, в сводке нет «ошибки»', () => {
    const f = buildFeed(FAILED_THEN_OK, [], false, true, 'ru', true);
    const st = allSteps(f);
    expect(st.map((s) => s.status)).toEqual(['err', 'ok', 'ok']);
    expect(st[0].recovered).toBe(true);
    expect(st[1].recovered).toBeUndefined();
    expect(countSteps(f)).toBe(3);
    expect(summaryLine(f, 41000, fmt)).toBe('Работал 41 s · 3 шага');
    expect(summaryLine(buildFeed(FAILED_THEN_OK, [], false, true, 'en', true), 41000, fmt, 'en')).toBe('Worked 41 s · 3 steps');
    expect(summaryLine(buildFeed(FAILED_THEN_OK, [], false, true, 'sr', true), 41000, fmt, 'sr')).toBe('Radio 41 s · 3 koraka');
  });
  it('тот же ход без «нормально» (ошибка хода, остановка, нет ответа): красное как было, «1 ошибка»', () => {
    const f = buildFeed(FAILED_THEN_OK, [], false, true, 'ru', false);
    expect(allSteps(f).some((s) => s.recovered)).toBe(false);
    expect(summaryLine(f, 41000, fmt)).toBe('Работал 41 s · 3 шага · 1 ошибка');
    expect(summaryLine(buildFeed(FAILED_THEN_OK, [], false, true, 'en', false), 41000, fmt, 'en')).toBe('Worked 41 s · 3 steps · 1 error');
    expect(statusText(allSteps(f)[0])).toBe('ошибка');
  });
  it('последний шаг упал и после него ничего не получилось — не пройдена, даже когда ход закончен нормально', () => {
    const f = buildFeed(FAILED_LAST, [], false, true, 'ru', true);
    expect(allSteps(f).map((s) => !!s.recovered)).toEqual([false, false]);
    expect(summaryLine(f, 20000, fmt)).toBe('Работал 20 s · 2 шага · 1 ошибка');
    expect(statusText(allSteps(f)[1])).toBe('ошибка');
  });
  it('две ошибки, повтор после первой: пройдена одна, в сводке «1 ошибка» про вторую', () => {
    const R = ['▸ python: Раз', '    [python failed, exit code 1]', '▸ python: Два', '    ok', '▸ python: Три', '    [python failed, exit code 2]', ''].join('\n');
    const f = buildFeed(R, [], false, true, 'ru', true);
    expect(allSteps(f).map((s) => `${s.status}:${!!s.recovered}`)).toEqual(['err:true', 'ok:false', 'err:false']);
    expect(summaryLine(f, 9000, fmt)).toBe('Работал 9 s · 3 шага · 1 ошибка');
  });
  it('шаги Korvex: упавший шаг браузера и потом удачный — пройден; ваше сообщение на ходу «получившимся шагом» не считается', () => {
    const calm = buildFeed('', [ev({ id: 'a', status: 'err', at: { r: 0, c: 0 } }), ev({ id: 'b', kind: 'chat', title: 'Читает чат «Склад»', at: { r: 0, c: 0 } })], false, true, 'ru', true);
    expect(allSteps(calm).find((s) => s.id === 'a')?.recovered).toBe(true);
    const steer = buildFeed('', [ev({ id: 'a', status: 'err' }), ev({ id: 's', kind: 'steer', title: 'сначала проверь цену' })], false, true, 'ru', true);
    expect(allSteps(steer).find((s) => s.id === 'a')?.recovered).toBeUndefined();
    expect(summaryLine(steer, 5000, fmt)).toBe('Работал 5 s · 1 шаг · 1 ошибка');
  });
  it('подшаги идут раньше своего вызова: упавший вызов не «восстанавливается» своими же подшагами', () => {
    const f = buildFeed('', [
      ev({ id: 'call', title: 'Работает в браузере', status: 'err' }),
      ev({ id: 's1', parent: 'call', title: 'Открывает hh.ru', status: 'ok' }),
    ], false, true, 'ru', true);
    expect(allSteps(f).find((s) => s.id === 'call')?.recovered).toBeUndefined();
    expect(summaryLine(f, 5000, fmt)).toBe('Работал 5 s · 1 шаг · 1 ошибка');
    const g = buildFeed('', [
      ev({ id: 'call', title: 'Работает в браузере', status: 'ok' }),
      ev({ id: 's1', parent: 'call', title: 'Нажимает «Войти»', status: 'err' }),
    ], false, true, 'ru', true);
    expect(allSteps(g).find((s) => s.id === 's1')?.recovered).toBe(true);
  });
  it('подпись шага: у пройденного нет слова «ошибка» в строке, голосом — «не получилось с первого раза — модель повторила»', () => {
    const [bad] = allSteps(buildFeed(FAILED_THEN_OK, [], false, true, 'ru', true));
    expect(bad.status).toBe('err');
    expect(statusText(bad)).toBe('');
    expect(statusSpoken(bad)).toBe('не получилось с первого раза — модель повторила');
    expect(statusSpoken(bad, 'en')).toBe('didn’t work at first — retried');
    expect(statusSpoken(bad, 'sr')).toBe('nije uspelo iz prvog pokušaja — model je ponovio');
  });
  it('пометка есть на всех трёх языках и не пустая', () => {
    for (const l of ['ru', 'en', 'sr'] as const) expect(tr(l, 'work.st.retried').length).toBeGreaterThan(10);
  });
  it('markRecovered можно звать на готовой ленте; без успешных шагов ничего не трогает', () => {
    const f = buildFeed('▸ python: Раз\n    [python failed, exit code 1]\n', [], false, true);
    markRecovered(f);
    expect(allSteps(f)[0].recovered).toBeUndefined();
  });
});

describe('ход кончился нормально (turnSettled)', () => {
  const ok = { streaming: false, content: 'Вот таблица.', meta: {} };
  it('есть ответ, не идёт, нет ошибки и остановки — да', () => { expect(turnSettled(ok)).toBe(true); });
  it('идёт, нет ответа, ошибка хода (в т. ч. для пользователя), остановлен — нет', () => {
    expect(turnSettled({ ...ok, streaming: true })).toBe(false);
    expect(turnSettled({ ...ok, content: '  ' })).toBe(false);
    expect(turnSettled({ ...ok, content: undefined })).toBe(false);
    expect(turnSettled({ ...ok, meta: { error: 'upstream 500' } })).toBe(false);
    expect(turnSettled({ ...ok, meta: { errorUser: 'Korvex временно недоступна' } })).toBe(false);
    expect(turnSettled({ ...ok, meta: { stopped: true } })).toBe(false);
    expect(turnSettled({ ...ok, meta: null })).toBe(true);
  });
});

describe('отрисовка: сводка и строка шага', () => {
  const done = (extra: Record<string, unknown> = {}) => ({ id: 'm1', reasoning: FAILED_THEN_OK, steps: [] as StepEvent[], streaming: false, reasoningMs: 41000, content: 'Вот таблица.', meta: { durationMs: 41000 }, ...extra });
  const sum = (m: ReturnType<typeof done>) => renderToStaticMarkup(createElement(WorkFeed, { m }));
  it('ход кончился нормально: «Работал 41 с · 3 шага», значок — галочка, красного и «ошибки» нет', () => {
    const html = sum(done());
    expect(html).toMatch(/data-testid="work-done"><b>Работал 41 с · 3 шага<\/b>/);
    expect(html).not.toContain('is-err');
    expect(html).not.toMatch(/ошибк/i);
  });
  it('ход упал (ошибка хода) или нет ответа или остановлен: поза «ошибка» у знака (08.11: «!», потом снова искра) и «Ошибка · работал … · 1 ошибка» как раньше', () => {
    for (const x of [{ meta: { durationMs: 41000, error: 'upstream 500' } }, { content: '' }]) {
      const html = sum(done(x));
      expect(html).toContain('data-end="error"');
      expect(html).toMatch(/1 ошибка/);
    }
    const stopped = sum(done({ meta: { durationMs: 41000, stopped: true } }));
    expect(stopped).toContain('Остановлено');
    expect(stopped).toContain('data-end="stop"');
    expect(sum(done())).not.toContain('data-end=');
  });
  it('строка упавшего и потом удавшегося шага: приглушённая пометка, не красная, без слова «ошибка»', () => {
    const [bad] = allSteps(buildFeed(FAILED_THEN_OK, [], false, true, 'ru', true));
    const html = renderToStaticMarkup(createElement(StepRow, { s: bad }));
    expect(html).toContain('data-testid="work-retried"');
    expect(html).toContain('Не получилось с первого раза — модель повторила');
    expect(html).toContain('is-recovered');
    expect(html).not.toContain('data-testid="work-status"');
    expect(html).not.toMatch(/ошибк/i);
  });
  it('не пройденная ошибка в строке — красный чип «ошибка», без пометки о повторе', () => {
    const [bad] = allSteps(buildFeed(FAILED_THEN_OK, [], false, true, 'ru', false));
    const html = renderToStaticMarkup(createElement(StepRow, { s: bad }));
    expect(html).toContain('wk-st is-err');
    expect(html).not.toContain('work-retried');
  });
});
