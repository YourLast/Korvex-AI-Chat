import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { agentsOnly, fail, json } from '@/lib/api';
import { validateCron } from '@/lib/cron';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const a = await agentsOnly(req, true);
  if ('res' in a) return a.res;
  const p = z.object({ cron: z.string().max(100), timezone: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, 'bad body');
  const bad = validateCron(p.data.cron, p.data.timezone);
  if (bad) return json({ error: bad });
  const it = CronExpressionParser.parse(p.data.cron, { tz: p.data.timezone, currentDate: new Date() });
  return json({ runs: [it.next().toDate().getTime(), it.next().toDate().getTime(), it.next().toDate().getTime()] });
}
