import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { deleteMcpServer } from '@/lib/mcp/servers';
import { setRule } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!deleteMcpServer(id, a.user.id)) return fail(404, 'Нет такого сервера');
  setRule('mcp', id, null, a.user.id);
  return json({ ok: true });
}
