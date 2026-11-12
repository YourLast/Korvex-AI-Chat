// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { AUTO_BELOW, getSidebar, initSidebar, isCollapsed, SB_KEY, SB_SNIPPET, sbReduce, toggleSidebar, _resetSidebar, type SbState } from '@/lib/sidebar';
import { _resetFileView, closeFile, openCompare, openFile } from '@/lib/fileView';

const S0: SbState = { pref: 'open', auto: false, viewer: false, locked: false };
const run = (s: SbState, ...a: Parameters<typeof sbReduce>[1][]) => a.reduce(sbReduce, s);
const open = (width: number) => ({ t: 'viewer', open: true, width }) as const;
const close = { t: 'viewer', open: false, width: 1400 } as const;
const toggle = { t: 'toggle' } as const;

describe('правила (чистая функция)', () => {
  it('панель открылась на узком экране — меню сворачивается само; закрылась — разворачивается', () => {
    const s = run(S0, open(1400));
    expect(isCollapsed(s)).toBe(true); expect(s.auto).toBe(true); expect(s.pref).toBe('open');
    expect(isCollapsed(run(s, close))).toBe(false);
  });
  it(`экран ${AUTO_BELOW} px и шире — меню остаётся как было`, () => {
    expect(isCollapsed(run(S0, open(AUTO_BELOW)))).toBe(false);
    expect(isCollapsed(run(S0, open(1920)))).toBe(false);
    expect(isCollapsed(run(S0, open(AUTO_BELOW - 1)))).toBe(true);
  });
  it('телефон (до 761 px): меню — выезжающий лист, автомат его не трогает', () => {
    expect(run(S0, open(390))).toEqual({ ...S0, viewer: true });
    expect(run(S0, open(760)).auto).toBe(false);
  });
  it('меню было свёрнуто человеком — остаётся свёрнутым и при открытии, и при закрытии панели', () => {
    const s = run(S0, toggle);
    expect(s).toMatchObject({ pref: 'closed', auto: false });
    const o = run(s, open(1400));
    expect(o.auto).toBe(false);
    expect(isCollapsed(run(o, close))).toBe(true);
  });
  it('человек развернул меню при открытой панели — закрытие панели его выбор не отменяет', () => {
    const o = run(S0, open(1400));
    const e = run(o, toggle);
    expect(isCollapsed(e)).toBe(false);
    expect(e.pref).toBe('open');
    expect(isCollapsed(run(e, close))).toBe(false);
  });
  it('человек свернул меню при открытой панели — после закрытия оно остаётся свёрнутым (его выбор, а не автомата)', () => {
    const o = run(S0, open(1900));
    const c = run(o, toggle);
    expect(c.pref).toBe('closed');
    expect(isCollapsed(run(c, close))).toBe(true);
  });
  it('после ручного выбора при открытой панели автомат молчит до её закрытия (изменение размера окна не переопределяет)', () => {
    const o = run(S0, open(1900));
    const e = run(o, toggle, toggle);
    expect(isCollapsed(e)).toBe(false);
    expect(isCollapsed(sbReduce(e, { t: 'resize', width: 1200 }))).toBe(false);
  });
  it('окно сузили при открытой панели — меню сворачивается; расширили — возвращается (если свернули сами)', () => {
    const o = run(S0, open(1900));
    const n = sbReduce(o, { t: 'resize', width: 1300 });
    expect(n.auto).toBe(true);
    expect(sbReduce(n, { t: 'resize', width: 1800 }).auto).toBe(false);
    expect(sbReduce(S0, { t: 'resize', width: 1300 })).toBe(S0);
  });
  it('второе открытие при уже открытой панели (другой файл, сравнение) ничего не меняет', () => {
    const o = run(S0, open(1400));
    expect(sbReduce(o, open(1400))).toBe(o);
  });
  it('ручное переключение: свернуть ↔ развернуть, выбор запоминается в pref', () => {
    expect(run(S0, toggle).pref).toBe('closed');
    expect(run(S0, toggle, toggle).pref).toBe('open');
  });
});

describe('хранилище: класс на <html>, запоминание на устройстве, подписка на панель «Файл»', () => {
  let off: () => void;
  const setW = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  const cls = () => document.documentElement.classList.contains('sb-collapsed');
  beforeEach(() => { localStorage.clear(); _resetFileView(); _resetSidebar(); setW(1400); });
  afterEach(() => { off?.(); closeFile(); _resetFileView(); _resetSidebar(); });

  it('панель открылась (чип) — класс sb-collapsed; закрылась — класс снят; localStorage не тронут (это не выбор человека)', () => {
    off = initSidebar();
    expect(cls()).toBe(false);
    act(() => { openFile({ id: 'f1', name: 'a.pdf' }); });
    expect(cls()).toBe(true);
    act(() => { closeFile(); });
    expect(cls()).toBe(false);
    expect(localStorage.getItem(SB_KEY)).toBeNull();
  });
  it('сравнение двух файлов тоже панель: меню сворачивается', () => {
    off = initSidebar();
    act(() => { openCompare({ id: 'a', name: 'a.pdf' }, { id: 'b', name: 'b.pdf' }); });
    expect(cls()).toBe(true);
    act(() => { closeFile(); });
    expect(cls()).toBe(false);
  });
  it('ручное свёртывание запоминается на устройстве и переживает перезагрузку; панель его не возвращает', () => {
    off = initSidebar();
    act(() => { toggleSidebar(); });
    expect(cls()).toBe(true);
    expect(localStorage.getItem(SB_KEY)).toBe('closed');
    off(); _resetSidebar();
    off = initSidebar();
    expect(getSidebar().pref).toBe('closed'); expect(cls()).toBe(true);
    act(() => { openFile({ id: 'f1', name: 'a.pdf' }); });
    act(() => { closeFile(); });
    expect(cls()).toBe(true);
  });
  it('человек развернул меню при открытой панели — оно остаётся развёрнутым после её закрытия', () => {
    off = initSidebar();
    act(() => { openFile({ id: 'f1', name: 'a.pdf' }); });
    expect(cls()).toBe(true);
    act(() => { toggleSidebar(); });
    expect(cls()).toBe(false);
    act(() => { closeFile(); });
    expect(cls()).toBe(false);
    expect(localStorage.getItem(SB_KEY)).not.toBe('closed');
  });
  it('широкий экран: панель меню не трогает', () => {
    setW(1920);
    off = initSidebar();
    act(() => { openFile({ id: 'f1', name: 'a.pdf' }); });
    expect(cls()).toBe(false);
  });
  it('панель уже была открыта к моменту подключения — меню сворачивается сразу', () => {
    act(() => { openFile({ id: 'f1', name: 'a.pdf' }); });
    off = initSidebar();
    expect(cls()).toBe(true);
  });
  it('вставка в <head>: «свёрнуто» на этом устройстве применяется до отрисовки (без вздрагивания), на телефоне — нет', () => {
    localStorage.setItem(SB_KEY, 'closed');
    new Function(SB_SNIPPET)();
    expect(cls()).toBe(true);
    document.documentElement.classList.remove('sb-collapsed');
    setW(390);
    new Function(SB_SNIPPET)();
    expect(cls()).toBe(false);
  });
});
