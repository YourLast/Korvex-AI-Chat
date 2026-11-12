import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
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

tmpData();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, I: typeof import('@/lib/invites');
let POST_INVITE: typeof import('@/app/api/auth/invite/route').POST, GET_INVITE: typeof import('@/app/api/auth/invite/route').GET;
let POST_ADMIN: typeof import('@/app/api/admin/invites/route').POST, GET_ADMIN: typeof import('@/app/api/admin/invites/route').GET;
let DEL_ADMIN: typeof import('@/app/api/admin/invites/[id]/route').DELETE;
const ADMIN = 'adm';

const H = { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' };
const rq = (url: string, method = 'POST', body?: unknown, extra: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
const reg = (token: string, email: string, extra: Record<string, unknown> = {}) => POST_INVITE(rq('/api/auth/invite', 'POST', { token, email, name: email.split('@')[0], password: 'пароль-12345', ...extra }));
const mk = (maxUses: number, extra: { days?: number; now?: number } = {}) => I.createInvite({ by: ADMIN, maxUses, ...extra });

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: ADMIN, email: 'adm@t.rs', name: 'Админ', passwordHash: 'x', role: 'admin', createdAt: 1 }).run();
  I = await import('@/lib/invites');
  ({ POST: POST_INVITE, GET: GET_INVITE } = await import('@/app/api/auth/invite/route'));
  ({ POST: POST_ADMIN, GET: GET_ADMIN } = await import('@/app/api/admin/invites/route'));
  ({ DELETE: DEL_ADMIN } = await import('@/app/api/admin/invites/[id]/route'));
});

const row = (id: string) => db.select().from(schema.invites).all().find((r) => r.id === id)!;

describe('счёт использований', () => {
  it('одноразовая (maxUses по умолчанию 1): первая регистрация проходит, вторая — «лимит исчерпан»', async () => {
    const { id, token } = I.createInvite({ by: ADMIN });
    expect(row(id).maxUses).toBe(1);
    expect((await reg(token, 'one@t.rs')).status).toBe(200);
    const r2 = await reg(token, 'two@t.rs');
    expect(r2.status).toBe(410);
    expect(((await r2.json()) as { code: string }).code).toBe('used_up');
    expect(row(id)).toMatchObject({ uses: 1 });
    expect(row(id).usedAt).not.toBeNull();
  });

  it('групповая на 5: из 14 одновременных регистраций проходят ровно 5, остальные — 410 used_up; в списке — имена', async () => {
    const { id, token } = mk(5);
    const emails = Array.from({ length: 14 }, (_, i) => `g${i}@t.rs`);
    const res = await Promise.all(emails.map((e) => reg(token, e, { lang: 'sr' })));
    const ok = res.filter((r) => r.status === 200).length;
    expect(ok).toBe(5);
    for (const r of res.filter((x) => x.status !== 200)) { expect(r.status).toBe(410); expect(((await r.json()) as { code: string }).code).toBe('used_up'); }
    expect(row(id)).toMatchObject({ uses: 5, maxUses: 5 });
    expect(row(id).usedAt).not.toBeNull();
    const people = I.listInvites().find((x) => x.id === id)!.people;
    expect(people).toHaveLength(5);
    const registered = db.select().from(schema.users).all().filter((u) => emails.includes(u.email));
    expect(registered).toHaveLength(5);
    expect(registered.every((u) => u.lang === 'sr')).toBe(true);
    expect(people.map((p) => p.name).sort()).toEqual(registered.map((u) => u.name).sort());
  });

  it('takeInvite: ровно maxUses успехов подряд, дальше false; giveBack возвращает место', () => {
    const { id } = mk(3);
    expect([1, 2, 3, 4, 5].map(() => I.takeInvite(id))).toEqual([true, true, true, false, false]);
    I.giveBackInvite(id);
    expect(row(id)).toMatchObject({ uses: 2, usedAt: null });
    expect(I.takeInvite(id)).toBe(true);
    expect(row(id).uses).toBe(3);
  });

  it('та же почта дважды одновременно: один аккаунт, второй получает 409 и место возвращается', async () => {
    const { id, token } = mk(4);
    const res = await Promise.all([reg(token, 'same@t.rs'), reg(token, 'same@t.rs'), reg(token, 'same@t.rs')]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    expect(row(id).uses).toBe(1);
  });

  it('почта уже занята: 409 и место не расходуется', async () => {
    const { id, token } = mk(2);
    const r = await reg(token, 'adm@t.rs');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe('email_taken');
    expect(row(id).uses).toBe(0);
  });
});

describe('срок, отзыв, состояния', () => {
  it('истекла -> expired (регистрация 410); свободных мест видно сколько осталось', async () => {
    const { id, token } = mk(10, { now: Date.now() - 3 * 864e5, days: 1 });
    expect(I.inviteState(token)).toMatchObject({ state: 'expired', left: 10 });
    const r = await reg(token, 'late@t.rs');
    expect(r.status).toBe(410);
    expect(((await r.json()) as { code: string }).code).toBe('expired');
    expect(row(id).uses).toBe(0);
    expect(I.takeInvite(id)).toBe(false);
  });
  it('неизвестный токен -> unknown', async () => {
    expect(I.inviteState('нет-такого-токена-вовсе').state).toBe('unknown');
    expect(((await (await reg(randomBytes(12).toString('base64url'), 'x@t.rs')).json()) as { code: string }).code).toBe('unknown');
  });
  it('отозвана -> revoked; использованную отзыв оставляет в списке (с именами), неиспользованную удаляет', async () => {
    const used = mk(3), fresh = mk(3);
    expect((await reg(used.token, 'rev1@t.rs')).status).toBe(200);
    expect(I.revokeInvite(used.id)).toBe('revoked');
    expect(I.inviteState(used.token).state).toBe('revoked');
    const r = await reg(used.token, 'rev2@t.rs');
    expect(r.status).toBe(410);
    expect(((await r.json()) as { code: string }).code).toBe('revoked');
    expect(I.listInvites().find((x) => x.id === used.id)).toMatchObject({ uses: 1, revokedAt: expect.any(Number) });
    expect(I.revokeInvite(fresh.id)).toBe('deleted');
    expect(I.inviteState(fresh.token).state).toBe('unknown');
    expect(I.revokeInvite('нет')).toBe('none');
  });
  it('inviteLive: отозванная, исчерпанная и истёкшая — не живые', async () => {
    const { inviteLive } = await import('@/lib/inviteTypes');
    const now = Date.now();
    expect(inviteLive({ revokedAt: null, uses: 1, maxUses: 29, expiresAt: now + 1e6 }, now)).toBe(true);
    expect(inviteLive({ revokedAt: now, uses: 1, maxUses: 29, expiresAt: now + 1e6 }, now)).toBe(false);
    expect(inviteLive({ revokedAt: null, uses: 29, maxUses: 29, expiresAt: now + 1e6 }, now)).toBe(false);
    expect(inviteLive({ revokedAt: null, uses: 0, maxUses: 29, expiresAt: now - 1 }, now)).toBe(false);
  });
});

describe('администратор создаёт групповую ссылку', () => {
  const asAdmin = () => { const t = randomBytes(16).toString('base64url'); db.insert(schema.sessions).values({ id: sha(t), userId: ADMIN, createdAt: Date.now(), expiresAt: Date.now() + 1e9 }).run(); jar.set('kx_session', t); };
  it('maxUses 1…200 и срок 1…30 дней; за пределами — 400; обычный пользователь — 403', async () => {
    asAdmin();
    const ok = await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 29, days: 7, note: 'класс' }));
    expect(ok.status).toBe(200);
    const { path } = (await ok.json()) as { path: string };
    expect(path).toMatch(/^\/invite\/[\w-]{20,}$/);
    const token = path.split('/').pop()!;
    expect(I.inviteState(token)).toMatchObject({ state: 'ok', left: 29 });
    expect((await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 200, days: 30 }))).status).toBe(200);
    expect((await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 201 }))).status).toBe(400);
    expect((await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 0 }))).status).toBe(400);
    expect((await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 5, days: 31 }))).status).toBe(400);
    const def = (await (await POST_ADMIN(rq('/api/admin/invites', 'POST', {}))).json()) as { path: string };
    expect(I.inviteState(def.path.split('/').pop()!)).toMatchObject({ state: 'ok', left: 1 });
    expect(db.select().from(schema.invites).all().some((r) => r.tokenHash === token)).toBe(false);
    const list = (await (await GET_ADMIN(rq('/api/admin/invites', 'GET'))).json()) as { invites: { maxUses: number; uses: number; note: string }[] };
    expect(list.invites.find((x) => x.note === 'класс')).toMatchObject({ maxUses: 29, uses: 0 });
    const id = db.select().from(schema.invites).all().find((r) => r.note === 'класс')!.id;
    expect(((await (await DEL_ADMIN(rq(`/api/admin/invites/${id}`, 'DELETE'), { params: Promise.resolve({ id }) })).json()) as { result: string }).result).toBe('deleted');
    jar.clear();
    expect((await POST_ADMIN(rq('/api/admin/invites', 'POST', { maxUses: 5 }))).status).toBe(401);
  });
});

describe('места по групповой ссылке для страницы приглашения', () => {
  const seats = async (token: string) => (await GET_INVITE(new Request(`http://localhost/api/auth/invite?t=${encodeURIComponent(token)}`))).json() as Promise<{ state: string; left: number; max: number }>;
  it('left / max живые: после каждой регистрации — меньше; на нуле — used_up; неизвестная ссылка — unknown', async () => {
    const { token } = mk(3);
    expect(await seats(token)).toEqual({ state: 'ok', left: 3, max: 3 });
    expect((await reg(token, 'seat1@t.rs')).status).toBe(200);
    expect(await seats(token)).toEqual({ state: 'ok', left: 2, max: 3 });
    await reg(token, 'seat2@t.rs'); await reg(token, 'seat3@t.rs');
    expect(await seats(token)).toEqual({ state: 'used_up', left: 0, max: 3 });
    expect((await seats('нет-такого-токена-вовсе')).state).toBe('unknown');
    expect((await seats('x')).state).toBe('unknown');
  });
  it('одноразовая: max = 1 (страница строку не показывает)', async () => {
    const { token } = I.createInvite({ by: ADMIN });
    expect(await seats(token)).toEqual({ state: 'ok', left: 1, max: 1 });
  });
});
