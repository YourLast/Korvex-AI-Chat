import { sweepOrphans } from './session';

const g = globalThis as unknown as { __kxJanitor?: NodeJS.Timeout };

export function startJanitor() {
  if (g.__kxJanitor) return;
  const tick = () => { void sweepOrphans().then((r) => { if (r.dirs || r.boxes) console.log(`[code] уборка: каталогов ${r.dirs}, песочниц ${r.boxes}`); }).catch((e) => console.error('[code] уборка', (e as Error).message)); };
  setTimeout(tick, 60_000).unref?.();
  g.__kxJanitor = setInterval(tick, 10 * 60_000);
  g.__kxJanitor.unref?.();
}
