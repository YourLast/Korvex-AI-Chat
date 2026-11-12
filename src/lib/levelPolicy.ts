import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import type { Lang } from './i18n/core';
import { capLevelId, isRestrictedLevel, withoutRestricted, type ModelLite } from './levels';
import { maxAdminOnly } from './status';
import { getModel, isClaude, publicModels, type Level, type ModelCfg, type PublicModel } from './models';

export const restrictedFor = (role: string | null | undefined): boolean => role !== 'admin' && role !== 'alpha' && maxAdminOnly();

export function accessRoleOf(userId: string | null | undefined): 'admin' | 'alpha' | 'user' {
  if (!userId) return 'user';
  const u = getDb().select({ role: schema.users.role, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return !u || u.disabled ? 'user' : u.role === 'admin' ? 'admin' : u.role === 'alpha' ? 'alpha' : 'user';
}

export function roleOf(userId: string): 'admin' | 'user' {
  return getDb().select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).get()?.role === 'admin' ? 'admin' : 'user';
}

export function capLevel(model: ModelCfg, level: Level, userId: string | null | undefined): Level {
  if (isClaude(model) || !isRestrictedLevel(level.id) || !userId || !restrictedFor(accessRoleOf(userId))) return level;
  const id = capLevelId(model as ModelLite, level.id);
  return model.levels.find((l) => l.id === id) ?? level;
}

export function forRole<M extends ModelLite>(models: M[], role: string | null | undefined): M[] {
  return restrictedFor(role) ? models.map((m) => (isClaude(getModel(m.id)) ? m : withoutRestricted(m))) : models;
}

export function modelsFor(role: string | null | undefined, lang?: Lang, userId?: string | null): PublicModel[] {
  return forRole(publicModels(role === 'admin' ? 'admin' : 'user', lang, role ?? 'user', userId), role);
}
