// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { PdfView } from '@/components/fileview/PdfView';
import { _resetPdfDocs } from '@/components/fileview/pdfDocs';
import { I18nProvider } from '@/lib/i18n/react';

type It = { str: string; transform: number[]; width: number; height: number };
const pdf = vi.hoisted(() => ({ numPages: 3801, h: (_n: number): number => 800, byPage: {} as Record<number, { str: string; transform: number[]; width: number; height: number }[]>, opened: 0, docs: 0 }));
vi.mock('@/components/fileview/pdfjs', async (orig) => {
  const o = await orig<typeof import('@/components/fileview/pdfjs')>();
  const lib = {
    Util: { transform: (a: number[], b: number[]) => [a[0] * b[0], 0, 0, a[3] * b[3], b[4] * a[0], a[5] + b[5] * a[3]] },
    getDocument: () => {
      pdf.docs++;
      return {
        destroy: async () => {},
        promise: Promise.resolve({
          numPages: pdf.numPages,
          getPage: async (n: number) => ({
            getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: pdf.h(n) * scale, transform: [scale, 0, 0, -scale, 0, pdf.h(n) * scale] }),
            render: () => { pdf.opened++; return { promise: Promise.resolve(), cancel() {} }; },
            getTextContent: async () => ({ items: pdf.byPage[n] ?? [] }),
          }),
        }),
      };
    },
  };
  return { ...o, loadPdfjs: async () => lib as never };
});

const line = (str: string, y: number, w = 300): It => ({ str, transform: [12, 0, 0, 12, 50, y], width: w, height: 12 });
const Q1 = 'Расходы на приобретение основных средств учитываются по первоначальной стоимости актива';
const Q2 = 'Благотворительные взносы свыше двухсот пятидесяти долларов подтверждаются письменно';
const Q3 = 'Улучшения здания капитализируются и амортизируются в течение срока полезного использования';
const CLIENT_H = 560, CLIENT_W = 640;
let fetches = 0;
beforeEach(() => {
  _resetPdfDocs();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return /fv-pages/.test(this.className) ? CLIENT_H : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? CLIENT_W : 0; } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  const raf = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)) as typeof requestAnimationFrame;
  window.requestAnimationFrame = raf; globalThis.requestAnimationFrame = raf;
  pdf.numPages = 3801; pdf.h = () => 800; pdf.opened = 0; pdf.docs = 0;
  pdf.byPage = { 3274: [line(Q1, 300)], 2717: [line(Q2, 200)], 3295: [line(Q3, 500)] };
  fetches = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { fetches++; return new Response(new Uint8Array([37, 80, 68, 70])); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const input = () => screen.queryByTestId('pdf-page-input') as HTMLInputElement | null;
const hls = () => screen.queryAllByTestId('pdf-hl');
const strong = () => hls().filter((h) => h.className.includes('is-strong'));
const pageEls = () => [...document.querySelectorAll<HTMLElement>('[data-testid=pdf-page]')];
function watch() {
  const counter: string[] = [], pages = new Set<number>();
  const tick = () => {
    const v = input()?.value;
    if (v !== undefined && counter[counter.length - 1] !== v) counter.push(v);
    pageEls().forEach((p) => pages.add(Number(p.dataset.page)));
  };
  tick();
  const id = window.setInterval(tick, 1);
  return { counter, pages, stop: () => { window.clearInterval(id); tick(); } };
}
const mount = (at: object, extra: object = {}) => createElement(PdfView, { id: 'cfr', name: 'CFR.pdf', at: at as never, marks: [], ...extra } as never);

describe('переход «сразу на страницу и строку»', () => {
  it('открытие на странице 3274 из 3801: счётчик сразу 3274 (без промежуточных), в DOM — окно у цели, строка цитаты подсвечена', async () => {
    const w = watch();
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 300));
    w.stop();
    expect(w.counter).toEqual(['3274']);
    expect(Math.min(...w.pages)).toBeGreaterThanOrEqual(3270);
    expect(Math.max(...w.pages)).toBeLessThanOrEqual(3279);
    expect(w.pages.size).toBeLessThan(10);
    expect(strong()[0].closest('[data-testid=pdf-page]')?.getAttribute('data-page')).toBe('3274');
    expect(Number(screen.getByTestId('pdf-view').dataset.zoom)).toBe(1);
  });
  it('строка подсвечена на экране: окно поставлено на верхнюю четверть к строке цитаты, а не на верх страницы', async () => {
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const sc = screen.getByTestId('pdf-scroll') as HTMLElement;
    const page = document.querySelector<HTMLElement>('[data-testid=pdf-page][data-page="3274"]')!;
    const hl = strong()[0];
    const lineTopOnScreen = parseFloat(page.style.top) + parseFloat(hl.style.top) - sc.scrollTop;
    expect(lineTopOnScreen).toBeGreaterThan(80);
    expect(lineTopOnScreen).toBeLessThan(CLIENT_H * 0.45);
  });
  it('чип→чип в том же файле: другой at и seq — документ не загружается заново, счётчик идёт 3274 → 2717 без промежуточных', async () => {
    const { rerender } = render(mount({ kind: 'page', page: 3274, quote: Q1 }, { seq: 1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const w = watch();
    rerender(mount({ kind: 'page', page: 2717, quote: Q2 }, { seq: 2 }));
    await waitFor(() => expect(input()?.value).toBe('2717'), { timeout: 4000 });
    await waitFor(() => expect(strong().length).toBe(1));
    await new Promise((r) => setTimeout(r, 300));
    w.stop();
    expect(w.counter).toEqual(['3274', '2717']);
    expect(Math.min(...[...w.pages].filter((p) => p < 3200))).toBeGreaterThanOrEqual(2712);
    expect(pdf.docs).toBe(1);
    expect(strong()[0].closest('[data-testid=pdf-page]')?.getAttribute('data-page')).toBe('2717');
  });
  it('повторное нажатие на тот же чип (seq вырос): возвращает на место цитаты после того, как человек листал', async () => {
    const { rerender } = render(mount({ kind: 'page', page: 3274, quote: Q1 }, { seq: 1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const sc = screen.getByTestId('pdf-scroll') as HTMLElement;
    const y0 = sc.scrollTop;
    act(() => { sc.scrollTop = y0 + 5000; fireEvent.scroll(sc); });
    await waitFor(() => expect(Number(input()!.value)).toBeGreaterThan(3274));
    rerender(mount({ kind: 'page', page: 3274, quote: Q1 }, { seq: 2 }));
    await waitFor(() => expect(input()!.value).toBe('3274'));
    await waitFor(() => expect(Math.abs(sc.scrollTop - y0)).toBeLessThan(2));
  });
  it('чип места в панели: страница и строка этой цитаты (сильная подсветка — у неё), счётчик прямо на страницу', async () => {
    render(mount({ kind: 'page', page: 3274, quote: Q1 }, { marks: [{ kind: 'page', page: 3274, quote: Q1 }, { kind: 'page', page: 2717, quote: Q2 }, { kind: 'page', page: 3295, quote: Q3 }] }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const w = watch();
    fireEvent.click(screen.getAllByTestId('pdf-mark').find((b) => b.textContent!.includes('2717'))!);
    await waitFor(() => expect(strong().length).toBe(1));
    await waitFor(() => expect(strong()[0].closest('[data-testid=pdf-page]')?.getAttribute('data-page')).toBe('2717'));
    expect(screen.getByTestId('pdf-quote').textContent).toBe(`«${Q2}»`);
    await new Promise((r) => setTimeout(r, 200));
    w.stop();
    expect(w.counter).toEqual(['3274', '2717']);
  });
  it('английский интерфейс: чипы места в панели — «p. 3295» (язык интерфейса, не русский), без разделителя тысяч', async () => {
    render(createElement(I18nProvider, { lang: 'en', children: mount({ kind: 'page', page: 3274, quote: Q1 }, { marks: [{ kind: 'page', page: 3295, quote: Q3 }, { kind: 'page', page: 19 }] }) }));
    await screen.findByTestId('pdf-marks');
    expect(screen.getByTestId('pdf-marks').textContent).toBe('p. 19p. 3274p. 3295');
    expect(document.body.textContent).not.toMatch(/стр/);
  });
  it('подписи чипов места в панели — «стр. 3295», без разделителя тысяч (как на чипах в ответе)', async () => {
    render(mount({ kind: 'page', page: 3274, quote: Q1 }, { marks: [{ kind: 'page', page: 3295, quote: Q3 }] }));
    await screen.findByTestId('pdf-marks');
    expect(screen.getByTestId('pdf-marks').textContent).toBe('стр. 3274стр. 3295');
  });
});

describe('окно не «уезжает» после посадки', () => {
  it('страницы выше цели доузнали настоящий размер (выше, чем у первой) — цель остаётся на экране там же', async () => {
    pdf.h = (n) => (n >= 3260 && n < 3274 ? 1000 : 800);
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const sc = screen.getByTestId('pdf-scroll') as HTMLElement;
    const at = () => { const p = document.querySelector<HTMLElement>('[data-testid=pdf-page][data-page="3274"]')!; return { top: parseFloat(p.style.top), screen: parseFloat(p.style.top) - sc.scrollTop }; };
    await new Promise((r) => setTimeout(r, 100));
    const a = at();
    await new Promise((r) => setTimeout(r, 800));
    const b = at();
    expect(b.top).toBeGreaterThan(a.top - 1);
    expect(Math.abs(b.screen - a.screen)).toBeLessThan(1);
  });
  it('ширина колонки сменилась (панель потянули / меню свернулось) — окно остаётся на той же странице и доле страницы', async () => {
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const sc = screen.getByTestId('pdf-scroll') as HTMLElement;
    const el = () => document.querySelector<HTMLElement>('[data-testid=pdf-page][data-page="3274"]')!;
    const w0 = parseFloat(el().style.width), off0 = sc.scrollTop - parseFloat(el().style.top);
    fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    await waitFor(() => expect(parseFloat(el().style.width)).toBeGreaterThan(w0));
    const w1 = parseFloat(el().style.width), off1 = sc.scrollTop - parseFloat(el().style.top);
    expect(input()!.value).toBe('3274');
    expect(Math.abs(off1 - (off0 * w1) / w0)).toBeLessThan(2);
  });
});

describe('номер страницы и стрелки', () => {
  it('номер печатают — переход по Enter (а не на каждую цифру: 3, 32, 327 …)', async () => {
    render(mount({ kind: 'page', page: 1 }));
    await waitFor(() => expect(input()).toBeTruthy(), { timeout: 4000 });
    const w = watch();
    for (const v of ['3', '32', '327', '3274']) fireEvent.change(input()!, { target: { value: v } });
    expect(input()!.value).toBe('3274');
    expect(w.pages.has(32) || w.pages.has(327)).toBe(false);
    fireEvent.keyDown(input()!, { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('[data-testid=pdf-page][data-page="3274"]')).toBeTruthy());
    w.stop();
    expect(w.counter.filter((c) => !['1', '3', '32', '327', '3274'].includes(c))).toEqual([]);
    expect(w.counter[w.counter.length - 1]).toBe('3274');
    expect(screen.queryByTestId('pdf-hl')).toBeNull();
  });
  it('стрелки — на соседнюю страницу, счётчик сразу', async () => {
    render(mount({ kind: 'page', page: 40 }));
    await waitFor(() => expect(input()?.value).toBe('40'), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('pdf-next'));
    expect(input()!.value).toBe('41');
    fireEvent.click(screen.getByTestId('pdf-prev')); fireEvent.click(screen.getByTestId('pdf-prev'));
    expect(input()!.value).toBe('39');
  });
});

describe('повторное открытие — из кэша', () => {
  it('закрыли и открыли тот же файл: ни загрузки, ни разбора; вид собирается сразу', async () => {
    const a = render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    a.unmount();
    expect(pdf.docs).toBe(1);
    const t0 = performance.now();
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    expect(pdf.docs).toBe(1);
    expect(fetches).toBe(0);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it('первое открытие скрывает страницы, пока целевая не нарисована; «Открываю файл…» — отдельное состояние, не колонка пустых страниц', async () => {
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    expect(screen.getByTestId('pdf-loading')).toBeTruthy();
    expect(pageEls().length).toBe(0);
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId('pdf-view').hasAttribute('data-hold')).toBe(false));
  });
});

describe('ширина панели меняется', () => {
  it('страница остаётся по ширине панели при любой ширине (полный экран, свёрнутое меню): не шире панели и не шире FIT_MAX; масштаб человека — множитель поверх', async () => {
    const ros: { cb: () => void }[] = [];
    vi.stubGlobal('ResizeObserver', class { cb: () => void; constructor(cb: () => void) { this.cb = cb; ros.push(this); } observe() {} disconnect() {} });
    render(mount({ kind: 'page', page: 3274, quote: Q1 }));
    await waitFor(() => expect(strong().length).toBe(1), { timeout: 4000 });
    const pageW = () => parseFloat(document.querySelector<HTMLElement>('[data-testid=pdf-page][data-page="3274"]')!.style.width);
    expect(pageW()).toBeLessThanOrEqual(640 - 24);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? 1900 : 0; } });
    act(() => { ros.forEach((r) => r.cb()); });
    await waitFor(() => expect(pageW()).toBe(1040), { timeout: 2000 });
    expect(Number(screen.getByTestId('pdf-view').dataset.zoom)).toBe(1);
    expect(input()!.value).toBe('3274');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? 420 : 0; } });
    act(() => { ros.forEach((r) => r.cb()); });
    await waitFor(() => expect(pageW()).toBe(420 - 24), { timeout: 2000 });
    fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    await waitFor(() => expect(pageW()).toBe(Math.round((420 - 24) * 1.2)));
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return /fv-pages|fv-pdf/.test(this.className) ? 700 : 0; } });
    act(() => { ros.forEach((r) => r.cb()); });
    await waitFor(() => expect(pageW()).toBe(Math.round((700 - 24) * 1.2)), { timeout: 2000 });
    expect(Number(screen.getByTestId('pdf-view').dataset.zoom)).toBeCloseTo(1.2, 5);
  });
});
