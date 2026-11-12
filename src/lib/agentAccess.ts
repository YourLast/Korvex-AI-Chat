import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { canAgents } from './roles';

export function agentsAllowed(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const u = getDb().select({ role: schema.users.role, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return !!u && !u.disabled && canAgents(u.role);
}
