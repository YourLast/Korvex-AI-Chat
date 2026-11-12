import { describe, expect, it } from 'vitest';
import { clamp, dismissLook, doubleTap, fit, fitView, glide, maxScale, morph, pageStep, range, rubberClamp, rubberScale, shouldDismiss, thumbRect, trackOffset, velocity, visibleEnough, zoomAt } from '@/lib/viewer';

describe('просмотрщик: геометрия', () => {
  it('вписывание: широкая и высокая картинки по центру, маленькая — не больше ×2', () => {
    expect(fit(1600, 1000, 390, 844)).toEqual({ x: 0, y: (844 - 243.75) / 2, w: 390, h: 243.75 });
    const tall = fit(900, 1300, 390, 844);
    expect(tall.h).toBeCloseTo(563.3, 1); expect(tall.w).toBe(390);
    const small = fit(100, 50, 1440, 900, { x: 72, y: 64 });
    expect(small.w).toBe(200); expect(small.x).toBe(620);
  });
  it('масштаб вокруг точки: точка под пальцем остаётся на месте', () => {
    const v = { x: 0, y: 300, s: 1 };
    const z = zoomAt(v, 2, 100, 400);
    expect((100 - v.x) / v.s).toBeCloseTo((100 - z.x) / z.s);
    expect((400 - v.y) / v.s).toBeCloseTo((400 - z.y) / z.s);
  });
  it('границы: меньше сцены — по центру, больше — края не отходят внутрь; резина за краем', () => {
    expect(range(200, 390)).toEqual([95, 95]);
    expect(range(780, 390)).toEqual([-390, 0]);
    const f = fit(1600, 1000, 390, 844);
    const c = clamp({ x: 50, y: 0, s: 2 }, f, 390, 844);
    expect(c.x).toBe(0); expect(c.y).toBeCloseTo((844 - f.h * 2) / 2);
    const r = rubberClamp({ x: 100, y: c.y, s: 2 }, f, 390, 844);
    expect(r.x).toBeGreaterThan(0); expect(r.x).toBeLessThan(100);
  });
  it('щипок: резина за пределами, наибольший масштаб — от размера картинки', () => {
    const f = fit(1600, 1000, 390, 844);
    expect(maxScale(1600, f)).toBeCloseTo(8);
    expect(maxScale(400, fit(400, 300, 390, 844))).toBe(4);
    expect(rubberScale(0.6, 4)).toBeGreaterThan(0.6); expect(rubberScale(0.6, 4)).toBeLessThan(1);
    expect(rubberScale(6, 4)).toBeLessThan(6); expect(rubberScale(2, 4)).toBe(2);
  });
  it('двойной тап: ×2 вокруг точки в границах, повторный — обратно к вписанной', () => {
    const f = fit(1600, 1000, 390, 844);
    const z = doubleTap(fitView(f), f, 390, 844, 300, 422);
    expect(z.s).toBe(2);
    expect(z.x).toBeLessThanOrEqual(0); expect(z.x).toBeGreaterThanOrEqual(390 - f.w * 2);
    expect(doubleTap(z, f, 390, 844, 10, 10)).toEqual(fitView(f));
  });
  it('смахивание вниз: далеко или быстро — закрыть; фон светлеет по ходу', () => {
    expect(shouldDismiss(60, 844, 0)).toBe(false);
    expect(shouldDismiss(120, 844, 0)).toBe(true);
    expect(shouldDismiss(40, 844, 0.8)).toBe(true);
    expect(shouldDismiss(200, 844, -0.8)).toBe(false);
    const a = dismissLook(0, 844), b = dismissLook(200, 844);
    expect(a).toEqual({ bg: 1, s: 1 }); expect(b.bg).toBeLessThan(1); expect(b.s).toBeLessThan(1);
  });
  it('листание: дальше пятой части или быстро; на краях — нет и резина', () => {
    expect(pageStep(-100, 390, 0, true, true)).toBe(1);
    expect(pageStep(100, 390, 0, true, true)).toBe(-1);
    expect(pageStep(-40, 390, -0.6, true, true)).toBe(1);
    expect(pageStep(-40, 390, 0, true, true)).toBe(0);
    expect(pageStep(-200, 390, 0, true, false)).toBe(0);
    expect(trackOffset(-200, 390, true, false)).toBeGreaterThan(-200);
    expect(trackOffset(-200, 390, true, true)).toBe(-200);
  });
  it('миниатюра contain и cover: рамка картинки и видимая часть; переход начинается в ней и кончается вписанной', () => {
    const box = { x: 10, y: 100, w: 320, h: 240 };
    const c = thumbRect(box, 1600, 1000, 'contain');
    expect(c.img).toEqual({ x: 10, y: 120, w: 320, h: 200 }); expect(c.clip).toEqual(c.img);
    const cv = thumbRect(box, 1600, 1000, 'cover');
    expect(cv.img.h).toBe(240); expect(cv.img.w).toBe(384); expect(cv.clip).toEqual(box);
    const f = fit(1600, 1000, 390, 844);
    const m0 = morph(f, cv, 0, 20), m1 = morph(f, cv, 1, 20);
    expect(m0.v.x).toBeCloseTo(cv.img.x); expect(m0.v.s).toBeCloseTo(384 / 390);
    expect(m0.inset[1]).toBeGreaterThan(0); expect(m0.inset[0]).toBeCloseTo(0);
    expect(m1.v).toEqual({ x: f.x, y: f.y, s: 1 }); expect(m1.inset).toEqual([0, 0, 0, 0]); expect(m1.r).toBe(0);
  });
  it('видимость миниатюры, скорость, инерция', () => {
    expect(visibleEnough({ x: 0, y: -500, w: 300, h: 200 }, 390, 844)).toBe(false);
    expect(visibleEnough({ x: 0, y: 100, w: 300, h: 200 }, 390, 844)).toBe(true);
    expect(velocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: 50, y: 25 }], 60)).toEqual({ vx: 1, vy: 0.5 });
    const f = fit(1600, 1000, 390, 844);
    const g = glide({ x: -100, y: 0, s: 3 }, -10, 0, f, 390, 844);
    expect(g.x).toBe(390 - f.w * 3);
  });
});
