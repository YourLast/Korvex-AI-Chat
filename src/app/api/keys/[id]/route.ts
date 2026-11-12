import { authed, fail, json } from '@/lib/api';
import { revokeKey } from '@/lib/apikeys';
import { apiOn, API_OFF_MESSAGE } from '@/lib/apiGate';

export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!apiOn()) return fail(503, API_OFF_MESSAGE);
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!revokeKey(a.user, id)) return fail(404, 'not found');
  return json({ ok: true });
}
