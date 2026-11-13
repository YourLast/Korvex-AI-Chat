import { describe, expect, it } from 'vitest';
import { MARKER } from '@/lib/turn';
import {
  CANCEL_PX, Leveler, SilenceWatch, VOICE_MARKER, barLevel, envOf, fmtDur, holdProgress, holdState, joinText, micError, pickMime, readAutoSend, revealFrom, revealPlan, REVEAL_TOTAL_MS, rmsDb, sttError,
} from '@/lib/voiceLogic';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';

describe('маркер голоса', () => {
  it('тот же, что у серверной сборки хода (U+2060 U+200C U+2060)', () => {
    expect(VOICE_MARKER).toBe(MARKER);
    expect([...VOICE_MARKER].map((c) => c.codePointAt(0)!.toString(16))).toEqual(['2060', '200c', '2060']);
  });
});

describe('уровень и волна', () => {
  it('rmsDb: тишина −120, полная синусоида ≈ −3 dBFS, −20 дБ', () => {
    expect(rmsDb(new Float32Array(512))).toBe(-120);
    const s = Float32Array.from({ length: 1600 }, (_, i) => Math.sin((2 * Math.PI * i) / 32));
    expect(rmsDb(s)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(s.map((x) => x * 0.1))).toBeCloseTo(-23.01, 1);
  });
  it('barLevel: −60 и ниже — ноль, −12 и выше — полный, между — монотонно', () => {
    expect(barLevel(-90)).toBe(0); expect(barLevel(-60)).toBe(0); expect(barLevel(-12)).toBe(1); expect(barLevel(0)).toBe(1);
    expect(barLevel(-36)).toBeCloseTo(0.5, 5);
    expect(barLevel(-30)).toBeGreaterThan(barLevel(-40));
  });
});

describe('«Не слышу»', () => {
  it('горит после 2 с почти тишины подряд и гаснет на первом громком кадре', () => {
    const w = new SilenceWatch(2000, -50);
    expect(w.feed(0, -70)).toBe(false);
    expect(w.feed(1000, -65)).toBe(false);
    expect(w.feed(1999, -65)).toBe(false);
    expect(w.feed(2000, -65)).toBe(true);
    expect(w.feed(2100, -30)).toBe(false);
    expect(w.feed(3000, -70)).toBe(false);
    expect(w.feed(5000, -70)).toBe(true);
  });
  it('речь с короткими паузами подсказку не зажигает', () => {
    const w = new SilenceWatch();
    let lit = false;
    for (let t = 0; t < 10000; t += 50) lit ||= w.feed(t, (t % 1500) < 900 ? -28 : -62);
    expect(lit).toBe(false);
  });
});

describe('усиление до целевого уровня', () => {
  it('тихая речь (−44 dBFS) -> +20 дБ до цели −24; громкая не ослабляется; потолок 24 дБ', () => {
    const l = new Leveler(-24, 24);
    for (let i = 0; i < 40; i++) l.feed(-44);
    expect(l.gain()).toBeCloseTo(20, 0);
    const loud = new Leveler(-24, 24);
    for (let i = 0; i < 40; i++) loud.feed(-12);
    expect(loud.gain()).toBe(0);
    const faint = new Leveler(-24, 24, -70);
    for (let i = 0; i < 40; i++) faint.feed(-60);
    expect(faint.gain()).toBe(24);
  });
  it('шум в паузах (ниже порога) усиление не трогает', () => {
    const l = new Leveler(-24, 24);
    for (let i = 0; i < 40; i++) l.feed(-34);
    const g = l.gain();
    for (let i = 0; i < 200; i++) l.feed(-75);
    expect(l.gain()).toBe(g);
    expect(new Leveler().feed(-80)).toBe(0);
  });
});

describe('формат записи', () => {
  const all = (m: string) => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'].includes(m);
  it('Chrome — webm/opus, Safari и iPhone (в том числе Chrome на iPhone) — audio/mp4', () => {
    expect(pickMime(all, CHROME)).toBe('audio/webm;codecs=opus');
    expect(pickMime(all, IPHONE)).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickMime(all, MAC_SAFARI)).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickMime(all, IOS_CHROME)).toBe('audio/mp4;codecs=mp4a.40.2');
  });
  it('старый Safari без mp4 — то, что есть; ничего — пусто (браузер выберет сам)', () => {
    expect(pickMime((m) => m === 'audio/webm', IPHONE)).toBe('audio/webm');
    expect(pickMime(() => false, CHROME)).toBe('');
    expect(pickMime(() => { throw new Error('x'); }, CHROME)).toBe('');
  });
});

describe('ошибки по-человечески', () => {
  const ios = envOf(IPHONE, false, true), iosApp = envOf(IPHONE, true, true), desk = envOf(CHROME, false, true), mac = envOf(MAC_SAFARI, false, true);
  it('нет доступа к микрофону: на iPhone — где включить (Safari и приложение с экрана «Домой»)', () => {
    const e = micError({ name: 'NotAllowedError' }, ios);
    expect(e.kind).toBe('mic-denied');
    expect(e.title).toBe('Нет доступа к микрофону');
    expect(e.hint).toContain('Настройки веб-сайта');
    expect(e.hint).toContain('Safari → Микрофон');
    expect(micError({ name: 'NotAllowedError' }, iosApp).hint).toContain('Настройки → Приложения → Safari → Микрофон');
    expect(micError({ name: 'NotAllowedError' }, desk).hint).toContain('значок слева от адреса');
    expect(micError({ name: 'NotAllowedError' }, mac).hint).toContain('Системные настройки');
    expect(e.action).toBe('record');
  });
  it('нет микрофона, занят, не https, нет записи в браузере', () => {
    expect(micError({ name: 'NotFoundError' }, desk).kind).toBe('mic-missing');
    expect(micError({ name: 'NotReadableError' }, desk).title).toBe('Микрофон занят');
    expect(micError({ name: 'NotAllowedError' }, { ...desk, secure: false }).kind).toBe('insecure');
    expect(micError({ name: 'NoMediaRecorder' }, desk).kind).toBe('unsupported');
    expect(micError(new Error('?'), desk).action).toBe('record');
  });
  it('распознавание: текст есть — не ошибка; пустой — «Не удалось разобрать»; сервис лёг — «недоступен» и повтор той же записи', () => {
    expect(sttError(200, undefined, VOICE_MARKER + 'привет')).toBeNull();
    const empty = sttError(200, undefined, '');
    expect(empty?.title).toBe('Не удалось разобрать, попробуйте ещё раз');
    expect(sttError(200, undefined, VOICE_MARKER + '  ')?.kind).toBe('empty');
    for (const s of [0, 502, 503, 504]) {
      const d = sttError(s, s ? 'stt_down' : undefined, '');
      expect(d?.kind).toBe('stt-down');
      expect(d?.title).toBe('Сервис распознавания сейчас недоступен');
      expect(d?.action).toBe('resend');
    }
    expect(sttError(422, 'stt_bad_audio', '')?.kind).toBe('stt-bad');
    expect(sttError(413, undefined, '')?.kind).toBe('too-big');
  });
});

describe('склейка расшифровки с набранным текстом', () => {
  it('пустое поле — расшифровка с маркером; набранное — через пробел, маркер один и в начале', () => {
    expect(joinText('', VOICE_MARKER + 'Сколько позиций?')).toBe(VOICE_MARKER + 'Сколько позиций?');
    expect(joinText('Посчитай  ', VOICE_MARKER + 'сумму по кусту.')).toBe(VOICE_MARKER + 'Посчитай сумму по кусту.');
    const twice = joinText(joinText('', VOICE_MARKER + 'Раз.'), VOICE_MARKER + 'Два.');
    expect(twice).toBe(VOICE_MARKER + 'Раз. Два.');
    expect(twice.split(VOICE_MARKER).length - 1).toBe(1);
    expect(joinText('без голоса', 'текст')).toBe('без голоса текст');
  });
});

describe('«зажми и говори»', () => {
  it('влево дальше порога — отмена; вправо и чуть влево — держим', () => {
    expect(holdState(0)).toBe('hold'); expect(holdState(40)).toBe('hold'); expect(holdState(-CANCEL_PX + 1)).toBe('hold');
    expect(holdState(-CANCEL_PX)).toBe('cancel'); expect(holdState(-300)).toBe('cancel');
    expect(holdProgress(0)).toBe(0); expect(holdProgress(-CANCEL_PX / 2)).toBe(0.5); expect(holdProgress(-999)).toBe(1); expect(holdProgress(50)).toBe(0);
  });
});

describe('прочее', () => {
  it('таймер, настройка «отправлять сразу» (битое хранилище — выкл)', () => {
    expect(fmtDur(0)).toBe('0:00'); expect(fmtDur(7.9)).toBe('0:07'); expect(fmtDur(65)).toBe('1:05'); expect(fmtDur(-3)).toBe('0:00');
    expect(readAutoSend(() => '1')).toBe(true);
    expect(readAutoSend(() => null)).toBe(false);
    expect(readAutoSend(() => { throw new Error('private'); })).toBe(false);
  });
});

describe('проявление слов', () => {
  it('набранное раньше видно сразу, новое — по словам; 25–40 мс на слово, всё не дольше REVEAL_TOTAL_MS', () => {
    const full = joinText('Посчитай', VOICE_MARKER + 'сколько позиций на складе');
    const from = revealFrom(full, 'Посчитай');
    const p = revealPlan(full, from);
    expect(p.head).toBe(VOICE_MARKER + 'Посчитай');
    expect(p.parts.filter((x) => x.w).map((x) => x.t)).toEqual(['сколько', 'позиций', 'на', 'складе']);
    expect(p.parts.map((x) => x.t).join('')).toBe(full.slice(from));
    expect(p.step).toBeGreaterThanOrEqual(25); expect(p.step).toBeLessThanOrEqual(40);
    expect(p.fade).toBeGreaterThanOrEqual(350); expect(p.fade).toBeLessThanOrEqual(450);
    expect(p.total).toBeLessThanOrEqual(REVEAL_TOTAL_MS);
    expect(p.total).toBe(Math.round(3 * p.step + p.rise));
  });
  it('длинный текст сжимает шаг, но не дольше REVEAL_TOTAL_MS; пустой — без анимации', () => {
    const long = VOICE_MARKER + Array.from({ length: 50 }, (_, i) => 'слово' + i).join(' ');
    const p = revealPlan(long, revealFrom(long, ''));
    expect(p.head).toBe(VOICE_MARKER);
    expect(p.count).toBe(50);
    expect(p.step).toBeLessThan(25); expect(p.step).toBeGreaterThanOrEqual(10); expect(p.total).toBeLessThanOrEqual(REVEAL_TOTAL_MS + 1);
    expect(revealPlan('', 0).total).toBe(0);
    expect(revealPlan('', 0).count).toBe(0);
  });
});
