import { adminOnly, json } from '@/lib/api';
import { ratingsFeed } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const q = new URL(req.url).searchParams;
  const v = q.get('value');
  const days = Number(q.get('days')) || 0;
  return json(ratingsFeed({
    value: v === 'up' ? 1 : v === 'down' ? -1 : undefined, userId: q.get('user') || undefined, modelId: q.get('model') || undefined,
    days: days > 0 && days <= 3650 ? days : undefined, before: q.get('before') || null, limit: Number(q.get('limit')) || 30,
  }));
}
