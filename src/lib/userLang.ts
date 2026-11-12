import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { asLang, type Lang } from './i18n/core';

export function userLang(userId: string | null | undefined): Lang {
  if (!userId) return 'ru';
  return asLang(getDb().select({ lang: schema.users.lang }).from(schema.users).where(eq(schema.users.id, userId)).get()?.lang) ?? 'ru';
}
