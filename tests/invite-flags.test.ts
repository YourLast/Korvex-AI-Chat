import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
let me = 'adm';
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, adminOnly: async () => { const { getDb, schema } = await import('@/lib/db'); const { eq } = await import('drizzle-orm'); const u = getDb().select().from(schema.users).where(eq(schema.users.id, me)).get()!; return u.role === 'admin' ? { user: u } : { res: m.fail(403, 'admin') }; } };
});
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let F: typeof import('@/lib/inviteFlags'), P: typeof import('@/lib/levelPolicy'), M: typeof import('@/lib/models'), W: typeof import('@/lib/week');

beforeAll(async () => {
  const lv = (ids: string[]) => ids.map((id) => ({ id, label: id, effort: id === 'off' ? null : id }));
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify({ models: [
    { id: 'alpha', name: 'Alpha', baseUrl: 'http://127.0.0.1:9/v1', upstreamModel: 'e', defaultLevel: 'medium', levels: lv(['off', 'medium', 'xhigh', 'max']), contextTokens: 8192, maxOutputTokens: 512 },
    { id: 'gamma', name: 'Gamma', provider: 'anthropic', roles: ['alpha', 'admin'], upstreamModel: 'claude-x', defaultLevel: 'max', levels: lv(['medium', 'max']), contextTokens: 8192, maxOutputTokens: 512 },
  ] }));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([
    { id: 'adm', email: 'adm@t', name: 'A', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'b1', email: 'b1@t', name: 'Бухгалтер 1', passwordHash: 'x', role: 'user', createdAt: 1 },
    { id: 'b2', email: 'b2@t', name: 'Бухгалтер 2', passwordHash: 'x', role: 'user', createdAt: 1, weekMult: 2 },
    { id: 'x', email: 'x@t', name: 'Другой', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  db.insert(schema.invites).values([
    { id: 'acme', tokenHash: 'h1', role: 'user', note: 'Acme test', createdBy: 'adm', expiresAt: Date.now() + 864e5, maxUses: 10, uses: 2, createdAt: 1 },
    { id: 'other', tokenHash: 'h2', role: 'user', note: 'другие', createdBy: 'adm', expiresAt: Date.now() + 864e5, maxUses: 10, uses: 1, createdAt: 1 },
  ]).run();
  db.insert(schema.inviteUses).values([
    { id: 'u1', inviteId: 'acme', userId: 'b1', name: 'Бухгалтер 1', createdAt: 2 },
    { id: 'u2', inviteId: 'acme', userId: 'b2', name: 'Бухгалтер 2', createdAt: 3 },
    { id: 'u3', inviteId: 'other', userId: 'x', name: 'Другой', createdAt: 4 },
  ]).run();
  F = await import('@/lib/inviteFlags'); P = await import('@/lib/levelPolicy'); M = await import('@/lib/models'); W = await import('@/lib/week');
});

const levels = (userId: string) => P.modelsFor('user', 'ru', userId).find((m) => m.id === 'alpha')!.levels.map((l) => l.id);

describe('настройки группы по ссылке', () => {
  it('без флагов — как было: у user нет max, ход с max уходит как xhigh', () => {
    expect(levels('b1')).not.toContain('max');
    const alpha = M.getModel('alpha')!;
    expect(P.capLevel(alpha, alpha.levels.find((l) => l.id === 'max')!, 'b1').id).toBe('xhigh');
  });
  it('флаг «Max» группы: max в выборе и в движке у её людей; у другой группы — нет; Gamma по-прежнему закрыта', async () => {
    const { POST } = await import('@/app/api/admin/invites/[id]/flags/route');
    const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ max: true }) }), { params: Promise.resolve({ id: 'acme' }) });
    expect(r.status).toBe(200);
    expect(levels('b1')).toContain('max');
    expect(levels('x')).not.toContain('max');
    const alpha = M.getModel('alpha')!;
    expect(P.capLevel(alpha, alpha.levels.find((l) => l.id === 'max')!, 'b1').id).toBe('max');
    expect(P.capLevel(alpha, alpha.levels.find((l) => l.id === 'max')!, 'x').id).toBe('xhigh');
    expect(P.modelsFor('user', 'ru', 'b1').map((m) => m.id)).not.toContain('gamma');
    expect(M.usableModel('gamma', 'user', 'b1')).toBeUndefined();
  });
  it('недельный лимит группы: ×5 для группы, личный ×2 главнее, «без лимита» — 0', () => {
    F.setInviteFlags('acme', { weekMult: 5 }, 'adm');
    expect(F.effectiveWeekMult({ id: 'b1', weekMult: 1 })).toBe(5);
    expect(F.effectiveWeekMult({ id: 'b2', weekMult: 2 })).toBe(2);
    expect(F.effectiveWeekMult({ id: 'x', weekMult: 1 })).toBe(1);
    const u = db.select().from(schema.users).all().find((x) => x.id === 'b1')!;
    const base = W.weekState({ ...db.select().from(schema.users).all().find((x) => x.id === 'x')! });
    expect(W.weekState(u).limit).toBe(base.limit * 5);
    F.setInviteFlags('acme', { weekMult: 0 }, 'adm');
    expect(W.weekState(u).limited).toBe(false);
    F.setInviteFlags('acme', { weekMult: null }, 'adm');
    expect(F.effectiveWeekMult({ id: 'b1', weekMult: 1 })).toBe(1);
  });
  it('«Организации»: флаг группы, остальное не трогается; API — только администратору', async () => {
    const { POST, GET } = await import('@/app/api/admin/invites/[id]/flags/route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ orgs: true }) }), { params: Promise.resolve({ id: 'acme' }) });
    expect(F.userFlags('b1')).toMatchObject({ max: true, orgs: true });
    expect(F.userFlags('x')).toEqual({});
    expect(await (await GET(new Request('http://x'), { params: Promise.resolve({ id: 'acme' }) })).json()).toMatchObject({ flags: { max: true, orgs: true } });
    expect((await GET(new Request('http://x'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
    me = 'b1';
    expect((await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ max: false }) }), { params: Promise.resolve({ id: 'acme' }) })).status).toBe(403);
    me = 'adm';
  });
});
