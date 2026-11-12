import { adminOnly, json } from '@/lib/api';
import { analytics } from '@/lib/analytics';
import { keysView } from '@/lib/anthropic/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOnly(req);
  if ('res' in a) return a.res;
  const days = Number(new URL(req.url).searchParams.get('days')) || 7;
  let claudeKeys: ReturnType<typeof keysView> | null = null;
  try { claudeKeys = keysView(); } catch { claudeKeys = null; }
  return json({ ...analytics(days, a.user.timezone || 'Europe/Moscow'), claudeKeys });
}
