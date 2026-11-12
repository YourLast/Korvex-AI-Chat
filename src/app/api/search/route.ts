import { authed, json, jsonz } from '@/lib/api';
import { searchChats } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (!q) return json({ hits: [], ms: 0, total: 0 });
  return jsonz(req, searchChats(a.user.id, q, 20));
}
