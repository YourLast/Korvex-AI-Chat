import { describe, expect, it } from 'vitest';
import { cleanTz, DEFAULT_TZ, isValidTz, tzOrDefault, withTimezone } from '@/lib/tz';

describe('проверка пояса', () => {
  it('принимает IANA-имена и UTC', () => {
    for (const z of ['UTC', 'Europe/Moscow', 'Asia/Dubai', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'Etc/GMT+3', 'Asia/Ho_Chi_Minh']) expect(isValidTz(z), z).toBe(true);
  });
  it('отбрасывает мусор, пробелы, переводы строк и инъекции в заголовок', () => {
    for (const z of ['', ' ', 'Europe/Moscow\r\nX-Evil: 1', 'Europe/Moscow ', '../etc/passwd', 'Europe//Moscow', 'a/b/c/d', 'Foo/Bar', '<script>', 'Москва', 'x'.repeat(65)]) expect(isValidTz(z), JSON.stringify(z)).toBe(false);
    for (const z of [null, undefined, 5, {}, []]) expect(isValidTz(z)).toBe(false);
  });
  it('cleanTz / tzOrDefault: невалидное -> null / UTC', () => {
    expect(cleanTz('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(cleanTz('nope!')).toBeNull();
    expect(tzOrDefault('nope!')).toBe(DEFAULT_TZ);
    expect(tzOrDefault(undefined)).toBe('UTC');
  });
});

describe('{{CURRENT_TIMEZONE}} в системном промпте', () => {
  const p = 'Сейчас пояс пользователя: {{CURRENT_TIMEZONE}}. Повтор: {{CURRENT_TIMEZONE}}.';
  it('заменяет все вхождения', () => {
    expect(withTimezone(p, 'Europe/Moscow')).toBe('Сейчас пояс пользователя: Europe/Moscow. Повтор: Europe/Moscow.');
  });
  it('нет пояса или он невалиден -> UTC (значение не подставляется как есть)', () => {
    expect(withTimezone(p)).toContain('пользователя: UTC.');
    expect(withTimezone(p, 'x\ny')).toContain('пользователя: UTC.');
    expect(withTimezone(p, 'x\ny')).not.toContain('x\ny');
  });
  it('промпт без переменной не меняется', () => {
    expect(withTimezone('Ты — модель.', 'Asia/Dubai')).toBe('Ты — модель.');
  });
});
