import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dir = tmpData();
const out = path.join(dir, 'secrets', 'links.txt');
const ADMIN = 'admin-lan@example.com';
const setup = (...extra: string[]) => execFileSync(process.execPath, ['scripts/lan-setup.mjs', '--base', 'http://korvex.lan:3101', '--admin', ADMIN, '--out', out, ...extra], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
const links = () => Object.fromEntries(fs.readFileSync(out, 'utf8').split('\n').filter((l) => /^(admin|all) /.test(l)).map((l) => [l.split(' ')[0], l.split('/invite/')[1]]));

const H = { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' };
const rq = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let POST_INVITE: typeof import('@/app/api/auth/invite/route').POST;
let printed = '';

beforeAll(async () => {
  printed = setup();
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ POST: POST_INVITE } = await import('@/app/api/auth/invite/route'));
});
const reg = (token: string, email: string, password = 'пароль-12345') => POST_INVITE(rq('/api/auth/invite', { token, email, name: email.split('@')[0], password }));
const user = (email: string) => db.select().from(schema.users).all().find((u) => u.email === email);

describe('установка в локальной сети', () => {
  it('ссылки — только в файле 0600, не в выводе; в БД — админ без пароля и две ссылки', () => {
    const l = links();
    expect(l.admin).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(l.all).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(printed).not.toContain(l.admin);
    expect(printed).not.toContain(l.all);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    expect(user(ADMIN)).toMatchObject({ role: 'admin', source: 'setup', passwordHash: '' });
    const inv = db.select().from(schema.invites).all();
    expect(inv).toHaveLength(2);
    expect(inv.find((i) => i.role === 'user')).toMatchObject({ maxUses: 1_000_000_000, email: null });
    expect(inv.find((i) => i.role === 'admin')).toMatchObject({ maxUses: 1, email: ADMIN });
  });

  it('пока пароль не задан, войти в аккаунт админа нельзя', async () => {
    const { verifyPassword } = await import('@/lib/auth');
    expect(await verifyPassword(user(ADMIN)!.passwordHash, '')).toBe(false);
    expect(await verifyPassword(user(ADMIN)!.passwordHash, 'пароль-12345')).toBe(false);
  });

  it('общая ссылка: 3 человека — «Пользователь»; почтой админа по ней не войти', async () => {
    const t = links().all;
    for (const e of ['lan-a@example.com', 'lan-b@example.com', 'lan-c@example.com']) {
      expect((await reg(t, e)).status).toBe(200);
      expect(user(e)!.role).toBe('user');
    }
    const r = await reg(t, ADMIN);
    expect(r.status).toBe(409);
    expect(user(ADMIN)).toMatchObject({ source: 'setup', passwordHash: '' });
  });

  it('админская ссылка: чужая почта — отказ без траты места; своя — пароль задан, роль admin; второй раз — нет', async () => {
    const t = links().admin;
    const bad = await reg(t, 'lan-x@example.com');
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { code: string }).code).toBe('email_mismatch');
    expect(user('lan-x@example.com')).toBeUndefined();
    expect((await reg(t, ADMIN, 'свой-пароль-777')).status).toBe(200);
    const a = user(ADMIN)!;
    expect(a).toMatchObject({ role: 'admin', source: '' });
    const { verifyPassword } = await import('@/lib/auth');
    expect(await verifyPassword(a.passwordHash, 'свой-пароль-777')).toBe(true);
    const again = await reg(t, ADMIN, 'другой-пароль-1');
    expect(again.status).toBe(410);
    expect(await verifyPassword(user(ADMIN)!.passwordHash, 'свой-пароль-777')).toBe(true);
  });

  it('повтор без --rotate новых ссылок не делает; --rotate отзывает общую и даёт новую (админ уже вошёл — админской нет)', async () => {
    const old = links().all;
    expect(setup()).toContain('новых нет');
    setup('--rotate');
    const fresh = links().all;
    expect(fresh).not.toBe(old);
    expect(links().admin).toBeDefined();
    const r = await reg(old, 'lan-d@example.com');
    expect(r.status).toBe(410);
    expect(((await r.json()) as { code: string }).code).toBe('revoked');
    expect((await reg(fresh, 'lan-d@example.com')).status).toBe(200);
    expect(db.select().from(schema.invites).all().filter((i) => i.role === 'admin')).toHaveLength(1);
  });

  it('KX_LAN=1: открытая регистрация на пустой БД первого админа не создаёт', async () => {
    tmpData();
    (globalThis as { __kxDb?: unknown }).__kxDb = undefined;
    const { POST } = await import('@/app/api/auth/register/route');
    const body = { email: 'first@example.com', name: 'F', password: 'пароль-12345' };
    process.env.KX_LAN = '1';
    try { expect((await POST(rq('/api/auth/register', body))).status).toBe(403); } finally { delete process.env.KX_LAN; }
    const { getDb, schema: sc } = await import('@/lib/db');
    expect(getDb().select().from(sc.users).all()).toHaveLength(0);
    expect((await POST(rq('/api/auth/register', body))).status).toBe(200);
    expect(getDb().select().from(sc.users).all()[0]?.role).toBe('admin');
  });
});

describe('отметка тура по админке', () => {
  it('нет отметки — тур покажется; done:true — нет; done:false — снова; не админу — 403', async () => {
    const { tourPending } = await import('@/lib/adminTour');
    const { getDb, schema: sc } = await import('@/lib/db');
    const d = getDb();
    d.insert(sc.users).values({ id: 'tour-adm', email: 'tour-adm@example.com', name: 'A', passwordHash: 'x', role: 'admin', createdAt: 1 }).run();
    d.insert(sc.users).values({ id: 'tour-usr', email: 'tour-usr@example.com', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
    const { startSession } = await import('@/lib/auth');
    const { POST } = await import('@/app/api/admin/tour/route');
    const as = async (id: string, done: boolean) => { jar.clear(); await startSession(id); const c = [...jar].map(([k, v]) => `${k}=${v}`).join('; '); return POST(new Request('http://localhost/api/admin/tour', { method: 'POST', headers: { ...H, Cookie: c }, body: JSON.stringify({ done }) })); };
    expect(tourPending('tour-adm')).toBe(true);
    expect((await as('tour-adm', true)).status).toBe(200);
    expect(tourPending('tour-adm')).toBe(false);
    expect((await as('tour-adm', false)).status).toBe(200);
    expect(tourPending('tour-adm')).toBe(true);
    expect((await as('tour-usr', true)).status).toBe(403);
  });
});

describe('KX_LAN=1: web push по умолчанию выключен (службы push браузеров — в интернете)', () => {
  it('push: без KX_LAN — включён, с KX_LAN=1 — выключен', async () => {
    const { featureDefault } = await import('@/lib/features');
    expect(featureDefault('push')).toBe(true);
    process.env.KX_LAN = '1';
    try { expect(featureDefault('push')).toBe(false); } finally { delete process.env.KX_LAN; }
  });
});
