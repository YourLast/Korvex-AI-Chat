import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { mcpServers, saveMcpServer, viewOf } from '@/lib/mcp/servers';
import { ruleOf } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => ({ servers: mcpServers().map((s) => ({ ...viewOf(s), rule: ruleOf('mcp', s.id) })) });

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(view());
}

const Body = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(60).optional(),
  url: z.string().max(2000).optional(),
  headerName: z.string().max(64).nullable().optional(),
  headerValue: z.string().max(4000).nullable().optional(),
  on: z.boolean().optional(),
  ask: z.enum(['always', 'write', 'never']).optional(),
  off: z.array(z.string().max(200)).max(500).optional(),
});
const ERR: Record<string, string> = { name: 'Укажите название', url: 'Адрес — http(s)://… без логина и пароля', header: 'Имя заголовка — латиница, цифры и дефис', 'not found': 'Нет такого сервера', 'too many servers': 'Слишком много серверов' };

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  try {
    const s = saveMcpServer(p.data, a.user.id);
    return json({ ok: true, id: s.id, ...view() });
  } catch (e) {
    const m = (e as Error).message;
    return fail(m === 'not found' ? 404 : 400, ERR[m] ?? 'Неверные данные');
  }
}
