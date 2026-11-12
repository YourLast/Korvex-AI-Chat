import { z } from 'zod';
import { fail, json } from '@/lib/api';
import { adminOrKey } from '@/lib/adminAuth';
import { getDb, schema } from '@/lib/db';
import { getModels } from '@/lib/models';
import { FEATURE_IDS } from '@/lib/features';
import { ruleOf, setRule } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view() {
  const db = getDb();
  const models = getModels().filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.name, roles: m.roles ?? null, rule: ruleOf('model', m.id) }));
  const features = FEATURE_IDS.filter((id) => id !== 'signup').map((id) => ({ id, rule: ruleOf('feature', id) }));
  const users = db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role }).from(schema.users).all();
  const invites = db.select({ id: schema.invites.id, note: schema.invites.note, role: schema.invites.role, uses: schema.invites.uses, createdAt: schema.invites.createdAt }).from(schema.invites).all()
    .filter((i) => (i.uses ?? 0) > 0).sort((a, b) => b.createdAt - a.createdAt);
  return { models, features, users, invites };
}

export async function GET(req: Request) {
  const a = await adminOrKey(req);
  if ('res' in a) return a.res;
  return json(view());
}

const Rule = z.object({ roles: z.array(z.enum(['user', 'alpha', 'admin'])).max(3), users: z.array(z.string().max(64)).max(500), invites: z.array(z.string().max(64)).max(200) });
const Body = z.object({ kind: z.enum(['model', 'feature']), id: z.string().min(1).max(64), rule: Rule.nullable() });

export async function POST(req: Request) {
  const a = await adminOrKey(req, true);
  if ('res' in a) return a.res;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, p.error.issues[0]?.message || 'Неверные данные');
  if (p.data.kind === 'feature' && !(FEATURE_IDS as readonly string[]).includes(p.data.id)) return fail(400, 'Нет такой функции');
  setRule(p.data.kind, p.data.id, p.data.rule, a.user.id);
  return json({ ok: true, ...view() });
}
