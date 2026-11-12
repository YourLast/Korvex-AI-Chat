import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
let cur: { id: string } | null = null;
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, authed: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); return { user: getDb().select().from(schema.users).all().find((u) => u.id === cur!.id)! }; } };
});
vi.mock('@/lib/adminAuth', async () => {
  const m = await import('@/lib/api');
  return { adminOrKey: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); const u = getDb().select().from(schema.users).all().find((x) => x.id === cur!.id)!; return u.role === 'admin' ? { user: u, viaKey: false } : { res: m.fail(403, 'admin') }; } };
});

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let F: typeof import('@/lib/features'), S: typeof import('@/lib/settings');

beforeAll(async () => {
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  for (const [id, role] of [['adm', 'admin'], ['usr', 'user']] as const)
    db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', role, createdAt: 1 }).run();
  F = await import('@/lib/features'); S = await import('@/lib/settings');
});
beforeEach(() => { db.delete(schema.settings).run(); S._resetSettingsCache(); cur = null; delete process.env.ALLOW_SIGNUP; });

describe('настройки и выключатели', () => {
  it('умолчание — как без настройки; запись администратора главнее; null — снова умолчание', () => {
    expect(F.featureOn('voice')).toBe(true);
    F.setFeature('voice', false, 'adm');
    expect(F.featureOn('voice')).toBe(false);
    expect(db.select().from(schema.settings).all()).toMatchObject([{ key: 'feature.voice', value: 'false', updatedBy: 'adm' }]);
    F.setFeature('voice', null, 'adm');
    expect(F.featureOn('voice')).toBe(true);
    expect(db.select().from(schema.settings).all()).toHaveLength(0);
  });
  it('регистрация: умолчание из ALLOW_SIGNUP, выключатель — главнее', () => {
    expect(F.featureOn('signup')).toBe(false);
    process.env.ALLOW_SIGNUP = '1';
    expect(F.featureOn('signup')).toBe(true);
    F.setFeature('signup', false, 'adm');
    expect(F.featureOn('signup')).toBe(false);
  });
  it('выключенный голос — 403 на сервере; включённый — дальше обычные проверки', async () => {
    const { POST } = await import('@/app/api/transcribe/route');
    cur = { id: 'usr' };
    F.setFeature('voice', false, 'adm');
    const off = await POST(new Request('http://x/api/transcribe', { method: 'POST', headers: { origin: 'http://x' }, body: new FormData() }));
    expect(off.status).toBe(403);
    expect((await off.json()).error).toBe(F.FEATURE_OFF);
    F.setFeature('voice', null, 'adm');
    const on = await POST(new Request('http://x/api/transcribe', { method: 'POST', headers: { origin: 'http://x' }, body: new FormData() }));
    expect(on.status).toBe(400);
  });
  it('/api/admin/features: только админ; список с умолчаниями; переключение и возврат', async () => {
    const R = await import('@/app/api/admin/features/route');
    cur = { id: 'usr' };
    expect((await R.GET(new Request('http://x/api/admin/features'))).status).toBe(403);
    cur = { id: 'adm' };
    const g = await (await R.GET(new Request('http://x/api/admin/features'))).json();
    expect(g.features.map((f: { id: string }) => f.id)).toEqual([...F.FEATURE_IDS]);
    expect(g.features.find((f: { id: string }) => f.id === 'code')).toMatchObject({ warn: 'code' });
    const post = (body: unknown) => R.POST(new Request('http://x/api/admin/features', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const r = await (await post({ id: 'compare', on: false })).json();
    expect(r.features.find((f: { id: string }) => f.id === 'compare')).toMatchObject({ on: false, default: true });
    expect((await post({ id: 'nope', on: true })).status).toBe(400);
    const back = await (await post({ id: 'compare', on: null })).json();
    expect(back.features.find((f: { id: string }) => f.id === 'compare').on).toBe(true);
  });
});
