// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountElastic, powerD, spring, type ELevel } from '@/lib/elastic';

const L = (ids: string[]): ELevel[] => ids.map((id) => ({ id, label: id, hint: `h-${id}` }));
const ALPHA = L(['off', 'low', 'medium', 'xhigh', 'max']);
let hosts: HTMLElement[] = [];
function mount(levels = ALPHA, value = 'medium') {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const onChange = vi.fn();
  const h = mountElastic(host, { levels, value, caption: 'Уровень размышления', label: 'Уровень размышления Alpha', onChange, testId: 'levels-alpha' });
  return { h, host, onChange, zone: host.querySelector<HTMLElement>('[role=slider]')! };
}
const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const ptr = (el: HTMLElement, type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: 0, button: 0, pointerType: 'touch', bubbles: true }));

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('hover: none'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { hosts.forEach((x) => x.remove()); hosts = []; });

describe('пилюля с искрой мощности', () => {
  it('диктор и подпись: role=slider, значение, «уровень — подсказка»; искра мощности в строке подписи', () => {
    const { zone, host } = mount();
    expect(zone.tabIndex).toBe(0);
    expect(zone.getAttribute('aria-valuemax')).toBe('4');
    expect(zone.getAttribute('aria-valuenow')).toBe('2');
    expect(zone.getAttribute('aria-valuetext')).toBe('medium — h-medium');
    expect(zone.dataset.testid).toBe('levels-alpha');
    expect(host.querySelector('.kxe-val')!.textContent).toBe('mediumh-medium');
    expect(host.querySelector('.kxe-head .kxe-pow')).not.toBeNull();
    expect(host.querySelectorAll('.kxe-row--on .kxe-cell')).toHaveLength(5);
  });
  it('клавиатура: стрелки, PageUp/PageDown, Home/End', () => {
    const { zone, onChange } = mount();
    key(zone, 'ArrowRight'); expect(onChange).toHaveBeenLastCalledWith('xhigh');
    key(zone, 'PageDown'); expect(onChange).toHaveBeenLastCalledWith('medium');
    key(zone, 'Home'); expect(onChange).toHaveBeenLastCalledWith('off');
    key(zone, 'End'); expect(onChange).toHaveBeenLastCalledWith('max');
    expect(zone.getAttribute('aria-valuetext')).toBe('max — h-max');
  });
  it('касание: уровень под пальцем, отклик на каждом уровне, на max — двойной', () => {
    const vib = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vib });
    const { zone, onChange } = mount();
    ptr(zone, 'pointerdown', 5000);
    expect(onChange).toHaveBeenLastCalledWith('max');
    expect(vib).toHaveBeenLastCalledWith([10, 40, 16]);
    ptr(zone, 'pointermove', -5000);
    expect(onChange).toHaveBeenLastCalledWith('off');
    expect(vib).toHaveBeenLastCalledWith(8);
    ptr(zone, 'pointerup', -5000);
  });
  it('Gamma — шесть уровней с high; без max (роль) — крайний xhigh, без внутренней искры', async () => {
    const r = mount(L(['off', 'low', 'medium', 'high', 'xhigh', 'max']), 'high');
    expect(r.zone.getAttribute('aria-valuemax')).toBe('5');
    r.h.update({ levels: L(['off', 'low', 'medium', 'xhigh']), value: 'xhigh' });
    expect(r.zone.getAttribute('aria-valuemax')).toBe('3');
    await new Promise((res) => setTimeout(res, 600));
    const d = r.host.querySelector('.kxe-pow-p')!.getAttribute('d')!;
    expect(d.split('M').length - 1).toBe(1);
    key(r.zone, 'End');
    expect(r.onChange).not.toHaveBeenCalledWith('max');
  });
  it('новое значение пропсом — подпись и ARIA за ним; destroy убирает разметку', () => {
    const { h, zone, host } = mount();
    h.update({ value: 'low' });
    expect(zone.getAttribute('aria-valuenow')).toBe('1');
    h.destroy();
    expect(host.querySelector('.kxe')).toBeNull();
  });
  it('искра мощности: на 0 — ядро, каждый шаг — новый луч, на max — знак с внутренней искрой', () => {
    const subs = (d: string) => d.split('M').length - 1;
    expect(subs(powerD(0, 0))).toBe(1);
    expect(subs(powerD(1, 1))).toBe(2);
    const steps = [0, 0.25, 0.5, 0.75, 1].map((p) => powerD(p, 0));
    expect(new Set(steps).size).toBe(5);
  });
  it('пружина капсулы: лёгкий перелёт и успокоение', () => {
    const s = { x: 0, v: 0 };
    let peak = 0;
    for (let i = 0; i < 90; i++) { spring(s, 1, 21, 0.6, 1 / 60); peak = Math.max(peak, s.x); }
    expect(s.x).toBeCloseTo(1, 3);
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.15);
  });
});
