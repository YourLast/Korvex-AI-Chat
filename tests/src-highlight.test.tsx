// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { PdfView } from '@/components/fileview/PdfView';
import { _resetPdfDocs } from '@/components/fileview/pdfDocs';
import { fontPx, highlightText, quoteRects } from '@/components/fileview/pdfjs';
import { findSource } from '@/components/SrcChip';
import { closeFile, _resetFileView } from '@/lib/fileView';
import { asSource, chipLabel, clauseOf, locLabel, parseLocator, parseMarker, type Source } from '@/lib/srcmark';
import { Markdown } from '@/components/Markdown';
import { SrcCtx } from '@/components/SrcChip';
import { setChatFiles } from '@/lib/fileView';
import fs from 'node:fs';
import { apiBase } from '@/lib/apiBase';
import { tr } from '@/lib/i18n/core';

type It = { str: string; transform: number[]; width: number; height: number };
const pdf = vi.hoisted(() => ({ numPages: 3, byPage: {} as Record<number, { str: string; transform: number[]; width: number; height: number }[]>, pageW: 600, pageH: 800 }));
vi.mock('@/components/fileview/pdfjs', async (orig) => {
  const o = await orig<typeof import('@/components/fileview/pdfjs')>();
  const lib = {
    Util: { transform: (a: number[], b: number[]) => [a[0] * b[0], 0, 0, a[3] * b[3], b[4] * a[0], a[5] + b[5] * a[3]] },
    getDocument: () => ({
      destroy: async () => {},
      promise: Promise.resolve({
        numPages: pdf.numPages,
        getPage: async (n: number) => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: pdf.pageW * scale, height: pdf.pageH * scale, transform: [scale, 0, 0, -scale, 0, pdf.pageH * scale] }),
          render: () => ({ promise: Promise.resolve(), cancel() {} }),
          getTextContent: async () => ({ items: pdf.byPage[n] ?? [] }),
        }),
      }),
    }),
  };
  return { ...o, loadPdfjs: async () => lib as never };
});

const line = (str: string, y: number, w = 300): It => ({ str, transform: [12, 0, 0, 12, 50, y], width: w, height: 12 });
const CL32 = 'Исполнитель вправе в одностороннем порядке изменить стоимость услуг';
const CL73 = 'За просрочку оплаты Заказчик уплачивает штраф в размере 0,5% от неоплаченной суммы';

const CLIENT_H = 560, CLIENT_W = 640;
beforeEach(() => {
  _resetFileView(); _resetPdfDocs();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return /fv-pages/.test(this.className) ? CLIENT_H : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? CLIENT_W : 0; } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= function () {};
  const raf = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
  window.requestAnimationFrame = raf; globalThis.requestAnimationFrame = raf;
  pdf.numPages = 3; pdf.pageW = 600; pdf.pageH = 800;
  pdf.byPage = { 1: [line('3.2. ' + CL32 + ', уведомив', 100)], 2: [line('7.1. Неустойка', 100), line('7.3. ' + CL73, 140, 520), line('за каждый день просрочки', 156, 200)], 3: [line('12.3. Порядок возмещения убытков', 100)] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); closeFile(); });

const view = () => screen.getByTestId('pdf-view');
const hls = () => screen.queryAllByTestId('pdf-hl');
const scroller = () => screen.getByTestId('pdf-scroll') as HTMLElement;

describe('PDF: подсветка цитаты, масштаб, прокрутка', () => {
  it('чип с цитатой: страница открыта по ширине панели (1×), цитата подсвечена, окно прокручено к подсветке', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
    await waitFor(() => expect(hls().length).toBeGreaterThan(0), { timeout: 3000 });
    await waitFor(() => expect(hls().length).toBe(1));
    expect(Number(view().dataset.zoom)).toBe(1);
    expect(hls()[0].className).toContain('is-strong');
    expect(screen.queryByTestId('pdf-fit')).toBeNull();
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0));
    expect(scroller().scrollLeft).toBe(0);
    expect(screen.getByTestId('pdf-page-input')).toHaveProperty('value', '2');
    expect(screen.getByTestId('pdf-quote').textContent).toBe(`«${CL73}»`);
  });

  it.each([420, 537, 900])('ширина панели %i px: страница не шире панели, строка цитаты целиком внутри панели (без прокрутки вбок)', async (panel) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? panel : 0; } });
    pdf.byPage[2] = [line('7.3. ' + CL73, 140, 540)];
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    const page = document.querySelector<HTMLElement>('[data-testid=pdf-page][data-page="2"]')!;
    const pageLeft = parseFloat(page.style.left), pageW = parseFloat(page.style.width);
    expect(pageW + pageLeft * 2).toBeLessThanOrEqual(panel);
    const hl = hls()[0];
    const right = pageLeft + parseFloat(hl.style.left) + parseFloat(hl.style.width);
    expect(right).toBeLessThanOrEqual(panel);
    expect(parseFloat(hl.style.left)).toBeGreaterThanOrEqual(0);
    expect(scroller().scrollLeft).toBe(0);
    expect(Number(view().dataset.zoom)).toBe(1);
  });

  it('над страницей — цитата обычным текстом (15 px): строки страницы при читаемом кегле шире окна телефона; нажатие разворачивает; без цитаты полосы нет', async () => {
    const { unmount } = render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
    const bar = await screen.findByTestId('pdf-quote');
    expect(bar.textContent).toBe(`«${CL73}»`);
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bar);
    expect(screen.getByTestId('pdf-quote').getAttribute('aria-expanded')).toBe('true');
    unmount();
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2 }, marks: [] }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page').length).toBe(3));
    expect(screen.queryByTestId('pdf-quote')).toBeNull();
  });

  it('прокрутка по вертикали — к подсвеченной строке, не к началу страницы', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    const z = Number(view().dataset.zoom);
    const width = Math.round((CLIENT_W - 24) * z), scale = width / 600, pageH = Math.round(width * 800 / 600);
    const page2Top = 12 + pageH + 12;
    const lineTop = (800 - 140 - 12) * scale;
    await waitFor(() => expect(Math.abs(scroller().scrollTop - (page2Top + lineTop - 140))).toBeLessThan(40));
  });

  it('на странице две цитаты ответа: «сильная» подсветка — только у той, на чип которой нажали; окно прокручено к ней, а не к верхней на странице', async () => {
    const Q71 = 'Исполнитель уплачивает неустойку в размере 0,01% от стоимости услуг';
    pdf.byPage[2] = [line('7.1. ' + Q71, 600, 520), line('7.3. ' + CL73, 100, 520)];
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [{ kind: 'page', page: 2, quote: Q71 }, { kind: 'page', page: 2, quote: CL73 }] }));
    await waitFor(() => expect(hls().length).toBe(2), { timeout: 3000 });
    expect(hls().filter((h) => h.className.includes('is-strong')).length).toBe(1);
    const strong = hls().find((h) => h.className.includes('is-strong'))!;
    const light = hls().find((h) => !h.className.includes('is-strong'))!;
    expect(parseFloat(strong.style.top)).toBeGreaterThan(parseFloat(light.style.top));
    const z = Number(view().dataset.zoom), width = Math.round((CLIENT_W - 24) * z), scale = width / 600, page2Top = 12 + Math.round(width * 800 / 600) + 12;
    await waitFor(() => expect(Math.abs(scroller().scrollTop - (page2Top + (800 - 100 - 12) * scale - 140))).toBeLessThan(40), { timeout: 3000 });
  });

  it('цитаты других страниц (остальные чипы ответа) не сбивают прокрутку: окно остаётся у подсветки той цитаты, на чип которой нажали', async () => {
    pdf.byPage[1] = [line('3.2. ' + CL32, 400, 520)];
    pdf.byPage[3] = [line('12.3. Порядок возмещения убытков определяется Приложением', 300, 520)];
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 },
      marks: [{ kind: 'page', page: 1, quote: CL32 }, { kind: 'page', page: 2, quote: CL73 }, { kind: 'page', page: 3, quote: 'Порядок возмещения убытков определяется Приложением' }] }));
    await waitFor(() => expect(hls().length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    const z = Number(view().dataset.zoom), width = Math.round((CLIENT_W - 24) * z), scale = width / 600, page2Top = 12 + Math.round(width * 800 / 600) + 12;
    await new Promise((r) => setTimeout(r, 1200));
    expect(Math.abs(scroller().scrollTop - (page2Top + (800 - 140 - 12) * scale - 140))).toBeLessThan(40);
    expect(screen.getByTestId('pdf-page-input')).toHaveProperty('value', '2');
  });

  it('презентация: слайд N = страница PDF-копии; цитата подсвечена; подписи мест — «слайд N», у страниц — «стр. N»', async () => {
    const seen: string[] = [];
    render(createElement(PdfView, { id: 'p1', name: 'Отчёт.pptx', at: { kind: 'slide', slide: 2, quote: CL73 }, marks: [{ kind: 'slide', slide: 2, quote: CL73 }, { kind: 'slide', slide: 3 }], onPlace: (x: string) => seen.push(x) }));
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    expect(view().dataset.target).toBe('2');
    expect(hls()[0].className).toContain('is-strong');
    expect(screen.getByTestId('pdf-marks').textContent).toBe('слайд 2слайд 3');
    expect(seen).toContain('слайд 2');
    expect(screen.getByTestId('pdf-quote').textContent).toBe(`«${CL73}»`);
    cleanup();
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [{ kind: 'page', page: 3 }] }));
    await screen.findByTestId('pdf-marks');
    expect(screen.getByTestId('pdf-marks').textContent).toBe('стр. 2стр. 3');
  });

  it('любой кегль цитаты — масштаб не трогаем: и крупный, и очень мелкий текст открываются по ширине панели (читать — в полосе цитаты, «+» приближает)', async () => {
    for (const fs of [18, 3]) {
      cleanup();
      pdf.byPage[2] = [{ ...line('7.3. ' + CL73, 140, 520), transform: [fs, 0, 0, fs, 50, 140] }];
      render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
      await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
      expect(Number(view().dataset.zoom)).toBe(1);
      expect(screen.getByTestId('pdf-quote').textContent).toBe(`«${CL73}»`);
    }
  });

  it('без цитаты — как раньше: страница открыта, подсветки и подгонки масштаба нет', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2 }, marks: [] }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page').length).toBe(3));
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 150));
    expect(hls().length).toBe(0);
    expect(Number(view().dataset.zoom)).toBe(1);
    expect(screen.queryByTestId('pdf-fit')).toBeNull();
  });

  it('вместо цитаты — кусок текста от серва (snippet): он и подсвечивается', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, snippet: '…' + CL73 + ' за каждый день просрочки…' }, marks: [] }));
    await waitFor(() => expect(hls().length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    expect(hls()[0].className).toContain('is-strong');
  });

  it('цитата не на указанной странице — ищется по страницам и открывается там, где нашлась', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 1, quote: CL73 }, marks: [] }));
    await waitFor(() => expect(view().dataset.target).toBe('2'), { timeout: 3000 });
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    expect(hls()[0].closest('[data-testid=pdf-page]')?.getAttribute('data-page')).toBe('2');
  });

  it('страницы нет вовсе (документ из DOCX: место — строка, а у PDF-копии страницы) — цитата ищется по страницам', async () => {
    render(createElement(PdfView, { id: 'd1', name: 'Договор.docx', at: { kind: 'line', line: 40, quote: CL32 }, marks: [] }));
    await waitFor(() => expect(view().dataset.target).toBe('1'), { timeout: 3000 });
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
  });

  it('цитаты нигде нет — тихо остаётся на странице, без подсветки и без зависания', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: 'Этой фразы нет в документе совсем нигде' }, marks: [] }));
    await waitFor(() => expect(screen.getAllByTestId('pdf-page').length).toBe(3));
    await new Promise((r) => setTimeout(r, 300));
    expect(hls().length).toBe(0);
    expect(view().dataset.target).toBe('2');
  });

  it('«+» приближает сам человек, «1×» возвращает страницу по ширине; повторное нажатие на чип масштаб человека не сбрасывает', async () => {
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: CL73 }, marks: [] }));
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    expect(Number(view().dataset.zoom)).toBe(1);
    fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    await waitFor(() => expect(Number(view().dataset.zoom)).toBeCloseTo(1.2, 5));
    fireEvent.click(screen.getByTestId('pdf-fit'));
    await waitFor(() => expect(Number(view().dataset.zoom)).toBe(1));
    expect(screen.queryByTestId('pdf-fit')).toBeNull();
  });
});

describe('подсветка в тексте страницы', () => {
  const util = { transform: (a: number[], b: number[]) => [a[0] * b[0], 0, 0, a[3] * b[3], b[4] * a[0], a[5] + b[5] * a[3]] };
  const vt = [1, 0, 0, -1, 0, 800];
  const rects = (items: It[], q: string) => quoteRects(items, vt, 1, q, util);
  it('слово из двух кусков, перенос с дефисом, другие кавычки и тире — находятся (сравнение по буквам и цифрам)', () => {
    const items = [line('Испол', 100, 30), line('нитель вправе в одно-', 100, 150), line('стороннем порядке', 114, 120), line('изменить стоимость', 128, 120)];
    expect(rects(items, '«Исполнитель вправе в одностороннем порядке изменить стоимость»').length).toBe(4);
    expect(rects([line('ставка 0,5 % в день — без потолка', 100)], 'ставка 0,5% в день - без потолка').length).toBe(1);
    expect(rects([line('Ёлка стоит', 100)], 'елка стоит').length).toBe(1);
  });
  it('длинная цитата с лишним хвостом находится по началу; чужой текст — нет', () => {
    const items = [line('Заказчик вправе отказаться от договора, уведомив Исполнителя', 100)];
    expect(rects(items, 'Заказчик вправе отказаться от договора, уведомив Исполнителя за 90 календарных дней, при этом обязан оплатить услуги').length).toBe(1);
    expect(rects(items, 'совсем другой текст про штрафы').length).toBe(0);
    expect(rects(items, 'ab').length).toBe(0);
  });
  it('кегль подсвеченного текста — медиана; текст подсветки: цитата, иначе snippet без «…», короткое не берётся', () => {
    expect(fontPx([{ l: 0, t: 0, w: 1, h: 11.5 }, { l: 0, t: 0, w: 1, h: 23 }, { l: 0, t: 0, w: 1, h: 11.5 }])).toBeCloseTo(10, 5);
    expect(fontPx([])).toBe(0);
    expect(highlightText({ quote: ' цитата ', snippet: 'другое другое' })).toBe('цитата');
    expect(highlightText({ snippet: '…текст вокруг цитаты…' })).toBe('текст вокруг цитаты');
    expect(highlightText({ snippet: '…коротко…' })).toBeUndefined();
    expect(highlightText(undefined)).toBeUndefined();
  });
});

describe('список серва и маркеры', () => {
  it('kind "sheet" принимается; «лист Итоги» без строки разбирается; подписи на трёх языках', () => {
    const s = asSource({ n: 1, raw: '[[src:Выгрузка.xlsx|лист Итоги]]', file: 'Выгрузка.xlsx', kind: 'sheet', sheet: 'Итоги', verified: true });
    expect(s).toMatchObject({ kind: 'sheet', sheet: 'Итоги', verified: true });
    expect(parseLocator('лист Итоги')).toMatchObject({ kind: 'sheet', sheet: 'Итоги' });
    expect(parseLocator('sheet Totals')).toMatchObject({ kind: 'sheet', sheet: 'Totals' });
    expect(parseLocator('лист Реализация, строка 5')).toMatchObject({ kind: 'row', row: 5 });
    const T = (lang: 'ru' | 'en' | 'sr') => ((k: string, p?: Record<string, string | number>) => tr(lang, k as never, p)) as never;
    expect(locLabel({ kind: 'sheet', sheet: 'Итоги' }, T('ru'))).toBe('лист Итоги');
    expect(chipLabel({ kind: 'sheet', sheet: 'Итоги' }, T('ru'))).toBe('лист Итоги');
    expect(chipLabel({ kind: 'sheet', sheet: 'Totals' }, T('en'))).toBe('sheet Totals');
    expect(chipLabel({ kind: 'sheet', sheet: 'Zbir' }, T('sr'))).toBe('list Zbir');
  });
  it('поля ред. 5: auto и quote_added принимаются, остальное — как было', () => {
    const s = asSource({ file: 'a.pdf', kind: 'page', page: 2, quote: 'цитата', snippet: '…вокруг…', verified: true, auto: true, quote_added: false });
    expect(s).toMatchObject({ auto: true, quote: 'цитата', snippet: '…вокруг…' });
    expect(s?.quote_added).toBeUndefined();
  });
  it('маркер из ячейки таблицы («\\|») разбирается как обычный, имя файла без обратной косой', () => {
    expect(parseMarker('Договор.pdf\\|стр. 2\\|"штраф 0,5%"')).toEqual({ file: 'Договор.pdf', loc: 'стр. 2', quote: 'штраф 0,5%' });
  });
  it('несколько маркеров на одной странице: чип получает тот элемент списка, чья цитата совпала; «\\|» в тексте маркера и в списке — одно и то же', () => {
    const list = [
      { raw: '[[src:Договор.pdf\\|стр. 2\\|"первая цитата ровно такая"]]', file: 'Договор.pdf', kind: 'page' as const, page: 2, quote: 'первая цитата ровно такая', verified: true },
      { raw: '[[src:Договор.pdf\\|стр. 2\\|"вторая цитата совсем другая"]]', file: 'Договор.pdf', kind: 'page' as const, page: 2, quote: 'вторая цитата совсем другая', verified: true },
    ];
    expect(findSource(list, '[[src:Договор.pdf|стр. 2|"вторая цитата совсем другая"]]')?.quote).toBe('вторая цитата совсем другая');
    expect(findSource(list, '[[src:Договор.pdf\\|стр. 2\\|"первая цитата ровно такая"]]')?.quote).toBe('первая цитата ровно такая');
    expect(findSource(list, '[[src:Договор.pdf|стр. 2|"первая цитата ровно такая"]]')?.quote).toBe('первая цитата ровно такая');
    expect(findSource(list, '[[src:Договор.pdf|стр. 2]]')?.quote).toBe('первая цитата ровно такая');
    expect(findSource(list, '[[src:Договор.pdf|стр. 3|"нет такой"]]')).toBeNull();
  });
});

describe('чип: одна строка, номер пункта', () => {
  const SN = '…без НДС. 3.2. Исполнитель вправе в одностороннем порядке изменить стоимость услуг, уведомив Заказчика не позднее чем за 3 рабочих дня до начала месяца. 3.3. Оплата производится…';
  it('номер пункта — ближайший перед цитатой «N.M.»; или в самом начале цитаты; нет в куске / нет цитаты / строка таблицы — null', () => {
    expect(clauseOf({ kind: 'page', quote: 'Исполнитель вправе в одностороннем порядке изменить стоимость услуг', snippet: SN })).toBe('3.2');
    expect(clauseOf({ kind: 'page', quote: '7.3. За просрочку оплаты Заказчик уплачивает штраф', snippet: '' })).toBe('7.3');
    expect(clauseOf({ kind: 'page', quote: '«12.3. Порядок возмещения убытков определяется»', snippet: undefined })).toBe('12.3');
    expect(clauseOf({ kind: 'page', quote: 'уведомив Заказчика не позднее чем за 3 рабочих дня', snippet: SN })).toBe('3.2');
    expect(clauseOf({ kind: 'page', quote: 'Оплата производится', snippet: SN })).toBe('3.3');
    expect(clauseOf({ kind: 'page', quote: 'Исполнитель вправе в одностороннем порядке изменить стоимость услуг', snippet: '…000 (сто пятьдесят тысяч) рублей в месяц без НДС. 3.2. Исполнитель вправе в…' })).toBe('3.2');
    expect(clauseOf({ kind: 'page', quote: 'совсем другой текст про штрафы', snippet: SN })).toBeNull();
    expect(clauseOf({ kind: 'page', quote: 'цена 150 000 рублей в месяц', snippet: 'договор от 15.09.2026. цена 150 000 рублей в месяц без НДС' })).toBeNull();
    expect(clauseOf({ kind: 'page', quote: undefined, snippet: SN })).toBeNull();
    expect(clauseOf({ kind: 'row', quote: 'Исполнитель вправе в одностороннем порядке', snippet: SN })).toBeNull();
    expect(clauseOf({ kind: 'page', quote: '(*[ бессмысленный ] текст', snippet: SN })).toBeNull();
  });

  const FILES = [{ id: 'f1', name: 'Договор.pdf', size: 1 }, { id: 'f2', name: 'Выгрузка.xlsx', size: 1 }];
  const mount = (text: string, sources: Source[]) => render(createElement(SrcCtx.Provider, { value: { sources, live: false } }, createElement(Markdown, { text })));
  beforeEach(() => { setChatFiles(FILES); });
  it('чип страницы: иконка файла внутри чипа, перед местом; подпись «стр. 2 · п. 3.2» при известном пункте, «строка 2311» у таблицы', () => {
    const raw = '[[src:Договор.pdf|стр. 1|"Исполнитель вправе в одностороннем порядке изменить стоимость услуг"]]';
    const { container } = mount(`Цена меняется ${raw}.`, [{ raw, file: 'Договор.pdf', kind: 'page', page: 1, quote: 'Исполнитель вправе в одностороннем порядке изменить стоимость услуг', snippet: SN, verified: true }]);
    const btn = container.querySelector<HTMLElement>('button[data-testid=src-chip]')!;
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.firstElementChild!.tagName.toLowerCase()).toBe('svg');
    expect(btn.querySelector('.src-l')!.textContent).toBe('стр. 1');
    expect(btn.querySelector('.src-c')!.textContent).toBe('п. 3.2');
    expect(btn.textContent).toBe('стр. 1п. 3.2');
    expect(container.querySelector('[data-testid=src-group] > svg')).toBeNull();
    cleanup();
    const raw2 = '[[src:Выгрузка.xlsx|лист Реализация, строка 2311]]';
    const r2 = mount(`Дубль ${raw2}.`, [{ raw: raw2, file: 'Выгрузка.xlsx', kind: 'row', sheet: 'Реализация', row: 2311, verified: true }]);
    const b2 = r2.container.querySelector<HTMLElement>('button[data-testid=src-chip]')!;
    expect(b2.textContent).toBe('строка 2311');
    expect(b2.querySelector('.src-c')).toBeNull();
  });
  it('несколько чипов подряд — отдельные кнопки одной группы; без цитаты — без номера пункта', () => {
    const a = '[[src:Договор.pdf|стр. 1]]', b = '[[src:Договор.pdf|стр. 2|"Совокупная ответственность Исполнителя по договору"]]';
    const { container } = mount(`${a} ${b}`, [{ raw: a, file: 'Договор.pdf', kind: 'page', page: 1, verified: true }, { raw: b, file: 'Договор.pdf', kind: 'page', page: 2, quote: 'Совокупная ответственность Исполнителя по договору', snippet: '…8.1. Стороны отвечают. 8.2. Совокупная ответственность Исполнителя по договору ограничена…', verified: true }]);
    const btns = [...container.querySelectorAll<HTMLElement>('[data-testid=src-group] button')];
    expect(btns.map((x) => x.textContent)).toEqual(['стр. 1', 'стр. 2п. 8.2']);
    expect(btns.filter((x) => x.querySelector('svg')).length).toBe(1);
  });
  it('стили: чип не переносится внутри, без рамки, малый радиус, группа — обычный поток (не flex с переносом: иконка не уходит над подписью); зона нажатия на телефоне невидимая', () => {
    const css = fs.readFileSync(`${__dirname}/../src/styles/fileview.css`, 'utf8');
    const rule = (sel: string) => (new RegExp(`^${sel.replace(/\./g, '\\.')} \\{[^}]*\\}`, 'm').exec(css)?.[0] ?? '');
    const p = rule('.src-p');
    expect(p).toContain('white-space: nowrap');
    expect(p).toContain('border: 0');
    expect(p).toMatch(/border-radius: [2-6]px/);
    expect(p).toMatch(/height: 1\.\d+em/);
    expect(rule('.src-grp')).toContain('display: inline;');
    expect(rule('.src-grp')).not.toContain('flex-wrap');
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.src-p::after \{[^}]*inset: -[89]px/);
    expect(css).toMatch(/\.src-p:hover/);
    expect(css).toMatch(/\.src-p:active/);
  });
});

describe('цитата с жирным модели: «**» не показываются, подсветка на месте', () => {
  it('полоса над страницей — без звёздочек; строка документа подсвечена', async () => {
    const Q = 'За просрочку оплаты Заказчик уплачивает **штраф в размере 0,5%** от неоплаченной суммы';
    render(createElement(PdfView, { id: 'p1', name: 'Договор.pdf', at: { kind: 'page', page: 2, quote: Q }, marks: [] }));
    await waitFor(() => expect(hls().length).toBe(1), { timeout: 3000 });
    expect(screen.getByTestId('pdf-quote').textContent).toBe(`«${CL73}»`);
  });
  it('номер пункта находится и у цитаты, начатой с «**»', () => {
    expect(clauseOf({ kind: 'page', quote: '**7.3. За просрочку оплаты** Заказчик уплачивает штраф' })).toBe('7.3');
  });
});
