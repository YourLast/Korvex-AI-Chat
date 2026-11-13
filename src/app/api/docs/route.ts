import { authed, fail, json } from '@/lib/api';
import { featureFor, FEATURE_OFF } from '@/lib/features';
import { countByType, listOrgDocs, ownFolder } from '@/lib/orgDocs';
import { DOC_TYPES, type DocType } from '@/lib/docType';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  if (!featureFor('files', a.user.id)) return fail(403, FEATURE_OFF);
  const u = new URL(req.url);
  const folder = u.searchParams.get('folder') || null;
  if (folder && !ownFolder(a.user.id, folder)) return fail(404, 'Нет такой организации');
  const type = u.searchParams.get('type');
  const from = u.searchParams.get('from'), to = u.searchParams.get('to');
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return fail(400, 'Неверные данные');
  const t = type && (DOC_TYPES as readonly string[]).includes(type) ? (type as DocType) : null;
  const inPeriod = listOrgDocs(a.user.id, folder, { from, to, q: u.searchParams.get('q') });
  const docs = t ? inPeriod.filter((d) => d.type === t) : inPeriod;
  return json({ docs: docs.slice(0, 1000), total: docs.length, counts: countByType(inPeriod) });
}
