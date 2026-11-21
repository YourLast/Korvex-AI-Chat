import { z } from 'zod';
import { authed, fail } from '@/lib/api';
import { reqLang } from '@/lib/i18n/server';
import { parseBlock } from '@/lib/blocks/parse';
import { attachment, blockFilePath, readBlockFile, tableXlsx } from '@/lib/blocks/server';
import { LIMITS } from '@/lib/blocks/schema';
import { countBlock } from '@/lib/blocks/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Body = z.object({ block: z.unknown().optional(), href: z.string().max(600).optional() });

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const raw = await req.text();
  if (raw.length > LIMITS.fileBytes + 4096) return fail(413, 'слишком большой блок');
  let body: unknown; try { body = JSON.parse(raw); } catch { return fail(400, 'bad body'); }
  const p = Body.safeParse(body);
  if (!p.success || (!p.data.block && !p.data.href)) return fail(400, 'block или href');
  let parsed;
  if (p.data.href) {
    const file = blockFilePath(a.user.id, p.data.href, a.user.role === 'admin');
    parsed = file ? readBlockFile(file) : null;
    if (!parsed) return fail(404, 'not found');
  } else parsed = parseBlock(JSON.stringify(p.data.block), 'file');
  if (!parsed.ok || parsed.block.type !== 'table') return fail(400, 'нужен блок-таблица');
  const buf = await tableXlsx(parsed.block, reqLang(req, a.user.lang));
  countBlock('xlsx');
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': attachment(parsed.block.title, 'xlsx'), 'Cache-Control': 'no-store' } });
}
