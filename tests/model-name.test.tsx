// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { ModelName, PickerPanel, levelLabel } from '@/components/ModelPicker';
import type { PublicModel } from '@/lib/models';

const lv = [{ id: 'off', label: 'off', hint: 'Без размышления' }, { id: 'on', label: 'on', hint: 'Размышлять' }];
const models = [
  { id: 'alpha', name: 'Alpha', fullName: 'Alpha', blurb: 'умная', defaultLevel: 'off', levels: lv, variantName: 'Обычная', variantHint: 'Как есть' },
  { id: 'alpha-fast', name: 'Alpha', fullName: 'Alpha fast', blurb: 'умная', defaultLevel: 'off', levels: lv, variantOf: 'alpha', variantName: 'Быстрая', variantHint: 'Быстрее' },
  { id: 'beta', name: 'Beta', fullName: 'Beta', blurb: 'лёгкая', defaultLevel: 'off', levels: lv },
] as unknown as PublicModel[];

describe('levelLabel: название и добавка варианта', () => {
  it('основная модель — без добавки; вариант с тем же именем — «Имя · вариант»; модель без вариантов — просто имя', () => {
    expect(levelLabel(models, { modelId: 'alpha', levelId: 'off' })).toMatchObject({ model: 'Alpha', name: 'Alpha', suffix: '', level: 'off' });
    expect(levelLabel(models, { modelId: 'alpha-fast', levelId: 'on' })).toMatchObject({ model: 'Alpha · быстрая', name: 'Alpha', suffix: ' · быстрая', level: 'on' });
    expect(levelLabel(models, { modelId: 'beta', levelId: 'off' })).toMatchObject({ model: 'Beta', suffix: '' });
  });
  it('неизвестная модель — её id без добавки', () => {
    expect(levelLabel(models, { modelId: 'x', levelId: 'y' })).toMatchObject({ model: 'x', name: 'x', suffix: '', level: 'y' });
  });
});

describe('ModelName', () => {
  let calls: { el: Element; frames: Keyframe[]; opt: KeyframeAnimationOptions }[];
  let finish: (() => void)[];
  let reduce = false;
  beforeEach(() => {
    calls = []; finish = []; reduce = false;
    document.documentElement.style.setProperty('--dur-base', '200ms');
    window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).textContent?.length ? (this as HTMLElement).textContent!.length * 7 : 0; } });
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], opt: KeyframeAnimationOptions) {
      const a = { onfinish: null as null | (() => void), cancel() {} };
      calls.push({ el: this, frames, opt }); finish.push(() => a.onfinish?.());
      return a;
    };
  });
  afterEach(() => { cleanup(); delete (Element.prototype as unknown as { animate?: unknown }).animate; });

  const mount = (suffix: string) => render(createElement(ModelName, { name: 'Beta', suffix }));

  it('первый показ — без анимации; текст целиком «Beta · без ускорителя»', () => {
    const { container } = mount(' · без ускорителя');
    expect(container.textContent).toBe('Beta · без ускорителя');
    expect(calls).toHaveLength(0);
  });
  it('добавка проявляется: ширина 0 -> естественная и прозрачность 0 -> 1, ~200 мс, текст сразу в DOM', () => {
    const { container, rerender } = mount('');
    expect(container.querySelector('.mn-x')).toBeNull();
    rerender(createElement(ModelName, { name: 'Beta', suffix: ' · без ускорителя' }));
    expect(container.textContent).toBe('Beta · без ускорителя');
    expect(calls).toHaveLength(1);
    expect(calls[0].opt.duration).toBe(200);
    expect(calls[0].frames[0]).toMatchObject({ width: '0px', opacity: 0 });
    expect(calls[0].frames[1]).toMatchObject({ width: `${' · без ускорителя'.length * 7}px`, opacity: 1 });
  });
  it('добавка гаснет: ширина -> 0 и прозрачность -> 0, в DOM остаётся до конца анимации, потом убирается', () => {
    const { container, rerender } = mount(' · без ускорителя');
    rerender(createElement(ModelName, { name: 'Beta', suffix: '' }));
    expect(container.textContent).toBe('Beta · без ускорителя');
    expect(calls).toHaveLength(1);
    expect(calls[0].opt).toMatchObject({ duration: 200, fill: 'forwards' });
    expect(calls[0].frames[0]).toMatchObject({ opacity: 1 });
    expect(calls[0].frames[1]).toMatchObject({ width: '0px', opacity: 0 });
    act(() => finish[0]());
    expect(container.textContent).toBe('Beta');
    expect(container.querySelector('.mn-x')).toBeNull();
  });
  it('prefers-reduced-motion и нулевой токен — без анимации: добавка меняется сразу', () => {
    reduce = true;
    const { container, rerender } = mount('');
    rerender(createElement(ModelName, { name: 'Beta', suffix: ' · без ускорителя' }));
    expect(container.textContent).toBe('Beta · без ускорителя');
    rerender(createElement(ModelName, { name: 'Beta', suffix: '' }));
    expect(container.textContent).toBe('Beta');
    expect(calls).toHaveLength(0);
    reduce = false;
    document.documentElement.style.setProperty('--dur-base', '0ms');
    rerender(createElement(ModelName, { name: 'Beta', suffix: ' · быстрая' }));
    expect(calls).toHaveLength(0);
  });
  it('без Web Animations (старый браузер, jsdom) — сразу, ничего не ломается', () => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    const { container, rerender } = mount(' · без ускорителя');
    rerender(createElement(ModelName, { name: 'Beta', suffix: '' }));
    expect(container.textContent).toBe('Beta');
  });
});

describe('выбор варианта в меню', () => {
  const panel = (id: string) => createElement(PickerPanel, { models, compare: false, sel: { modelId: id, levelId: 'off' }, onModel: () => {}, onLevel: () => {} });
  it('одна капсула на выбранный вариант: --n — число вариантов, --i — номер выбранного; кнопки не красят фон сами', () => {
    const a = render(panel('alpha'));
    const seg = a.container.querySelector<HTMLElement>('.pk-var-seg')!;
    expect(seg.querySelectorAll('.pk-var-pill')).toHaveLength(1);
    expect(seg.style.getPropertyValue('--n')).toBe('2');
    expect(seg.style.getPropertyValue('--i')).toBe('0');
    a.rerender(panel('alpha-fast'));
    expect(a.container.querySelector<HTMLElement>('.pk-var-seg')!.style.getPropertyValue('--i')).toBe('1');
    expect(a.container.querySelector('.pk-var-seg')).toBe(seg);
  });
  it('подпись уровня: у варианта — добавка; название и добавка раздельны (ModelName)', () => {
    const a = render(panel('alpha-fast'));
    const f = a.container.querySelector('.pk-for-now')!;
    expect(f.getAttribute('data-fam')).toBe('alpha');
    expect(f.querySelector('.mn')!.textContent).toBe('Alpha · быстрая');
    expect(f.querySelector('.mn-x')!.textContent).toBe(' · быстрая');
  });
});
