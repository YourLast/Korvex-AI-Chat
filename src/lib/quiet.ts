
export function inQuiet(spec: string | null | undefined, tz: string, now = Date.now()): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(spec ?? '');
  if (!m) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Europe/Moscow', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(now)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const t = p.hour * 60 + p.minute, a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  return a === b ? false : a < b ? t >= a && t < b : t >= a || t < b;
}
