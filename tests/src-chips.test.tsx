// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';
import { SrcBar, SrcCtx, SrcList } from '@/components/SrcChip';
import { srcLinks } from '@/components/MarkdownBody';
import { _resetFileView, getFileView, setChatFiles } from '@/lib/fileView';
import { asSource, chipLabel, locLabel, parseLocator, parseMarker, quoteView, sourcesOf, stripMarkers, type Source } from '@/lib/srcmark';
import { tr, type Lang } from '@/lib/i18n/core';
import { summarize } from '@/lib/summary';
import { resolveFile } from '@/lib/fileView';

const FILES = [
  { id: 'f1', name: 'Акты/акт_017.pdf', size: 1 }, { id: 'f2', name: 'Выгрузка.xlsx', size: 1 },
  { id: 'f3', name: 'Положение_ред_2025.docx', size: 1 }, { id: 'f4', name: 'Положение_ред_2026.docx', size: 1 },
];
const M = (f: string, loc: string, q?: string) => `[[src:${f}|${loc}${q ? `|"${q}"` : ''}]]`;
const src = (o: Partial<Source> & Pick<Source, 'raw' | 'file' | 'kind'>): Source => ({ verified: true, ...o });

beforeEach(() => { _resetFileView(); setChatFiles(FILES); });
afterEach(() => { cleanup(); setChatFiles([]); });

const mount = (text: string, ctx: { sources: Source[] | null; live: boolean }) =>
  render(createElement(SrcCtx.Provider, { value: ctx }, createElement(Markdown, { text })));

describe('разбор маркера и локатора', () => {
  it('путь, локатор, цитата; нераспознанное — пусто', () => {
    expect(parseMarker('Акты/акт_017.pdf|стр. 1|"Сумма 12 400,00"')).toEqual({ file: 'Акты/акт_017.pdf', loc: 'стр. 1', quote: 'Сумма 12 400,00' });
    expect(parseMarker('a.txt|строка 40')).toEqual({ file: 'a.txt', loc: 'строка 40', quote: '' });
    expect(parseLocator('лист Реализация, стр. 1532')).toMatchObject({ kind: 'row', sheet: 'Реализация', row: 1532 });
    expect(parseLocator('лист Реализация, ячейка F1532')).toMatchObject({ kind: 'cell', sheet: 'Реализация', col: 'F', row: 1532 });
    expect(parseLocator('слайд 4')).toMatchObject({ kind: 'slide', slide: 4 });
    expect(parseLocator('строка 40')).toMatchObject({ kind: 'line', line: 40 });
    expect(parseLocator('стр. 7')).toMatchObject({ kind: 'page', page: 7 });
    expect(parseLocator('лист Реализация, строка 1532')).toMatchObject({ kind: 'row', sheet: 'Реализация', row: 1532 });
    expect(parseLocator('лист Реализация, строки 1532–1540')).toMatchObject({ kind: 'row', row: 1532, row_to: 1540 });
    expect(parseLocator('строки 40–52')).toMatchObject({ kind: 'line', line: 40, line_to: 52 });
    expect(parseLocator('стр. 7–9')).toMatchObject({ kind: 'page', page: 7, page_to: 9 });
    expect(parseLocator('вложение скан.pdf, стр. 2')).toMatchObject({ kind: 'page', page: 2, attachment: 'скан.pdf' });
    expect(parseLocator('page 3')).toMatchObject({ kind: 'page', page: 3 });
    expect(parseLocator('где-то там')).toBeNull();
  });
  it('подпись места на языке интерфейса', () => {
    const t = (k: string, p?: Record<string, string | number>) => ({ 'files.loc.row': `лист ${p?.sheet}, строка ${p?.n}`, 'files.loc.page': `стр. ${p?.n}`, 'files.loc.cell': `лист ${p?.sheet}, ячейка ${p?.cell}` } as Record<string, string>)[k];
    expect(locLabel({ kind: 'row', sheet: 'Р', row: 5 }, t as never)).toBe('лист Р, строка 5');
    expect(locLabel({ kind: 'cell', sheet: 'Р', row: 5, col: 'f' }, t as never)).toBe('лист Р, ячейка F5');
    expect(locLabel({ kind: 'page', page: 2 }, t as never)).toBe('стр. 2');
  });
  it('подпись чипа: у строк таблицы «строка N» / «строки a–b» (по-русски «стр.» читается как «страница»), у страниц «стр.», на ru/en/sr', () => {
    const lab = (lang: Lang, o: Parameters<typeof chipLabel>[0]) => chipLabel(o, ((k: string, p?: Record<string, string | number>) => tr(lang, k as never, p)) as never);
    expect(lab('ru', { kind: 'row', row: 1338 })).toBe('строка 1338');
    expect(lab('ru', { kind: 'row', row: 12, row_to: 14 })).toBe('строки 12–14');
    expect(lab('ru', { kind: 'line', line: 40 })).toBe('строка 40');
    expect(lab('ru', { kind: 'page', page: 3 })).toBe('стр. 3');
    expect(lab('ru', { kind: 'page', page: 7, page_to: 9 })).toBe('стр. 7–9');
    expect(lab('ru', { kind: 'cell', row: 40001, col: 'F' })).toBe('F40001');
    expect(lab('en', { kind: 'row', row: 1338 })).toBe('row 1338');
    expect(lab('en', { kind: 'row', row: 12, row_to: 14 })).toBe('rows 12–14');
    expect(lab('en', { kind: 'page', page: 3 })).toBe('p. 3');
    expect(lab('sr', { kind: 'row', row: 1338 })).toBe('red 1338');
    expect(lab('sr', { kind: 'row', row: 12, row_to: 14 })).toBe('redovi 12–14');
    expect(lab('sr', { kind: 'page', page: 3 })).toBe('str. 3');
  });
  it('имя в маркере без «|» и «]»: загрузка чистит имена так же, как конверт и сопоставление', async () => {
    const { cleanRelPath, markerName } = await import('@/lib/upload/paths');
    expect(cleanRelPath('Акты/Акт [1] | №5].pdf')).toEqual({ ok: true, path: 'Акты/Акт [1_ _ №5_.pdf' });
    expect(markerName('a|b]c')).toBe('a_b_c');
    expect(resolveFile([{ id: 'q', name: 'Акт|1].pdf', size: 1 }], { file: 'Акт_1_.pdf' })?.id).toBe('q');
  });
  it('файл чата по пути, по хвосту пути, по file_ref; неоднозначное имя не угадывается', () => {
    expect(resolveFile(FILES, { file: 'Акты/акт_017.pdf' })?.id).toBe('f1');
    expect(resolveFile(FILES, { file: 'акт_017.pdf' })?.id).toBe('f1');
    expect(resolveFile(FILES, { file: 'что-то', file_ref: 'f2' })?.id).toBe('f2');
    expect(resolveFile([...FILES, { id: 'f9', name: 'Другое/акт_017.pdf', size: 1 }], { file: 'акт_017.pdf' })).toBeNull();
    expect(resolveFile(FILES, { file: 'нет такого.pdf' })).toBeNull();
  });
});

describe('текст без маркеров', () => {
  it('копирование/уведомление: маркер -> «(файл, локатор)» или пусто; недописанный маркер убирается', () => {
    const t = `Сумма расходится ${M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400')}. Дата тоже ${M('a.xlsx', 'лист Р, стр. 5')}.`;
    expect(stripMarkers(t)).toBe('Сумма расходится (акт_017.pdf, стр. 1). Дата тоже (a.xlsx, лист Р, стр. 5).');
    expect(stripMarkers(t, 'drop')).toBe('Сумма расходится. Дата тоже.');
    expect(stripMarkers('конец [[src:a.pdf|стр')).toBe('конец ');
    expect(summarize(`Нашёл расхождение в акте ${M('a.pdf', 'стр. 1')}. Остальное в порядке.`)).not.toContain('[[src');
  });
  it('в коде маркеры не трогаем, вне кода — ссылки-метки', () => {
    const out = srcLinks(`до ${M('a.pdf', 'стр. 1')}\n\n\`\`\`\n${M('b.pdf', 'стр. 2')}\n\`\`\`\n\nи \`${M('c.pdf', 'стр. 3')}\``);
    expect(out.match(/#kxsrc/g)?.length).toBe(1);
    expect(srcLinks('конец [[src:a.pdf|ст')).toContain('pending');
  });
});

describe('чипы в ответе', () => {
  const text = `Сумма не сходится ${M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400')} и строка ${M('Выгрузка.xlsx', 'лист Реализация, стр. 1532')}.`;
  it('пока идёт ответ и списка нет — серые чипы без ссылки', () => {
    const { container } = mount(text, { sources: null, live: true });
    const chips = [...container.querySelectorAll<HTMLElement>('[data-testid=src-chip]')];
    expect(chips.map((c) => c.dataset.state)).toEqual(['wait', 'wait']);
    expect(chips[0].tagName).not.toBe('BUTTON');
    expect(chips[0].textContent).toContain('акт_017');
    expect(chips[0].textContent).toContain('стр. 1');
  });
  it('ответ закончился, списка нет (флаг серва выключен) — простой текст', () => {
    const { container } = mount(text, { sources: null, live: false });
    expect(container.querySelectorAll('[data-testid=src-chip]').length).toBe(0);
    expect(container.textContent).toContain('(акт_017.pdf, стр. 1)');
    expect(container.textContent).not.toContain('[[src');
  });
  it('проверенный маркер — чип-кнопка; непроверенный — простой текст без ссылки', () => {
    const sources = [
      src({ raw: M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400'), file: 'Акты/акт_017.pdf', kind: 'page', page: 1, quote: 'Итого 12 400' }),
      src({ raw: M('Выгрузка.xlsx', 'лист Реализация, стр. 1532'), file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 1532, verified: false }),
    ];
    const { container } = mount(text, { sources, live: false });
    const chips = container.querySelectorAll<HTMLButtonElement>('button[data-testid=src-chip]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe('стр. 1');
    expect(chips[0].title).toContain('акт_017.pdf');
    expect(chips[0].getAttribute('aria-label')).toContain('акт_017.pdf');
    expect(container.querySelector('[data-testid=src-plain][data-verified=false]')?.textContent).toBe('(Выгрузка.xlsx, лист Реализация, строка 1532)')
  });
  it('нажатие открывает файл на месте со всеми отметками ответа в этом файле', () => {
    const sources = [
      src({ raw: M('Выгрузка.xlsx', 'лист Реализация, стр. 1532'), file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 1532 }),
      src({ raw: M('Выгрузка.xlsx', 'лист Реализация, ячейка F40001'), file: 'Выгрузка.xlsx', kind: 'cell', sheet: 'Реализация', col: 'F', row: 40001 }),
      src({ raw: M('Акты/акт_017.pdf', 'стр. 1'), file: 'Акты/акт_017.pdf', kind: 'page', page: 1 }),
    ];
    const { container } = mount(`Ошибки: ${M('Выгрузка.xlsx', 'лист Реализация, стр. 1532')} и ${M('Выгрузка.xlsx', 'лист Реализация, ячейка F40001')} и ${M('Акты/акт_017.pdf', 'стр. 1')}.`, { sources, live: false });
    const chips = container.querySelectorAll<HTMLButtonElement>('button[data-testid=src-chip]');
    expect(chips.length).toBe(3);
    act(() => { fireEvent.click(chips[0]); });
    const v = getFileView();
    expect(v.target).toMatchObject({ id: 'f2', name: 'Выгрузка.xlsx', at: { kind: 'row', sheet: 'Реализация', row: 1532 } });
    expect(v.target!.marks!.map((m) => [m.kind, m.row])).toEqual([['row', 1532], ['cell', 40001]]);
    act(() => { fireEvent.click(chips[2]); });
    expect(getFileView().target).toMatchObject({ id: 'f1', at: { kind: 'page', page: 1 } });
  });
  it('файла нет в чате — не ссылка, а текст', () => {
    const sources = [src({ raw: M('Чужой.pdf', 'стр. 2'), file: 'Чужой.pdf', kind: 'page', page: 2 })];
    const { container } = mount(`Вот ${M('Чужой.pdf', 'стр. 2')}`, { sources, live: false });
    expect(container.querySelectorAll('button[data-testid=src-chip]').length).toBe(0);
    expect(container.textContent).toContain('(Чужой.pdf, стр. 2)');
  });
});

describe('компактные чипы и группы', () => {
  const sources = [
    src({ raw: M('Выгрузка.xlsx', 'лист Реализация, строка 1532'), file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 1532 }),
    src({ raw: M('Выгрузка.xlsx', 'лист Реализация, строки 20000–20002'), file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 20000, row_to: 20002 }),
    src({ raw: M('Выгрузка.xlsx', 'лист Реализация, ячейка F40001'), file: 'Выгрузка.xlsx', kind: 'cell', sheet: 'Реализация', col: 'F', row: 40001 }),
    src({ raw: M('Акты/акт_017.pdf', 'стр. 1'), file: 'Акты/акт_017.pdf', kind: 'page', page: 1 }),
  ];
  const text = `Расхождения ${M('Выгрузка.xlsx', 'лист Реализация, строка 1532')}, ${M('Выгрузка.xlsx', 'лист Реализация, строки 20000–20002')} и ${M('Выгрузка.xlsx', 'лист Реализация, ячейка F40001')}; по актам ${M('Акты/акт_017.pdf', 'стр. 1')}.`;
  it('подряд идущие ссылки на один файл — одна группа; места компактно: «строка 1532», «строки 20000–20002», «F40001»; имя — коротко, если файлов несколько', () => {
    const { container } = mount(text, { sources, live: false });
    const groups = [...container.querySelectorAll<HTMLElement>('[data-testid=src-group]')];
    expect(groups.map((g) => g.dataset.n)).toEqual(['3', '1']);
    expect(groups[0].textContent).toBe('Выгрузкастрока 1532строки 20000–20002F40001');
    expect([...groups[0].querySelectorAll('button')].map((b) => b.querySelector('.src-l')!.textContent)).toEqual(['строка 1532', 'строки 20000–20002', 'F40001']);
    expect(groups[1].textContent).toBe('акт_017стр. 1');
    expect(container.textContent).not.toContain('[[src');
  });
  it('в ответе один файл — имя только в подсказке, на чипах одни места', () => {
    const one = sources.slice(0, 3);
    const { container } = mount(text.replace(/; по актам.*$/, '.'), { sources: one, live: false });
    expect(container.querySelectorAll('.src-n').length).toBe(0);
    expect([...container.querySelectorAll('button[data-testid=src-chip]')].map((b) => b.textContent)).toEqual(['строка 1532', 'строки 20000–20002', 'F40001']);
  });
  it('разные файлы подряд — две группы, а не одна', () => {
    const { container } = mount(`${M('Выгрузка.xlsx', 'лист Реализация, строка 1532')} и ${M('Акты/акт_017.pdf', 'стр. 1')}`, { sources, live: false });
    expect(container.querySelectorAll('[data-testid=src-group]').length).toBe(2);
  });
  it('наведение: превью строки таблицы с шапкой (красная — названная ячейка); нажатие по-прежнему открывает файл', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = vi.fn(async (u: string) => {
      if (u.includes('/view')) return new Response(JSON.stringify({ state: 'ready', kind: 'grid', meta: { v: 2, sheets: [{ name: 'Реализация', rows: 40001, cols: 3, header: 1, chunks: 81, truncated: false }] } }));
      return new Response(JSON.stringify({ rows: { '1': ['Дата', 'Документ', 'Сумма'], '1532': ['16.10.2026', 'РТУ-0001531', '184 560,40'] } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = mount(`Ошибка ${M('Выгрузка.xlsx', 'лист Реализация, ячейка C1532')}.`, { sources: [src({ raw: M('Выгрузка.xlsx', 'лист Реализация, ячейка C1532'), file: 'Выгрузка.xlsx', kind: 'cell', sheet: 'Реализация', col: 'C', row: 1532 })], live: false });
    const btn = container.querySelector<HTMLButtonElement>('button[data-testid=src-chip]')!;
    expect(btn.textContent).toBe('C1532');
    await act(async () => { fireEvent.pointerEnter(btn, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    await waitFor(() => expect(document.querySelector('[data-testid=peek-row]')).toBeTruthy());
    const rows = [...document.querySelectorAll('[data-testid=peek-row] > div')];
    expect(rows.map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent])).toEqual([['Дата', '16.10.2026'], ['Документ', 'РТУ-0001531'], ['Сумма', '184 560,40']]);
    expect(rows[2].className).toContain('is-hit');
    expect(getFileView().target).toBeNull();
    act(() => { fireEvent.click(btn); });
    expect(getFileView().target).toMatchObject({ id: 'f2', at: { kind: 'cell', row: 1532 } });
    vi.unstubAllGlobals();
  });
  it('превью от серва (ред. 2): row_values — запасной путь, если строку из файла прочитать не удалось; snippet страницы берётся из ответа', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = mount(`Ошибка ${M('Выгрузка.xlsx', 'лист Реализация, строка 7')}; ${M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400')}.`, { sources: [
      src({ raw: M('Выгрузка.xlsx', 'лист Реализация, строка 7'), file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 7, row_values: { header: ['Дата', 'Сумма'], values: ['16.10.2026', '1 200'] } }),
      src({ raw: M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400'), file: 'Акты/акт_017.pdf', kind: 'page', page: 1, quote: 'Итого 12 400', snippet: '…по договору поставки. Итого 12 400 руб., включая НДС…' }),
    ], live: false });
    const [row, page] = [...container.querySelectorAll<HTMLButtonElement>('button[data-testid=src-chip]')];
    await act(async () => { fireEvent.pointerEnter(row, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    await waitFor(() => expect([...document.querySelectorAll('[data-testid=peek-row] > div')].map((r) => r.textContent)).toEqual(['Дата16.10.2026', 'Сумма1 200']));
    expect(fetchMock).toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => { fireEvent.pointerLeave(row, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(400); fireEvent.pointerEnter(page, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    expect(document.querySelector('[data-testid=peek-quote]')?.textContent).toBe('…по договору поставки. Итого 12 400 руб., включая НДС…');
    vi.unstubAllGlobals();
  });
  it('превью страницы — цитата', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = mount(`Вот ${M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400')}.`, { sources: [src({ raw: M('Акты/акт_017.pdf', 'стр. 1', 'Итого 12 400'), file: 'Акты/акт_017.pdf', kind: 'page', page: 1, quote: 'Итого 12 400' })], live: false });
    await act(async () => { fireEvent.pointerEnter(container.querySelector('button[data-testid=src-chip]')!, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    expect(document.querySelector('[data-testid=peek-quote]')?.textContent).toBe('Итого 12 400');
  });
});

describe('блок «Источники» под ответом', () => {
  it('по файлам: места с цитатой или значениями строки, всё кликается; два файла — «Сравнить»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/view')
      ? new Response(JSON.stringify({ state: 'ready', kind: 'grid', meta: { v: 2, sheets: [{ name: 'Лист1', rows: 9000, cols: 2, header: 1, chunks: 18, truncated: false }] } }))
      : new Response(JSON.stringify({ rows: { '1': ['Дата', 'Сумма'], '1532': ['16.10.2026', '184 560,40'] } })))));
    const s = [
      src({ raw: 'a', file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Лист1', row: 1532 }),
      src({ raw: 'b', file: 'Акты/акт_017.pdf', kind: 'page', page: 1, quote: 'Итого 12 400' }),
      src({ raw: 'c', file: 'Положение_ред_2025.docx', kind: 'page', page: 3 }),
      src({ raw: 'd', file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Лист1', row: 5, verified: false }),
    ];
    const { container } = render(createElement(SrcList, { sources: s, live: false }));
    expect(container.querySelector('[data-testid=src-list]')!.textContent).toContain('3 файла · 3 места');
    expect(container.querySelectorAll('[data-testid=src-file]').length).toBe(3);
    await waitFor(() => expect(container.textContent).toContain('16.10.2026 · 184 560,40'));
    expect(container.textContent).toContain('«Итого 12 400»');
    act(() => { fireEvent.click(container.querySelectorAll<HTMLElement>('[data-testid=src-item]')[0]); });
    expect(getFileView().target).toMatchObject({ id: 'f2', at: { kind: 'row', row: 1532 } });
    act(() => { fireEvent.click(container.querySelector('[data-testid=src-compare]')!); });
    expect(getFileView().compare).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid=src-list-toggle]')!);
    expect(container.querySelectorAll('[data-testid=src-file]').length).toBe(0);
    expect(render(createElement(SrcList, { sources: s, live: true })).container.querySelector('[data-testid=src-list]')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('много мест — блок свёрнут сам, у файла первые 8 и «Ещё N»', () => {
    const many = Array.from({ length: 20 }, (_, i) => src({ raw: `r${i}`, file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Лист1', row: 100 + i }));
    const { container } = render(createElement(SrcList, { sources: many, live: false }));
    expect(container.querySelector('[data-testid=src-list-toggle]')!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(container.querySelector('[data-testid=src-list-toggle]')!);
    expect(container.querySelectorAll('[data-testid=src-item]').length).toBe(8);
    fireEvent.click(container.querySelector('.srcl-more')!);
    expect(container.querySelectorAll('[data-testid=src-item]').length).toBe(20);
  });
});

describe('«Сравнить» у ответа с двумя файлами', () => {
  it('две редакции в ответе -> кнопка открывает сравнение с отметками; один файл — кнопки нет', () => {
    const s = [
      src({ raw: 'a', file: 'Положение_ред_2025.docx', kind: 'page', page: 3, quote: 'неустойка 0,1%' }),
      src({ raw: 'b', file: 'Положение_ред_2026.docx', kind: 'page', page: 3, quote: 'неустойка 0,5%' }),
    ];
    const { container, unmount } = render(createElement(SrcBar, { sources: s }));
    const btn = container.querySelector<HTMLButtonElement>('[data-testid=src-compare]')!;
    expect(btn).toBeTruthy();
    act(() => { fireEvent.click(btn); });
    const c = getFileView().compare!;
    expect([c.a.id, c.b.id]).toEqual(['f3', 'f4']);
    expect(c.a.marks![0].quote).toBe('неустойка 0,1%');
    unmount();
    const one = render(createElement(SrcBar, { sources: [s[0]] }));
    expect(one.container.querySelector('[data-testid=src-compare]')).toBeNull();
  });
});

describe('цитата для показа', () => {
  it('quoteView снимает жирный модели', () => {
    expect(quoteView('расторгнут **и до истечения срока предупреждения** об увольнении')).toBe('расторгнут и до истечения срока предупреждения об увольнении');
    expect(quoteView('**и до истечения срока…')).toBe('и до истечения срока…');
    expect(quoteView('раздел *** раздел')).toBe('раздел *** раздел');
    expect(quoteView('цена* (без НДС)')).toBe('цена* (без НДС)');
  });
  it('карточка чипа и блок «Источники» — без звёздочек', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const q = 'может быть расторгнут **и до истечения срока предупреждения** об увольнении';
    const s = src({ raw: M('Акты/акт_017.pdf', 'стр. 76', q), file: 'Акты/акт_017.pdf', kind: 'page', page: 76, quote: q });
    const { container } = mount(`Вот ${M('Акты/акт_017.pdf', 'стр. 76', q)}.`, { sources: [s], live: false });
    await act(async () => { fireEvent.pointerEnter(container.querySelector('button[data-testid=src-chip]')!, { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    expect(document.querySelector('[data-testid=peek-quote]')?.textContent).toBe('может быть расторгнут и до истечения срока предупреждения об увольнении');
    cleanup();
    const list = render(createElement(SrcList, { sources: [s], live: false }));
    expect(list.container.querySelector('.srcl-x')?.textContent).toBe('«может быть расторгнут и до истечения срока предупреждения об увольнении»');
  });
});
