import { z } from 'zod';
import { authed, fail } from '@/lib/api';
import { reqLang } from '@/lib/i18n/server';
import { parseBlock } from '@/lib/blocks/parse';
import { attachment, deadlinesIcs } from '@/lib/blocks/server';
import { countBlock } from '@/lib/blocks/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Body = z.object({ block: z.unknown() });

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'block');
  const parsed = parseBlock(JSON.stringify(p.data.block), 'file');
  if (!parsed.ok || parsed.block.type !== 'deadlines') return fail(400, 'нужен блок «сроки»');
  countBlock('ics');
  return new Response(deadlinesIcs(parsed.block, reqLang(req, a.user.lang)), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': attachment(parsed.block.title, 'ics'), 'Cache-Control': 'no-store' } });
}
