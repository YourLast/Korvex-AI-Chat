export function letterTag(to: string, subject: string): string {
  let h = 2166136261;
  for (const ch of `${to}\u0001${subject}`) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
