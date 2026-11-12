import { NextResponse } from 'next/server';
import { count, W } from './plural';
import { adminOnly, fail } from './api';
import { authKey, rateLimit, touchKey } from './apikeys';
import type { User } from './db/schema';

export async function adminOrKey(req: Request, mutating = false): Promise<{ user: User; viaKey: boolean } | { res: NextResponse }> {
  if (req.headers.get('authorization')) {
    const k = authKey(req);
    if ('status' in k) return { res: NextResponse.json({ error: k.message, code: k.code }, { status: k.status }) };
    if (k.user.role !== 'admin') return { res: fail(403, 'Ключ не администратора') };
    const retry = rateLimit(k.key.id, k.key.rpm);
    if (retry !== null) return { res: NextResponse.json({ error: `Лимит ключа: ${count(k.key.rpm, W.request)} в минуту` }, { status: 429, headers: { 'Retry-After': String(retry) } }) };
    touchKey(k.key.id);
    return { user: k.user, viaKey: true };
  }
  const a = await adminOnly(req, mutating);
  return 'res' in a ? a : { user: a.user, viaKey: false };
}
