import { json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { checkUpdate } from '@/lib/updates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(await checkUpdate({ force: new URL(req.url).searchParams.get('force') === '1' }));
}
