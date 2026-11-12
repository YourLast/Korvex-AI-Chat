import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
let cur: { id: string } | null = null;
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, authed: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); return { user: getDb().select().from(schema.users).all().find((u) => u.id === cur!.id)! }; } };
});

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let A: typeof import('@/lib/access'), M: typeof import('@/lib/models'), F: typeof import('@/lib/features'), S: typeof import('@/lib/settings');
let open: string;

beforeAll(async () => {
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([
    { id: 'adm', email: 'adm@t', name: 'adm', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'u1', email: 'u1@t', name: 'u1', passwordHash: 'x', role: 'user', createdAt: 1 },
    { id: 'u2', email: 'u2@t', name: 'u2', passwordHash: 'x', role: 'user', createdAt: 1 },
    { id: 'al', email: 'al@t', name: 'al', passwordHash: 'x', role: 'alpha', createdAt: 1 },
  ]).run();
  db.insert(schema.invites).values({ id: 'inv1', tokenHash: 'h', role: 'user', note: 'Команда партнёра', createdBy: 'adm', createdAt: 1, expiresAt: 9e15 }).run();
  db.insert(schema.inviteUses).values({ id: 'iu1', inviteId: 'inv1', userId: 'u2', name: 'u2', createdAt: 2 }).run();
  A = await import('@/lib/access'); M = await import('@/lib/models'); F = await import('@/lib/features'); S = await import('@/lib/settings');
  open = M.getModels().find((m) => !m.hidden && !m.roles && !m.variantOf)!.id;
});
beforeEach(() => { db.delete(schema.settings).run(); S._resetSettingsCache(); cur = null; });

describe('правила доступа', () => {
  it('без правила — как конфиг; правило по роли — только эта роль (админ — всегда)', () => {
    expect(M.modelAllowed(M.getModel(open), 'user', 'u1')).toBe(true);
    A.setRule('model', open, { roles: ['alpha'] }, 'adm');
    expect(M.modelAllowed(M.getModel(open), 'user', 'u1')).toBe(false);
    expect(M.modelAllowed(M.getModel(open), 'alpha', 'al')).toBe(true);
    expect(M.modelAllowed(M.getModel(open), 'admin', 'adm')).toBe(true);
    expect(M.modelAllowed(M.getModel(open), 'user')).toBe(false);
    A.setRule('model', open, null, 'adm');
    expect(M.modelAllowed(M.getModel(open), 'user', 'u1')).toBe(true);
  });
  it('человек и ссылка-приглашение: модель видна только им; в выборе у остальных — нет, в «закрытых» — есть', () => {
    A.setRule('model', open, { roles: [], users: ['u1'], invites: ['inv1'] }, 'adm');
    const ids = (uid: string) => M.publicModels('user', 'ru', 'user', uid).map((m) => m.id);
    expect(ids('u1')).toContain(open);
    expect(ids('u2')).toContain(open);
    expect(ids('al')).not.toContain(open);
    expect(M.lockedFor('alpha', 'al').map((m) => m.id)).toContain(open);
    expect(M.usableModel(open, 'user', 'u2')).toBeTruthy();
    expect(M.usableModel(open, 'alpha', 'al')).toBeUndefined();
  });
  it('функция по правилу: остальным — выключена в карте и 403 на сервере', async () => {
    A.setRule('feature', 'voice', { roles: ['alpha'] }, 'adm');
    expect(F.featureMap('u1').voice).toBe(false);
    expect(F.featureMap('al').voice).toBe(true);
    expect(F.featureMap('adm').voice).toBe(true);
    const { POST } = await import('@/app/api/transcribe/route');
    cur = { id: 'u1' };
    expect((await POST(new Request('http://x/api/transcribe', { method: 'POST', headers: { origin: 'http://x' }, body: new FormData() }))).status).toBe(403);
    cur = { id: 'al' };
    expect((await POST(new Request('http://x/api/transcribe', { method: 'POST', headers: { origin: 'http://x' }, body: new FormData() }))).status).toBe(400);
  });
  it('закрытая модель не отвечает на ход (403)', async () => {
    A.setRule('model', open, { roles: ['alpha'] }, 'adm');
    const { submitTurn } = await import('@/lib/jobs');
    const now = Date.now();
    db.insert(schema.threads).values({ id: 'th1', userId: 'u1', title: 't', modelId: open, effort: M.getModel(open)!.defaultLevel, createdAt: now, updatedAt: now }).run();
    const t = db.select().from(schema.threads).all().find((x) => x.id === 'th1')!;
    expect(() => submitTurn({ thread: t, userId: 'u1', mode: 'send', text: 'привет', modelId: open, levelId: M.getModel(open)!.defaultLevel })).toThrow(/недоступна/);
  });
});
