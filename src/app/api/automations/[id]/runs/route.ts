import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { agentsOnly, fail, json } from '@/lib/api';
import { listRuns } from '@/lib/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await agentsOnly(req);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!getDb().select({ id: schema.automations.id }).from(schema.automations).where(and(eq(schema.automations.id, id), eq(schema.automations.userId, a.user.id))).get()) return fail(404, 'not found');
  return json({ runs: listRuns(id, 15).map((r) => ({ id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, trigger: r.trigger, error: r.error, durationMs: r.durationMs, messageId: r.messageId })) });
}
