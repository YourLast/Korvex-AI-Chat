import { adminOnly, json } from '@/lib/api';
import { people } from '@/lib/adminView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  return json({ people: people() });
}
