import { adminOnly, json } from '@/lib/api';
import { auditLog } from '@/lib/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const q = new URL(req.url).searchParams;
  return json({ items: auditLog({ limit: Number(q.get('limit')) || 30, offset: Number(q.get('offset')) || 0, userId: q.get('user'), inviteId: q.get('invite') }) });
}
