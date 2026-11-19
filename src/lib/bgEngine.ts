
type St = { downUntil: number; logged: boolean };
const g = globalThis as unknown as { __kxBg?: St };
const S = (): St => (g.__kxBg ??= { downUntil: 0, logged: false });

const norm = (u: string) => u.trim().replace(/\/+$/, '');
export const bgUrl = (): string => norm(process.env.KX_BG_ENGINE_URL || '');
export const bgModel = (): string => (process.env.KX_BG_ENGINE_MODEL || '').trim();
const downMs = () => Number(process.env.KX_BG_DOWN_MS) || 60_000;

export function bgTarget(now = Date.now()): { url: string; model: string } | null {
  const url = bgUrl();
  if (!url || now < S().downUntil) return null;
  const s = S();
  if (!s.logged) { s.logged = true; console.log(`[bg] фон (куратор, названия, правила) → помощник ${url} модель ${bgModel() || '(по умолчанию входа)'}`); }
  return { url, model: bgModel() };
}
export const isBg = (url: string): boolean => !!url && norm(url) === bgUrl();
export const modelFor = (url: string, fallback: string): string => (isBg(url) ? bgModel() || fallback : fallback);

export function bgDown(url: string, why: string, now = Date.now()): boolean {
  if (!isBg(url) || process.env.KX_BG_FALLBACK === '0') return false;
  const s = S();
  if (now >= s.downUntil) console.log(`[bg] помощник недоступен (${why.slice(0, 60)}) — фон ${Math.round(downMs() / 1000)} с идёт на основной движок`);
  s.downUntil = now + downMs();
  return true;
}
export const bgActive = (now = Date.now()): boolean => !!bgTarget(now);
export function bgReset() { const s = S(); s.downUntil = 0; s.logged = false; }
