import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

export function hasCodeSession(threadId: string): boolean {
  try {
    return !!getDb().select({ t: schema.codeSessions.threadId }).from(schema.codeSessions).where(eq(schema.codeSessions.threadId, threadId)).get();
  } catch { return false; }
}
