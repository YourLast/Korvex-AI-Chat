// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { GridView } from '@/components/fileview/GridView';
import { TextView } from '@/components/fileview/TextView';
import { CompareView } from '@/components/fileview/CompareView';
import { PdfView } from '@/components/fileview/PdfView';
import { _resetPdfDocs } from '@/components/fileview/pdfDocs';
import FileViewer, { _resetInfoCache } from '@/components/FileViewer';
import { FolderCard } from '@/components/FolderCard';
import { UserTurn, FileCard } from '@/components/Message';
import { _resetFileView, closeFile, openCompare, openFile, setChatFiles } from '@/lib/fileView';
import { groupByFolder } from '@/lib/upload/paths';
import type { GridMeta } from '@/lib/gridview';
import type { FileChip, MsgView } from '@/lib/types';

const pdf = vi.hoisted(() => ({ status: 200, pending: 0, numPages: 3, rendered: [] as number[], items: [] as { str: string; transform: number[]; width: number; height: number }[] }));
vi.mock('@/components/fileview/pdfjs', async (orig) => {
  const o = await orig<typeof import('@/components/fileview/pdfjs')>();
  const lib = {
    Util: { transform: (a: number[], b: number[]) => [a[0] * b[0], 0, 0, a[3] * b[3], b[4] * a[0], a[5] + b[5] * a[3]] },
    getDocument: () => ({
      destroy: async () => {},
      promise: Promise.resolve({
        numPages: pdf.numPages,
        getPage: async (n: number) => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }),
          render: () => { pdf.rendered.push(n); return { promise: Promise.resolve(), cancel() {} }; },
          getTextContent: async () => ({ items: n === 2 ? pdf.items : [] }),
        }),
      }),
    }),
  };
  return { ...o, loadPdfjs: async () => lib as never };
});

const CLIENT_H = 560;
beforeEach(() => {
  _resetFileView(); _resetPdfDocs(); _resetInfoCache();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return /xl-scroll|fv-tscroll|fv-pages|fv-cmp-rows/.test(this.className) ? CLIENT_H : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? 640 : 0; } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= function () {};
  const raf = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
  window.requestAnimationFrame = raf; globalThis.requestAnimationFrame = raf;
  pdf.status = 200; pdf.pending = 0; pdf.numPages = 3; pdf.rendered = []; pdf.items = [];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); closeFile(); });

const ROWS = 40001;
const META: GridMeta = { v: 2, sheets: [{ name: 'Реализация', rows: ROWS, cols: 4, header: 1, chunks: 81, truncated: false }, { name: 'Итоги', rows: 5, cols: 2, header: 1, chunks: 1, truncated: false }] };
const cellsOf = (r: number) => (r === 1 ? ['Дата', 'Документ', 'Сумма', 'Ставка'] : [String(46000 + r), `РТУ-${String(r - 1).padStart(7, '0')}`, `${(r * 10).toLocaleString('ru-RU')}`, '20%']);
function gridFetch(log: string[]) {
  return vi.fn(async (url: string) => {
    log.push(url);
    const u = new URL(url, 'http://x');
    const sheet = Number(u.searchParams.get('sheet') ?? 0);
    if (u.searchParams.has('rows')) {
      const rows: Record<number, string[]> = {};
      for (const r of (u.searchParams.get('rows') ?? '').split(',').map(Number)) rows[r] = cellsOf(r);
      return new Response(JSON.stringify({ sheet, rows }));
    }
    const a = Number(u.searchParams.get('from')), b = Math.min(META.sheets[sheet].rows, Number(u.searchParams.get('to')));
    return new Response(JSON.stringify({ sheet, from: a, rows: Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => cellsOf(a + i)) }));
  });
}
const rowsShown = () => [...document.querySelectorAll<HTMLElement>('[data-testid=grid-row]')].map((r) => Number(r.dataset.row));

describe('таблица', () => {
  it('40 тысяч строк: в DOM только окно; шапка закреплена; номера строк как в Excel; запросы блоками, а не всем файлом', async () => {
    const log: string[] = [];
    vi.stubGlobal('fetch', gridFetch(log));
    render(createElement(GridView, { id: 'f1', meta: META, marks: [] }));
    await waitFor(() => expect(rowsShown().length).toBeGreaterThan(5));
    expect(rowsShown().length).toBeLessThan(60);
    expect(rowsShown()[0]).toBe(2);
    expect(screen.getByTestId('grid-header').textContent).toContain('Дата');
    expect(log.every((u) => /from=\d+&to=\d+/.test(u))).toBe(true);
    expect(log.length).toBeLessThan(6);
    expect(document.querySelector('[data-testid=grid-scroll] .xl-inner')!.getAttribute('style')).toMatch(/height: \d{6,}px/);
  });
  it('строки и ячейки из ответа — красные; переход к строке из чипа; следующая/предыдущая отметка', async () => {
    vi.stubGlobal('fetch', gridFetch([]));
    const marks = [{ kind: 'row' as const, sheet: 'Реализация', row: 3 }, { kind: 'cell' as const, sheet: 'Реализация', row: 5, col: 'C' }, { kind: 'row' as const, sheet: 'Реализация', row: 40001 }];
    render(createElement(GridView, { id: 'f1', meta: META, at: marks[0], marks }));
    await waitFor(() => expect(document.querySelectorAll('[data-testid=grid-row][data-mark]').length).toBe(2));
    const red = [...document.querySelectorAll<HTMLElement>('[data-mark]')].map((r) => r.dataset.row);
    expect(red).toEqual(['3', '5']);
    expect(document.querySelectorAll('.xl-c.is-cell').length).toBe(1);
    expect(document.querySelector('.xl-row.is-cur')?.getAttribute('data-row')).toBe('3');
    expect(screen.getByTestId('mark-count').textContent).toBe('1 из 3');
    fireEvent.click(screen.getByTestId('mark-next'));
    expect(document.querySelector('.xl-row.is-cur')?.getAttribute('data-row')).toBe('5');
    expect(screen.getByTestId('mark-count').textContent).toBe('2 из 3');
    expect(screen.getByTestId('name-box').textContent).toBe('C5');
    fireEvent.click(screen.getByTestId('mark-prev'));
    fireEvent.click(screen.getByTestId('mark-prev'));
    await waitFor(() => expect(screen.getByTestId('mark-count').textContent).toBe('3 из 3'));
  });
  it('«только отмеченные»: в списке одни красные строки, данные запрашиваются списком номеров', async () => {
    const log: string[] = [];
    vi.stubGlobal('fetch', gridFetch(log));
    const marks = [{ kind: 'row' as const, sheet: 'Реализация', row: 1532 }, { kind: 'row' as const, sheet: 'Реализация', row: 40001 }, { kind: 'row' as const, sheet: 'Реализация', row: 7 }];
    render(createElement(GridView, { id: 'f1', meta: META, marks }));
    fireEvent.click(screen.getByTestId('only-marked'));
    await waitFor(() => expect(rowsShown()).toEqual([7, 1532, 40001]));
    expect(log.some((u) => u.includes('rows=7,1532,40001'))).toBe(true);
    expect(document.querySelectorAll('[data-testid=grid-row][data-mark]').length).toBe(3);
    fireEvent.click(screen.getByTestId('only-marked'));
    await waitFor(() => expect(rowsShown().length).toBeGreaterThan(5));
  });
  it('красная шапка: ссылка на ячейку шапки (строка 1) подсвечивает закреплённую шапку', async () => {
    vi.stubGlobal('fetch', gridFetch([]));
    render(createElement(GridView, { id: 'f1', meta: META, at: { kind: 'cell', sheet: 'Реализация', row: 1, col: 'C' }, marks: [{ kind: 'cell', sheet: 'Реализация', row: 1, col: 'C' }] }));
    await waitFor(() => expect(screen.getByTestId('grid-header').querySelector('.xl-row')!.className).toContain('is-mark'));
  });
  it('диапазон строк из ссылки («строки 10–12») — все три красные', async () => {
    vi.stubGlobal('fetch', gridFetch([]));
    render(createElement(GridView, { id: 'f1', meta: META, at: { kind: 'row', sheet: 'Реализация', row: 10, row_to: 12 }, marks: [{ kind: 'row', sheet: 'Реализация', row: 10, row_to: 12 }] }));
    await waitFor(() => expect(document.querySelectorAll('[data-testid=grid-row][data-mark]').length).toBe(3));
    expect([...document.querySelectorAll<HTMLElement>('[data-mark]')].map((r) => r.dataset.row)).toEqual(['10', '11', '12']);
  });
  it('листы вкладками, точка у листа с отметками; название листа из ссылки нестрогое; чужой лист — без красных', async () => {
    vi.stubGlobal('fetch', gridFetch([]));
    render(createElement(GridView, { id: 'f1', meta: META, marks: [{ kind: 'row', sheet: 'Итоги', row: 2 }] }));
    const tabs = screen.getAllByTestId('sheet-tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Реализация', 'Итоги']);
    expect(tabs[1].querySelector('.fv-dot')).toBeTruthy();
    expect(tabs[0].querySelector('.fv-dot')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('grid-view').dataset.sheet).toBe('Итоги'));
    expect(document.querySelector('[data-testid=grid-row][data-row="2"]')?.hasAttribute('data-mark')).toBe(true);
    fireEvent.click(tabs[0]);
    await waitFor(() => expect(screen.getByTestId('grid-view').dataset.sheet).toBe('Реализация'));
  });
});

describe('текст и Markdown', () => {
  const lines = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `строка ${a + i}`);
  function textFetch() {
    return vi.fn(async (url: string) => {
      const u = new URL(url, 'http://x');
      const a = Number(u.searchParams.get('from')), b = Math.min(100000, Number(u.searchParams.get('to')));
      return new Response(JSON.stringify({ from: a, total: 100000, lines: lines(a, b) }));
    });
  }
  it('100 тысяч строк: окно строк с номерами; строка из ссылки подсвечена', async () => {
    vi.stubGlobal('fetch', textFetch());
    render(createElement(TextView, { id: 't1', total: 100000, md: false, binary: false, truncated: false, at: { kind: 'line', line: 40 }, marks: [{ kind: 'line', line: 40 }] }));
    await waitFor(() => expect(document.querySelectorAll('[data-testid=text-line]').length).toBeGreaterThan(10));
    expect(document.querySelectorAll('[data-testid=text-line]').length).toBeLessThan(80);
    await waitFor(() => expect(document.querySelector('[data-line="40"] .fv-lt')?.textContent).toBe('строка 40'));
    expect(document.querySelector('[data-line="40"]')?.hasAttribute('data-mark')).toBe(true);
    expect(document.querySelector('[data-line="41"]')?.hasAttribute('data-mark')).toBe(false);
  });
  it('текст, который видит модель (письмо, веб-страница): с пометкой, что строки считаются по нему', async () => {
    vi.stubGlobal('fetch', textFetch());
    render(createElement(TextView, { id: 'e1', total: 50, md: false, extracted: true, binary: false, truncated: false, at: { kind: 'line', line: 11 }, marks: [{ kind: 'line', line: 11 }] }));
    expect(screen.getByTestId('text-extracted').textContent).toContain('текст, который видит модель');
    await waitFor(() => expect(document.querySelector('[data-line="11"]')?.hasAttribute('data-mark')).toBe(true));
  });
  it('двоичный файл — «не текст»; Markdown — отрендеренный, переключатель на исходник', async () => {
    const { unmount } = render(createElement(TextView, { id: 't2', total: 0, md: false, binary: true, truncated: false, marks: [] }));
    expect(screen.getByTestId('text-binary')).toBeTruthy();
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ total: 3, lines: ['# Заголовок', '', 'Абзац **жирный**.'] }))));
    render(createElement(TextView, { id: 't3', total: 3, md: true, binary: false, truncated: false, marks: [] }));
    await waitFor(() => expect(document.querySelector('.fv-md h1')?.textContent).toBe('Заголовок'));
    fireEvent.click(screen.getByTestId('md-source'));
    await waitFor(() => expect(document.querySelectorAll('[data-testid=text-line]').length).toBe(3));
  });
});

describe('PDF', () => {
  const route = (opts: { pending?: number; status?: number } = {}) => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes('/pdf')) return new Response('{}');
      if (n++ < (opts.pending ?? 0)) { await new Promise((r) => setTimeout(r, 250)); return new Response(JSON.stringify({ state: 'pending' }), { status: 202 }); }
      if ((opts.status ?? 200) !== 200) return new Response(JSON.stringify({ state: 'error', code: 'convert' }), { status: opts.status });
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }));
  };
  it('страницы по числу страниц документа; переход на нужную; номер страницы в панели', async () => {
    route();
    pdf.numPages = 12;
    render(createElement(PdfView, { id: 'p1', name: 'акт.pdf', at: { kind: 'page', page: 7 }, marks: [{ kind: 'page', page: 7 }, { kind: 'page', page: 9 }] }));
    await waitFor(() => expect(document.querySelector('[data-testid=pdf-page][data-page="7"]')).toBeTruthy());
    expect(screen.getAllByTestId('pdf-page').length).toBeLessThan(12);
    expect(screen.getByTestId('pdf-view').querySelector('.fv-pg span')?.textContent).toBe('/ 12');
    expect(screen.getByTestId('pdf-page-input')).toBeTruthy();
    const marks = screen.getByTestId('pdf-marks');
    expect(marks.textContent).toContain('стр. 7');
    expect(marks.textContent).toContain('стр. 9');
    await waitFor(() => expect((screen.getByTestId('pdf-scroll') as HTMLElement).scrollTop).toBeGreaterThan(0));
    await waitFor(() => expect(pdf.rendered.length).toBeGreaterThan(0));
  });
  it('цитата на странице подсвечивается прямоугольником над найденным текстом', async () => {
    route();
    pdf.items = [
      { str: 'Итого к оплате', transform: [10, 0, 0, 10, 50, 100], width: 80, height: 10 },
      { str: 'сумма 12 400,00 руб.', transform: [10, 0, 0, 10, 50, 120], width: 110, height: 10 },
      { str: 'подпись', transform: [10, 0, 0, 10, 50, 300], width: 40, height: 10 },
    ];
    render(createElement(PdfView, { id: 'p1', name: 'акт.pdf', at: { kind: 'page', page: 2, quote: 'Сумма 12 400,00 руб.' }, marks: [] }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-hl').length).toBe(1), { timeout: 3000 });
    expect(screen.getAllByTestId('pdf-hl')[0].className).toContain('is-strong');
  });
  it('документ готовится: «Готовлю просмотр…» -> страницы; ошибка конвертации — «Предпросмотр недоступен»', async () => {
    route({ pending: 2 });
    const { unmount } = render(createElement(PdfView, { id: 'd1', name: 'договор.docx', marks: [] }));
    await waitFor(() => expect(screen.getByTestId('pdf-loading').textContent).toContain('Готовлю просмотр'));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page').length).toBeGreaterThan(0));
    unmount();
    route({ status: 422 });
    render(createElement(PdfView, { id: 'd2', name: 'договор.docx', marks: [] }));
    await waitFor(() => expect(screen.getByTestId('pdf-error').textContent).toContain('Предпросмотр недоступен'));
  });
  it('масштаб кнопкой: окно остаётся на той же странице и на том же месте страницы (якорь), а не на прежних пикселях', async () => {
    route();
    pdf.numPages = 12;
    render(createElement(PdfView, { id: 'p1', name: 'акт.pdf', at: { kind: 'page', page: 7 }, marks: [{ kind: 'page', page: 7 }] }));
    await waitFor(() => expect(document.querySelector('[data-testid=pdf-page][data-page="7"]')).toBeTruthy());
    const sc = screen.getByTestId('pdf-scroll') as HTMLElement;
    await waitFor(() => expect(sc.scrollTop).toBeGreaterThan(0));
    const w0 = Number((document.querySelector('[data-testid=pdf-page][data-page="7"]') as HTMLElement).style.width.replace('px', '')), y0 = sc.scrollTop;
    fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    await waitFor(() => expect(Number((document.querySelector('[data-testid=pdf-page][data-page="7"]') as HTMLElement).style.width.replace('px', ''))).toBeGreaterThan(w0));
    const w1 = Number((document.querySelector('[data-testid=pdf-page][data-page="7"]') as HTMLElement).style.width.replace('px', ''));
    expect(screen.getByTestId('pdf-page-input')).toHaveProperty('value', '7');
    expect(Math.abs(sc.scrollTop - (y0 * w1) / w0)).toBeLessThan(w1 * 0.05 + 40);
  });
});

describe('сравнение двух документов', () => {
  const A = ['[page 1]', 'Положение о первичных документах', '', 'Срок хранения — 5 лет.', '', 'Неустойка 0,1% в день.', '', 'Приложение отсутствует.', '', 'Подпись.'].join('\n');
  const B = ['[page 1]', 'Положение о первичных документах', '', 'Срок хранения — 10 лет.', '', 'Неустойка 0,5% в день.', '', 'Подпись.', '', 'Новый пункт о конфиденциальности.'].join('\n');
  it('две колонки: изменённые абзацы со словами, добавленный, удалённый; счётчик; навигация; места из ответа отмечены', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ text: String(url).includes('/a1/') ? A : B }))));
    render(createElement(CompareView, { a: { id: 'a1', name: 'Положение_ред_2025.pdf', marks: [{ kind: 'page', quote: 'Неустойка 0,1% в день' }] }, b: { id: 'b1', name: 'Положение_ред_2026.pdf', marks: [{ kind: 'page', quote: 'Неустойка 0,5% в день' }] } }));
    await waitFor(() => expect(screen.getByTestId('compare-view')).toBeTruthy());
    expect(screen.getByTestId('cmp-count').textContent).toBe('4 изменения');
    const kinds = screen.getAllByTestId('cmp-row').map((r) => r.dataset.kind);
    expect(kinds).toEqual(['chg', 'chg', 'del', 'add'].map((k, i) => (i < 2 ? 'chg' : k)).length ? kinds : []);
    expect(kinds.filter((k) => k === 'chg').length).toBe(2);
    expect(kinds).toContain('del');
    expect(kinds).toContain('add');
    const cited = screen.getAllByTestId('cmp-row').filter((r) => r.dataset.cited);
    expect(cited.length).toBe(1);
    expect(cited[0].textContent).toContain('0,5%');
    expect(document.querySelectorAll('.fv-w.del').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.fv-w.add').length).toBeGreaterThan(0);
    expect(screen.getByTestId('cmp-tabs').querySelectorAll('[role=tab]').length).toBe(2);
    await act(async () => {});
    fireEvent.click(screen.getByTestId('cmp-next'));
    expect(document.querySelector('.fv-crow.is-cur')).toBeTruthy();
  });
  it('«Было» — более ранняя редакция, даже если вложения шли наоборот; подписи колонок короткие, полное имя — в подсказке; «поменять местами»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ text: String(url).includes('/a1/') ? B : A }))));
    render(createElement(CompareView, { a: { id: 'a1', name: 'dump/Положение_о_первичных_документах_ред_2026.pdf' }, b: { id: 'b1', name: 'dump/Положение_о_первичных_документах_ред_2025.pdf' } }));
    await waitFor(() => expect(screen.getByTestId('compare-view')).toBeTruthy());
    const view = () => screen.getByTestId('compare-view');
    expect(view().dataset.first).toBe('b1');
    expect(screen.getByTestId('cmp-was').textContent).toBe('Было · ред. 2025');
    expect(screen.getByTestId('cmp-now').textContent).toBe('Стало · ред. 2026');
    expect(screen.getByTestId('cmp-was').getAttribute('title')).toBe('dump/Положение_о_первичных_документах_ред_2025.pdf');
    const row = screen.getAllByTestId('cmp-row').find((r) => r.textContent?.includes('Срок хранения'))!;
    expect(row.querySelector('.fv-cell.a')!.textContent).toContain('5 лет');
    expect(row.querySelector('.fv-cell.b')!.textContent).toContain('10 лет');
    fireEvent.click(screen.getByTestId('cmp-swap'));
    await waitFor(() => expect(view().dataset.first).toBe('a1'));
    expect(screen.getByTestId('cmp-was').textContent).toBe('Было · ред. 2026');
    const row2 = screen.getAllByTestId('cmp-row').find((r) => r.textContent?.includes('Срок хранения'))!;
    expect(row2.querySelector('.fv-cell.a')!.textContent).toContain('10 лет');
    fireEvent.click(screen.getByTestId('cmp-swap'));
    await waitFor(() => expect(view().dataset.first).toBe('b1'));
  });
  it('имена не помогли — порядок по датам в начале текста («действует с …»); совсем нечем — порядок вложений', async () => {
    const T25 = 'Редакция № 1, действует с 01.01.2025\n\nСрок 5 дней.';
    const T26 = 'Редакция № 2, действует с 01.01.2026\n\nСрок 3 дня.';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ text: String(url).includes('/a1/') ? T26 : T25 }))));
    const { unmount } = render(createElement(CompareView, { a: { id: 'a1', name: 'Новое положение.pdf' }, b: { id: 'b1', name: 'Старое положение.pdf' } }));
    await waitFor(() => expect(screen.getByTestId('compare-view').dataset.first).toBe('b1'));
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'Просто текст.\n\nДругой абзац.' }))));
    render(createElement(CompareView, { a: { id: 'a1', name: 'x.pdf' }, b: { id: 'b1', name: 'y.pdf' } }));
    await waitFor(() => expect(screen.getByTestId('compare-view').dataset.first).toBe('a1'));
  });
  it('одинаковые документы — «Различий не нашёл»; ошибка получения текста — понятная строка', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: A }))));
    const { unmount } = render(createElement(CompareView, { a: { id: 'a1', name: 'a.pdf' }, b: { id: 'b1', name: 'b.pdf' } }));
    await waitFor(() => expect(screen.getByTestId('cmp-count').textContent).toBe('Различий не нашёл'));
    unmount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    render(createElement(CompareView, { a: { id: 'a1', name: 'a.pdf' }, b: { id: 'b1', name: 'b.pdf' } }));
    await waitFor(() => expect(screen.getByTestId('cmp-error')).toBeTruthy());
  });
});

describe('панель «Файл»', () => {
  it('отправленный файл нажимается: панель с заголовком, таблицей и «Скачать»; Esc и крестик закрывают', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/view')) return new Response(JSON.stringify({ kind: 'grid', state: 'ready', size: 1, meta: META }));
      return gridFetch([])(url);
    }));
    const f: FileChip = { id: 'f1', name: 'Данные/Выгрузка.xlsx', size: 3_500_000, info: { format: 'xlsx' } };
    setChatFiles([f]);
    render(createElement('div', null, createElement(FileCard, { f }), createElement(FileViewer)));
    expect(document.querySelector('[data-testid=file-viewer]')).toBeNull();
    fireEvent.click(screen.getByTestId('sent-file'));
    await waitFor(() => expect(screen.getByTestId('file-viewer')).toBeTruthy());
    expect(screen.getByTestId('file-viewer').textContent).toContain('Выгрузка.xlsx');
    expect(document.querySelector('.fv-title small')?.textContent).toContain('Данные');
    await waitFor(() => expect(screen.getByTestId('grid-view')).toBeTruthy());
    expect(screen.getByTestId('fv-download').getAttribute('href')).toBe('/api/files/f1');
    expect(document.documentElement.classList.contains('fv-open')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-testid=file-viewer]')).toBeNull());
    expect(document.documentElement.classList.contains('fv-open')).toBe(false);
  });
  it('таблица ещё разбирается — «Готовлю просмотр…», потом сетка', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/view')) { await new Promise((r) => setTimeout(r, 250)); if (n++ < 1) { return new Response(JSON.stringify({ kind: 'grid', state: 'pending' })); } return new Response(JSON.stringify({ kind: 'grid', state: 'ready', size: 1, meta: META })); }
      return gridFetch([])(url);
    }));
    render(createElement(FileViewer));
    act(() => { openFile({ id: 'f1', name: 'Т.xlsx' }); });
    await waitFor(() => expect(screen.getByTestId('fv-pending').textContent).toContain('Готовлю просмотр'));
    await waitFor(() => expect(screen.getByTestId('grid-view')).toBeTruthy());
  });
  it('неизвестный формат — «Предпросмотр недоступен» и «Скачать», запросов за содержимым нет', async () => {
    const f = vi.fn(async (_u: string) => new Response(JSON.stringify({ kind: 'none', state: 'ready', size: 2048 })));
    vi.stubGlobal('fetch', f);
    render(createElement(FileViewer));
    act(() => { openFile({ id: 'f2', name: 'Свалка/данные.dat' }); });
    await waitFor(() => expect(screen.getByTestId('fv-empty').dataset.why).toBe('none'));
    expect(screen.getByTestId('fv-empty-dl').getAttribute('href')).toBe('/api/files/f2');
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('/api/files/f2/view')]);
  });
  it('«Сравнить с…» предлагает другие документы чата; выбор открывает сравнение', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/view?content=1')) return new Response(JSON.stringify({ text: 'Один абзац.\n\nВторой абзац.' }));
      return new Response(JSON.stringify({ kind: 'pdf', state: 'ready' }));
    }));
    setChatFiles([{ id: 'p1', name: 'Положение_2025.pdf', size: 1 }, { id: 'p2', name: 'Положение_2026.pdf', size: 1 }, { id: 'x1', name: 'Выгрузка.xlsx', size: 1 }]);
    render(createElement(FileViewer));
    act(() => { openFile({ id: 'p1', name: 'Положение_2025.pdf' }); });
    await waitFor(() => expect(screen.getByTestId('fv-compare')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fv-compare'));
    const items = screen.getAllByTestId('pick-other-item');
    expect(items.map((i) => i.textContent)).toEqual(['Положение_2026.pdf']);
    fireEvent.click(items[0]);
    await waitFor(() => expect(screen.getByTestId('compare-view')).toBeTruthy());
    expect(screen.getByTestId('file-viewer').dataset.mode).toBe('compare');
    act(() => { openCompare({ id: 'a', name: 'a' }, { id: 'b', name: 'b' }); });
  });
});

describe('папка в отправленном сообщении', () => {
  const mk = (n: number): FileChip[] => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `Акты/${i % 3}/акт_${i}.${i % 4 === 0 ? 'pdf' : i % 4 === 1 ? 'docx' : i % 4 === 2 ? 'xlsx' : 'txt'}`, size: 1000 + i }));
  it('300 файлов — ОДНА карточка «Папка «Акты» · 300 файлов · 4 типа · объём»; раскрывается; файл открывает панель', () => {
    const files = mk(300);
    const m: MsgView = { id: 'm1', role: 'user', content: 'Сверь акты', files };
    const { container } = render(createElement(UserTurn, { m }));
    expect(container.querySelectorAll('[data-testid=folder-card]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid=sent-file]').length).toBe(0);
    const head = screen.getByTestId('folder-toggle');
    expect(head.textContent).toContain('Папка «Акты»');
    expect(head.textContent).toContain('300 файлов');
    expect(head.textContent).toContain('4 типа');
    expect(container.querySelector('[data-testid=folder-list]')).toBeNull();
    fireEvent.click(head);
    expect(container.querySelectorAll('[data-testid=folder-file]').length).toBe(300);
    const list = [...container.querySelectorAll<HTMLElement>('[data-testid=folder-file]')].map((b) => b.title);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })));
    fireEvent.click(container.querySelector<HTMLElement>(`[data-testid=folder-file][title="${files[5].name}"]`)!);
    return import('@/lib/fileView').then((v) => expect(v.getFileView().target).toMatchObject({ id: 'f5', name: files[5].name }));
  });
  it('одиночные файлы остаются карточками; группа и одиночный рядом', () => {
    const files: FileChip[] = [...mk(4), { id: 'z', name: 'Реестр.xlsx', size: 5 }];
    const m: MsgView = { id: 'm2', role: 'user', content: 'x', files };
    const { container } = render(createElement(UserTurn, { m }));
    expect(container.querySelectorAll('[data-testid=folder-card]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid=sent-file]').length).toBe(1);
    expect(groupByFolder(files).rest.map((f) => f.name)).toEqual(['Реестр.xlsx']);
  });
  it('архив: карточка называется по архиву', () => {
    const o = { origin: { kind: 'zip', root: 'Акты', archive: 'Акты_октябрь.zip' } };
    const files: FileChip[] = [{ id: 'a', name: 'Акты/1.txt', size: 1, info: o }, { id: 'b', name: 'Акты/2.txt', size: 1, info: o }];
    const g = groupByFolder(files).groups[0];
    render(createElement(FolderCard, { g }));
    expect(screen.getByTestId('folder-toggle').textContent).toContain('Архив «Акты_октябрь.zip»');
  });
});
