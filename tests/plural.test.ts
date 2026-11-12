import { describe, expect, it } from 'vitest';
import { count, plural, W } from '@/lib/plural';

describe('plural (Intl.PluralRules, ru)', () => {
  it('ключ: 1 / 2–4 / 5–20 / 21 / 22 / 111', () => {
    expect(count(1, W.activeKey)).toBe('1 активный ключ');
    expect(count(2, W.activeKey)).toBe('2 активных ключа');
    expect(count(4, W.key)).toBe('4 ключа');
    expect(count(5, W.activeKey)).toBe('5 активных ключей');
    expect(count(0, W.key)).toBe('0 ключей');
    expect(count(11, W.key)).toBe('11 ключей');
    expect(count(14, W.key)).toBe('14 ключей');
    expect(count(21, W.key)).toBe('21 ключ');
    expect(count(22, W.key)).toBe('22 ключа');
    expect(count(111, W.key)).toBe('111 ключей');
  });
  it('тысячи — с неразрывным пробелом', () => {
    expect(count(1001, W.request)).toBe('1 001 запрос');
    expect(count(25000, W.request)).toBe('25 000 запросов');
  });
  it('дробные — как «few»', () => {
    expect(plural(1.5, W.hour)).toBe('часа');
  });
  it('пользователи и модели (шапка администрирования)', () => {
    expect(`${count(8, W.user)} · ${count(2, W.model)}`).toBe('8 пользователей · 2 модели');
    expect(count(1, W.user)).toBe('1 пользователь');
    expect(count(3, W.automation)).toBe('3 автоматизации');
  });
});
