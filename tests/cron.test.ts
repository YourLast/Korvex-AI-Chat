import { describe, expect, it } from 'vitest';
import { buildCron, describeCron, nextRun, parsePreset, validateCron } from '@/lib/cron';

describe('cron', () => {
  it('следующий запуск считается в часовом поясе задачи', () => {
    const t = nextRun('30 8 * * 1-5', 'Asia/Yekaterinburg', Date.parse('2026-10-28T10:00:00Z'));
    expect(new Date(t).toISOString()).toBe('2026-10-29T03:30:00.000Z');
    expect(new Date(nextRun('30 8 * * 1-5', 'Europe/Moscow', Date.parse('2026-10-28T10:00:00Z'))).toISOString()).toBe('2026-10-29T05:30:00.000Z');
  });
  it('будни пропускают выходные', () => {
    expect(new Date(nextRun('0 9 * * 1-5', 'UTC', Date.parse('2026-10-30T10:00:00Z'))).toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });
  it('проверка расписания', () => {
    expect(validateCron('0 9 * * 1', 'Europe/Moscow')).toBeNull();
    expect(validateCron('*/20 * * * *', 'UTC')).toBeNull();
    expect(validateCron('* * * * *', 'UTC')).toMatch(/15 минут/);
    expect(validateCron('*/10 * * * *', 'UTC')).toMatch(/15 минут/);
    expect(validateCron('99 * * * *', 'UTC')).toMatch(/Неверное/);
    expect(validateCron('0 9 *', 'UTC')).toMatch(/5 полей/);
    expect(validateCron('0 9 * * *', 'Mars/Base')).toMatch(/часовой пояс/);
  });
  it('пресеты собираются и разбираются обратно', () => {
    for (const [kind, time, dow] of [['daily', '07:00', 1], ['weekdays', '08:30', 1], ['weekly', '17:00', 5], ['weekly', '09:00', 7], ['monthly', '10:00', 1]] as const) {
      const c = buildCron(kind, time, dow);
      expect(parsePreset(c)).toEqual({ kind, time, dow });
    }
    expect(parsePreset('*/20 * * * *').kind).toBe('custom');
    expect(parsePreset('15 * * * *').kind).toBe('hourly');
  });
  it('расписание словами', () => {
    expect(describeCron('0 9 * * 1')).toBe('Каждый понедельник, 9:00');
    expect(describeCron('30 8 * * 1-5')).toBe('По будням, 8:30');
    expect(describeCron('0 7 * * *')).toBe('Ежедневно, 7:00');
    expect(describeCron('0 10 1 * *')).toBe('1-го числа, 10:00');
    expect(describeCron('*/20 * * * *')).toBe('*/20 * * * *');
  });
});
