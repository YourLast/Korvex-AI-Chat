import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { cleanTz, DEFAULT_TZ } from './tz';

export function resolveUserTz(userId: string, supplied?: unknown): string {
  const db = getDb();
  const z = cleanTz(supplied);
  try {
    if (z) {
      const cur = db.select({ tz: schema.users.lastTz }).from(schema.users).where(eq(schema.users.id, userId)).get();
      if (cur && cur.tz !== z) db.update(schema.users).set({ lastTz: z }).where(eq(schema.users.id, userId)).run();
      return z;
    }
    const row = db.select({ tz: schema.users.lastTz }).from(schema.users).where(eq(schema.users.id, userId)).get();
    return cleanTz(row?.tz) ?? DEFAULT_TZ;
  } catch (e) {
    console.error('[tz]', (e as Error).message);
    return z ?? DEFAULT_TZ;
  }
}
