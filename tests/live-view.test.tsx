import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { actText, answerLine, cameraAt, chatLines, clampPanel, convLines, foundValue, readScale } from '@/components/LiveView';
import { AssistantMsg, sharedShots } from '@/components/Message';
import { buildFeed } from '@/lib/work';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import type { StepEvent } from '@/lib/tools/types';

const ev = (o: Partial<StepEvent> & { id: string }): StepEvent => ({ kind: 'browser', tool: 'browser_open', title: 'Открывает cbr.ru', status: 'ok', at: { r: 0, c: 0 }, ...o } as StepEvent);

describe('микрочат живого показа', () => {
  const steps = [
    ev({ id: 'a', title: 'Открывает cbr.ru/currency_base/daily', detail: 'https://www.cbr.ru/currency_base/daily/ · HTTP 404' }),
    ev({ id: 's', kind: 'steer', tool: 'steer', title: 'только курс на сегодня', detail: 'только курс на сегодня' }),
    ev({ id: 'b', tool: 'browser_scroll', title: 'Прокручивает страницу вниз' }),
    ev({ id: 'c', tool: 'browser_snapshot', title: 'Ищет на странице «Доллар США»', status: 'run' }),
  ];
  it('размышления не попадают, прокрутка — тоже, «Агент:» — только ответ', () => {
    const items = buildFeed('Шаг 1: browser_open.\n\nразмышляю 3.', steps, true, false);
    const l = chatLines(items, '', 5);
    expect(l.map((x) => x.who)).not.toContain('reply');
    expect(l.some((x) => /размышляю|Шаг 1/.test(x.text))).toBe(false);
    expect(l.some((x) => /Прокру/.test(x.text))).toBe(false);
    expect(l.find((x) => x.id === 'a')?.text).toMatch(/^Открыл cbr\.ru\/currency_base\/daily · 404$/);
    expect(l.find((x) => x.who === 'you')).toBeTruthy();
  });
  it('шаг из шапки (skip) в микрочате не повторяется', () => {
    const items = buildFeed('', steps, true, false);
    expect(chatLines(items, '', 5, 'c').some((x) => x.id === 'c')).toBe(false);
  });
  it('ответ — одной строкой без разметки и ссылок (2 строки по словам режет интерфейс)', () => {
    expect(answerLine('**Ключевая ставка** — 16,5 % с 27 октября. Подробнее: [ЦБ](https://cbr.ru).')).toBe('Ключевая ставка — 16,5 % с 27 октября. Подробнее: ЦБ.');
    expect(answerLine('Готово.')).toBe('Готово.');
    expect(answerLine('![](/out/x/a.jpg)')).toBe('');
  });
});

describe('лист переписки', () => {
  it('вопрос, шаги коротко, ваши сообщения на ходу, ответ целиком (с разметкой); затем следующий вопрос', () => {
    const q = { id: 'q1', role: 'user', content: 'Какой курс доллара у ЦБ сегодня?' } as MsgView;
    const a = { id: 'a1', role: 'assistant', content: '**Доллар** — по таблице ЦБ.\n\nЕвро — там же.', reasoning: 'думаю', steps: [
      ev({ id: 'o', title: 'Открывает cbr.ru/currency_base/daily', detail: 'https://www.cbr.ru/currency_base/daily/ · HTTP 200' }),
      ev({ id: 's', kind: 'steer', tool: 'steer', title: 'и евро', detail: 'и евро' }),
    ] } as unknown as MsgView;
    const q2 = { id: 'q2', role: 'user', content: 'А юань?' } as MsgView;
    const l = convLines([q, a, q2]);
    expect(l.map((x) => x.who)).toEqual(['you', 'agent', 'you', 'reply', 'you']);
    expect(l[1].text).toBe('Открыл cbr.ru/currency_base/daily');
    expect(l[3].md).toContain('**Доллар**');
    expect(l.some((x) => x.text.includes('думаю'))).toBe(false);
  });
});

describe('камера', () => {
  it('без области — страница 1280 по ширине экрана 390, по вертикали между стеклом; ближе — не больше 2×', () => {
    const s = 390 / 1280;
    const c = cameraAt(0, 400, 1280, 800, 390, 844, s, 107, 168);
    expect(c.x).toBe(0);
    expect(c.y).toBeGreaterThan(107);
    expect(c.y + 800 * s).toBeLessThan(844 - 168);
    expect(readScale(390, 1280)).toBeGreaterThanOrEqual(s);
  });
});

describe('снимок «пришли скрин» — под ответом', () => {
  const att = { kind: 'image', fileId: '', url: '/out/tok/cbr.jpg', name: 'cbr.jpg', mime: 'image/jpeg', size: 1, w: 1280, h: 800 };
  const st = [ev({ id: 'sh', tool: 'browser_screenshot', title: 'Делает снимок для вас', thumb: att, attachments: [att] } as never)];
  it('вложение /out/ рисуется один раз; если адрес уже в тексте — не рисуется', () => {
    expect(sharedShots({ steps: st, content: 'Вот снимок.' }).length).toBe(1);
    expect(sharedShots({ steps: st, content: 'Вот: ![](/out/tok/cbr.jpg)' }).length).toBe(0);
    expect(sharedShots({ steps: [ev({ id: 'x', attachments: [{ ...att, url: '/api/files/1' }] } as never)], content: '' }).length).toBe(0);
  });
  it('в разметке ответа — картинка с «Скачать»', () => {
    const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'low', levels: [{ id: 'low', label: 'low' }] }] as unknown as PublicModel[];
    const m = { id: 'm1', role: 'assistant', content: 'Вот снимок.', meta: { modelId: 'alpha', levelId: 'low' }, steps: st } as unknown as MsgView;
    const h = renderToStaticMarkup(createElement(AssistantMsg, { m, models }));
    expect(h).toContain('data-testid="shared-shots"');
    expect(h).toContain('/out/tok/cbr.jpg');
    expect(h).toContain('Скачать');
  });
});

describe('найденное значение в шапке', () => {
  it('строка таблицы ЦБ: код валюты и курс', () => {
    const a = { type: 'find' as const, label: 'Доллар США', cells: ['840', 'USD', '1', 'Доллар США', '80,5573'] };
    expect(foundValue(a)).toBe('USD — 80,5573');
    expect(actText(a)).toBe('USD — 80,5573');
  });
  it('без кода — найденный текст; без числа или без ячеек — обычная подпись', () => {
    expect(foundValue({ label: 'Ключевая ставка', cells: ['30.10.2026', '16,50'] })).toBe('Ключевая ставка — 16,50');
    expect(foundValue({ label: 'Евро', cells: ['Евро', 'нет данных'] })).toBe('');
    expect(actText({ type: 'find', label: 'Евро' })).toBe('Нашёл на странице «Евро»');
  });
});

describe('ширина панели показа (компьютер)', () => {
  it('360 px … 70 % окна, чат не уже 420', () => {
    expect(clampPanel(200, 1440, 264)).toBe(360);
    expect(clampPanel(2000, 1440, 264)).toBe(756);
    expect(clampPanel(2000, 2560, 264)).toBe(1792);
    expect(clampPanel(600, 1440, 264)).toBe(600);
  });
});
