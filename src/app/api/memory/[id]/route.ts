import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { deleteMemory, updateMemory, SECTIONS, MAX_TEXT } from '@/lib/memory';
import { memoryState } from '@/lib/memoryView';
import { publish } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ text: z.string().max(MAX_TEXT * 2).optional(), section: z.enum(SECTIONS.map((s) => s.id) as [string, ...string[]]).optional(), sure: z.literal(true).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const r = p.data.sure && p.data.text === undefined && p.data.section === undefined ? updateMemory(a.user.id, id, { sure: true }) : updateMemory(a.user.id, id, { text: p.data.text, section: p.data.section as never, origin: 'manual', ...(p.data.sure ? { sure: true } : {}) });
  if (!r) return fail(404, 'not found');
  if (!r.ok) return fail(400, r.message);
  publish(a.user.id, { t: 'memory', action: 'updated' });
  return json(memoryState(a.user.id));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const { id } = await params;
  if (!deleteMemory(a.user.id, [id])) return fail(404, 'not found');
  publish(a.user.id, { t: 'memory', action: 'deleted' });
  return json(memoryState(a.user.id));
}
