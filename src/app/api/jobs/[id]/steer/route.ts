import { authed, fail, json } from '@/lib/api';
import { steerJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { text?: unknown; mode?: unknown };
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return fail(400, 'empty text');
  if (text.length > 4000) return fail(400, 'text too long (4000)');
  const mode = b.mode === 'now' ? 'now' : 'next';
  const r = steerJob(id, a.user.id, text, mode);
  if (!r) return fail(404, 'job not found or finished');
  return json({ ok: true, id: r.id });
}
