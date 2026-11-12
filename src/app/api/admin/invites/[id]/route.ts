import { adminOnly, json } from '@/lib/api';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { revokeInvite } from '@/lib/invites';
import { logAudit } from '@/lib/moderation';

export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOnly(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const inv = getDb().select({ note: schema.invites.note }).from(schema.invites).where(eq(schema.invites.id, id)).get();
  const result = revokeInvite(id);
  if (inv && result !== 'none') logAudit({ adminId: a.user.id, action: 'invite_revoke', inviteId: result === 'revoked' ? id : null, detail: `ссылка «${inv.note || 'без названия'}»${result === 'deleted' ? ' (никто не регистрировался — убрана из списка)' : ''}` });
  return json({ ok: true, result });
}
