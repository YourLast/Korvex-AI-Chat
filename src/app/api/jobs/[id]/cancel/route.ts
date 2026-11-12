import { authed, fail, json } from '@/lib/api';
import { cancelJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!cancelJob(id, a.user.id)) return fail(404, 'job not found or finished');
  return json({ ok: true });
}
