import { CronExpressionParser } from 'cron-parser';
import { tr, type Key, type Lang } from './i18n/core';

export const MIN_INTERVAL_MS = 15 * 60_000;

export function nextRun(cron: string, tz: string, from: number = Date.now()): number {
  const it = CronExpressionParser.parse(cron, { tz, currentDate: new Date(from) });
  return it.next().toDate().getTime();
}

export function validateCron(cron: string, tz: string): string | null {
  if (!/^\s*\S+(\s+\S+){4}\s*$/.test(cron)) return 'Расписание — 5 полей cron: минута час день месяц день_недели';
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
  } catch {
    return `Неизвестный часовой пояс: ${tz}`;
  }
  try {
    const it = CronExpressionParser.parse(cron, { tz, currentDate: new Date() });
    let prev = it.next().toDate().getTime();
    for (let i = 0; i < 4; i++) {
      const n = it.next().toDate().getTime();
      if (n - prev < MIN_INTERVAL_MS) return 'Чаще раза в 15 минут запускать нельзя';
      prev = n;
    }
  } catch (e) {
    return `Неверное расписание: ${(e as Error).message.slice(0, 80)}`;
  }
  return null;
}

export type Preset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'custom';
const pad = (n: number) => String(n);

export function buildCron(kind: Exclude<Preset, 'custom'>, time = '09:00', dow = 1): string {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10) || 0);
  switch (kind) {
    case 'hourly': return `${pad(m)} * * * *`;
    case 'daily': return `${pad(m)} ${pad(h)} * * *`;
    case 'weekdays': return `${pad(m)} ${pad(h)} * * 1-5`;
    case 'weekly': return `${pad(m)} ${pad(h)} * * ${dow % 7}`;
    case 'monthly': return `${pad(m)} ${pad(h)} 1 * *`;
  }
}

const dk = (s: string) => s as Key;
const hm = (h: string, m: string) => `${parseInt(h, 10)}:${m.padStart(2, '0')}`;

export function parsePreset(cron: string): { kind: Preset; time: string; dow: number } {
  const f = cron.trim().split(/\s+/);
  const d = { kind: 'custom' as Preset, time: '09:00', dow: 1 };
  if (f.length !== 5) return d;
  const [m, h, dom, mon, dw] = f;
  const num = (x: string) => /^\d+$/.test(x);
  if (num(m) && h === '*' && dom === '*' && mon === '*' && dw === '*') return { ...d, kind: 'hourly', time: `00:${m.padStart(2, '0')}` };
  if (!num(m) || !num(h) || mon !== '*') return d;
  const time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (dom === '*' && dw === '*') return { kind: 'daily', time, dow: 1 };
  if (dom === '*' && dw === '1-5') return { kind: 'weekdays', time, dow: 1 };
  if (dom === '*' && num(dw)) return { kind: 'weekly', time, dow: Number(dw) === 0 ? 7 : Number(dw) };
  if (dom === '1' && dw === '*') return { kind: 'monthly', time, dow: 1 };
  return d;
}

export function describeCron(cron: string, lang: Lang = 'ru'): string {
  const f = cron.trim().split(/\s+/);
  const p = parsePreset(cron);
  if (p.kind === 'custom' || f.length !== 5) return cron;
  const [m, h] = f;
  switch (p.kind) {
    case 'hourly': return tr(lang, 'tools.sched.hourlyAt', { m: m.padStart(2, '0') });
    case 'daily': return tr(lang, 'tools.sched.cron.daily', { t: hm(h, m) });
    case 'weekdays': return tr(lang, 'tools.sched.cron.weekdays', { t: hm(h, m) });
    case 'weekly': return tr(lang, 'tools.sched.cron.weekly', { day: tr(lang, dk(`tools.sched.every.${p.dow % 7}`)), t: hm(h, m) });
    case 'monthly': return tr(lang, 'tools.sched.cron.monthly', { t: hm(h, m) });
  }
}
export const dayName = (i: number, lang: Lang = 'ru') => tr(lang, dk(`tools.dow.${i % 7 || 7}`)).toLowerCase();
