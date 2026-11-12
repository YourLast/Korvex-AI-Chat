import { fail, json } from '@/lib/api';
import { ownedFile } from '@/lib/fileAccess';
import { extractedWindow, findLine, textWindow } from '@/lib/textview';
import { isCardText, viewKind } from '@/lib/viewKind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await ownedFile(req, id);
  if (!o.ok) return o.res;
  const { f, file, st } = o.v;
  const k = viewKind(f.name);
  const info = (f.info ?? {}) as Record<string, unknown>;
  const card = isCardText(f.text, info);
  const sp = new URL(req.url).searchParams;
  const from = Number(sp.get('from') ?? 1), to = Number(sp.get('to') ?? 200);
  if (k === 'extracted' || (k === 'none' && f.text && !card)) {
    const find = sp.get('find');
    if (find) return json({ line: findLine(f.id, f.text ?? '', find.slice(0, 300)) });
    return json(extractedWindow(f.id, f.text ?? '', from, to));
  }
  if (k !== 'text' && k !== 'md') return fail(415, 'not a text file');
  return json(textWindow(file, st, from, to));
}
