import { randomBytes, randomUUID } from 'node:crypto';
import type { Role } from './roles';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb, schema } from './db';
import { sha256 } from './auth';
import type { InviteRow } from './inviteTypes';
export type { InviteRow } from './inviteTypes';

export const MAX_GROUP = 200;
export const MAX_DAYS = 30;
type Db = ReturnType<typeof getDb>;

export type InviteState = 'ok' | 'unknown' | 'expired' | 'used_up' | 'revoked';

export function inviteState(token: string, now = Date.now(), db: Db = getDb()): { state: InviteState; invite?: typeof schema.invites.$inferSelect; left?: number } {
  const inv = db.select().from(schema.invites).where(eq(schema.invites.tokenHash, sha256(token))).get();
  if (!inv) return { state: 'unknown' };
  if (inv.revokedAt) return { state: 'revoked', invite: inv };
  if (inv.uses >= inv.maxUses) return { state: 'used_up', invite: inv, left: 0 };
  if (inv.expiresAt <= now) return { state: 'expired', invite: inv, left: inv.maxUses - inv.uses };
  return { state: 'ok', invite: inv, left: inv.maxUses - inv.uses };
}

export function takeInvite(id: string, now = Date.now(), db: Db = getDb()): boolean {
  const r = db.update(schema.invites).set({
    uses: sql`${schema.invites.uses} + 1`,
    usedAt: sql`CASE WHEN ${schema.invites.uses} + 1 >= ${schema.invites.maxUses} THEN ${now} ELSE ${schema.invites.usedAt} END`,
  }).where(and(eq(schema.invites.id, id), isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, now), lt(schema.invites.uses, schema.invites.maxUses))).run();
  return r.changes === 1;
}

export function giveBackInvite(id: string, db: Db = getDb()) {
  db.update(schema.invites).set({ uses: sql`MAX(${schema.invites.uses} - 1, 0)`, usedAt: null, usedBy: null }).where(eq(schema.invites.id, id)).run();
}

export function recordInviteUse(inviteId: string, user: { id: string; name: string }, now = Date.now(), db: Db = getDb()) {
  db.insert(schema.inviteUses).values({ id: randomUUID(), inviteId, userId: user.id, name: user.name, createdAt: now }).run();
  db.update(schema.invites).set({ usedBy: user.id }).where(eq(schema.invites.id, inviteId)).run();
}

export type CreateInvite = { role?: Role; note?: string; days?: number; maxUses?: number; by: string; now?: number };
export function createInvite(p: CreateInvite, db: Db = getDb()): { id: string; token: string } {
  const token = randomBytes(24).toString('base64url');
  const now = p.now ?? Date.now();
  const id = randomUUID();
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(p.days ?? 7)));
  const maxUses = Math.min(MAX_GROUP, Math.max(1, Math.round(p.maxUses ?? 1)));
  db.insert(schema.invites).values({ id, tokenHash: sha256(token), role: p.role ?? 'user', note: p.note ?? '', createdBy: p.by, expiresAt: now + days * 864e5, maxUses, uses: 0, createdAt: now }).run();
  return { id, token };
}

export function listInvites(limit = 100, db: Db = getDb()): InviteRow[] {
  const rows = db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)).limit(limit).all();
  const ids = rows.map((r) => r.id);
  const uses = ids.length ? db.select().from(schema.inviteUses).where(inArray(schema.inviteUses.inviteId, ids)).orderBy(asc(schema.inviteUses.createdAt)).all() : [];
  return rows.map((r) => ({
    id: r.id, role: r.role, note: r.note, expiresAt: r.expiresAt, usedAt: r.usedAt, createdAt: r.createdAt, maxUses: r.maxUses, uses: r.uses, revokedAt: r.revokedAt, email: r.email ?? null,
    people: uses.filter((u) => u.inviteId === r.id).map((u) => ({ name: u.name, at: u.createdAt })),
  }));
}

export function revokeInvite(id: string, now = Date.now(), db: Db = getDb()): 'revoked' | 'deleted' | 'none' {
  const inv = db.select({ id: schema.invites.id, uses: schema.invites.uses }).from(schema.invites).where(eq(schema.invites.id, id)).get();
  if (!inv) return 'none';
  if (inv.uses > 0) { db.update(schema.invites).set({ revokedAt: now }).where(eq(schema.invites.id, id)).run(); return 'revoked'; }
  db.delete(schema.invites).where(eq(schema.invites.id, id)).run();
  return 'deleted';
}
