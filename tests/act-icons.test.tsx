// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ActIcon } from '@/components/ActIcon';
import { ICON_IDS, ICONS, errBadge, iconFrame, iconState, isActIcon, strokeUnits } from '@/lib/actIcons';
import { KIND_ICON, toolIcon, type WKind } from '@/lib/work';
import { parsePath, taper } from '@/lib/morph';
import { animate, tickerReset, tickerState } from '@/lib/ticker';

describe('набор значков', () => {
  it('у каждого вида шага — значок из нашего набора (ни одной «искры»-заглушки, ни спрайта)', () => {
    const kinds: WKind[] = ['bash', 'python', 'web', 'memory', 'table', 'browser', 'chat', 'usermem', 'file', 'github', 'code', 'agent', 'work', 'steer', 'other'];
    for (const k of kinds) expect(isActIcon(KIND_ICON[k]), k).toBe(true);
    expect(new Set(Object.values(KIND_ICON)).size).toBeGreaterThanOrEqual(13);
    for (const tool of ['code_run', 'code_read', 'code_search', 'code_commit', 'code_edit', 'browser_click', 'browser_type', 'browser_snapshot', 'browser_screenshot', 'files_get'])
      expect(isActIcon(toolIcon(tool)), tool).toBe(true);
    expect(toolIcon('web_search')).toBeUndefined();
    expect(toolIcon('browser_open')).toBeUndefined();
    expect(ICON_IDS).toEqual(expect.arrayContaining(['terminal', 'code', 'globe', 'search', 'browser', 'cursor', 'doc', 'table', 'chat', 'memory', 'branch', 'agents', 'edit', 'steer', 'work', 'tool', 'image', 'retry']));
  });
  it('покой (amt = 0) от времени не зависит; петля (amt = 1) меняет кадры; число элементов постоянно; координаты в пределах коробки, без NaN', () => {
    for (const n of ICON_IDS) {
      const still = JSON.stringify(iconFrame(n, 0, 0));
      for (const t of [0.37, 1.9, 13.3]) expect(JSON.stringify(iconFrame(n, t, 0)), n).toBe(still);
      const len = iconFrame(n, 0, 0).length;
      const live = new Set<string>();
      for (let t = 0; t < 3; t += 0.13) {
        const f = iconFrame(n, t, 1);
        expect(f.length, n).toBe(len);
        live.add(JSON.stringify(f));
        for (const e of f) {
          expect(e.d, n).not.toMatch(/NaN|Infinity|undefined/);
          if (e.o !== undefined) { expect(e.o).toBeGreaterThanOrEqual(-1e-9); expect(e.o).toBeLessThanOrEqual(1 + 1e-9); }
          if (!/[aA]/.test(e.d)) for (const sp of parsePath(e.d)) for (const [x, y] of sp.pts) { expect(x, n).toBeGreaterThan(-2); expect(x, n).toBeLessThan(26); expect(y, n).toBeGreaterThan(-3); expect(y, n).toBeLessThan(26); }
        }
      }
      expect(live.size, `${n}: петля должна двигаться`).toBeGreaterThan(5);
    }
  });
  it('заострённый штрих: к концам сходится в точку, посередине — полная ширина; тупой конец — полукругом', () => {
    const w = 2, poly = taper([[0, 0], [10, 0]], w, 3, 3);
    const ys = poly.map((p) => Math.abs(p[1]));
    expect(Math.max(...ys)).toBeCloseTo(w / 2, 5);
    const near = (x: number) => Math.max(...poly.filter((p) => Math.abs(p[0] - x) < 0.2).map((p) => Math.abs(p[1])));
    expect(near(0)).toBeLessThan(0.05); expect(near(10)).toBeLessThan(0.05); expect(near(5)).toBeCloseTo(1, 5);
    const blunt = taper([[0, 0], [10, 0]], w, 0, 3);
    expect(Math.min(...blunt.map((p) => p[0]))).toBeLessThan(-0.9);
    expect(strokeUnits(16)).toBeCloseTo(2.25, 5); expect(strokeUnits(48)).toBeCloseTo(0.75, 5);
  });
  it('поза ошибки: вырез растёт, «!» прорисовывается, точка появляется последней', () => {
    const w = strokeUnits(16);
    expect(errBadge(0, w).cut).toBe(0);
    expect(errBadge(1, w).cut).toBeGreaterThan(5);
    expect(errBadge(0.3, w).dotR).toBe(0);
    expect(errBadge(1, w).dotR).toBe(1);
    expect(errBadge(0.1, w).spike).toBe('M0 0Z');
    expect(errBadge(1, w).spike).not.toBe(errBadge(0.5, w).spike);
  });
  it('статус шага -> поза: run петля; err ошибка (если повтор получился — покой); timeout — warn; отменено/остановлено — off', () => {
    expect(iconState('run')).toBe('run');
    expect(iconState('err')).toBe('err'); expect(iconState('err', true)).toBe('ok');
    expect(iconState('timeout')).toBe('warn');
    expect(iconState('denied')).toBe('off'); expect(iconState('stopped')).toBe('off');
    expect(iconState('wait')).toBe('wait'); expect(iconState('ok')).toBe('ok');
  });
});

describe('ActIcon: разметка', () => {
  it('сервер: поза покоя, класс семьи значков (i i--sm), data-ai/data-st; ошибка — сразу с вырезом и «!»; незнакомый id — значок спрайта', () => {
    const ok = renderToStaticMarkup(createElement(ActIcon, { n: 'terminal', state: 'ok' }));
    expect(ok).toMatch(/^<svg class="i i--sm ai" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-ai="terminal" data-st="ok">/);
    expect(ok).not.toMatch(/[^-]mask="url\(/);
    const err = renderToStaticMarkup(createElement(ActIcon, { n: 'globe', state: 'err' }));
    expect(err).toMatch(/<g class="ai-g" data-mask="url\(#aim[^"]+\)" mask="url\(#aim[^"]+\)">/);
    expect(err).toMatch(/<circle class="ai-cut" cx="18.6" cy="17.6" r="5.40"/);
    expect(err).not.toMatch(/class="ai-x" d="M0 0Z"/);
    expect(renderToStaticMarkup(createElement(ActIcon, { n: 'eye' }))).toContain('href="#i-eye"');
    const n = (ok.match(/class="ai-e"/g) ?? []).length;
    expect(n).toBe(iconFrame('terminal', 0, 0).length);
  });
});

describe('ActIcon и общий двигатель кадров', () => {
  let clock = 0, q: Map<number, FrameRequestCallback>, nextId = 1, requests = 0;
  const flush = (ms: number) => { clock += ms; const run = [...q.values()]; q.clear(); run.forEach((cb) => cb(clock)); };
  const frames = (n: number) => { for (let i = 0; i < n; i++) flush(16); };
  beforeEach(() => {
    tickerReset();
    clock = 1000; q = new Map(); nextId = 1; requests = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; requests++; q.set(id, cb); return id; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { q.delete(id); });
    document.documentElement.className = '';
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); tickerReset(); document.documentElement.className = ''; });
  const els = (c: HTMLElement) => [...c.querySelectorAll('.ai-e')].map((e) => `${e.getAttribute('d')}|${e.getAttribute('opacity')}|${e.getAttribute('transform')}`).join('#');

  it('покой: ни одного кадра; run: кадры идут, значок движется; ok: петля затухает ровно в позу покоя и кадры прекращаются', () => {
    const { container, rerender } = render(createElement(ActIcon, { n: 'doc', state: 'ok' }));
    const rest = els(container);
    expect(q.size).toBe(0);
    rerender(createElement(ActIcon, { n: 'doc', state: 'run' }));
    expect(q.size).toBe(1);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { flush(16); seen.add(els(container)); }
    expect(seen.size).toBeGreaterThan(30);
    rerender(createElement(ActIcon, { n: 'doc', state: 'ok' }));
    frames(150);
    expect(q.size).toBe(0);
    expect(els(container)).toBe(rest);
  });
  it('ошибка: петля гаснет, вырез и «!» прорисовываются за ~0,34 с (маска включается), потом кадров нет', () => {
    const { container, rerender } = render(createElement(ActIcon, { n: 'terminal', state: 'run' }));
    frames(20);
    rerender(createElement(ActIcon, { n: 'terminal', state: 'err' }));
    const g = container.querySelector('.ai-g')!, cut = container.querySelector('.ai-cut')!;
    flush(16);
    expect(g.getAttribute('mask')).toMatch(/^url\(#aim/);
    const r1 = Number(cut.getAttribute('r'));
    frames(10);
    expect(Number(cut.getAttribute('r'))).toBeGreaterThan(r1);
    frames(120);
    expect(q.size).toBe(0);
    expect(Number(cut.getAttribute('r'))).toBeCloseTo(5.4, 1);
    expect(container.querySelector('svg')!.dataset.st).toBe('err');
    rerender(createElement(ActIcon, { n: 'terminal', state: 'ok' }));
    frames(40);
    expect(g.hasAttribute('mask')).toBe(false);
    expect(q.size).toBe(0);
  });
  it('один rAF на всю страницу: десять живых значков — одна заявка на кадр', () => {
    render(createElement('div', null, ...ICON_IDS.slice(0, 10).map((n) => createElement(ActIcon, { key: n, n, state: 'run' }))));
    expect(q.size).toBe(1);
    requests = 0;
    frames(10);
    expect(requests).toBe(10);
    expect(tickerState().active).toBe(10);
  });
  it('тишина: пока виден бар «работает» (html.wbar-shown), значки ленты (quiet) встают в покой; бар спрятался — снова живые', async () => {
    const { container } = render(createElement(ActIcon, { n: 'code', state: 'run', quiet: true }));
    frames(40);
    document.documentElement.classList.add('wbar-shown');
    await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    frames(150);
    expect(q.size).toBe(0);
    const rest = els(container);
    document.documentElement.classList.remove('wbar-shown');
    await new Promise((r) => setTimeout(r, 0));
    expect(q.size).toBe(1);
    frames(30);
    expect(els(container)).not.toBe(rest);
  });
  it('вкладка скрыта — кадров нет; видна — продолжает', () => {
    const hide = (v: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
    render(createElement(ActIcon, { n: 'globe', state: 'run' }));
    flush(16); expect(q.size).toBe(1);
    hide(true); expect(q.size).toBe(0);
    hide(false); expect(q.size).toBe(1);
  });
  it('prefers-reduced-motion: петли нет — run стоит в позе покоя без кадров; ошибка — сразу целиком', () => {
    vi.stubGlobal('matchMedia', (m: string) => ({ matches: /reduce/.test(m), media: m }));
    const { container, rerender } = render(createElement(ActIcon, { n: 'chat', state: 'ok' }));
    const rest = els(container);
    rerender(createElement(ActIcon, { n: 'chat', state: 'run' }));
    expect(q.size).toBe(0);
    expect(els(container)).toBe(rest);
    rerender(createElement(ActIcon, { n: 'chat', state: 'err' }));
    expect(q.size).toBe(0);
    expect(Number(container.querySelector('.ai-cut')!.getAttribute('r'))).toBeCloseTo(5.4, 1);
  });
  it('unmount живого значка снимает кадры; подписчик без кадров ничего не заводит', () => {
    const { unmount } = render(createElement(ActIcon, { n: 'branch', state: 'run' }));
    flush(16); expect(q.size).toBe(1);
    unmount();
    expect(q.size).toBe(0);
    expect(tickerState()).toEqual({ active: 0, raf: false });
    const a = animate(() => false);
    a.kick(); expect(q.size).toBe(1); flush(16); expect(q.size).toBe(0); expect(a.on).toBe(false);
  });
  it('у каждого значка петля на живом svg работает (кадры меняют разметку) и затухает в покой', () => {
    for (const n of Object.keys(ICONS)) {
      const { container, rerender, unmount } = render(createElement(ActIcon, { n, state: 'ok' }));
      const rest = els(container);
      rerender(createElement(ActIcon, { n, state: 'run' }));
      const seen = new Set<string>();
      for (let i = 0; i < 90; i++) { flush(16); seen.add(els(container)); }
      expect(seen.size, n).toBeGreaterThan(10);
      rerender(createElement(ActIcon, { n, state: 'ok' }));
      frames(160);
      expect(els(container), n).toBe(rest);
      unmount();
    }
  });
});
