import { authed, fail, jsonz } from '@/lib/api';
import { loadGroup, TAIL_TURNS } from '@/lib/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  const turns = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get('turns')) || TAIL_TURNS));
  const g = loadGroup(a.user.id, id, { turns });
  if (!g) return fail(404, 'not found');
  return jsonz(req, g);
}
