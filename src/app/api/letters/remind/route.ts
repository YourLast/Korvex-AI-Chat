import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { remindersOf, setReminder } from '@/lib/letterRemind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const m = new URL(req.url).searchParams.get('m') ?? '';
  if (!m) return fail(400, 'm — id ответа');
  return json({ reminders: remindersOf(a.user.id, m) });
}

const Body = z.object({ messageId: z.string().min(1).max(64), tag: z.string().min(1).max(16), on: z.boolean() });
export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'messageId, tag, on');
  const at = setReminder(a.user.id, p.data.messageId, p.data.tag, p.data.on);
  if (at === false) return fail(404, 'Нет такого ответа');
  return json({ at });
}
