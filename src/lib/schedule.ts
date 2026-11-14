import { buildCron, parsePreset } from './cron';
import { localeOf, tr, type Key, type Lang } from './i18n/core';
import { errText } from './i18n/errors';
import { fmtHM, hour12Of } from './hourFormat';

const dk = (s: string) => s as Key;

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'every' | 'custom';
export type When = { repeat: Repeat; time: string; dow: number; every: number; cron: string };

export const EVERY_HOURS = [2, 3, 4, 6, 8, 12] as const;
export const dowList = (lang: Lang = 'ru'): [number, string][] => [1, 2, 3, 4, 5, 6, 7].map((d): [number, string] => [d, tr(lang, dk(`tools.dow.${d}`))]);

const hm = (time: string, lang: Lang) => { const [h, m] = time.split(':'); return fmtHM(`${parseInt(h, 10) || 0}:${(m ?? '00').padStart(2, '0')}`, lang); };
const two = (n: number) => String(n).padStart(2, '0');

export function whenOf(cron: string): When {
  const p = parsePreset(cron);
  const base: When = { repeat: p.kind, time: p.time, dow: p.dow, every: 3, cron: cron.trim() };
  if (p.kind !== 'custom') return base;
  const f = cron.trim().split(/\s+/);
  const ev = f.length === 5 ? /^\*\/(\d+)$/.exec(f[1]) : null;
  if (ev && /^\d+$/.test(f[0]) && f[2] === '*' && f[3] === '*' && f[4] === '*' && (EVERY_HOURS as readonly number[]).includes(Number(ev[1]))) {
    return { ...base, repeat: 'every', every: Number(ev[1]), time: `00:${f[0].padStart(2, '0')}` };
  }
  return base;
}

export function cronOf(w: When): string {
  if (w.repeat === 'custom') return w.cron.trim();
  if (w.repeat === 'every') { const m = parseInt(w.time.split(':')[1] ?? '0', 10) || 0; return `${m} */${w.every} * * *`; }
  return buildCron(w.repeat, w.time, w.dow);
}

export function describeWhen(w: When, lang: Lang = 'ru'): string {
  const min = parseInt(w.time.split(':')[1] ?? '0', 10) || 0;
  switch (w.repeat) {
    case 'daily': return tr(lang, 'tools.sched.daily', { t: hm(w.time, lang) });
    case 'weekdays': return tr(lang, 'tools.sched.weekdays', { t: hm(w.time, lang) });
    case 'weekly': return tr(lang, 'tools.sched.weeklyAt', { day: tr(lang, dk(`tools.sched.every.${w.dow % 7}`)), t: hm(w.time, lang) });
    case 'monthly': return tr(lang, 'tools.sched.monthly', { t: hm(w.time, lang) });
    case 'hourly': return min ? tr(lang, 'tools.sched.hourlyAt', { m: two(min) }) : tr(lang, 'tools.sched.hourly');
    case 'every': return tr(lang, 'tools.sched.everyN', { n: w.every }) + (min ? tr(lang, 'tools.sched.atMin', { m: two(min) }) : '');
    case 'custom': return tr(lang, 'tools.sched.custom', { cron: w.cron });
  }
}
export const describeSchedule = (cron: string, lang: Lang = 'ru') => describeWhen(whenOf(cron), lang);

export const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly', 'hourly', 'every', 'custom'];
export const repeatLabel = (r: Repeat, lang: Lang = 'ru') => tr(lang, dk(`tools.repeat.${r}`));
export const dowOn = (dow: number, lang: Lang = 'ru') => tr(lang, dk(`tools.sched.on.${dow % 7}`));

const ymd = (ts: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

export function relTime(ts: number, tz: string, now = Date.now(), lang: Lang = 'ru'): string {
  const loc = localeOf(lang);
  let zone = tz;
  try { new Intl.DateTimeFormat(loc, { timeZone: zone }); } catch { zone = 'UTC'; }
  const t = new Intl.DateTimeFormat(loc, { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: hour12Of(lang) }).format(new Date(ts)).replace(/\s(?=[AP]M)/, '\u00a0');
  const d = dayDiff(ymd(ts, zone), ymd(now, zone));
  if (d === 0) return tr(lang, 'tools.rel.today', { t });
  if (d === 1) return tr(lang, 'tools.rel.tomorrow', { t });
  if (d === -1) return tr(lang, 'tools.rel.yesterday', { t });
  const sameYear = ymd(ts, zone).slice(0, 4) === ymd(now, zone).slice(0, 4);
  const date = new Intl.DateTimeFormat(loc, { timeZone: zone, day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(ts));
  return tr(lang, 'tools.rel.date', { date, t });
}

export function tzName(tz: string, lang: Lang = 'ru'): string {
  try {
    const v = new Intl.DateTimeFormat(localeOf(lang), { timeZone: tz, timeZoneName: 'shortGeneric' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value;
    return v && !/^GMT/.test(v) ? v : tz.replace(/_/g, ' ');
  } catch { return tz; }
}

export function humanRunError(e: string | null | undefined, lang: Lang = 'ru'): string {
  const s = (e ?? '').trim();
  if (!s) return tr(lang, 'tools.sched.err.default');
  if (/перезапуск/i.test(s)) return tr(lang, 'tools.sched.err.restart');
  if (/время выполнения|timeout|timed out/i.test(s)) return tr(lang, 'tools.sched.err.timeout');
  if (/пустой ответ/i.test(s)) return tr(lang, 'tools.sched.err.empty');
  if (/чат.*удал/i.test(s)) return tr(lang, 'tools.sched.err.chat');
  if (/занята/i.test(s)) return tr(lang, 'tools.sched.err.busy');
  if (/недоступн/i.test(s)) {
    const own = lang === 'ru' ? s : errText(lang, s);
    return s.length <= 120 && (lang === 'ru' || own !== s) ? own : tr(lang, 'tools.sched.err.unavail');
  }
  return tr(lang, 'tools.sched.err.other');
}
