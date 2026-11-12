
export const DEFAULT_TZ = 'UTC';
export const TZ_HEADER = 'X-User-Timezone';
export const TZ_PLACEHOLDER = '{{CURRENT_TIMEZONE}}';

const IANA_LIKE = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/;

export function isValidTz(z: unknown): z is string {
  if (typeof z !== 'string' || z.length === 0 || z.length > 64 || !IANA_LIKE.test(z)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export const cleanTz = (z: unknown): string | null => (isValidTz(z) ? z : null);

export const tzOrDefault = (z: unknown): string => cleanTz(z) ?? DEFAULT_TZ;

export function withTimezone(prompt: string, tz?: unknown): string {
  return prompt.includes(TZ_PLACEHOLDER) ? prompt.split(TZ_PLACEHOLDER).join(tzOrDefault(tz)) : prompt;
}

export function browserTimeZone(): string | undefined {
  try {
    return cleanTz(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? undefined;
  } catch {
    return undefined;
  }
}
