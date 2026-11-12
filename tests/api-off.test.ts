import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
tmpData();
afterEach(() => { process.env.KX_API = '1'; });

describe('KX_API', () => {
  it('выключен: /v1/models и /v1/chat/completions — 503 service_unavailable, без ключа тоже', async () => {
    delete process.env.KX_API;
    const m = await import('@/app/v1/models/route'), c = await import('@/app/v1/chat/completions/route');
    for (const r of [await m.GET(new Request('http://x/v1/models')), await c.POST(new Request('http://x/v1/chat/completions', { method: 'POST', body: '{}' }))]) {
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: { message: 'API временно недоступен', type: 'service_unavailable' } });
    }
  });
  it('/api/keys (список, создание, отзыв) — 503 с тем же текстом', async () => {
    delete process.env.KX_API;
    const k = await import('@/app/api/keys/route'), kid = await import('@/app/api/keys/[id]/route');
    for (const r of [await k.GET(new Request('http://x/api/keys')), await k.POST(new Request('http://x/api/keys', { method: 'POST', body: '{}' })), await kid.DELETE(new Request('http://x/api/keys/1', { method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) })]) {
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'API временно недоступен' });
    }
  });
  it('включён (KX_API=1): прежнее поведение — без ключа 401', async () => {
    process.env.KX_API = '1';
    const m = await import('@/app/v1/models/route');
    expect((await m.GET(new Request('http://x/v1/models'))).status).toBe(401);
  });
  it('ключ администратора баннера идёт через adminOrKey (authKey), а не через /v1: флаг его не трогает', async () => {
    delete process.env.KX_API;
    const a = await import('@/lib/adminAuth');
    const r = await a.adminOrKey(new Request('http://x/api/admin/banner', { headers: { authorization: 'Bearer kx-nope' } }));
    expect('res' in r && r.res.status).toBe(401);
  });
});
