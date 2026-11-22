import type { PublicModel } from './models';
import type { Sel } from './levels';

type M = Pick<PublicModel, 'levels'>;
export function modelMult(m: M | undefined): number | null {
  const ms = (m?.levels ?? []).map((l) => l.mult ?? 0);
  return ms.length && ms[0] > 0 && ms.every((x) => x === ms[0]) ? ms[0] : null;
}
export function warmMult(m: M | undefined, levelId: string): number | null {
  if (!m || modelMult(m) !== null) return null;
  const x = m.levels.find((l) => l.id === levelId)?.mult ?? 0;
  return x > 1 ? x : null;
}
export const chipWarn = (models: PublicModel[], s: Sel): boolean => s.levelId === 'max' && warmMult(models.find((m) => m.id === s.modelId), 'max') !== null;
export const timesFew = (n: number) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
