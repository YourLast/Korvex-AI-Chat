import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { blockTypes, DEFAULT_TYPES, orgTypes, region, setBlockTypes, setOrgTypes } from '@/lib/blocks/config';
import { BLOCK_TYPES, STAGE1_TYPES } from '@/lib/blocks/schema';
import { usageSince } from '@/lib/blocks/usage';
import { featureOn } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => ({
  on: featureOn('blocks'), region: region(), types: blockTypes(), defaults: DEFAULT_TYPES,
  ready: STAGE1_TYPES,
  usage: usageSince(7),
});

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  const org = new URL(req.url).searchParams.get('org');
  return json({ ...view(), ...(org ? { org: { id: org, types: orgTypes(org) } } : {}) });
}

const Types = z.record(z.enum(BLOCK_TYPES), z.boolean());
const Body = z.union([
  z.object({ types: Types.nullable() }),
  z.object({ org: z.string().min(1).max(64), types: Types.nullable() }),
]);

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, `types — { ${BLOCK_TYPES.join(' | ')}: true | false } или null; org — id папки организации`);
  if ('org' in p.data) setOrgTypes(p.data.org, p.data.types, a.user.id);
  else setBlockTypes(p.data.types, a.user.id);
  return json({ ok: true, ...view() });
}
