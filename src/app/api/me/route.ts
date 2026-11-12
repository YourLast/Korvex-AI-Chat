import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { nextRun } from '@/lib/cron';
import { getDb, schema } from '@/lib/db';
import { authed, fail, json } from '@/lib/api';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ timezone: z.string().max(64).optional(), name: z.string().max(80).optional(), notifyQuiet: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d-([01]?\d|2[0-3]):[0-5]\d$/).nullable().optional(), lang: z.enum(['ru', 'en', 'sr']).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const set: { timezone?: string; name?: string; notifyQuiet?: string | null; lang?: string } = {};
  if (p.data.lang !== undefined) set.lang = p.data.lang;
  if (p.data.notifyQuiet !== undefined) set.notifyQuiet = p.data.notifyQuiet;
  if (p.data.timezone !== undefined) {
    try { new Intl.DateTimeFormat('ru-RU', { timeZone: p.data.timezone }); } catch { return fail(400, 'Неизвестный часовой пояс'); }
    set.timezone = p.data.timezone;
  }
  if (p.data.name !== undefined) {
    const n = p.data.name.replace(/\s+/g, ' ').trim();
    if (!n) return fail(400, 'Имя не может быть пустым');
    set.name = n;
  }
  if (Object.keys(set).length) getDb().update(schema.users).set(set).where(eq(schema.users.id, a.user.id)).run();
  let moved = 0;
  const old = a.user.timezone;
  if (set.timezone && old && set.timezone !== old) {
    const db = getDb();
    const rows = db.select().from(schema.automations).where(and(eq(schema.automations.userId, a.user.id), eq(schema.automations.timezone, old))).all();
    for (const r of rows) {
      let next: number | null = r.nextRunAt;
      if (r.enabled) { try { next = nextRun(r.cron, set.timezone); } catch { next = r.nextRunAt; } }
      db.update(schema.automations).set({ timezone: set.timezone, nextRunAt: next }).where(eq(schema.automations.id, r.id)).run();
      moved++;
    }
  }
  return json({ ok: true, ...set, moved });
}
