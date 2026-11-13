import { tr, type Lang } from '../i18n/core';
import type { Key } from '../i18n/dict';
import { userLang } from '../userLang';

export const uiLang = (userId?: string | null): Lang => userLang(userId);
export const mLang = (userId?: string | null): 'ru' | 'en' => (userLang(userId) === 'ru' ? 'ru' : 'en');
export const m = (l: 'ru' | 'en', ru: string, en: string): string => (l === 'ru' ? ru : en);
export const qt = (s: string, l: Lang): string => (l === 'ru' ? `«${s}»` : l === 'sr' ? `„${s}“` : `“${s}”`);
export function step(userId: string | null | undefined, key: Key, p: Record<string, string | number> = {}): string {
  const l = uiLang(userId);
  const params = { ...p, ...(typeof p.q === 'string' ? { q: qt(p.q, l) } : {}) };
  return tr(l, key, params);
}
export function chatsWord(l: Lang, n: number): string {
  if (l === 'en') return n === 1 ? 'chat' : 'chats';
  const a = n % 100, b = n % 10;
  const i = a >= 11 && a <= 14 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2;
  return (l === 'sr' ? ['čat', 'čata', 'čatova'] : ['чат', 'чата', 'чатов'])[i];
}
