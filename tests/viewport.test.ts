// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECHECK_MS, isEditable, trackViewport } from '@/lib/viewport';

class FakeVV extends EventTarget { width = 390; height = 844; offsetTop = 0; scale = 1; }

let vv: FakeVV;
let stop: (() => void) | null = null;
let vis: 'visible' | 'hidden' = 'visible';
let touch = true;
const html = document.documentElement;
const kbOpen = () => html.classList.contains('kb-open');
const vars = () => [html.style.getPropertyValue('--vvh'), html.style.getPropertyValue('--vvt')];
const setVV = (h: number, opts: { w?: number; top?: number; scale?: number; silent?: boolean } = {}) => {
  vv.height = h; if (opts.w) vv.width = opts.w; vv.offsetTop = opts.top ?? 0; vv.scale = opts.scale ?? 1;
  if (!opts.silent) vv.dispatchEvent(new Event('resize'));
};
const tick = (ms = 20) => { vi.advanceTimersByTime(ms); };
const setInner = (w: number, h: number) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: w }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: h }); };
const setVis = (v: 'visible' | 'hidden') => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
let ta: HTMLTextAreaElement;
let btn: HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vv = new FakeVV();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
  vis = 'visible'; touch = true;
  window.matchMedia = ((q: string) => ({ matches: touch && q.includes('pointer: coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  setInner(390, 844);
  document.body.innerHTML = '<textarea id="ta"></textarea><button id="btn">ok</button>';
  ta = document.getElementById('ta') as HTMLTextAreaElement; btn = document.getElementById('btn') as HTMLButtonElement;
});
afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); document.body.innerHTML = ''; html.className = ''; html.removeAttribute('style'); });

const start = () => { stop = trackViewport(); tick(); };

describe('isEditable', () => {
  it('поля ввода — да, кнопки и флажки — нет', () => {
    const mk = (h: string) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild as Element; };
    expect(isEditable(mk('<textarea></textarea>'))).toBe(true);
    expect(isEditable(mk('<input>'))).toBe(true);
    expect(isEditable(mk('<input type="search">'))).toBe(true);
    expect(isEditable(mk('<input type="email">'))).toBe(true);
    expect(isEditable(mk('<div contenteditable="true"></div>'))).toBe(true);
    expect(isEditable(mk('<div contenteditable=""></div>'))).toBe(true);
    expect(isEditable(mk('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditable(mk('<input type="checkbox">'))).toBe(false);
    expect(isEditable(mk('<input type="file">'))).toBe(false);
    expect(isEditable(mk('<input type="range">'))).toBe(false);
    expect(isEditable(mk('<textarea readonly></textarea>'))).toBe(false);
    expect(isEditable(mk('<input disabled>'))).toBe(false);
    expect(isEditable(mk('<button></button>'))).toBe(false);
    expect(isEditable(mk('<div></div>'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe('kb-open и переменные высоты', () => {
  it('без клавиатуры: класса и переменных нет', () => {
    start();
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('поле в фокусе и видимая область ниже на 344 px: kb-open, --vvh и --vvt заданы', () => {
    start(); ta.focus(); tick();
    setVV(500, { top: 36 }); tick();
    expect(kbOpen()).toBe(true);
    expect(vars()).toEqual(['500px', '36px']);
  });

  it('область сжалась, а поля в фокусе нет — kb-open не ставится (клавиатуры без поля не бывает)', () => {
    start();
    setVV(500); tick(); tick(800);
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('поле в фокусе, но разница меньше порога (панель вкладок, адресная строка) — kb-open нет', () => {
    start(); ta.focus(); tick();
    setVV(844 - 100); tick();
    expect(kbOpen()).toBe(false);
    setVV(844 - 121); tick();
    expect(kbOpen()).toBe(true);
  });

  it('фокус на кнопке (не редактируемый элемент) при сжатой области — kb-open нет', () => {
    start(); btn.focus(); tick();
    setVV(500); tick();
    expect(kbOpen()).toBe(false);
  });

  it('клавиатура закрылась (resize) — kb-open и переменные сняты', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    setVV(844); tick();
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('поле потеряло фокус — kb-open снимается сразу, переменные тоже', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    ta.blur(); tick();
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('щипок-зум (scale > 1): раскладку не трогаем', () => {
    start(); ta.focus(); tick();
    setVV(500, { scale: 2 }); tick();
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('поле в фокусе в PWA: innerHeight сжимается вместе с клавиатурой — база остаётся прежней', () => {
    start(); ta.focus(); tick();
    setInner(390, 500); setVV(500); tick();
    expect(kbOpen()).toBe(true);
  });
});

describe('уход в фон и возврат (баг product 29.10: после возврата остаётся место под клавиатуру)', () => {
  it('сворачивание: фокус с поля снят, kb-open и переменные сняты сразу', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    setVis('hidden');
    expect(document.activeElement).not.toBe(ta);
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('возврат: видимая область не сообщила resize (осталась «клавиатурной») — kb-open не ставится, поля в фокусе нет', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    setVis('hidden');
    setVis('visible'); tick(); tick(RECHECK_MS[1] + 50);
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('возврат, поле осталось в фокусе (настольный браузер, фокус не снимаем), клавиатуры нет, resize не пришёл: через 300 мс класс снят', () => {
    touch = false;
    start(); ta.focus(); tick(); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    setVis('hidden');
    expect(document.activeElement).toBe(ta);
    expect(kbOpen()).toBe(false);
    setVis('visible'); tick();
    setVV(844, { silent: true });
    tick(RECHECK_MS[0] + 10);
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('возврат с настоящей клавиатурой (iOS её вернула вместе с фокусом): kb-open возвращается', () => {
    touch = false;
    start(); ta.focus(); tick(); setVV(500); tick();
    setVis('hidden'); setVis('visible'); tick(); tick(RECHECK_MS[1] + 10);
    expect(document.activeElement).toBe(ta);
    expect(kbOpen()).toBe(true);
    expect(vars()[0]).toBe('500px');
  });

  it('на настольном: переключение вкладки не снимает фокус с поля ввода', () => {
    touch = false;
    start(); ta.focus(); tick();
    setVis('hidden'); setVis('visible'); tick(RECHECK_MS[1] + 10);
    expect(document.activeElement).toBe(ta);
  });

  it('pagehide (iOS убирает страницу в фон) — как visibilitychange hidden', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    window.dispatchEvent(new Event('pagehide'));
    expect(document.activeElement).not.toBe(ta);
    expect(kbOpen()).toBe(false);
  });

  it('pageshow — пересчёт после rAF и через 300 и 700 мс', () => {
    start();
    ta.focus(); tick(); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    setVV(844, { silent: true });
    window.dispatchEvent(new Event('pageshow'));
    tick(20);
    expect(kbOpen()).toBe(false);
  });

  it('пересчёт возврата: rAF, потом 300 и 700 мс — каждый раз по свежей высоте', () => {
    touch = false;
    start(); ta.focus(); tick(); setVV(500); tick();
    setVis('hidden');
    setVV(500, { silent: true });
    setVis('visible'); tick(20);
    expect(kbOpen()).toBe(true);
    setVV(700, { silent: true }); tick(RECHECK_MS[0]);
    expect(kbOpen()).toBe(true);
    expect(vars()[0]).toBe('700px');
    setVV(844, { silent: true }); tick(RECHECK_MS[1] - RECHECK_MS[0]);
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
  });

  it('window focus и blur тоже пересчитывают', () => {
    touch = false;
    start(); ta.focus(); tick(); setVV(500); tick();
    setVV(844, { silent: true });
    window.dispatchEvent(new Event('blur')); tick(20);
    expect(kbOpen()).toBe(false);
    setVV(500, { silent: true });
    window.dispatchEvent(new Event('focus')); tick(20);
    expect(kbOpen()).toBe(true);
    setVV(844, { silent: true }); tick(RECHECK_MS[0] + 10);
    expect(kbOpen()).toBe(false);
  });
});

describe('базовая высота обновляется', () => {
  it('поворот: в альбомной ориентации (область 390 px высотой) kb-open не ставится от «прежней» высоты 844', () => {
    start(); ta.focus(); tick();
    setInner(844, 390); setVV(390, { w: 844 });
    window.dispatchEvent(new Event('orientationchange'));
    tick(20); tick(RECHECK_MS[1]);
    expect(kbOpen()).toBe(false);
    setVV(190, { w: 844 }); tick();
    expect(kbOpen()).toBe(true);
    setInner(390, 844); setVV(844, { w: 390 });
    window.dispatchEvent(new Event('orientationchange')); tick(20); tick(RECHECK_MS[1]);
    expect(kbOpen()).toBe(false);
  });

  it('смена ширины без orientationchange (изменение размера окна, split view) — тоже новая база', () => {
    start(); ta.focus(); tick();
    setInner(844, 390); setVV(390, { w: 844 }); tick();
    expect(kbOpen()).toBe(false);
  });

  it('окно стало ниже (iPad split view, настольный), поля в фокусе нет: потом поле в фокусе — kb-open не ставится', () => {
    start();
    setInner(390, 700); setVV(700); tick(400);
    ta.focus(); tick();
    expect(kbOpen()).toBe(false);
    setVV(700 - 300); tick();
    expect(kbOpen()).toBe(true);
  });

  it('PWA: клавиатура закрывается дольше 300 мс, поле нажали снова — база не успела «упасть» до клавиатурной высоты', () => {
    start(); ta.focus(); tick();
    setInner(390, 500); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    ta.blur(); tick(RECHECK_MS[0] + 10);
    expect(kbOpen()).toBe(false);
    ta.focus(); tick();
    expect(kbOpen()).toBe(true);
    expect(vars()[0]).toBe('500px');
  });

  it('база не уменьшается, пока клавиатура открыта и поле в фокусе', () => {
    start(); ta.focus(); tick(); setVV(500); tick(); tick(2000);
    expect(kbOpen()).toBe(true);
  });
});

describe('снятие слежения', () => {
  it('после cleanup: класса и переменных нет, события игнорируются', () => {
    start(); ta.focus(); tick(); setVV(500); tick();
    expect(kbOpen()).toBe(true);
    stop?.(); stop = null;
    expect(kbOpen()).toBe(false);
    expect(vars()).toEqual(['', '']);
    setVV(400); window.dispatchEvent(new Event('pageshow')); tick(1000);
    expect(kbOpen()).toBe(false);
  });

  it('без visualViewport — пустая функция, ошибок нет', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
    const off = trackViewport();
    expect(() => off()).not.toThrow();
    expect(kbOpen()).toBe(false);
  });
});
