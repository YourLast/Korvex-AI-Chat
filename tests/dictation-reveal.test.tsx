// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useRef } from 'react';

vi.hoisted(() => {
  const w = globalThis as unknown as { AnimationEvent?: unknown };
  if (!w.AnimationEvent) {
    w.AnimationEvent = class AnimationEvent extends Event {
      animationName: string;
      constructor(type: string, init: EventInit & { animationName?: string } = {}) { super(type, init); this.animationName = init.animationName ?? ''; }
    };
  }
});

vi.mock('@/lib/recorder', () => ({
  prepareAudio: () => null,
  buzz: () => {},
  startRecorder: async () => {
    const t0 = Date.now();
    return {
      mime: 'audio/webm;codecs=opus', processed: true,
      levels: () => ({ raw: -30, out: -20, gain: 6 }),
      stop: async (tail = 0) => { await new Promise((r) => setTimeout(r, tail)); return { blob: new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), mime: 'audio/webm', ms: Math.max(2000, Date.now() - t0), rawMax: -25, processed: true }; },
      cancel: () => {},
    };
  },
}));

import { Composer } from '@/components/Composer';
import { REVEAL_GRACE_MS, WordReveal } from '@/components/WordReveal';
import {
  REVEAL_MAX_WORDS, REVEAL_MAX_WORDS_TOUCH, REVEAL_REDUCED_MS, REVEAL_TOTAL_MS, VOICE_MARKER, joinText, revealFrom, revealPlan,
} from '@/lib/voiceLogic';

const M = VOICE_MARKER;
const words = (n: number, p = 'w') => Array.from({ length: n }, (_, i) => p + i).join(' ');

describe('новые слова: что проявляется, а что уже было в поле', () => {
  it('диктовка дописана к набранному: head — набранное, анимируются только новые слова', () => {
    const full = joinText('Посчитай', M + 'сколько позиций');
    const p = revealPlan(full, revealFrom(full, 'Посчитай'));
    expect(p.head).toBe(M + 'Посчитай');
    expect(p.parts.filter((x) => x.w).map((x) => x.t)).toEqual(['сколько', 'позиций']);
    expect(p.count).toBe(2); expect(p.skipped).toBe(0);
  });
  it('вторая диктовка подряд: слова первой не проявляются заново (и маркер голоса остаётся один)', () => {
    const one = joinText('', M + 'первая фраза');
    const two = joinText(one, M + 'вторая фраза');
    expect(two.split(M).length - 1).toBe(1);
    const p = revealPlan(two, revealFrom(two, one));
    expect(p.head).toBe(M + 'первая фраза');
    expect(p.parts.filter((x) => x.w).map((x) => x.t)).toEqual(['вторая', 'фраза']);
  });
  it('поле было пустым: head — только маркер, анимируются все слова', () => {
    const full = joinText('', M + 'раз два три');
    const p = revealPlan(full, revealFrom(full, ''));
    expect(p.head).toBe(M);
    expect(p.count).toBe(3);
  });
  it('текст пришёл не дописанным (хвост переписан): уже показанное — общий префикс по целым словам', () => {
    expect(revealFrom('а б г д', 'а б в')).toBe('а б'.length);
    expect(revealFrom(M + 'а б г д', M + 'а б в')).toBe(M.length + 'а б'.length);
    expect(revealFrom('х у', 'а б')).toBe(0);
  });
  it('обрывок слова не считается «уже набранным»: «Пос» + «Посчитай» — слово проявится целиком', () => {
    const from = revealFrom('Посчитай позиции', 'Пос');
    expect(from).toBe(0);
    expect(revealPlan('Посчитай позиции', from).count).toBe(2);
  });
  it('ничего нового — анимировать нечего', () => {
    expect(revealPlan('уже было', revealFrom('уже было', 'уже было')).count).toBe(0);
    expect(revealPlan('', 0).total).toBe(0);
  });
  it('шаг между словами 25–40 мс у обычной фразы; всё не дольше REVEAL_TOTAL_MS у любой', () => {
    for (const n of [1, 2, 5, 12, 25, 30]) {
      const p = revealPlan(M + words(n), revealFrom(M + words(n), ''));
      if (n > 1) { expect(p.step).toBeGreaterThanOrEqual(25); expect(p.step).toBeLessThanOrEqual(40); }
      expect(p.total).toBeLessThanOrEqual(REVEAL_TOTAL_MS + 1);
    }
    for (const n of [40, 60, 300]) expect(revealPlan(words(n), 0).total).toBeLessThanOrEqual(REVEAL_TOTAL_MS + 1);
  });
  it(`больше ${REVEAL_MAX_WORDS} новых слов: анимируются последние ${REVEAL_MAX_WORDS}, ранние встают сразу (в head)`, () => {
    const full = 'был ' + words(80);
    const p = revealPlan(full, 3);
    expect(p.count).toBe(REVEAL_MAX_WORDS); expect(p.skipped).toBe(20);
    expect(p.head.endsWith('w19')).toBe(true);
    expect(p.parts[0]).toEqual({ t: ' ', w: false });
    expect(p.parts.find((x) => x.w)!.t).toBe('w20');
    expect(p.head + p.parts.map((x) => x.t).join('')).toBe(full);
    expect(p.parts.filter((x) => x.w)).toHaveLength(REVEAL_MAX_WORDS);
  });
  it(`телефон: лимит ниже (${REVEAL_MAX_WORDS_TOUCH}) — слоёв с размытием меньше; параметр max задаёт лимит`, () => {
    expect(REVEAL_MAX_WORDS_TOUCH).toBeLessThan(REVEAL_MAX_WORDS);
    const p = revealPlan(words(80), 0, false, REVEAL_MAX_WORDS_TOUCH);
    expect(p.count).toBe(REVEAL_MAX_WORDS_TOUCH); expect(p.skipped).toBe(80 - REVEAL_MAX_WORDS_TOUCH);
    expect(p.total).toBeLessThanOrEqual(REVEAL_TOTAL_MS + 1);
  });
  it('prefers-reduced-motion: все слова разом (шаг 0), короткое простое появление, лимита слов нет (размытия нет)', () => {
    const p = revealPlan(words(80), 0, true);
    expect(p.step).toBe(0); expect(p.count).toBe(80); expect(p.skipped).toBe(0);
    expect(p.fade).toBe(REVEAL_REDUCED_MS); expect(p.total).toBe(REVEAL_REDUCED_MS);
  });
});

describe('WordReveal поверх поля', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] }); });
  afterEach(() => { vi.runOnlyPendingTimers(); cleanup(); vi.useRealTimers(); });

  function Harness({ full, from = 0, reduced, onDone }: { full: string; from?: number; reduced?: boolean; onDone: () => void }) {
    const ta = useRef<HTMLTextAreaElement>(null);
    return createElement('div', { className: 'ta-wrap' },
      createElement('textarea', {
        ref: ta, 'data-testid': 'ta', defaultValue: full, className: 'is-reveal',
        style: { fontSize: '17px', fontFamily: 'Inter, sans-serif', lineHeight: '24px', letterSpacing: '0.2px', paddingTop: '8px', paddingRight: '12px', paddingBottom: '8px', paddingLeft: '12px' },
      }),
      createElement(WordReveal, { full, from, ta, onDone, reduced }));
  }
  const layer = () => screen.getByTestId('reveal');
  const spans = () => [...layer().querySelectorAll<HTMLElement>('.wr-w')];
  const delay = (e: HTMLElement) => parseInt(e.style.getPropertyValue('--d'), 10);

  it('новые слова — отдельные span-ы с шагом по времени; набранное раньше — обычным текстом без анимации', () => {
    const onDone = vi.fn();
    render(createElement(Harness, { full: 'Посчитай сколько позиций на складе', from: 'Посчитай'.length, onDone }));
    expect(spans().map((s) => s.textContent)).toEqual(['сколько', 'позиций', 'на', 'складе']);
    expect(layer().textContent).toBe('Посчитай сколько позиций на складе');
    const d = spans().map(delay);
    expect(d[0]).toBe(0);
    for (let i = 1; i < d.length; i++) { expect(d[i] - d[i - 1]).toBeGreaterThanOrEqual(25); expect(d[i] - d[i - 1]).toBeLessThanOrEqual(40); }
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    expect(layer().dataset.motion).toBe('blur');
    expect(layer().dataset.words).toBe('4');
    expect(onDone).not.toHaveBeenCalled();
  });

  it(`лимит: из 90 новых слов анимируется ${REVEAL_MAX_WORDS} (последние), остальные — обычным текстом`, () => {
    render(createElement(Harness, { full: words(90), onDone: () => {} }));
    expect(spans()).toHaveLength(REVEAL_MAX_WORDS);
    expect(spans()[0].textContent).toBe('w30');
    expect(layer().dataset.skipped).toBe('30');
    expect(layer().textContent).toBe(words(90));
  });

  it('шрифт, межстрочье, отступы поля копируются на стопку; прокрутка поля повторяется', () => {
    render(createElement(Harness, { full: 'раз два три', onDone: () => {} }));
    const t = layer().firstElementChild as HTMLElement;
    expect(t.style.getPropertyValue('font-size')).toBe('17px');
    expect(t.style.getPropertyValue('line-height')).toBe('24px');
    expect(t.style.getPropertyValue('letter-spacing')).toBe('0.2px');
    expect(t.style.getPropertyValue('padding-left')).toBe('12px');
    expect(t.style.getPropertyValue('padding-top')).toBe('8px');
    expect(t.style.getPropertyValue('font-family')).toContain('Inter');
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    Object.defineProperty(ta, 'clientWidth', { configurable: true, value: 301 });
    ta.scrollTop = 48;
    fireEvent.scroll(ta);
    expect(layer().style.width).toBe('301px');
    expect(t.style.transform).toBe('translateY(-48px)');
  });

  it('конец: доигран подъём последнего слова (animationend) — один раз; раньше проявление/размытие других слов не кончает', () => {
    const onDone = vi.fn();
    render(createElement(Harness, { full: 'раз два три', onDone }));
    const [a, , c] = spans();
    const ev = (el: HTMLElement, animationName: string) => { fireEvent(el, new AnimationEvent('animationend', { bubbles: true, animationName } as AnimationEventInit)); };
    ev(a, 'wr-tr'); ev(c, 'wr-op');
    expect(onDone).not.toHaveBeenCalled();
    ev(c, 'wr-tr');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('запасной таймер: animationend не пришёл — копия снимается после расчётного конца + запас', () => {
    const onDone = vi.fn();
    render(createElement(Harness, { full: 'раз два три', onDone }));
    const total = revealPlan('раз два три', 0).total;
    act(() => { vi.advanceTimersByTime(total + REVEAL_GRACE_MS - 5); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(10); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['клавиша', (ta: HTMLElement) => fireEvent.keyDown(ta, { key: 'a' })],
    ['Backspace', (ta: HTMLElement) => fireEvent.keyDown(ta, { key: 'Backspace' })],
    ['стрелка', (ta: HTMLElement) => fireEvent.keyDown(ta, { key: 'ArrowLeft' })],
    ['нажатие в поле (курсор / выделение)', (ta: HTMLElement) => fireEvent.pointerDown(ta)],
    ['вставка', (ta: HTMLElement) => fireEvent.paste(ta)],
    ['ввод (beforeinput)', (ta: HTMLElement) => fireEvent(ta, new Event('beforeinput', { bubbles: true }))],
    ['IME', (ta: HTMLElement) => fireEvent.compositionStart(ta)],
  ])('%s в поле во время анимации — копия снимается сразу', (_n, act1) => {
    const onDone = vi.fn();
    render(createElement(Harness, { full: 'раз два три', onDone }));
    act1(screen.getByTestId('ta'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('одни модификаторы (Shift, Ctrl) анимацию не прерывают — Ctrl+A и Shift+стрелка начинаются с них', () => {
    const onDone = vi.fn();
    render(createElement(Harness, { full: 'раз два три', onDone }));
    const ta = screen.getByTestId('ta');
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) fireEvent.keyDown(ta, { key });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: 'a', ctrlKey: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reduced-motion: простое появление — все слова с задержкой 0, без размытия (data-motion=fade, .wr--rm)', () => {
    render(createElement(Harness, { full: words(10), reduced: true, onDone: () => {} }));
    expect(layer().dataset.motion).toBe('fade');
    expect(layer().classList.contains('wr--rm')).toBe(true);
    expect(spans().map(delay)).toEqual(Array(10).fill(0));
    expect((layer().firstElementChild as HTMLElement).style.getPropertyValue('--wr-fade')).toBe(REVEAL_REDUCED_MS + 'ms');
  });
});

describe('диктовка в поле ввода (Composer): набор прерывает анимацию', () => {
  let phrase = 'Сколько позиций на складе?';
  const sent: string[] = [];
  const mount = () => render(createElement(Composer, { busy: false, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSend: (t: string) => { sent.push(t); } }));
  const input = () => screen.getByTestId('composer-input') as HTMLTextAreaElement;
  const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const media = (reduced: boolean, coarse = false) => {
    window.matchMedia = ((q: string) => ({ matches: (q.includes('pointer: fine') && !coarse) || (coarse && q.includes('pointer: coarse')) || (reduced && q.includes('reduced-motion')), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  };
  async function dictate() {
    fireEvent.click(screen.getByTestId('mic'), { detail: 0 });
    await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(620);
  }
  const wr = () => document.querySelector<HTMLElement>('[data-testid=reveal]');
  const newWords = () => [...document.querySelectorAll('[data-testid=reveal] .wr-w')].map((e) => e.textContent);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    sent.length = 0; phrase = 'Сколько позиций на складе?'; localStorage.clear(); media(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ text: M + phrase }) } as Response)));
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => { vi.runOnlyPendingTimers(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('к набранному дописывается диктовка: проявляются только её слова, набранное — обычным текстом', async () => {
    mount();
    fireEvent.change(input(), { target: { value: 'Посчитай' } });
    await dictate();
    expect(input().value).toBe(M + 'Посчитай Сколько позиций на складе?');
    expect(newWords()).toEqual(['Сколько', 'позиций', 'на', 'складе?']);
    expect(wr()!.textContent).toBe(M + 'Посчитай Сколько позиций на складе?');
    expect(input().classList.contains('is-reveal')).toBe(true);
  });

  it('вторая диктовка: слова первой уже не анимируются', async () => {
    mount();
    await dictate();
    await tick(2000);
    expect(wr()).toBeNull();
    phrase = 'и ещё одно предложение';
    await dictate();
    expect(newWords()).toEqual(['и', 'ещё', 'одно', 'предложение']);
    expect(wr()!.textContent).toContain('Сколько позиций на складе? и ещё одно предложение');
  });

  it('набор текста в поле во время анимации сразу снимает копию; поле снова показывает свой текст', async () => {
    mount();
    await dictate();
    expect(wr()).not.toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(true);
    fireEvent.change(input(), { target: { value: M + 'Сколько позиций на складе?!' } });
    expect(wr()).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
    expect(input().value).toBe(M + 'Сколько позиций на складе?!');
  });

  it('клавиша в поле (без изменения текста, например стрелка) тоже снимает копию', async () => {
    mount();
    await dictate();
    expect(wr()).not.toBeNull();
    fireEvent.keyDown(input(), { key: 'ArrowLeft' });
    expect(wr()).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
  });

  it('нажатие в поле (поставить курсор / выделить) снимает копию — курсор и выделение работают по настоящему тексту', async () => {
    mount();
    await dictate();
    fireEvent.pointerDown(input());
    expect(wr()).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
  });

  it('«Отправить» во время анимации: копии нет, текст ушёл, поле пустое', async () => {
    mount();
    await dictate();
    fireEvent.click(screen.getByTestId('send'));
    expect(sent).toEqual([M + 'Сколько позиций на складе?']);
    expect(wr()).toBeNull();
    expect(input().value).toBe('');
  });

  it('анимация доигрывает сама: без вмешательства копия снимается', async () => {
    mount();
    await dictate();
    expect(wr()).not.toBeNull();
    await tick(1500);
    expect(wr()).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
    expect(input().value).toBe(M + 'Сколько позиций на складе?');
  });

  it('диктовка на 80 слов: анимируются последние 60, текст в поле целиком', async () => {
    phrase = words(80);
    mount();
    await dictate();
    expect(newWords()).toHaveLength(REVEAL_MAX_WORDS);
    expect(newWords()[0]).toBe('w20');
    expect(input().value).toBe(M + words(80));
    expect(wr()!.textContent).toBe(M + words(80));
  });

  it(`на телефоне (pointer: coarse) из 80 слов анимируются последние ${REVEAL_MAX_WORDS_TOUCH}`, async () => {
    media(false, true);
    phrase = words(80);
    mount();
    await dictate();
    expect(newWords()).toHaveLength(REVEAL_MAX_WORDS_TOUCH);
    expect(newWords()[0]).toBe('w40');
    expect(wr()!.textContent).toBe(M + words(80));
  });

  it('после диктовки курсор в конце, поле прокручено к концу — без requestAnimationFrame (раньше он мог сработать до возврата поля); фокус на десктопе', async () => {
    const st = new WeakMap<Element, number>();
    const hd = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return st.get(this) ?? 0; }, set(v: number) { st.set(this, v); } });
    const hs = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 480 });
    try {
      mount();
      await dictate();
      expect(input().selectionStart).toBe(input().value.length);
      expect(input().selectionEnd).toBe(input().value.length);
      expect(input().scrollTop).toBe(480);
      expect(document.activeElement).toBe(input());
    } finally {
      if (hd) Object.defineProperty(Element.prototype, 'scrollTop', hd); else delete (Element.prototype as unknown as Record<string, unknown>).scrollTop;
      delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      if (hs) Object.defineProperty(Element.prototype, 'scrollHeight', hs);
    }
  });

  it('на телефоне после диктовки поле не получает фокус (клавиатура не выезжает)', async () => {
    media(false, true);
    mount();
    await dictate();
    expect(document.activeElement).not.toBe(input());
    expect(input().selectionStart).toBe(input().value.length);
  });

  it('reduced-motion: копия есть, но это простое появление (не размытие), слова разом', async () => {
    media(true);
    mount();
    await dictate();
    expect(wr()!.dataset.motion).toBe('fade');
    await tick(REVEAL_REDUCED_MS + REVEAL_GRACE_MS + 50);
    expect(wr()).toBeNull();
  });
});
