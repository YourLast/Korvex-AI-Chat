import { json } from '@/lib/api';
import { ownedFile } from '@/lib/fileAccess';
import { gridOf } from '@/lib/gridview';
import { extractedTotal, loadLines } from '@/lib/textview';
import { isCardText, viewKind } from '@/lib/viewKind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 3_000_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await ownedFile(req, id, { log: true });
  if (!o.ok) return o.res;
  const { f, file, st } = o.v;
  const sp = new URL(req.url).searchParams;
  if (sp.has('content')) {
    const t = f.text ?? '';
    return json({ id: f.id, name: f.name, text: t.length > MAX_CONTENT ? t.slice(0, MAX_CONTENT) : t, truncated: t.length > MAX_CONTENT });
  }
  let kind = viewKind(f.name);
  const info = (f.info ?? {}) as Record<string, unknown>;
  const card = isCardText(f.text, info);
  if (kind === 'none' && f.text && !card) kind = 'extracted';
  const base = { id: f.id, name: f.name, size: st.size, kind };
  if (kind === 'grid') {
    const wait = Math.min(25_000, Math.max(0, Number(sp.get('wait') ?? 15_000) || 0));
    const g = await gridOf(file, st, f.name, { waitMs: wait });
    return json(g.state === 'ready' ? { ...base, state: 'ready', meta: g.meta } : { ...base, ...g });
  }
  if (kind === 'extracted') return json({ ...base, state: 'ready', total: extractedTotal(f.id, f.text ?? ''), enc: 'utf8', truncated: false, binary: false });
  if (kind === 'text' || kind === 'md') {
    const c = loadLines(file, st);
    return json({ ...base, state: 'ready', total: c.lines.length, enc: c.enc, truncated: c.truncated, binary: c.binary });
  }
  return json({ ...base, state: 'ready' });
}
