// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { mountElastic, type ELevel, type EMult } from '@/lib/elastic';
import { multFmt, multNote } from '@/components/LevelElastic';
import { tr } from '@/lib/i18n/core';
import { publicModels } from '@/lib/models';

const cfgPath = process.env.MODELS_CONFIG || 'tests/fixtures/models.json';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { models: { id: string; mult?: number; multCalc?: { at: string; recheck: string }; levels: { id: string; mult?: number }[] }[] };
let hosts: HTMLElement[] = [];
afterEach(() => { hosts.forEach((x) => x.remove()); hosts = []; });
const tx = ((k: string, v?: Record<string, string>) => tr('ru', k as never, v as never)) as never;
const mult = (view: EMult['view']): EMult => ({ view, fmt: (x) => `×${multFmt(x, 'ru')}`, note: (x, u) => multNote(tx, 'ru', x, u) });
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
    const note = host.querySelector<HTMLElement>('.kxe-note')!;
    expect(note.textContent).toBe('Тратит недельный лимит в 3 раза быстрее');
    h.update({ value: 'xhigh' }); expect(m.textContent).toBe('×1'); expect(m.classList.contains('is-max')).toBe(false);
    expect(note.textContent).toBe('Обычный расход лимита');
    h.update({ value: 'low' }); expect(note.textContent).toBe('Тратит лимит примерно в 4 раза медленнее');
    h.update({ value: 'off' }); expect(m.hidden).toBe(true); expect(note.hidden).toBe(true);
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
    expect(host.querySelector('.kxe-note')!.textContent).toBe('Тратит лимит в 70 раз быстрее');
    h.update({ levels: ['low', 'max'].map((id) => ({ id, label: id, mult: 17 })), value: 'low' });
    expect(host.querySelector('.kxe-note')!.textContent).toBe('Тратит лимит в 17 раз быстрее');
  });
  it('без множителей у модели — ни строки, ни ячеек, ни пояснения', () => {
    const { host } = mount([{ id: 'off', label: 'off' }, { id: 'on', label: 'on' }], 'on', 'cells');
    expect(host.querySelector<HTMLElement>('.kxe-mult')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.kxe-note')!.hidden).toBe(true);
  });
});

describe("'warm': только тёплая метка под max и подсказка", () => {
  it('у Alpha под max «⚠ ×3» с подсказкой, у других уровней пусто; строки пояснения и множителя в строке подписи нет; у Gamma (один множитель) — ничего', () => {
    const host = document.createElement('div'); document.body.append(host); hosts.push(host);
    const h = mountElastic(host, { levels: ET, value: 'xhigh', caption: 'c', label: 'l', onChange: vi.fn(), mult: { view: 'warm', fmt: (x) => `×${x}`, note: () => '', tip: (x) => `в ${x} раза больше` } });
    const w = host.querySelectorAll('[data-testid=lvl-warm]');
    expect(w).toHaveLength(1);
    expect(w[0].textContent).toBe('×3в 3 раза больше');
    expect(w[0].getAttribute('aria-label')).toBe('в 3 раза больше');
    expect(host.querySelector<HTMLElement>('.kxe-mult')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.kxe-note')!.hidden).toBe(true);
    const row = host.querySelector<HTMLElement>('.kxe-mrow')!;
    expect(row.classList.contains('kxe-mrow--off')).toBe(true);
    expect(row.getAttribute('aria-hidden')).not.toBeNull();
    for (const [v, off] of [['max', false], ['low', true], ['off', true], ['max', false]] as const) {
      h.update({ value: v });
      expect([v, row.classList.contains('kxe-mrow--off'), row.hasAttribute('aria-hidden')]).toEqual([v, off, off]);
    }
    expect(host.querySelectorAll('[data-testid=lvl-warm]')).toHaveLength(1);
    h.update({ levels: ['low', 'max'].map((id) => ({ id, label: id, mult: 17 })), value: 'max' });
    expect(host.querySelector('[data-testid=lvl-warm]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.kxe-mult')!.hidden).toBe(true);
  });
});
