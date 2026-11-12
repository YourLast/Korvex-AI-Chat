import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CheckCard, leftText, StepRow } from '@/components/WorkFeed';
import { buildFeed, pendingCheck, statusText, allSteps } from '@/lib/work';
import type { StepEvent } from '@/lib/tools/types';

const ev = (o: Partial<StepEvent> & { id: string }): StepEvent => ({ kind: 'browser', tool: 'browser_open', title: 'Открывает shop.example/item', status: 'run', at: { r: 0, c: 0 }, round: 0, t0: 1, ...o } as StepEvent);
const wait = (open = false) => ev({ id: 'c1', status: 'wait_user', live: { kind: 'browser', session: 't' }, ask: { text: 'Сайт просит пройти проверку', allow: 'Готово', deny: 'Пропустить' }, check: { host: 'shop.example', until: Date.now() + 52_000, open } });

describe('карточка проверки', () => {
  it('шаг ждёт проверку: карточка, сайт и «жду N с», «Пропустить» и «Пройти»; строка — не вопрос', () => {
    const s = allSteps(buildFeed('', [wait()], true, false))[0];
    expect(s.check).toMatchObject({ host: 'shop.example', open: false });
    expect(s.title).toBe('Открывает shop.example/item');
    const html = renderToStaticMarkup(createElement(StepRow, { s, onLive: () => {}, onDecide: () => {} }));
    expect(html).toContain('data-testid="check-card"');
    expect(html).toContain('Сайт просит пройти проверку');
    expect(html).toMatch(/shop\.example<\/span> · <span class="tnum">жду 5[12] с/);
    expect(html).toContain('data-testid="check-pass"');
    expect(html).toContain('data-testid="check-skip"');
    expect(html).not.toContain('data-testid="work-ask"');
  });
  it('после «Пройти»: «Готово» и «Открыть браузер»', () => {
    const s = allSteps(buildFeed('', [wait(true)], true, false))[0];
    const html = renderToStaticMarkup(createElement(CheckCard, { s, onLive: () => {}, onDecide: () => {} }));
    expect(html).toContain('data-open=""');
    expect(html).toContain('data-testid="check-done"');
    expect(html).toContain('data-testid="check-reopen"');
    expect(html).not.toContain('data-testid="check-pass"');
  });
  it('шаг закончился — карточки нет; «Проверка … не пройдена» — без слова «ошибка»', () => {
    const s = allSteps(buildFeed('', [ev({ id: 'c1', status: 'err', title: 'Проверка на shop.example не пройдена' })], false, true))[0];
    expect(s.check).toBeUndefined();
    expect(statusText(s)).toBe('');
    expect(renderToStaticMarkup(createElement(StepRow, { s }))).not.toContain('check-card');
  });
  it('pendingCheck — последнее состояние шага; leftText — «52 с», «60 с», «4:59»', () => {
    expect(pendingCheck([wait(), { ...wait(), status: 'run', check: undefined }])).toBeNull();
    expect(pendingCheck([ev({ id: 'x' }), wait()])?.id).toBe('c1');
    expect(leftText(52_000, 'ru')).toBe('52 с');
    expect(leftText(60_300, 'ru')).toBe('60 с');
    expect(leftText(299_000, 'ru')).toBe('4:59');
    expect(leftText(-5, 'en')).toBe('0 s');
  });
});
