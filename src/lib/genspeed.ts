export const CHARS_PER_TOKEN = 3.6;
const STEP_RE = /(^|\n)\s*(▸ |\[(поиск|расчёт|python|выписки|проверка))/;
export type Gen = { t0: number; t1: number; n: number; act: number; c: number; step: boolean };
export const newGen = (): Gen => ({ t0: 0, t1: 0, n: 0, act: 0, c: 0, step: false });

export function genTick(g: Gen, now: number, d = ''): void {
  if (!g.t0) { g.t0 = now; g.t1 = now; g.n = 1; g.c = d.length; g.step = STEP_RE.test(d); return; }
  const gap = now - g.t1;
  if (gap > 0 && !g.step) g.act += gap;
  g.t1 = now;
  g.n++;
  g.c += d.length;
  g.step = STEP_RE.test(d);
}

export const genView = (g: Gen) => (g.t0 ? { n: g.n, ms: g.act, c: g.c } : undefined);

export function genTokens(g: { n: number; c?: number }, usageTokens: number | null | undefined): { n: number; exact: boolean } {
  if (typeof usageTokens === 'number' && usageTokens > 0) return { n: usageTokens, exact: true };
  if (typeof g.c === 'number' && g.c > 0) return { n: Math.round(g.c / CHARS_PER_TOKEN), exact: false };
  return { n: g.n, exact: false };
}
