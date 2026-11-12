import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { tmpData } from './helpers';

const jar = { token: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.token ? { name: n, value: jar.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

tmpData();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ADMIN = { id: 'admin-1', token: randomBytes(32).toString('base64url') };
const U = { id: 'user-u', token: randomBytes(32).toString('base64url') };
const OTHER = { id: 'user-o', token: randomBytes(32).toString('base64url') };
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const keys: Record<string, string> = {};

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  const now = Date.now();
  for (const [u, role] of [[ADMIN, 'admin'], [U, 'user'], [OTHER, 'user']] as const) {
    db.insert(schema.users).values({ id: u.id, email: `${u.id}@t`, name: u.id, passwordHash: 'x', role, createdAt: now }).run();
    db.insert(schema.sessions).values({ id: sha(u.token), userId: u.id, createdAt: now, expiresAt: now + 864e5 }).run();
    db.insert(schema.pushSubs).values({ id: `ps-${u.id}`, userId: u.id, device: 'd1', endpoint: `https://push.example/${u.id}`, p256dh: 'p', auth: 'a', createdAt: now }).run();
  }
  const K = await import('@/lib/apikeys');
  const users = db.select().from(schema.users).all();
  for (const id of [U.id, OTHER.id]) {
    const r = K.createKey(users.find((x) => x.id === id)!, { name: 'k', models: ['alpha'] });
    if ('error' in r) throw new Error(r.error);
    keys[id] = r.key;
  }
});

const bearer = (k: string) => new Request('http://x/v1/models', { headers: { Authorization: `Bearer ${k}` } });

describe('сброс пароля администратором отзывает доступ пользователя', () => {
  it('сессии, ключи API и push-подписки пользователя — закрыты; у другого — нет', async () => {
    const K = await import('@/lib/apikeys');
    expect('user' in K.authKey(bearer(keys[U.id]))).toBe(true);
    jar.token = ADMIN.token;
    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    const r = await PATCH(new Request(`http://localhost/api/admin/users/${U.id}`, { method: 'PATCH', headers: { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'new-password-123' }) }), { params: Promise.resolve({ id: U.id }) });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { revoked: Record<string, number> }).revoked).toEqual({ sessions: 1, apiKeys: 1, pushSubs: 1 });
    expect(db.select().from(schema.sessions).all().some((s) => s.userId === U.id)).toBe(false);
    expect(db.select().from(schema.pushSubs).all().some((s) => s.userId === U.id)).toBe(false);
    const k = db.select().from(schema.apiKeys).all().find((x) => x.userId === U.id)!;
    expect(k.revokedAt).toBeTruthy();
    const after = K.authKey(bearer(keys[U.id]));
    expect('status' in after && after.message).toBe('Ключ отозван');
    expect(db.select().from(schema.sessions).all().some((s) => s.userId === OTHER.id)).toBe(true);
    expect(db.select().from(schema.pushSubs).all().some((s) => s.userId === OTHER.id)).toBe(true);
    expect('user' in K.authKey(bearer(keys[OTHER.id]))).toBe(true);
  });

  it('отключение пользователя — так же; смена только роли — ничего не отзывает', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    jar.token = ADMIN.token;
    const call = (body: unknown) => PATCH(new Request(`http://localhost/api/admin/users/${OTHER.id}`, { method: 'PATCH', headers: { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }), { params: Promise.resolve({ id: OTHER.id }) });
    const role = await call({ role: 'user' });
    expect(((await role.json()) as { revoked: Record<string, number> }).revoked).toEqual({ sessions: 0, apiKeys: 0, pushSubs: 0 });
    expect(db.select().from(schema.pushSubs).all().some((s) => s.userId === OTHER.id)).toBe(true);
    const off = await call({ disabled: true });
    expect(((await off.json()) as { revoked: Record<string, number> }).revoked).toEqual({ sessions: 1, apiKeys: 1, pushSubs: 1 });
    expect(db.select().from(schema.apiKeys).all().find((x) => x.userId === OTHER.id)!.revokedAt).toBeTruthy();
  });

  it('не администратор сбросить пароль не может', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    db.insert(schema.sessions).values({ id: sha(U.token), userId: U.id, createdAt: Date.now(), expiresAt: Date.now() + 864e5 }).run();
    jar.token = U.token;
    const r = await PATCH(new Request(`http://localhost/api/admin/users/${ADMIN.id}`, { method: 'PATCH', headers: { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'hacked-password' }) }), { params: Promise.resolve({ id: ADMIN.id }) });
    expect(r.status).toBe(403);
  });
});
