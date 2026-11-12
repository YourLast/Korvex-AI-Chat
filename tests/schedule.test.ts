import { describe, expect, it } from 'vitest';
import { cronOf, describeSchedule, humanRunError, relTime, whenOf } from '@/lib/schedule';
import { validateCron } from '@/lib/cron';

describe('расписание словами', () => {
  it('пресеты', () => {
    expect(describeSchedule('0 9 * * *')).toBe('Каждый день в 9:00');
    expect(describeSchedule('30 18 * * 1-5')).toBe('По будням в 18:30');
    expect(describeSchedule('30 18 * * 5')).toBe('Каждую пятницу в 18:30');
    expect(describeSchedule('0 9 * * 0')).toBe('Каждое воскресенье в 9:00');
    expect(describeSchedule('0 9 1 * *')).toBe('Каждый месяц, 1-го числа в 9:00');
    expect(describeSchedule('0 * * * *')).toBe('Каждый час');
    expect(describeSchedule('15 * * * *')).toBe('Каждый час, в :15');
  });
  it('каждые N часов', () => {
    expect(describeSchedule('0 */3 * * *')).toBe('Каждые 3 часа');
    expect(describeSchedule('5 */12 * * *')).toBe('Каждые 12 часов, в :05');
    const w = whenOf('0 */6 * * *');
    expect(w.repeat).toBe('every');
    expect(cronOf(w)).toBe('0 */6 * * *');
    expect(validateCron(cronOf({ ...w, every: 2 }), 'Europe/Moscow')).toBeNull();
  });
  it('своё расписание остаётся строкой', () => {
    expect(describeSchedule('30 8 1,15 * *')).toBe('Своё расписание: 30 8 1,15 * *');
    expect(cronOf(whenOf('30 8 1,15 * *'))).toBe('30 8 1,15 * *');
  });
  it('туда и обратно для всех пресетов', () => {
    for (const c of ['0 9 * * *', '30 18 * * 1-5', '0 17 * * 5', '0 9 1 * *', '15 * * * *', '0 */4 * * *']) expect(cronOf(whenOf(c))).toBe(c);
  });
});

describe('relTime в поясе пользователя', () => {
  const now = Date.UTC(2026, 9, 29, 9, 0);
  it('сегодня / завтра / вчера / дата', () => {
    expect(relTime(Date.UTC(2026, 9, 29, 15, 30), 'Europe/Moscow', now)).toBe('сегодня в 18:30');
    expect(relTime(Date.UTC(2026, 9, 30, 6, 0), 'Europe/Moscow', now)).toBe('завтра в 9:00');
    expect(relTime(Date.UTC(2026, 9, 28, 6, 0), 'Europe/Moscow', now)).toBe('вчера в 9:00');
    expect(relTime(Date.UTC(2026, 10, 2, 6, 0), 'Europe/Moscow', now)).toBe('2 ноября в 9:00');
    expect(relTime(Date.UTC(2027, 0, 5, 6, 0), 'Europe/Moscow', now)).toBe('5 января 2027 г. в 9:00');
  });
  it('граница суток считается в поясе, а не в UTC', () => {
    expect(relTime(Date.UTC(2026, 9, 29, 22, 30), 'Asia/Vladivostok', now)).toBe('завтра в 8:30');
    expect(relTime(Date.UTC(2026, 9, 29, 22, 30), 'Europe/Moscow', now)).toBe('завтра в 1:30');
    expect(relTime(Date.UTC(2026, 9, 29, 22, 30), 'UTC', now)).toBe('сегодня в 22:30');
  });
  it('неизвестный пояс — не падает', () => {
    expect(relTime(now, 'Foo/Bar', now)).toMatch(/^сегодня в /);
  });
});

describe('ошибки запуска — понятной фразой', () => {
  it('без внутренностей', () => {
    expect(humanRunError('502: мок: источник не отвечает')).toBe('Модель не ответила. Запустите ещё раз');
    expect(humanRunError('Прервано перезапуском сервера')).toMatch(/сервер перезапускался/);
    expect(humanRunError('Превышено время выполнения (30 минут)')).toMatch(/30 минут/);
    expect(humanRunError('Модель вернула пустой ответ')).toMatch(/ничего не ответила/);
    expect(humanRunError('Чат для результата удалён')).toMatch(/Чат для результата удалён/);
    expect(humanRunError(null)).toBe('Не получилось выполнить');
  });
});
