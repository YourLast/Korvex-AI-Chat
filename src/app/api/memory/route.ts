import { z } from 'zod';
import { authed, fail, json } from '@/lib/api';
import { addMemory, clearMemory, deleteMemory, listMemory, setPrefs, SECTIONS, MAX_TEXT } from '@/lib/memory';
import { memoryState } from '@/lib/memoryView';
import { publish } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Section = z.enum(SECTIONS.map((s) => s.id) as [string, ...string[]]);

export async function GET(req: Request) {
  const a = await authed(req);
  if ('res' in a) return a.res;
  return json(memoryState(a.user.id));
}

export async function PATCH(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ on: z.boolean().optional(), auto: z.boolean().optional(), callName: z.string().max(60).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  if (p.data.callName !== undefined) {
    const v = p.data.callName.replace(/[\n\r«»"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v) deleteMemory(a.user.id, listMemory(a.user.id).filter((r) => r.key === 'name').map((r) => r.id));
    else {
      const r = addMemory(a.user.id, { section: 'who', key: 'name', text: `Зовут ${v}`, origin: 'manual' });
      if (!r.ok) return fail(400, r.message);
    }
    publish(a.user.id, { t: 'memory', action: 'name' });
    return json(memoryState(a.user.id));
  }
  const prefs = setPrefs(a.user.id, { on: p.data.on, auto: p.data.auto });
  publish(a.user.id, { t: 'memory', action: 'prefs' });
  return json({ prefs });
}

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ section: Section, text: z.string().max(MAX_TEXT * 2) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const r = addMemory(a.user.id, { section: p.data.section as never, text: p.data.text, origin: 'manual' });
  if (!r.ok) return fail(400, r.message);
  publish(a.user.id, { t: 'memory', action: r.action });
  return json({ ...memoryState(a.user.id), id: r.row.id, action: r.action });
}

export async function DELETE(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const n = clearMemory(a.user.id);
  publish(a.user.id, { t: 'memory', action: 'cleared' });
  return json({ deleted: n, ...memoryState(a.user.id) });
}
