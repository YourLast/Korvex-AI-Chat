export type BrandNames = { name: string; short: string };
export const DEFAULT_NAME = 'Korvex AI';
export const DEFAULT_SHORT = 'Korvex';

let getter: (() => BrandNames | null) | null = null;
let fixed: BrandNames | null = null;
export function setBrandGetter(f: (() => BrandNames | null) | null) { getter = f; }
export function setBrandNames(b: BrandNames | null) { fixed = b; }

export function brandNames(): BrandNames {
  const b = fixed ?? getter?.() ?? null;
  return b ?? { name: DEFAULT_NAME, short: DEFAULT_SHORT };
}

export function brandText(s: string): string {
  if (!s || !s.includes('Korvex')) return s;
  const b = brandNames();
  if (b.name === DEFAULT_NAME && b.short === DEFAULT_SHORT) return s;
  return s.replace(/(?<![-\w])Korvex AI(?![-\w])/g, b.name).replace(/(?<![-\w])Korvex(?![-\w])/g, b.short);
}
