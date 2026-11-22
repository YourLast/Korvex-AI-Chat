import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WorkFeed } from '@/components/WorkFeed';
import { briefOf, liveTitle, titleMarkdown, titlesIn } from '@/lib/thoughtTitles';
import { buildFeed, lastSentence } from '@/lib/work';
import { THINK_GATE } from '@/lib/thinkPref';
THINK_GATE.brief = true;

const RAW = 'Okay, the user wants the cost per person. Let me look at the sheets.\n[[t: Смотрю листы с цифрами]]\nThere are three sheets, revenue in B2:B40.\n'
  + '## Считаю себестоимость на одного человека\nSo 1 240 000 / 38...\n';

describe('заголовки размышления', () => {
  it('[[t: …]] и короткие ## — по порядку; незакрытая метка хвоста потока не берётся; длинный ## — не заголовок', () => {
    expect(titlesIn(RAW)).toEqual(['Смотрю листы с цифрами', 'Считаю себестоимость на одного человека']);
    expect(titlesIn('[[t: Сверяю с PDF')).toEqual([]);
    expect(titlesIn(`## ${'x'.repeat(100)}`)).toEqual([]);
    expect(titlesIn('текст [[t: не с начала строки]]')).toEqual([]);
  });
  it('полный вид: метка — жирной строкой, сама метка не видна; строка бара без скобок', () => {
    expect(titleMarkdown('мысль\n[[t: Сверяю с PDF]]\nдальше')).toBe('мысль\n\n**Сверяю с PDF**\n\nдальше');
    expect(titleMarkdown('мысль\n[[t: Свер')).toBe('мысль\n');
    expect(lastSentence('[[t: Сверяю с PDF]]')).not.toMatch(/\[\[|\]\]/);
  });
  it('краткий вид: заголовки и подписи шагов без кода; одинаковые подряд — одной строкой; живая — последняя', () => {
    const items = buildFeed(`${RAW}▸ python: расчёт по листам\n    итог 32 631\n▸ python: проверка\n`, [], true, false, 'ru');
    const lines = briefOf(items, true, 'ru');
    expect(lines.map((l) => l.text)).toEqual(['Смотрю листы с цифрами', 'Считаю себестоимость на одного человека']);
    expect(lines.at(-1)!.live).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/расчёт по листам|32 631|python/);
    expect(liveTitle(lines)).toBe('Считаю себестоимость на одного человека');
    const bare = briefOf(buildFeed('Thinking.\n▸ python: a\n▸ python: b\n[поиск: курс]\n[найдено: 3 источника]\n', [], false, true, 'ru'), false, 'ru');
    expect(bare.map((l) => l.text)).toEqual(['Считаю', 'Ищу в интернете']);
  });
  it('мысль без заголовков — «Обдумываю» только пока нечего сказать', () => {
    expect(briefOf(buildFeed('Hmm, let me think.', [], true, false, 'ru'), true, 'ru').map((l) => l.text)).toEqual(['Обдумываю']);
    expect(briefOf(buildFeed('Hmm.', [], false, true, 'ru'), false, 'ru')).toEqual([]);
  });
});

describe('лента в ответе — коротко по умолчанию', () => {
  it('идёт ход: в шапке — живой заголовок, сырого текста нет, «шаг N» нет', () => {
    const html = renderToStaticMarkup(createElement(WorkFeed, { m: { id: 'a', reasoning: RAW, streaming: true, rStartedAt: 1, startedAt: Date.now() } }));
    expect(html).toContain('Считаю себестоимость на одного человека');
    expect(html).not.toMatch(/Okay, the user|B2:B40|\[\[t:/);
  });
  it('ответ готов: «Думала 8 с», без числа шагов', () => {
    const html = renderToStaticMarkup(createElement(WorkFeed, { m: { id: 'b', reasoning: `${RAW}▸ python: расчёт\n`, streaming: false, content: 'Ответ', reasoningMs: 8000, meta: { durationMs: 8000 } } }));
    expect(html).toContain('Думала 8 с');
    expect(html).not.toMatch(/шаг|Okay, the user/);
  });
});

describe('формат A: «[[t: заголовок | пояснение]]»', () => {
  it('пояснение отдельно от заголовка; в кратком виде — строкой под ним, в полном — после тире', async () => {
    const { thoughtsIn } = await import('@/lib/thoughtTitles');
    expect(thoughtsIn('[[t: Сверяю выписку с 1С | ищу платежи без документа]]')).toEqual([{ title: 'Сверяю выписку с 1С', note: 'ищу платежи без документа' }]);
    expect(titleMarkdown('[[t: Сверяю | ищу платежи]]')).toBe('\n**Сверяю** — ищу платежи\n');
    const lines = briefOf(buildFeed('[[t: Сверяю выписку с 1С | ищу платежи без документа]]\nok\n', [], false, true, 'ru'), false, 'ru');
    expect(lines[0]).toMatchObject({ text: 'Сверяю выписку с 1С', note: 'ищу платежи без документа' });
  });
});

describe('номер в начале заголовка (A 22.11)', () => {
  it('«1. …» и «2) …» срезаются; «1С: …», «2026 год», «12.5% ставка» — нет', async () => {
    const { titlesIn } = await import('@/lib/thoughtTitles');
    expect(titlesIn('[[t: 1. Загружаю выписку банка]]\n[[t: 2) Сверяю с 1С]]')).toEqual(['Загружаю выписку банка', 'Сверяю с 1С']);
    expect(titlesIn('[[t: 1С: сверяю проводки]]\n[[t: 2026 год — ставка]]\n[[t: 12.5% ставка]]')).toEqual(['1С: сверяю проводки', '2026 год — ставка', '12.5% ставка']);
  });
});
