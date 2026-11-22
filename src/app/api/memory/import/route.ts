import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { memoryAllowed, SECTIONS } from '@/lib/memory';
import { IMPORT_MAX_CHARS, IMPORT_MAX_ITEMS, IMPORT_PROMPT_EN, IMPORT_PROMPT_RU, parseImportFor, saveImport } from '@/lib/memoryImport';
import { userLang } from '@/lib/userLang';
import { publish } from '@/lib/bus';
import { memoryState } from '@/lib/memoryView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json({ prompt: userLang(a.user.id) === 'ru' ? IMPORT_PROMPT_RU : IMPORT_PROMPT_EN });
}

const SEC = z.enum(SECTIONS.map((s) => s.id) as [string, ...string[]]);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('parse'), text: z.string().max(IMPORT_MAX_CHARS * 2) }),
  z.object({ action: z.literal('save'), items: z.array(z.object({ text: z.string().max(400), section: SEC })).max(IMPORT_MAX_ITEMS) }),
]);

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!memoryAllowed(a.user.id, null)) return fail(403, 'Память выключена');
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'Неверные данные');
  if (p.data.action === 'parse') return json({ items: parseImportFor(a.user.id, p.data.text) });
  const r = saveImport(a.user.id, p.data.items as never);
  if (r.added) publish(a.user.id, { t: 'memory', action: 'updated' });
  return json({ ...r, ...memoryState(a.user.id) });
}
