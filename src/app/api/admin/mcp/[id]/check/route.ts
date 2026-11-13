import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { checkMcpServer, viewOf } from '@/lib/mcp/servers';
import { ruleOf } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  try {
    const s = await checkMcpServer(id, a.user.id);
    return json({ ok: !s.error, server: { ...viewOf(s), rule: ruleOf('mcp', s.id) } });
  } catch {
    return fail(404, 'Нет такого сервера');
  }
}
