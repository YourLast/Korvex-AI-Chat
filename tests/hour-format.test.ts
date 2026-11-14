import { afterEach, describe, expect, it } from 'vitest';
import { fmtHM, from12, hour12Of, parseHM, setClockLocales, to12 } from '@/lib/hourFormat';
import { describeSchedule, relTime } from '@/lib/schedule';

afterEach(() => setClockLocales(null));
const AT = Date.UTC(2026, 10, 14, 7, 5);

describe('формат часов', () => {
  it('ru и sr — всегда 24 ч, даже при английском регионе браузера', () => {
    setClockLocales(['en-US']);
    expect(hour12Of('ru')).toBe(false);
    expect(hour12Of('sr')).toBe(false);
    expect(fmtHM('21:00', 'ru')).toBe('21:00');
    expect(relTime(AT, 'Europe/Berlin', AT, 'ru')).toBe('сегодня в 8:05');
  });
  it('en-US — 12 ч с AM/PM; en-GB и en-150 — 24 ч', () => {
    setClockLocales(['en-US']);
    expect(hour12Of('en')).toBe(true);
    expect(fmtHM('09:00', 'en')).toBe('9:00\u00a0AM');
    expect(fmtHM('21:30', 'en')).toBe('9:30\u00a0PM');
    expect(fmtHM('00:15', 'en')).toBe('12:15\u00a0AM');
    expect(relTime(AT, 'Europe/Berlin', AT, 'en')).toMatch(/8:05\s?AM/);
    expect(describeSchedule('0 21 * * *', 'en')).toContain('9:00\u00a0PM');
    for (const l of ['en-GB', 'en-150']) {
      setClockLocales([l]);
      expect(hour12Of('en'), l).toBe(false);
      expect(fmtHM('21:00', 'en')).toBe('21:00');
      expect(relTime(AT, 'Europe/Berlin', AT, 'en')).not.toMatch(/AM|PM/);
      expect(describeSchedule('0 21 * * *', 'en')).toContain('21:00');
    }
  });
  it('перевод 12 ↔ 24 ч и разбор «ЧЧ:ММ»', () => {
    expect(to12(0)).toEqual({ h: 12, pm: false });
    expect(to12(12)).toEqual({ h: 12, pm: true });
    expect(to12(23)).toEqual({ h: 11, pm: true });
    expect(from12(12, false)).toBe(0);
    expect(from12(12, true)).toBe(12);
    expect(from12(9, true)).toBe(21);
    expect(parseHM('24:00')).toBeNull();
    expect(parseHM('7:05')).toEqual({ h: 7, m: 5 });
  });
});
