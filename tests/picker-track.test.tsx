// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { TrackPanel } from '@/components/PickerTrack';
import { ShellCtx } from '@/components/Shell';
import { LEVEL_CONTROL, PICKER_VARIANT, levelControl } from '@/lib/pickerVariant';
import type { PublicModel } from '@/lib/models';
import type { LockedModel } from '@/lib/locked';

const L = (ids: string[]) => ids.map((id) => ({ id, label: id, hint: `h-${id}` }));
const alpha = { id: 'alpha', name: 'Alpha', fullName: 'Alpha', blurb: 'Файлы и расчёты', defaultLevel: 'medium', levels: L(['off', 'low', 'medium', 'xhigh', 'max']) } as unknown as PublicModel;
const gamma = { id: 'gamma', name: 'Gamma', fullName: 'Gamma Korvex', blurb: 'Сложные задачи и код', defaultLevel: 'medium', levels: L(['off', 'low', 'medium', 'high', 'xhigh', 'max']) } as unknown as PublicModel;
const delta = { id: 'delta', name: 'Delta', fullName: 'Delta Korvex', blurb: 'Самые сложные задачи', defaultLevel: 'medium', levels: L(['low', 'medium', 'high', 'xhigh', 'max']) } as unknown as PublicModel;
const PAIR = { a: { modelId: 'alpha', levelId: 'xhigh' }, b: { modelId: 'gamma', levelId: 'high' } };

function mount(over: Record<string, unknown> = {}, locked: LockedModel[] = []) {
  const h = { onModel: vi.fn(), onLevel: vi.fn(), onCompare: vi.fn(), onTab: vi.fn(), onPairModel: vi.fn() };
  const props = { models: [alpha, gamma, delta], compare: false, sel: { modelId: 'alpha', levelId: 'medium' }, ...h, ...over };
  const wrap = (c: ReactNode) => createElement(ShellCtx.Provider, { value: { models: [], refresh: async () => {}, openDrawer() {}, threads: [], role: 'user', locked } }, c);
  const r = render(wrap(createElement(TrackPanel, props as never)));
  return { ...r, h, q: (s: string) => r.container.querySelector<HTMLElement>(s), qa: (s: string) => [...r.container.querySelectorAll<HTMLElement>(s)] };
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('вид меню', () => {
  it('по умолчанию — вид c с пилюлей и искрой мощности; откат одной строкой (PICKER_VARIANT = 0) возвращает и прежнюю строку пилюль', () => {
    expect(PICKER_VARIANT).toBe('c');
    expect(LEVEL_CONTROL).toBe('p2b');
    expect(levelControl('c')).toBe('p2b');
    expect(levelControl(0)).toBe('pill');
  });
});

describe('модель и уровень', () => {
  it('дорожка моделей: выбранная отмечена, другая — onModel; выбранная ещё раз — без вызова', () => {
    const { h, q } = mount();
    expect(q('[data-testid=model-alpha]')!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(q('[data-testid=model-gamma]')!);
    expect(h.onModel).toHaveBeenLastCalledWith('gamma');
    fireEvent.click(q('[data-testid=model-alpha]')!);
    expect(h.onModel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(q('[data-testid=model-alpha]')!, { key: 'ArrowRight' });
    expect(h.onModel).toHaveBeenLastCalledWith('gamma');
  });
  it('уровень — role=slider: значение и «уровень — подсказка», клавиатура меняет уровень', () => {
    const { h, q } = mount();
    const sl = q('[role=slider][data-testid=levels-alpha]')!;
    expect(sl.getAttribute('aria-valuetext')).toBe('medium — h-medium');
    expect(sl.getAttribute('aria-valuemax')).toBe('4');
    fireEvent.keyDown(sl, { key: 'ArrowRight' });
    expect(h.onLevel).toHaveBeenLastCalledWith('xhigh');
    fireEvent.keyDown(sl, { key: 'End' });
    expect(h.onLevel).toHaveBeenLastCalledWith('max');
  });
  it('Gamma — шесть уровней с high; без max (роль) — крайний xhigh', () => {
    const a = mount({ sel: { modelId: 'gamma', levelId: 'high' } });
    expect(a.q('[role=slider]')!.getAttribute('aria-valuemax')).toBe('5');
    expect(a.q('[role=slider]')!.getAttribute('aria-valuetext')).toBe('high — h-high');
    a.unmount();
    const noMax = { ...alpha, levels: alpha.levels.filter((l) => l.id !== 'max') } as PublicModel;
    const b = mount({ models: [noMax], sel: { modelId: 'alpha', levelId: 'xhigh' } });
    expect(b.q('[role=slider]')!.getAttribute('aria-valuemax')).toBe('3');
    expect(b.container.textContent).not.toContain('max');
  });
  it('сравнение: «Сравнить с другой моделью» -> onCompare(true); вкладки A/B; модель — у открытой стороны', () => {
    const a = mount();
    fireEvent.click(a.q('[data-testid=compare-switch]')!);
    expect(a.h.onCompare).toHaveBeenLastCalledWith(true);
    a.unmount();
    const b = mount({ compare: true, pair: PAIR, tab: 'a', sel: PAIR.a, pairAny: true });
    expect(b.q('[data-testid=tab-pick-a]')!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(b.q('[data-testid=tab-pick-b]')!);
    expect(b.h.onTab).toHaveBeenLastCalledWith('b');
    fireEvent.click(b.q('[data-testid=model-delta]')!);
    expect(b.h.onPairModel).toHaveBeenLastCalledWith('a', 'delta');
    expect(b.q('[data-testid=compare-switch]')!.textContent).toContain('Вернуться к одной модели');
  });
});

describe('модели, закрытые по роли', () => {
  const LOCKED = [{ id: 'gamma', name: 'Gamma' }, { id: 'delta', name: 'Delta' }];
  it('видны серыми: aria-disabled, вне Tab и стрелок; нажатие — «нет доступа» на месте назначения, без выбора', () => {
    const { h, q, qa } = mount({ models: [alpha] }, LOCKED);
    expect(qa('.pkv-mseg-opt')).toHaveLength(3);
    for (const id of ['gamma', 'delta']) {
      const b = q(`[data-testid=model-${id}]`)!;
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-checked')).toBe('false');
      expect(b.tabIndex).toBe(-1);
      expect(b.dataset.navItem).toBeUndefined();
    }
    fireEvent.click(q('[data-testid=model-gamma]')!);
    expect(h.onModel).not.toHaveBeenCalled();
    expect(q('[data-testid=model-blurb] [data-on]')!.textContent).toBe('Gamma — нет доступа');
    fireEvent.keyDown(q('[data-testid=model-alpha]')!, { key: 'ArrowRight' });
    fireEvent.keyDown(q('[data-testid=model-alpha]')!, { key: 'End' });
    expect(h.onModel).not.toHaveBeenCalled();
    fireEvent.click(q('[data-testid=model-alpha]')!);
    expect(q('[data-testid=model-blurb] [data-on]')!.textContent).toBe('Файлы и расчёты');
  });
  it('в сравнении закрытую модель тоже нельзя поставить на сторону (альфа: Delta закрыт)', () => {
    const pair = { a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'gamma', levelId: 'xhigh' } };
    const { h, q } = mount({ models: [alpha, gamma], compare: true, pair, tab: 'b', sel: pair.b, pairAny: true }, [{ id: 'delta', name: 'Delta' }]);
    expect(q('[data-testid=model-delta]')!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(q('[data-testid=model-delta]')!);
    expect(h.onPairModel).not.toHaveBeenCalled();
    expect(h.onModel).not.toHaveBeenCalled();
  });
  it('администратору и альфе закрытых нет — дорожка как обычно', () => {
    const { qa } = mount({}, []);
    expect(qa('[aria-disabled=true]')).toHaveLength(0);
  });
});
