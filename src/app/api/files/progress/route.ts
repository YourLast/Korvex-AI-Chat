import { NextResponse } from 'next/server';
import { authed } from '@/lib/api';
import { PID_RE, readUpload } from '@/lib/uploadProgress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!PID_RE.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  return NextResponse.json(await readUpload(id, a.user.id), { headers: { 'Cache-Control': 'no-store' } });
}
