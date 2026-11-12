import { adminOnly, json } from '@/lib/api';
import { viewLog } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const q = new URL(req.url).searchParams;
  return json({ items: viewLog(Number(q.get('limit')) || 50, q.get('user') || undefined) });
}
