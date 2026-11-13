import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getSetting, setSetting } from './settings';

export type InviteFlags = { max?: boolean; weekMult?: number | null; orgs?: boolean };
const key = (inviteId: string) => `invite.flags.${inviteId}`;

export function inviteFlags(inviteId: string | null | undefined): InviteFlags {
  if (!inviteId) return {};
  const f = getSetting<InviteFlags | null>(key(inviteId), null);
  return f && typeof f === 'object' ? f : {};
}

export function setInviteFlags(inviteId: string, p: InviteFlags, by: string | null): InviteFlags {
  const cur = inviteFlags(inviteId);
  const next: InviteFlags = { ...cur };
  if (p.max !== undefined) next.max = !!p.max;
  if (p.orgs !== undefined) next.orgs = !!p.orgs;
  if (p.weekMult !== undefined) next.weekMult = p.weekMult === null || !Number.isFinite(p.weekMult) || p.weekMult < 0 ? null : p.weekMult;
  setSetting(key(inviteId), next, by);
  return next;
}

export function inviteOfUser(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return getDb().select({ id: schema.inviteUses.inviteId }).from(schema.inviteUses).where(eq(schema.inviteUses.userId, userId))
    .orderBy(desc(schema.inviteUses.createdAt)).limit(1).get()?.id ?? null;
}

export const userFlags = (userId: string | null | undefined): InviteFlags => inviteFlags(inviteOfUser(userId));

export function effectiveWeekMult(u: { id: string; weekMult: number }): number {
  const own = Number.isFinite(u.weekMult) && u.weekMult >= 0 ? u.weekMult : 1;
  if (own !== 1) return own;
  const g = userFlags(u.id).weekMult;
  return typeof g === 'number' && g >= 0 ? g : 1;
}
