// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { mountElastic, type ELevel, type EMult } from '@/lib/elastic';
import { multFmt } from '@/components/LevelElastic';
import { publicModels } from '@/lib/models';

const cfgPath = process.env.MODELS_CONFIG || 'tests/fixtures/models.json';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { models: { id: string; mult?: number; multCalc?: { at: string; recheck: string }; levels: { id: string; mult?: number }[] }[] };
let hosts: HTMLElement[] = [];
afterEach(() => { hosts.forEach((x) => x.remove()); hosts = []; });
const mult = (view: EMult['view']): EMult => ({ view, fmt: (x) => `×${multFmt(x, 'ru')}`, note: 'пояснение' });
function mount(levels: ELevel[], value: string, view: EMult['view']) {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const h = mountElastic(host, { levels, value, caption: 'c', label: 'l', onChange: vi.fn(), mult: mult(view) });
  return { h, host };
}
const ET: ELevel[] = [{ id: 'off', label: 'off' }, { id: 'low', label: 'low', mult: 0.25 }, { id: 'medium', label: 'medium', mult: 0.25 }, { id: 'xhigh', label: 'xhigh', mult: 1 }, { id: 'max', label: 'max', mult: 3 }];

describe('множители лимита', () => {
  it('конфиг: у моделей с множителями есть дата расчёта и дата пересчёта; публичные уровни несут свой или общий множитель', () => {
    const withMult = cfg.models.filter((m) => m.mult || m.levels.some((l) => l.mult));
    for (const m of withMult) expect(m.multCalc?.recheck).toMatch(/^\d{4}-\d\d-\d\d$/);
    for (const pm of publicModels('admin')) {
      const c = cfg.models.find((m) => m.id === pm.id)!;
      for (const l of pm.levels) expect(l.mult).toBe(c.levels.find((x) => x.id === l.id)!.mult ?? c.mult);
      expect(pm).not.toHaveProperty('multCalc');
    }
  });
  it('формат: 0,25 по-русски, 0.25 по-английски, целые без дроби', () => {
    expect(multFmt(0.25, 'ru')).toBe('0,25');
    expect(multFmt(0.25, 'en')).toBe('0.25');
    expect(multFmt(3, 'ru')).toBe('3');
  });
  it("'head': множитель выбранного уровня в строке подписи, у max — теплее; у off — пусто; пояснение одно", () => {
    const { h, host } = mount(ET, 'max', 'head');
    const m = host.querySelector<HTMLElement>('.kxe-mult')!;
    expect(m.textContent).toBe('×3'); expect(m.classList.contains('is-max')).toBe(true);
    expect(host.querySelector<HTMLElement>('.kxe-mrow')!.hidden).toBe(true);
    expect(host.querySelector('.kxe-note')!.textContent).toBe('пояснение');
    h.update({ value: 'xhigh' }); expect(m.textContent).toBe('×1'); expect(m.classList.contains('is-max')).toBe(false);
    h.update({ value: 'off' }); expect(m.hidden).toBe(true);
  });
  it("'cells': под каждой подписью свой множитель, выбранный is-on; один множитель на все уровни — в строке подписи, без ячеек и без «теплее»", () => {
    const { h, host } = mount(ET, 'low', 'cells');
    const cells = [...host.querySelectorAll<HTMLElement>('.kxe-m')];
    expect(cells.map((c) => c.textContent)).toEqual(['', '×0,25', '×0,25', '×1', '×3']);
    expect(cells[1].classList.contains('is-on')).toBe(true);
    expect(cells[4].classList.contains('is-max')).toBe(true);
    expect(host.querySelector<HTMLElement>('.kxe-mult')!.hidden).toBe(true);
    h.update({ levels: ['low', 'medium', 'max'].map((id) => ({ id, label: id, mult: 70 })), value: 'max' });
    expect(host.querySelector<HTMLElement>('.kxe-mrow')!.hidden).toBe(true);
    const m = host.querySelector<HTMLElement>('.kxe-mult')!;
    expect(m.textContent).toBe('×70'); expect(m.classList.contains('is-max')).toBe(false);
  });
  it('без множителей у модели — ни строки, ни ячеек, ни пояснения', () => {
    const { host } = mount([{ id: 'off', label: 'off' }, { id: 'on', label: 'on' }], 'on', 'cells');
    expect(host.querySelector<HTMLElement>('.kxe-mult')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.kxe-note')!.hidden).toBe(true);
  });
});
