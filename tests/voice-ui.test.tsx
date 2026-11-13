// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

type Lv = { raw: number; out: number; gain: number } | null;
const ctl = vi.hoisted(() => ({
  level: { raw: -30, out: -20, gain: 6 } as { raw: number; out: number; gain: number } | null,
  fail: null as null | { name: string },
  started: 0, stopped: 0, cancelled: 0,
}));
vi.mock('@/lib/recorder', () => ({
  prepareAudio: () => null,
  buzz: () => {},
  startRecorder: async () => {
    if (ctl.fail) throw ctl.fail;
    ctl.started++;
    const t0 = Date.now();
    return {
      mime: 'audio/webm;codecs=opus', processed: true,
      levels: (): Lv => ctl.level,
      stop: async (tail = 0) => { await new Promise((r) => setTimeout(r, tail)); ctl.stopped++; return { blob: new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), mime: 'audio/webm', ms: Math.max(2000, Date.now() - t0), rawMax: -25, processed: true }; },
      cancel: () => { ctl.cancelled++; },
    };
  },
}));

import { Composer } from '@/components/Composer';
import { VOICE_MARKER } from '@/lib/voiceLogic';

const M = VOICE_MARKER;
let replies: Array<{ status: number; body: unknown }> = [];
let calls = 0;
const sent: Array<{ text: string }> = [];

function mount() {
  return render(createElement(Composer, { busy: false, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSend: (text: string) => { sent.push({ text }); } }));
}
const input = () => screen.getByTestId('composer-input') as HTMLTextAreaElement;
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  ctl.level = { raw: -30, out: -20, gain: 6 }; ctl.fail = null; ctl.started = ctl.stopped = ctl.cancelled = 0;
  replies = []; calls = 0; sent.length = 0;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls++;
    expect(url).toBe('/api/transcribe');
    const r = replies.shift() ?? { status: 200, body: { text: M + 'Сколько позиций на складе?' } };
    return { status: r.status, ok: r.status < 400, json: async () => r.body } as Response;
  }));
  window.matchMedia = ((q: string) => ({ matches: q.includes('pointer: fine'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => { vi.runOnlyPendingTimers(); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function tapMic() {
  const mic = screen.getByTestId('mic');
  fireEvent.click(mic, { detail: 0 });
  await tick(10);
}

describe('запись с кнопками (тап)', () => {
  it('тап -> полоса записи с «Отмена» и «Готово» -> «Распознаю…» -> текст в поле для правки, не отправлен', async () => {
    mount();
    await tapMic();
    expect(screen.getByTestId('rec').dataset.phase).toBe('rec');
    expect(screen.queryByTestId('composer-input')).toBeNull();
    expect(screen.getByTestId('rec-cancel').textContent).toContain('Отмена');
    expect(screen.getByTestId('rec-done').textContent).toContain('Готово');
    expect(screen.queryByTestId('send')).toBeNull();
    await tick(2500);
    expect(screen.getByTestId('rec-time').textContent).toBe('0:02');
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(0);
    expect(screen.getByTestId('rec').dataset.phase).toBe('stt');
    expect(screen.getByTestId('rec-stt').textContent).toBe('Распознаю…');
    await tick(800);
    expect(calls).toBe(1);
    expect(input().value).toBe(M + 'Сколько позиций на складе?');
    expect(sent).toHaveLength(0);
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('«Отмена» — ничего не отправляется на распознавание, поле возвращается', async () => {
    mount();
    fireEvent.change(input(), { target: { value: 'черновик' } });
    await tapMic();
    fireEvent.click(screen.getByTestId('rec-cancel'));
    await tick(800);
    expect(ctl.cancelled).toBe(1);
    expect(calls).toBe(0);
    expect(input().value).toBe('черновик');
  });

  it('Escape — отмена, Enter — «Готово»; расшифровка дописывается к набранному', async () => {
    mount();
    await tapMic();
    fireEvent.keyDown(window, { key: 'Escape' });
    await tick(10);
    expect(screen.queryByTestId('rec')).toBeNull();
    fireEvent.change(input(), { target: { value: 'Посчитай' } });
    await tapMic();
    await tick(1500);
    fireEvent.keyDown(window, { key: 'Enter' });
    await tick(800);
    expect(input().value).toBe(M + 'Посчитай Сколько позиций на складе?');
  });

  it('«Отправлять сразу после распознавания» — текст уходит модели сам', async () => {
    localStorage.setItem('kx.voice.send', '1');
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(800);
    expect(sent).toEqual([{ text: M + 'Сколько позиций на складе?' }]);
    expect(input().value).toBe('');
  });
});

describe('«не слышу»', () => {
  it('2 с почти тишины -> подсказка; заговорили -> гаснет', async () => {
    mount();
    ctl.level = { raw: -72, out: -70, gain: 24 };
    await tapMic();
    await tick(1200);
    expect(screen.queryByTestId('rec-quiet')).toBeNull();
    await tick(1200);
    expect(screen.getByTestId('rec-quiet').textContent).toBe('Не слышу — говорите ближе к микрофону');
    expect(screen.getByTestId('rec').className).toContain('is-quiet');
    ctl.level = { raw: -28, out: -18, gain: 4 };
    await tick(200);
    expect(screen.queryByTestId('rec-quiet')).toBeNull();
  });
  it('уровня нет (звуковая цепочка не запустилась) — подсказку не показываем', async () => {
    mount();
    ctl.level = null;
    await tapMic();
    await tick(3000);
    expect(screen.queryByTestId('rec-quiet')).toBeNull();
    expect(screen.getByTestId('rec').dataset.nolevel).toBe('1');
  });
});

describe('анимация «Распознаю…» и проявление слов', () => {
  it('текст пришёл: волны растворяются (is-land), затем слова проявляются поверх поля, поле сразу правится; правка снимает проявление', async () => {
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(300);
    expect(screen.getByTestId('rec').classList.contains('is-land')).toBe(true);
    expect(screen.queryByTestId('composer-input')).toBeNull();
    await tick(300);
    expect(screen.queryByTestId('rec')).toBeNull();
    expect(input().value).toBe(M + 'Сколько позиций на складе?');
    expect(input().classList.contains('is-reveal')).toBe(true);
    expect(screen.getByTestId('reveal').querySelectorAll('.wr-w')).toHaveLength(4);
    fireEvent.change(input(), { target: { value: M + 'Сколько позиций?' } });
    expect(screen.queryByTestId('reveal')).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
  });
  it('проявление кончается само, не позже ~1 с после последнего слова', async () => {
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(600); expect(screen.getByTestId('reveal')).toBeTruthy();
    await tick(1200); expect(screen.queryByTestId('reveal')).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
  });
  it('prefers-reduced-motion: без растворения волн; слова — простое появление разом, без размытия и сдвига', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('pointer: fine') || q.includes('reduced-motion'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(300);
    expect(input().value).toBe(M + 'Сколько позиций на складе?');
    const r = screen.getByTestId('reveal');
    expect(r.dataset.motion).toBe('fade');
    expect(r.classList.contains('wr--rm')).toBe(true);
    expect([...r.querySelectorAll<HTMLElement>('.wr-w')].map((w) => w.style.getPropertyValue('--d'))).toEqual(['0ms', '0ms', '0ms', '0ms']);
    await tick(600);
    expect(screen.queryByTestId('reveal')).toBeNull();
    expect(input().classList.contains('is-reveal')).toBe(false);
  });
});

describe('«зажми и говори»', () => {
  const down = (x = 300) => fireEvent.pointerDown(screen.getByTestId('mic'), { pointerId: 7, button: 0, clientX: x });
  const win = (type: string, x: number) => { const e = new Event(type) as PointerEvent; Object.assign(e, { pointerId: 7, clientX: x }); window.dispatchEvent(e); };
  it('удержание -> подпись «Влево — отмена»; отпустил -> распознавание', async () => {
    mount();
    down(); await tick(350);
    expect(screen.getByTestId('rec').dataset.mode).toBe('hold');
    expect(screen.getByTestId('rec-slide').textContent).toContain('Влево — отмена');
    expect(screen.getByTestId('mic').className).toContain('is-held');
    await tick(1500);
    await act(async () => { win('pointerup', 300); });
    await tick(800);
    expect(calls).toBe(1);
    expect(input().value).toContain('позиций');
  });
  it('свайп влево дальше порога — отмена без распознавания', async () => {
    mount();
    down(); await tick(800);
    await act(async () => { win('pointermove', 250); });
    expect(screen.getByTestId('rec')).toBeTruthy();
    await act(async () => { win('pointermove', 180); });
    await tick(50);
    expect(screen.queryByTestId('rec')).toBeNull();
    expect(ctl.cancelled).toBe(1);
    await act(async () => { win('pointerup', 180); });
    await tick(800);
    expect(calls).toBe(0);
  });
  it('короткое нажатие -> запись с кнопками (не обрывается)', async () => {
    mount();
    down(); await tick(100);
    await act(async () => { win('pointerup', 300); });
    await tick(50);
    expect(screen.getByTestId('rec').dataset.mode).toBe('tap');
    expect(screen.getByTestId('rec-done')).toBeTruthy();
  });
});

describe('ошибки', () => {
  it('нет доступа к микрофону на iPhone — подсказка, где включить', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true });
    ctl.fail = { name: 'NotAllowedError' };
    mount();
    await tapMic();
    const e = screen.getByTestId('voice-err');
    expect(e.dataset.kind).toBe('mic-denied');
    expect(e.textContent).toContain('Нет доступа к микрофону');
    expect(e.textContent).toContain('Настройки веб-сайта');
    expect(screen.getByTestId('composer-input')).toBeTruthy();
  });
  it('сервис распознавания недоступен -> «Отправить ещё раз» отправляет ту же запись', async () => {
    replies = [{ status: 503, body: { error: 'x', code: 'stt_down' } }];
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(800);
    const e = screen.getByTestId('voice-err');
    expect(e.textContent).toContain('Сервис распознавания сейчас недоступен');
    expect(screen.getByTestId('voice-retry').textContent).toBe('Отправить ещё раз');
    fireEvent.click(screen.getByTestId('voice-retry'));
    await tick(800);
    expect(calls).toBe(2);
    expect(ctl.started).toBe(1);
    expect(screen.queryByTestId('voice-err')).toBeNull();
    expect(input().value).toContain('позиций');
  });
  it('пустой результат — «Не удалось разобрать, попробуйте ещё раз» и «Записать снова»', async () => {
    replies = [{ status: 200, body: { text: '' } }];
    mount();
    await tapMic(); await tick(1500);
    fireEvent.click(screen.getByTestId('rec-done'));
    await tick(800);
    expect(screen.getByTestId('voice-err').textContent).toContain('Не удалось разобрать, попробуйте ещё раз');
    fireEvent.click(screen.getByTestId('voice-retry'));
    await tick(10);
    expect(screen.getByTestId('rec').dataset.phase).toBe('rec');
  });
});
