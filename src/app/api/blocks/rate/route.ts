import { authed, fail, json } from '@/lib/api';
import { rateFor } from '@/lib/blocks/cbr';
import { countBlock } from '@/lib/blocks/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const q = new URL(req.url).searchParams;
  const code = (q.get('code') ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return fail(400, 'code — три латинские буквы');
  const date = q.get('date'), from = q.get('from'), to = q.get('to');
  if ((date && !ISO.test(date)) || (from && !ISO.test(from)) || (to && !ISO.test(to))) return fail(400, 'дата — ГГГГ-ММ-ДД');
  const range = from && to ? (Date.parse(to) - Date.parse(from) <= 400 * 86400_000 ? { from, to } : null) : null;
  countBlock('rate');
  return json(await rateFor(code, date, range));
}
