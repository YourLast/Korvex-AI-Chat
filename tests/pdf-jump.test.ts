import { describe, expect, it } from 'vitest';
import { anchorAt, buildLayout, GAP, PAD, pageAt, planJump, revealAt, SEARCH_MS, windowOf, yOfAnchor, type PlanDoc } from '@/components/fileview/pdfJump';

const EST: [number, number] = [600, 800];
const U = { transform: (a: number[], b: number[]) => [a[0] * b[0], 0, 0, a[3] * b[3], b[4] * a[0], a[5] + b[5] * a[3]] };

describe('раскладка колонки', () => {
  it('верх каждой страницы = отступ + высоты и зазоры предыдущих; полная высота известна', () => {
    const L = buildLayout(4, 600, {}, EST);
    expect(L.tops.slice(1)).toEqual([PAD, PAD + 800 + GAP, PAD + 2 * (800 + GAP), PAD + 3 * (800 + GAP)]);
    expect(L.total).toBe(PAD + 4 * 800 + 3 * GAP + PAD);
  });
  it('известный размер страницы учитывается, неизвестные — как у первой', () => {
    const L = buildLayout(3, 600, { 2: [600, 400] }, EST);
    expect(L.hs.slice(1)).toEqual([800, 400, 800]);
    expect(L.tops[3]).toBe(PAD + 800 + GAP + 400 + GAP);
  });
  it('pageAt — страница, на которую приходится вертикаль (двоичный поиск на 3801 странице)', () => {
    const L = buildLayout(3801, 600, {}, EST);
    expect(pageAt(L, 0)).toBe(1);
    expect(pageAt(L, L.tops[3274])).toBe(3274);
    expect(pageAt(L, L.tops[3274] + 799)).toBe(3274);
    expect(pageAt(L, L.tops[3275] - 1)).toBe(3274);
    expect(pageAt(L, 1e9)).toBe(3801);
  });
  it('windowOf — только видимые страницы и запас: на 3801 страницах в DOM единицы, а не тысячи', () => {
    const L = buildLayout(3801, 600, {}, EST);
    const [a, b] = windowOf(L, L.tops[3274] - PAD, 600, 600);
    expect(a).toBeGreaterThanOrEqual(3272);
    expect(b).toBeLessThanOrEqual(3277);
    expect(a).toBeLessThanOrEqual(3274);
    expect(b).toBeGreaterThanOrEqual(3274);
    expect(b - a).toBeLessThan(8);
  });
});

describe('якорь окна: ничего не «уезжает» после посадки', () => {
  it('страницы выше цели доузнали размер — окно возвращается на то же место цели', () => {
    const L0 = buildLayout(3801, 600, {}, EST);
    const y0 = L0.tops[3274] + 123;
    const a = anchorAt(L0, y0, 300, 600, 624);
    expect(a.page).toBe(3274);
    const L1 = buildLayout(3801, 600, { 3270: [600, 1200] }, EST);
    expect(L1.tops[3274] - L0.tops[3274]).toBe(400);
    expect(yOfAnchor(L1, a, 600)).toBe(y0 + 400);
  });
  it('ширина сменилась (масштаб, размер панели) — смещение пересчитывается пропорционально', () => {
    const L0 = buildLayout(100, 600, {}, EST);
    const a = anchorAt(L0, L0.tops[40] + 200, 300, 600, 624);
    const L1 = buildLayout(100, 900, {}, EST);
    expect(yOfAnchor(L1, a, 900)).toBeCloseTo(L1.tops[40] + 300, 5);
  });
  it('якорь выше верха страницы (подсвеченная строка у самого верха) — смещение отрицательное и тоже держится', () => {
    const L0 = buildLayout(10, 600, {}, EST);
    const a = anchorAt(L0, L0.tops[5] - PAD, 300, 600, 624);
    expect(a.page).toBe(4);
    expect(yOfAnchor(buildLayout(10, 600, { 2: [600, 1000] }, EST), a, 600)).toBe(L0.tops[5] - PAD + 200);
  });
});

describe('revealAt: строка цитаты — на верхнюю четверть окна', () => {
  it('вертикаль: верх строки минус четверть окна (не больше 160); по горизонтали: помещается — по центру, шире окна — к левому краю строк', () => {
    const L = buildLayout(5, 600, {}, EST);
    const r1 = revealAt(L, 3, [{ l: 50, t: 400, w: 200, h: 14 }], 1, 640, 560);
    expect(r1.y).toBeCloseTo(L.tops[3] + 400 - 156.8, 5);
    expect(r1.x).toBe(Math.max(0, PAD + 50 + 100 - 320));
    const wide = revealAt(L, 3, [{ l: 50, t: 400, w: 900, h: 14 }], 1, 640, 560);
    expect(wide.x).toBe(PAD + 50 - 12);
    const scaled = revealAt(L, 3, [{ l: 50, t: 400, w: 200, h: 14 }], 2, 640, 560);
    expect(scaled.y).toBeCloseTo(L.tops[3] + 800 - 156.8, 5);
    expect(revealAt(L, 3, [{ l: 300, t: 400, w: 280, h: 14 }], 1, 640, 560, 640).x).toBe(0);
  });
});

function fakeDoc(n: number, text: Record<number, { str: string; y: number; w?: number }[]>, opt: { pageW?: number; fs?: number; slow?: number } = {}): PlanDoc & { calls: number[] } {
  const calls: number[] = [];
  const pageW = opt.pageW ?? 600, fs = opt.fs ?? 12;
  return {
    calls,
    doc: { numPages: n, getPage: async (p: number) => { calls.push(p); return { getViewport: ({ scale }: { scale: number }) => ({ width: pageW * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }) }; } },
    lib: { Util: U } as never,
    sizes: {},
    text: async (p: number) => (text[p] ?? []).map((t) => ({ str: t.str, transform: [fs, 0, 0, fs, 50, t.y], width: t.w ?? 300, height: fs })),
  };
}
const Q = 'За просрочку оплаты Заказчик уплачивает штраф в размере 0,5% от неоплаченной суммы';

describe('planJump: страница, строка и масштаб считаются по тексту, без отрисовки', () => {
  it('цитата на указанной странице: страница = указанная, прямоугольник строки; масштаб план не трогает (страница по ширине панели)', async () => {
    const d = fakeDoc(3801, { 3274: [{ str: Q, y: 300 }] });
    const p = await planJump(d, { page: 3274, quote: Q }, { boxW: 600 });
    expect(p.page).toBe(3274);
    expect(p.found).toBe(true);
    expect(p.rects.length).toBe(1);
    expect(p).not.toHaveProperty('zoom');
    expect(p.rects[0].l + p.rects[0].w).toBeLessThanOrEqual(600);
    expect(d.sizes[3274]).toEqual([600, 800]);
    expect(d.calls.every((c) => c === 3274)).toBe(true);
  });
  it('цитаты нет на указанной странице — найдена на соседней: переход на ту, где нашлась', async () => {
    const d = fakeDoc(3801, { 3276: [{ str: Q, y: 200 }] });
    const p = await planJump(d, { page: 3274, quote: Q }, { boxW: 600 });
    expect(p.page).toBe(3276);
    expect(p.found).toBe(true);
  });
  it('нигде нет — остаётся на указанной странице без подсветки, поиск ограничен по времени', async () => {
    let t = 0;
    const d = fakeDoc(3801, {});
    const p = await planJump(d, { page: 500, quote: Q }, { boxW: 600, now: () => { t += 400; return t; } });
    expect(p).toMatchObject({ page: 500, found: false });
    expect(p.rects).toEqual([]);
    expect(d.calls.length).toBeLessThan(10);
    expect(SEARCH_MS).toBeLessThanOrEqual(2000);
  });
  it('без цитаты — на верх страницы; страница за пределами документа ограничивается', async () => {
    const d = fakeDoc(12, {});
    expect(await planJump(d, { page: 7 }, { boxW: 600 })).toMatchObject({ page: 7, found: false, rects: [] });
    expect((await planJump(d, { page: 99 }, { boxW: 600 })).page).toBe(12);
    expect((await planJump(d, { page: null }, { boxW: 600 })).page).toBe(1);
  });
  it('страницы нет (документ из DOCX: место — строка) — цитата ищется по документу', async () => {
    const d = fakeDoc(30, { 9: [{ str: Q, y: 100 }] });
    const p = await planJump(d, { page: null, quote: Q }, { boxW: 600 });
    expect(p.page).toBe(9);
  });
});
