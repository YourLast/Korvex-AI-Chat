import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
let cur: { id: string } | null = null;
vi.mock('@/lib/adminAuth', async () => {
  const m = await import('@/lib/api');
  return { adminOrKey: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); const u = getDb().select().from(schema.users).all().find((x) => x.id === cur!.id)!; return u.role === 'admin' ? { user: u, viaKey: false } : { res: m.fail(403, 'admin') }; } };
});

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let B: typeof import('@/lib/brand'), C: typeof import('@/lib/brandCore'), S: typeof import('@/lib/settings');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3e3a2c40000000049454e44ae426082', 'hex');

beforeAll(async () => {
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'adm', email: 'adm@t', name: 'adm', passwordHash: 'x', role: 'admin', createdAt: 1 }).run();
  B = await import('@/lib/brand'); C = await import('@/lib/brandCore'); S = await import('@/lib/settings');
});
beforeEach(() => { db.delete(schema.settings).run(); S._resetSettingsCache(); C.setBrandNames(null); cur = { id: 'adm' }; });

const post = async (body: unknown) => (await import('@/app/api/admin/brand/route')).POST(new Request('http://x/api/admin/brand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const logo = async (data: Buffer, type = 'application/octet-stream') => {
  const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(data)], { type }), 'logo');
  return (await import('@/app/api/admin/brand/logo/route')).POST(new Request('http://x/api/admin/brand/logo', { method: 'POST', body: fd }));
};

describe('бренд партнёра', () => {
  it('без настройки — Korvex; название подставляется в тексты интерфейса и системный текст; пустое — снова Korvex', async () => {
    const { tr } = await import('@/lib/i18n/core');
    const before = tr('ru', 'pwa.desc');
    expect(B.brand()).toMatchObject({ name: 'Korvex AI', short: 'Korvex', accent: null, logo: null });
    expect((await post({ name: 'Acme Assist', short: 'Acme', accent: '#3366ff' })).status).toBe(200);
    expect(B.brand()).toMatchObject({ name: 'Acme Assist', short: 'Acme', accent: '#3366ff' });
    expect(tr('ru', 'pwa.desc')).toBe(before.replace(/Korvex AI/g, 'Acme Assist').replace(/Korvex/g, 'Acme'));
    expect(C.brandText('Инструменты Korvex: ты работаешь в приложении Korvex AI')).toBe('Инструменты Acme: ты работаешь в приложении Acme Assist');
    expect(C.brandText('заголовок X-Korvex-Conversation и переменная KORVEX_API_KEY')).toBe('заголовок X-Korvex-Conversation и переменная KORVEX_API_KEY');
    expect((await post({ accent: 'red' })).status).toBe(400);
    await post({ name: '', short: '', footer: null, accent: null });
    expect(B.brand()).toMatchObject({ name: 'Korvex AI', short: 'Korvex', accent: null });
    expect(tr('ru', 'pwa.desc')).toBe(before);
  });
  it('футер: null — умолчание сборки, пустая строка — без строки, своя — своя', async () => {
    const { FOOTER_TEXT } = await import('@/ext/client');
    expect(B.brand().footer).toBe(FOOTER_TEXT);
    await post({ footer: '© 2026 Acme' });
    expect(B.brand().footer).toBe('© 2026 Acme');
    await post({ footer: '' });
    expect(B.brand().footer).toBe('');
  });
  it('логотип: PNG — да, SVG со скриптом и прочее — нет; /brand/logo отдаёт его без входа, без своего — знак по умолчанию', async () => {
    const { GET } = await import('@/app/brand/logo/route');
    const none = await GET(new Request('http://x/brand/logo'));
    expect(none.status).toBe(302);
    expect(none.headers.get('location')).toBe('http://x/mark.png');
    expect((await logo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status).toBe(415);
    expect((await logo(Buffer.from('просто текст'))).status).toBe(415);
    const r = await (await logo(PNG, 'image/png')).json();
    expect(r.logoUrl).toMatch(/^\/brand\/logo\?v=\d+$/);
    const got = await GET(new Request('http://x/brand/logo'));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await logo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'))).status).toBe(200);
    expect((await GET(new Request('http://x/brand/logo'))).headers.get('content-type')).toBe('image/svg+xml');
    const { DELETE } = await import('@/app/api/admin/brand/logo/route');
    await DELETE(new Request('http://x/api/admin/brand/logo', { method: 'DELETE' }));
    expect((await GET(new Request('http://x/brand/logo'))).status).toBe(302);
  });
});
