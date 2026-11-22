import { listMemory, isSecret, ruleConflict, stripHedge, MAYBE_TTL_MS } from './memory';
import type { MemoryRow } from './db/schema';

export type GuessRef = { id: string; text: string };
export const MAX_GUESSES = 3;

const STRONG = /(?<![\p{L}\d])(УСН|ОСНО|ОСН|АУСН|ПСН|НПД|ЕСХН|НДС|НДФЛ|патент\S*|упрощ\S*|самозанят\S*|1С|1C|Контур\S*|СБИС|Эльб\S*|Excel|Эксел\S*|ООО|ИП|АО|\d+(?:[.,]\d+)?\s?%)(?![\p{L}])/giu;
const norm = (s: string) => s.toLowerCase().replace(/1c/g, '1с').replace(/ё/g, 'е').replace(/\s+%/g, '%');
export function anchors(text: string): string[] {
  return [...new Set([...text.matchAll(STRONG)].map((m) => norm(m[1]).replace(/^(патент|упрощ|самозанят|контур|эльб|эксел)\S*/u, '$1')))];
}
export function usedIn(guess: string, answer: string): boolean {
  const a = anchors(guess);
  if (!a.length) return false;
  const ans = norm(answer);
  return a.some((w) => (/^[\p{L}]+$/u.test(w) ? new RegExp(`(?<![\\p{L}])${w}`, 'u').test(ans) : ans.includes(w)));
}

export function guessesUsed(rows: MemoryRow[], answer: string, now = Date.now()): GuessRef[] {
  if (!answer.trim()) return [];
  return rows
    .filter((r) => r.sure === 0 && r.updatedAt >= now - MAYBE_TTL_MS && !isSecret(r.text) && !ruleConflict(r.text) && r.section !== 'style')
    .filter((r) => usedIn(r.text, answer))
    .slice(0, MAX_GUESSES)
    .map((r) => ({ id: r.id, text: stripHedge(r.text).slice(0, 80) }));
}
export const guessesFor = (userId: string, answer: string, now = Date.now()) => guessesUsed(listMemory(userId), answer, now);
