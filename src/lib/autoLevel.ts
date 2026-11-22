export type LevelModel = { defaultLevel: string; levels: { id: string }[] };

const HEAVY = /\d|посчита|рассчита|расч[её]т|сколько|сумм|налог|ндс|ндфл|усн|осно|взнос|сверк|реестр|итог|процент|выписк|баланс|отч[её]т|деклар|%|calculat|how much|tax|invoice|total/iu;
export const isHeavy = (text: string, hasFiles: boolean) => hasFiles || HEAVY.test(text);

export function autoLevel(model: LevelModel | undefined, text: string, hasFiles: boolean): string | null {
  if (!model) return null;
  const has = (id: string) => model.levels.some((l) => l.id === id);
  const order = isHeavy(text, hasFiles) ? ['xhigh', 'high', 'max'] : ['medium', 'low'];
  return order.find(has) ?? model.defaultLevel;
}
