import { authed, fail, json } from '@/lib/api';
import { answerJobStep } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; step: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id, step } = await params;
  const b = (await req.json().catch(() => ({}))) as { decision?: unknown };
  if (b.decision !== 'allow' && b.decision !== 'deny' && b.decision !== 'open') return fail(400, 'decision: allow | deny | open');
  if (!answerJobStep(id, step, a.user.id, b.decision)) return fail(404, 'step not waiting');
  return json({ ok: true });
}
