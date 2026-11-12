import { STAND_ENV } from '@/ext/env';

export const cfg = (k: string, d = ''): string => process.env[k] || STAND_ENV[k] || d;
export const standDefault = (k: string, d = ''): string => STAND_ENV[k] ?? d;
