import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';

let cur: { id: string; role: string } | null = null;
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), currentUser: async () => cur }));

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let PATCH: typeof import('@/app/api/threads/[id]/route').PATCH;
const T0 = 1_790_000_000_000;
const patch = (id: string, body: unknown) => PATCH(new Request(`http://localhost/api/threads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Host: 'localhost', Origin: 'http://localhost' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const effort = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!.effort;

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'adm', email: 'adm@t', name: 'adm', passwordHash: 'x', role: 'admin', createdAt: T0 }).run();
  db.insert(schema.users).values({ id: 'usr', email: 'usr@t', name: 'usr', passwordHash: 'x', role: 'user', createdAt: T0 }).run();
  for (const [id, uid] of [['t-adm', 'adm'], ['t-usr', 'usr']]) db.insert(schema.threads).values({ id, userId: uid, title: id, modelId: 'alpha', effort: 'medium', createdAt: T0, updatedAt: T0 }).run();
  ({ PATCH } = await import('@/app/api/threads/[id]/route'));
});

describe('сохранение уровня в чате', () => {
  it('обычный пользователь: max -> в чате xhigh; открытые уровни — как есть', async () => {
    cur = { id: 'usr', role: 'user' };
    expect((await patch('t-usr', { modelId: 'alpha', levelId: 'max' })).status).toBe(200);
    expect(effort('t-usr')).toBe('xhigh');
    for (const l of ['off', 'low', 'medium', 'xhigh']) { await patch('t-usr', { modelId: 'alpha', levelId: l }); expect(effort('t-usr')).toBe(l); }
  });
  it('админ: max сохраняется как max', async () => {
    cur = { id: 'adm', role: 'admin' };
    expect((await patch('t-adm', { modelId: 'alpha', levelId: 'max' })).status).toBe(200);
    expect(effort('t-adm')).toBe('max');
  });
  it('неизвестный уровень — 400, чат не меняется', async () => {
    cur = { id: 'usr', role: 'user' };
    const before = effort('t-usr');
    expect((await patch('t-usr', { modelId: 'alpha', levelId: 'ultra' })).status).toBe(400);
    expect(effort('t-usr')).toBe(before);
  });
});
