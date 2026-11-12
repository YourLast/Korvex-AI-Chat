// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { HeadMark } from '@/components/HeadMark';
import { MARK_SMALL, MARK_VIEWBOX } from '@/lib/thinkMark';
import { tickerReset } from '@/lib/ticker';

describe('HeadMark: живая искра', () => {
  let clock = 0, q: Map<number, FrameRequestCallback>, nextId = 1;
  const flush = (ms: number) => { clock += ms; const run = [...q.values()]; q.clear(); run.forEach((cb) => cb(clock)); };
  beforeEach(() => {
    tickerReset();
    clock = 1000; q = new Map(); nextId = 1;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; q.set(id, cb); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { q.delete(id); });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); tickerReset(); });

  it('не live: кадров нет, путь статичный; live: кадры идут и путь меняется; live снят без позы — доезжает до статичного знака; viewBox всё время наш', () => {
    const { container, rerender } = render(createElement(HeadMark, { live: false }));
    const svg = container.querySelector('svg')!, path = svg.querySelector('.hm-g')!;
    expect(q.size).toBe(0);
    expect(path.getAttribute('d')).toBe(MARK_SMALL);
    expect(svg.dataset.phase).toBe('rest');
    rerender(createElement(HeadMark, { live: true }));
    expect(q.size).toBe(1);
    expect(svg.dataset.phase).toBe('think');
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) { flush(16); seen.add(path.getAttribute('d')!); }
    expect(seen.size).toBeGreaterThan(10);
    expect(svg.getAttribute('viewBox')).toBe(MARK_VIEWBOX);
    expect(svg.classList.contains('is-live')).toBe(true);
    rerender(createElement(HeadMark, { live: false }));
    for (let i = 0; i < 120 && q.size; i++) flush(16);
    expect(q.size).toBe(0);
    expect(path.getAttribute('d')).toBe(MARK_SMALL);
    expect(svg.classList.contains('is-live')).toBe(false);
    expect(svg.getAttribute('viewBox')).toBe(MARK_VIEWBOX);
  });
  it('первый кадр после включения — ещё почти неподвижный знак (разгон ~0,6 с, без прыжка)', () => {
    const { container } = render(createElement(HeadMark, { live: true }));
    const g = container.querySelector('.hm-g')!;
    flush(16);
    const k = Number(/scale\(([\d.]+)\)/.exec(g.getAttribute('transform') ?? '')?.[1] ?? 1);
    expect(k).toBeGreaterThan(0.97);
  });
  it('calm (идёт шаг, его значок живой): искра двигается тише, чем при «думает»', () => {
    const spread = (calm: boolean) => {
      const { container, unmount } = render(createElement(HeadMark, { live: true, calm }));
      const g = container.querySelector('.hm-g')!;
      for (let i = 0; i < 80; i++) flush(16);
      let lo = 9, hi = 0;
      for (let i = 0; i < 200; i++) { flush(16); const k = Number(/scale\(([\d.]+)\)/.exec(g.getAttribute('transform') ?? '')?.[1] ?? 1); lo = Math.min(lo, k); hi = Math.max(hi, k); }
      unmount();
      return 1 - lo;
    };
    expect(spread(true)).toBeLessThan(spread(false) * 0.6);
  });
  it('unmount на живом знаке гасит кадры', () => {
    const { unmount } = render(createElement(HeadMark, { live: true }));
    flush(16); expect(q.size).toBe(1);
    unmount(); expect(q.size).toBe(0);
  });
});
