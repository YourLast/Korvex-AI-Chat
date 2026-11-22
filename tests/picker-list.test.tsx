// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { ListPanel } from '@/components/PickerList';
import { ShellCtx } from '@/components/Shell';
import { chipWarn, modelMult, timesFew, warmMult } from '@/lib/levelMult';
import type { PublicModel } from '@/lib/models';

const L = (ids: string[], mult?: Record<string, number> | number) => ids.map((id) => ({ id, label: id, hint: `h-${id}`, ...(mult !== undefined ? { mult: typeof mult === 'number' ? mult : mult[id] } : {}) }));
const alpha = { id: 'alpha', name: 'Alpha', fullName: 'Alpha', blurb: 'Файлы и расчёты', defaultLevel: 'xhigh', levels: L(['off', 'low', 'medium', 'xhigh', 'max'], { low: 0.25, medium: 0.25, xhigh: 1, max: 3 }) } as unknown as PublicModel;
const gamma = { id: 'gamma', name: 'Gamma', fullName: 'Gamma Korvex', blurb: 'Сложные задачи и код', defaultLevel: 'medium', levels: L(['off', 'low', 'medium', 'max'], 17) } as unknown as PublicModel;

function mount(levelId = 'xhigh') {
  const h = { onModel: vi.fn(), onLevel: vi.fn(), onCompare: vi.fn(), onTab: vi.fn(), onPairModel: vi.fn() };
  const props = { models: [alpha, gamma], compare: false, sel: { modelId: 'alpha', levelId }, ...h };
  const wrap = (c: ReactNode) => createElement(ShellCtx.Provider, { value: { models: [], refresh: async () => {}, openDrawer() {}, threads: [], role: 'admin', locked: [] } }, c);
  const r = render(wrap(createElement(ListPanel, props as never)));
  return { ...r, h, q: (s: string) => document.querySelector<HTMLElement>(s) };
}
beforeEach(() => { localStorage.clear(); window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; });
afterEach(cleanup);

describe('множители', () => {
  it('модель с одним множителем — строка под назначением; тёплое — только у max со своим множителем; ⚠ на чипе — только у него', () => {
    expect(modelMult(gamma)).toBe(17);
    expect(modelMult(alpha)).toBeNull();
    expect(warmMult(alpha, 'max')).toBe(3);
    expect(warmMult(alpha, 'xhigh')).toBeNull();
    expect(warmMult(gamma, 'max')).toBeNull();
    expect(chipWarn([alpha, gamma], { modelId: 'alpha', levelId: 'max' })).toBe(true);
    expect(chipWarn([alpha, gamma], { modelId: 'gamma', levelId: 'max' })).toBe(false);
    expect([2, 3, 4, 17, 22, 70].map(timesFew)).toEqual([true, true, true, false, true, false]);
  });
});

describe('меню списком', () => {
  it('модели строками, ✓ у выбранной; у Gamma — «тратит лимит в 17 раз быстрее»; нажатие — выбор', () => {
    const { q, h } = mount();
    expect(q('[data-testid=model-alpha]')!.getAttribute('aria-checked')).toBe('true');
    expect(q('[data-testid=model-mult-gamma]')!.textContent).toBe('тратит лимит в 17 раз быстрее');
    expect(q('[data-testid=model-mult-alpha]')).toBeNull();
    fireEvent.click(q('[data-testid=model-gamma]')!);
    expect(h.onModel).toHaveBeenCalledWith('gamma');
  });
  it('«Уровень ›»: подменю с пояснением, «Рекомендуем» у xhigh, у max «⚠ ×3 и больше» и подсказка; выбор уровня', () => {
    const { q, h } = mount();
    expect(q('[data-testid=level-row]')!.textContent).toContain('xhigh');
    fireEvent.click(q('[data-testid=level-row]')!);
    const sub = q('[data-testid=level-sub]')!;
    expect(sub.textContent).toContain('Чем выше уровень');
    expect(q('[data-testid=lvl-alpha-xhigh]')!.textContent).toContain('Рекомендуем');
    expect(q('[data-testid=lvl-alpha-max] [data-testid=lvl-warm]')!.textContent).toBe('×3 и больше');
    expect(q('[data-testid=lvl-alpha-max] [role=tooltip]')!.textContent).toBe('Alpha думает дольше всех и может тратить в 3 раза больше лимита, чем на обычном уровне');
    expect(q('[data-testid=lvl-alpha-low] [data-testid=lvl-warm]')).toBeNull();
    fireEvent.click(q('[data-testid=lvl-alpha-max]')!);
    expect(h.onLevel).toHaveBeenCalledWith('max');
  });
});
