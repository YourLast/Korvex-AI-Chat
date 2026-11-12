import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { agentsOnly, fail, json } from '@/lib/api';
import { isRunning, modelBusy, runAutomation } from '@/lib/automations';
import { FEATURE_OFF, featureFor } from '@/lib/features';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('automations', a.user.id)) return fail(403, FEATURE_OFF);
  const { id } = await params;
  const auto = getDb().select().from(schema.automations).where(and(eq(schema.automations.id, id), eq(schema.automations.userId, a.user.id))).get();
  if (!auto) return fail(404, 'not found');
  if (isRunning(auto.id)) return fail(409, 'Эта задача уже выполняется');
  if (modelBusy(auto.modelId)) return fail(409, 'Модель занята другой автоматизацией, попробуйте через минуту');
  void runAutomation(auto, 'manual').catch((e) => console.error('[automation] manual run failed', (e as Error).message));
  return json({ started: true }, 202);
}
