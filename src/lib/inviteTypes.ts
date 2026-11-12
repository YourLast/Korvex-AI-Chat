import type { Role } from './roles';
export type InviteRow = {
  id: string; role: Role; note: string; expiresAt: number; usedAt: number | null; createdAt: number;
  maxUses: number; uses: number; revokedAt: number | null; people: { name: string; at: number }[];
};

export const inviteLive = (i: Pick<InviteRow, 'revokedAt' | 'uses' | 'maxUses' | 'expiresAt'>, now = Date.now()) => !i.revokedAt && i.uses < i.maxUses && i.expiresAt > now;
