import { describe, expect, it } from 'vitest';
import { SLOW_MS, SNOOZE_MS, cardFor, decide, deniedHint, markDenied, readNP, snooze, visit, type NPState } from '@/lib/notifyPrompt';
import type { PushEnv } from '@/lib/pushClient';

const DESK: PushEnv = { supported: true, ios: false, standalone: false, iosOld: false, permission: 'default' };
const IOS_TAB: PushEnv = { supported: false, ios: true, standalone: false, iosOld: false, permission: 'unsupported' };
const IOS_APP: PushEnv = { supported: true, ios: true, standalone: true, iosOld: false, permission: 'default' };
const IOS_OLD: PushEnv = { supported: false, ios: true, standalone: false, iosOld: true, permission: 'unsupported' };
const NOPUSH: PushEnv = { supported: false, ios: false, standalone: false, iosOld: false, permission: 'unsupported' };
const NOW = Date.UTC(2026, 9, 29, 12);
const st = (o: Partial<NPState> = {}): NPState => ({ visits: 1, snoozeUntil: 0, denied: false, ...o });

describe('какая карточка', () => {
  it('десктоп Chrome/Safari и iPhone с экрана «Домой» — уведомления; iPhone в Safari — «на экран Домой»; старая iOS и без Web Push — никакой', () => {
    expect(cardFor(DESK)).toBe('push');
    expect(cardFor(IOS_APP)).toBe('push');
    expect(cardFor(IOS_TAB)).toBe('install');
    expect(cardFor(IOS_OLD)).toBeNull();
    expect(cardFor(NOPUSH)).toBeNull();
  });
});

describe('когда показывать', () => {
  it('первый заход — нет; второй — да', () => {
    expect(decide(st({ visits: 1 }), DESK, false, 'visit', NOW)).toBeNull();
    expect(decide(st({ visits: 2 }), DESK, false, 'visit', NOW)).toBe('push');
    expect(decide(st({ visits: 9 }), IOS_TAB, false, 'visit', NOW)).toBe('install');
  });
  it('долгий ответ (> 15 с) — да даже в первый заход', () => {
    expect(SLOW_MS).toBe(15000);
    expect(decide(st({ visits: 1 }), DESK, false, 'slow', NOW)).toBe('push');
    expect(decide(st({ visits: 1 }), IOS_TAB, false, 'slow', NOW)).toBe('install');
  });
  it('уже включено на этом устройстве — никогда', () => {
    expect(decide(st({ visits: 5 }), DESK, true, 'visit', NOW)).toBeNull();
    expect(decide(st({ visits: 5 }), DESK, true, 'slow', NOW)).toBeNull();
  });
  it('«Не сейчас» — не раньше чем через 7 дней', () => {
    const s = snooze(st({ visits: 3 }), NOW);
    expect(s.snoozeUntil).toBe(NOW + SNOOZE_MS);
    expect(SNOOZE_MS).toBe(7 * 24 * 3600 * 1000);
    expect(decide(s, DESK, false, 'visit', NOW + 3600e3)).toBeNull();
    expect(decide(s, DESK, false, 'slow', NOW + 6 * 864e5)).toBeNull();
    expect(decide(s, DESK, false, 'slow', NOW + 7 * 864e5 + 1)).toBe('push');
  });
  it('запрещено в системе — больше не показываем (и после 7 дней)', () => {
    expect(decide(st({ visits: 5 }), { ...DESK, permission: 'denied' }, false, 'slow', NOW)).toBeNull();
    const d = markDenied(st({ visits: 5 }));
    expect(decide(d, DESK, false, 'slow', NOW + 30 * 864e5)).toBeNull();
  });
  it('iPhone: после установки на экран «Домой» — предложение уведомлений сразу, с первого запуска', () => {
    expect(decide(st({ visits: 1 }), IOS_APP, false, 'visit', NOW)).toBe('push');
    expect(decide(st({ visits: 1 }), IOS_TAB, false, 'visit', NOW)).toBeNull();
  });
  it('разрешение уже выдано, но подписки нет (сменили ключ, стёрли данные) — карточка уведомлений', () => {
    expect(decide(st({ visits: 2 }), { ...DESK, permission: 'granted' }, false, 'visit', NOW)).toBe('push');
  });
});

describe('хранилище', () => {
  it('битое и пустое — с нуля; заходы считаются', () => {
    expect(readNP(null)).toEqual({ visits: 0, snoozeUntil: 0, denied: false });
    expect(readNP('{oops')).toEqual({ visits: 0, snoozeUntil: 0, denied: false });
    expect(readNP(JSON.stringify({ visits: 'x', snoozeUntil: null, denied: 'yes' }))).toEqual({ visits: 0, snoozeUntil: 0, denied: false });
    expect(readNP(JSON.stringify({ visits: 3.7, snoozeUntil: 5, denied: true }))).toEqual({ visits: 3, snoozeUntil: 5, denied: true });
    expect(visit(visit(readNP(null))).visits).toBe(2);
  });
});

describe('подсказка «как разрешить» в «Настройках»', () => {
  it('по платформе', () => {
    expect(deniedHint(IOS_APP, 'iPhone')).toContain('Настройки → Уведомления → Korvex AI');
    expect(deniedHint(DESK, 'Mozilla/5.0 (X11) AppleWebKit/537.36 Chrome/141.0 Safari/537.36')).toContain('значок слева от адреса → Уведомления');
    expect(deniedHint(DESK, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toContain('Safari → Настройки → Веб-сайты → Уведомления');
  });
});
