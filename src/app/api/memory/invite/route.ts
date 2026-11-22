import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { inviteLater, inviteLineOn, inviteNever } from '@/lib/introInvite';
import { rulesNotice, rulesSeen } from '@/lib/memoryRules';
import { addressTy } from '@/lib/memory';
import { nightNotice, nightSeen } from '@/lib/night';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const msg = new URL(req.url).searchParams.get('msg');
  return json({ show: false, line: msg ? inviteLineOn(a.user.id, msg) : false, rules: rulesNotice(a.user.id), night: nightNotice(a.user.id), ty: addressTy(a.user.id) });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ action: z.enum(['later', 'never', 'rules-seen', 'night-seen']) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.action === 'later') inviteLater(a.user.id); else if (p.data.action === 'never') inviteNever(a.user.id); else if (p.data.action === 'night-seen') nightSeen(a.user.id); else rulesSeen(a.user.id);
  return json({ ok: true, show: false, line: false });
}
