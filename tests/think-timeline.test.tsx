import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WorkFeed } from '@/components/WorkFeed';
import { buildFeed } from '@/lib/work';
import { timelineOf } from '@/lib/thoughtTimeline';
import { turnUrls } from '@/lib/webmark';
import { THINK_GATE } from '@/lib/thinkPref';
THINK_GATE.brief = true;

const R = [
  '[[t: Смотрю, что за документы в пачке | шапки файлов: выписка, выгрузка 1С, сканы]]', 'The user uploaded 46 files.',
  '▸ python: разбор шапок', '    46 файлов, 3 ИНН',
  '[[t: Проверяю ставку по открытым данным | ищу официальный источник]]',
  '[поиск: ключевая ставка ЦБ ноябрь 2026]', '[найдено: 3 источника]',
  '    https://www.cbr.ru/hd_base/KeyRate/ — Ключевая ставка', '    https://www.nalog.gov.ru/rn77/news/ — Новости',
  '[[t: Считаю пени за просрочку | 1/300 ставки за каждый день]]',
  '▸ python: import math; print(x)', '    итого пени: 373,20 ₽',
].join('\n');

describe('таймлайн', () => {
  it('строки по порядку: заголовки с пояснениями, поиск с доменами и ссылками, расчёт с выводом; «Готово» в конце', () => {
    const rows = timelineOf(buildFeed(R, [], false, true, 'ru'), false, 'ru', turnUrls([R]));
    expect(rows.map((r) => r.kind)).toEqual(['title', 'calc', 'title', 'search', 'title', 'calc', 'done']);
    expect(rows[0].note).toBe('шапки файлов: выписка, выгрузка 1С, сканы');
    expect(rows[1]).toMatchObject({ text: 'Посчитала', note: 'разбор шапок', calc: ['46 файлов, 3 ИНН'] });
    expect(rows[3]).toMatchObject({ text: 'Нашла 3 источника', hosts: ['cbr.ru', 'nalog.gov.ru'] });
    expect(rows[3].links).toHaveLength(2);
    expect(rows[5].note).toBeUndefined();
    expect(rows.at(-1)!.text).toBe('Готово');
  });
  it('идёт ход: последняя строка — «сейчас», «Готово» нет', () => {
    const rows = timelineOf(buildFeed(R, [], true, false, 'ru'), true, 'ru');
    expect(rows.at(-1)!.live).toBe(true);
    expect(rows.some((r) => r.kind === 'done')).toBe(false);
  });
  it('в ответе: «Думала N с», таймлайн без сырого текста и кода', () => {
    const html = renderToStaticMarkup(createElement(WorkFeed, { m: { id: 'x', reasoning: R, streaming: false, content: 'Ответ', reasoningMs: 61000, meta: { durationMs: 61000 } } }));
    expect(html).toContain('Думала 1 мин 1 с');
    for (const s of ['Нашла 3 источника', 'cbr.ru · nalog.gov.ru', 'Как считала', 'Готово', 'ищу официальный источник']) expect(html).toContain(s);
    expect(html).not.toMatch(/The user uploaded|import math|\[\[t:/);
  });
});
