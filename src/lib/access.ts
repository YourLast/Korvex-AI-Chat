import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getSetting, setSetting, deleteSetting } from './settings';

export type AccessRule = { roles?: string[]; users?: string[]; invites?: string[] };
export type AccessKind = 'model' | 'feature' | 'mcp';
type Who = { id: string; role: string; invites: string[] };

export const ruleOf = (kind: AccessKind, id: string): AccessRule | null => {
  const r = getSetting<AccessRule | null>(`access.${kind}.${id}`, null);
  return r && typeof r === 'object' ? r : null;
};

export function setRule(kind: AccessKind, id: string, rule: AccessRule | null, by: string | null) {
  if (!rule) { deleteSetting(`access.${kind}.${id}`); return; }
  const clean = (a?: string[]) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && x))].slice(0, 500) : []);
  setSetting(`access.${kind}.${id}`, { roles: clean(rule.roles), users: clean(rule.users), invites: clean(rule.invites) }, by);
}

export function whoOf(userId: string): Who {
  const db = getDb();
  const u = db.select({ role: schema.users.role, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.id, userId)).get();
  const invites = db.select({ i: schema.inviteUses.inviteId }).from(schema.inviteUses).where(eq(schema.inviteUses.userId, userId)).all().map((r) => r.i);
  return { id: userId, role: !u || u.disabled ? 'user' : u.role, invites };
}

export function allowedBy(rule: AccessRule, who: Who): boolean {
  if (who.role === 'admin') return true;
  return !!(rule.roles?.includes(who.role) || rule.users?.includes(who.id) || rule.invites?.some((i) => who.invites.includes(i)));
}

export const allowedForRole = (rule: AccessRule, role: string): boolean => role === 'admin' || !!rule.roles?.includes(role);
