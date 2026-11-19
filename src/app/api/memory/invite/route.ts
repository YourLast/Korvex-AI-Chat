import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { inviteLater, inviteNever, inviteState } from '@/lib/introInvite';
import { rulesNotice, rulesSeen } from '@/lib/memoryRules';
import { addressTy } from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json({ show: inviteState(a.user.id).widget, rules: rulesNotice(a.user.id), ty: addressTy(a.user.id) });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ action: z.enum(['later', 'never', 'rules-seen']) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.action === 'later') inviteLater(a.user.id); else if (p.data.action === 'never') inviteNever(a.user.id); else rulesSeen(a.user.id);
  return json({ ok: true, show: false });
}
