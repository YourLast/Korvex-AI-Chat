export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export type Scheme = 'light' | 'dark';
export const THEME_COOKIE = 'kx-theme';
export const SCHEME_COOKIE = 'kx-scheme';
export const THEME_COLOR: Record<Scheme, string> = { light: '#ffffff', dark: '#000000' };

export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);
export function pickTheme(o: { user?: string | null; cookie?: string | null }): Theme {
  if (isTheme(o.user)) return o.user;
  return isTheme(o.cookie) ? o.cookie : 'system';
}

export function schemeOf(t: Theme, hint?: string | null): Scheme {
  if (t !== 'system') return t;
  return hint === 'light' ? 'light' : 'dark';
}
