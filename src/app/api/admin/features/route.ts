import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { FEATURE_IDS, featureDefault, featureOn, featureWarn, setFeature, type FeatureId } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => FEATURE_IDS.map((id) => ({ id, on: featureOn(id), default: featureDefault(id), ...(featureWarn(id) ? { warn: featureWarn(id) } : {}) }));

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json({ features: view() });
}

const Body = z.object({ id: z.enum(FEATURE_IDS), on: z.boolean().nullable() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, `id — ${FEATURE_IDS.join(' | ')}; on — true | false | null`);
  setFeature(p.data.id as FeatureId, p.data.on, a.user.id);
  return json({ ok: true, features: view() });
}
