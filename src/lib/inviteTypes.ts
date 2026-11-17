import type { Role } from './roles';
export type InviteRow = {
  id: string; role: Role; note: string; expiresAt: number; usedAt: number | null; createdAt: number;
  maxUses: number; uses: number; revokedAt: number | null; people: { name: string; at: number }[]; email?: string | null;
};

export const UNLIMITED_USES = 1_000_000_000;
export const FOREVER_AT = 253_402_300_799_000;
export const isUnlimited = (i: Pick<InviteRow, 'maxUses'>) => i.maxUses >= UNLIMITED_USES;
export const isForever = (i: Pick<InviteRow, 'expiresAt'>) => i.expiresAt >= FOREVER_AT;

export const inviteLive = (i: Pick<InviteRow, 'revokedAt' | 'uses' | 'maxUses' | 'expiresAt'>, now = Date.now()) => !i.revokedAt && i.uses < i.maxUses && i.expiresAt > now;
