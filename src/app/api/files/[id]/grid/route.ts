import { fail, json } from '@/lib/api';
import { ownedFile } from '@/lib/fileAccess';
import { gridOf, rowList, rowRange } from '@/lib/gridview';
import { viewKind } from '@/lib/viewKind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await ownedFile(req, id);
  if (!o.ok) return o.res;
  const { f, file, st, lang } = o.v;
  if (viewKind(f.name) !== 'grid') return fail(415, 'not a table');
  const g = await gridOf(file, st, f.name, { waitMs: 0 });
  if (g.state !== 'ready') return json({ state: g.state }, g.state === 'pending' ? 202 : 422);
  const sp = new URL(req.url).searchParams;
  const sheet = Math.max(0, Math.floor(Number(sp.get('sheet') ?? 0)) || 0);
  if (sp.has('rows')) {
    const list = (sp.get('rows') ?? '').split(',').map((x) => Number(x)).filter((n) => Number.isInteger(n));
    const r = rowList(g.sha, g.meta, sheet, list, lang);
    return r ? json({ sheet, ...r }) : fail(404, 'no sheet');
  }
  const from = Number(sp.get('from') ?? 1), to = Number(sp.get('to') ?? from + 99);
  const r = rowRange(g.sha, g.meta, sheet, from, to, lang);
  return r ? json({ sheet, ...r }) : fail(404, 'no sheet');
}
