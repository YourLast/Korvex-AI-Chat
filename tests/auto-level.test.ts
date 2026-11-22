import { describe, expect, it } from 'vitest';
import { autoLevel, isHeavy } from '@/lib/autoLevel';

const ALPHA = { defaultLevel: 'xhigh', levels: ['off', 'low', 'medium', 'xhigh', 'max'].map((id) => ({ id })) };
describe('autoLevel', () => {
  it('файлы, расчёт, бухгалтерия — xhigh; разговор — medium', () => {
    expect(autoLevel(ALPHA, 'разбери', true)).toBe('xhigh');
    expect(autoLevel(ALPHA, 'Посчитай НДС с 120 000', false)).toBe('xhigh');
    expect(autoLevel(ALPHA, 'когда сдавать декларацию по УСН?', false)).toBe('xhigh');
    expect(autoLevel(ALPHA, 'Привет! Как дела?', false)).toBe('medium');
    expect(autoLevel(ALPHA, 'перепиши письмо вежливее', false)).toBe('medium');
  });
  it('у модели нет нужного уровня — ближайший из списка или её умолчание', () => {
    expect(autoLevel({ defaultLevel: 'high', levels: [{ id: 'high' }] }, 'привет', false)).toBe('high');
    expect(autoLevel({ defaultLevel: 'x', levels: [{ id: 'low' }, { id: 'high' }] }, 'итог 5', false)).toBe('high');
    expect(autoLevel(undefined, 'x', false)).toBeNull();
    expect(isHeavy('сделай таблицу 2 на 2', false)).toBe(true);
  });
});
