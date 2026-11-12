import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ETA_MAX_S, ETA_MIN_S, ETA_START_S, etaFor, etaNextFor, ewma, fmtEta, ordinal } from '@/lib/queueEta';
import { BUSY_OFF_HOLD_MS, BUSY_ON_HOLD_MS, busyBanner, busyInit, busyOn, busyStep, busyText, type BusyAuto } from '@/lib/announce';

describe('скользящее среднее длительности хода', () => {
  it('старт 30 с; новый ход входит с весом 0,25; результат всегда в пределах 5…300 с', () => {
    expect(ETA_START_S).toBe(30);
    expect(ewma(30, 70)).toBeCloseTo(0.25 * 70 + 0.75 * 30, 6);
    expect(ewma(30, 10)).toBeCloseTo(25, 6);
    expect(ewma(30, 1800)).toBeCloseTo(0.25 * ETA_MAX_S + 0.75 * 30, 6);
    expect(ewma(290, 1800)).toBeLessThanOrEqual(ETA_MAX_S);
    expect(ewma(30, 0.2)).toBeCloseTo(0.25 * ETA_MIN_S + 0.75 * 30, 6);
    expect(ewma(5, 0.1)).toBe(5);
    expect(ewma(42, NaN)).toBe(42);
    expect(ewma(42, 0)).toBe(42);
    expect(ewma(42, -3)).toBe(42);
    expect(ewma(Infinity, 20)).toBeGreaterThanOrEqual(ETA_MIN_S);
  });
  it('сходится к настоящей длительности', () => {
    let a = ETA_START_S;
    for (let i = 0; i < 40; i++) a = ewma(a, 90);
    expect(a).toBeCloseTo(90, 1);
  });
});

describe('ожидание места в очереди', () => {
  it('ceil((впереди + 1) / лимит) × среднее', () => {
    expect(etaFor(0, 5, 30)).toBe(30);
    expect(etaFor(4, 5, 30)).toBe(30);
    expect(etaFor(5, 5, 30)).toBe(60);
    expect(etaFor(2, 1, 30)).toBe(90);
    expect(etaFor(7, 2, 40)).toBe(160);
    expect(etaFor(0, 1, 23.75)).toBe(24);
  });
  it('мусор на входе не ломает: отрицательное «впереди», нулевой лимит, среднее вне пределов', () => {
    expect(etaFor(-3, 0, 30)).toBe(30);
    expect(etaFor(NaN, NaN, 30)).toBe(30);
    expect(etaFor(0, 1, 1)).toBe(ETA_MIN_S);
    expect(etaFor(0, 1, 10_000)).toBe(ETA_MAX_S);
  });
  it('etaNext: места есть и очереди нет — ждать не надо; иначе как последнему в очереди', () => {
    expect(etaNextFor(0, 0, 5, 30)).toBe(0);
    expect(etaNextFor(4, 0, 5, 30)).toBe(0);
    expect(etaNextFor(5, 0, 5, 30)).toBe(30);
    expect(etaNextFor(5, 5, 5, 30)).toBe(60);
    expect(etaNextFor(1, 2, 1, 30)).toBe(90);
  });
  it('словами: до минуты «~N с» (шаг 5), 60–120 «~1–2 мин», дольше «больше 2 мин»', () => {
    expect(fmtEta(40)).toBe('~40 с');
    expect(fmtEta(37)).toBe('~35 с');
    expect(fmtEta(2)).toBe('~5 с');
    expect(fmtEta(58)).toBe('~55 с');
    expect(fmtEta(59.9)).toBe('~55 с');
    expect(fmtEta(60)).toBe('~1–2 мин');
    expect(fmtEta(120)).toBe('~1–2 мин');
    expect(fmtEta(121)).toBe('больше 2 мин');
    expect(fmtEta(900)).toBe('больше 2 мин');
    expect(ordinal(3)).toBe('3-й');
  });
});

function run(start: BusyAuto, t0: number, seconds: number, eta: (sec: number) => number): BusyAuto[] {
  const out: BusyAuto[] = [];
  let s = start;
  for (let sec = 5; sec <= seconds; sec += 5) { s = busyStep(s, eta(sec), t0 + sec * 1000); out.push(s); }
  return out;
}

describe('режим высокой нагрузки: гистерезис', () => {
  const T0 = 1_000_000;
  it('ВКЛ: ожидание ≥ 60 с держится ≥ 20 с подряд; раньше — нет', () => {
    let s = busyStep(busyInit(), 70, T0);
    expect(s.on).toBe(false);
    s = busyStep(s, 70, T0 + 5_000); expect(s.on).toBe(false);
    s = busyStep(s, 70, T0 + 15_000); expect(s.on).toBe(false);
    s = busyStep(s, 70, T0 + BUSY_ON_HOLD_MS - 1); expect(s.on).toBe(false);
    s = busyStep(s, 70, T0 + BUSY_ON_HOLD_MS); expect(s.on).toBe(true);
    expect(s.since).toBe(T0 + BUSY_ON_HOLD_MS);
  });
  it('короткий всплеск (< 20 с) отсчёт сбрасывает: 15 с жарко, провал, снова 15 с — не включилось', () => {
    const r = run(busyInit(), T0, 60, (sec) => (sec <= 15 ? 90 : sec === 20 ? 10 : sec <= 35 ? 90 : 10));
    expect(r.every((x) => !x.on)).toBe(true);
  });
  it('ожидание ровно 60 с считается; 59 с — нет', () => {
    expect(run(busyInit(), T0, 30, () => 60).at(-1)!.on).toBe(true);
    expect(run(busyInit(), T0, 600, () => 59).at(-1)!.on).toBe(false);
  });
  it('ВЫКЛ: ожидание < 20 с держится ≥ 120 с подряд; на 119 с ещё включён', () => {
    const on = run(busyInit(), T0, 30, () => 120).at(-1)!;
    expect(on.on).toBe(true);
    const t1 = T0 + 30_000;
    let s = busyStep(on, 5, t1);
    s = busyStep(s, 5, t1 + 60_000); expect(s.on).toBe(true);
    s = busyStep(s, 5, t1 + BUSY_OFF_HOLD_MS - 1_000); expect(s.on).toBe(true);
    s = busyStep(s, 5, t1 + BUSY_OFF_HOLD_MS); expect(s.on).toBe(false);
    expect(s.since).toBeNull();
  });
  it('между 20 и 60 с режим держит прежнее: включённый не гаснет, выключенный не включается (баннер не мигает)', () => {
    const on = run(busyInit(), T0, 30, () => 120).at(-1)!;
    expect(run(on, T0 + 30_000, 1_000, () => 40).every((x) => x.on)).toBe(true);
    expect(run(busyInit(), T0, 1_000, () => 40).every((x) => !x.on)).toBe(true);
  });
  it('включённый: всплеск ≥ 20 с во время «спокойного» отрезка сбрасывает отсчёт 120 с', () => {
    const on = run(busyInit(), T0, 30, () => 120).at(-1)!;
    const t1 = T0 + 30_000;
    const r = run(on, t1, 100 + 5 + 110, (sec) => (sec > 100 && sec <= 105 ? 25 : 5));
    expect(r.every((x) => x.on)).toBe(true);
    const r2 = run(r.at(-1)!, t1 + 215_000, 30, () => 5);
    expect(r2.at(-1)!.on).toBe(false);
  });
  it('полный цикл «жарко -> спокойно» мигает ровно один раз в каждую сторону', () => {
    const r = run(busyInit(), T0, 600, (sec) => (sec <= 120 ? 100 : 5));
    const flips = r.filter((x, i) => x.on !== (i ? r[i - 1].on : false)).length;
    expect(flips).toBe(2);
  });
});

describe('баннер режима', () => {
  it('точный текст из задания; N — ожидание в минутах, округлённо', () => {
    expect(busyText(60)).toBe('Сейчас высокая нагрузка — ответы могут задерживаться (~1 мин). Сообщения обрабатываются по очереди, место в очереди видно в чате.');
    expect(busyText(100)).toContain('(~2 мин)');
    expect(busyText(240)).toContain('(~4 мин)');
    expect(busyText(40)).toContain('(~1 мин)');
  });
  it('при принудительном «Вкл» и пустой очереди — без числа', () => {
    expect(busyText(0)).toBe('Сейчас высокая нагрузка — ответы могут задерживаться. Сообщения обрабатываются по очереди, место в очереди видно в чате.');
    expect(busyText(10)).not.toContain('~');
  });
  it('id busy, уровень info; ручной выбор сильнее автоматического', () => {
    expect(busyBanner(60, 'b1')).toMatchObject({ id: 'busy', level: 'info', sig: 'b1' });
    expect(busyOn('auto', true)).toBe(true);
    expect(busyOn('auto', false)).toBe(false);
    expect(busyOn('off', true)).toBe(false);
    expect(busyOn('on', false)).toBe(true);
  });
});
