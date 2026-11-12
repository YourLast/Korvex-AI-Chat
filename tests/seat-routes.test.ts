import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';
process.env.KX_SUPPORT_TG = 'https://t.me/korvex_support_test'; process.env.KX_SUPPORT_EMAIL = 'support@example.com';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), set: (n: string, v: string) => { jar.set(n, v); }, delete: (n: string) => { jar.delete(n); } }),
  headers: async () => new Headers(),
}));
tmpData();
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
let cur: string;
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, authed: async () => { const d = await import('@/lib/db'); return { user: d.getDb().select().from(d.schema.users).all().find((u) => u.id === cur)! }; } };
});
beforeAll(async () => {
  const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', createdAt: 1, lang: 'en' }).run();
  db.insert(schema.threads).values({ id: 't', userId: 'u', modelId: 'm', createdAt: 1, updatedAt: 1 }).run();
});
afterEach(() => { for (const k of ['KX_WEEK_MODE', 'KX_WEEK_LIMIT', 'KX_WEEK_HARD']) delete process.env[k]; });
const post = async () => (await import('@/app/api/chat/route')).POST(new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify({ threadId: 't', text: 'hi', modelId: 'm', levelId: 'low' }) }));

describe('/api/chat и недельный лимит', () => {
  it('сверх жёсткого порога — 429 week_limit: текст + поддержка на языке человека, resetAt', async () => {
    cur = 'u';
    process.env.KX_WEEK_LIMIT = '100'; process.env.KX_WEEK_HARD = '200';
    db.insert(schema.jobs).values({ id: 'big', userId: 'u', kind: 'chat', modelId: 'm', levelId: 'low', status: 'done', createdAt: Date.now(), cardS: 250 }).run();
    const r = await post();
    expect(r.status).toBe(429);
    const j = (await r.json()) as { error: string; code: string; resetAt: number };
    expect(j.code).toBe('week_limit');
    expect(j.error).toContain("You've used up your weekly limit. You can send new messages from Monday.");
    expect(j.error).toContain('Support: Telegram @korvex_support_test, email support@example.com');
    expect(j.resetAt).toBeGreaterThan(Date.now());
  });
  it('KX_WEEK_MODE=off — лимит не мешает (ход доходит до обычной проверки, а не до 429 лимита)', async () => {
    process.env.KX_WEEK_LIMIT = '100'; process.env.KX_WEEK_HARD = '200'; process.env.KX_WEEK_MODE = 'off';
    const r = await post();
    expect(((await r.json().catch(() => ({}))) as { code?: string }).code).not.toBe('week_limit');
  });
});

describe('вход', () => {
  it('верный пароль + пауза «одно место» — особый текст 403; неверный пароль — как всегда 401 и ничего не раскрывает', async () => {
    const { hashPassword } = await import('@/lib/auth');
    db.insert(schema.users).values({ id: 'p', email: 'p@t.io', name: 'P', passwordHash: await hashPassword('secret-pass'), createdAt: 1, disabled: 1, blockKind: 'pause', blockReason: 'auto:seat-sharing', blockedBy: 'system:seat', blockedAt: Date.now(), lang: 'ru' }).run();
    const login = async (pw: string) => (await import('@/app/api/auth/login/route')).POST(new Request('http://x/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'p@t.io', password: pw }) }));
    const bad = await login('wrong');
    expect(bad.status).toBe(401);
    expect(JSON.stringify(await bad.json())).not.toContain('приостановлен');
    const ok = await login('secret-pass');
    expect(ok.status).toBe(403);
    const t = ((await ok.json()) as { error: string }).error;
    expect(t).toContain('Доступ временно приостановлен: похоже, аккаунтом пользуются несколько человек. Напишите нам в поддержку, разберёмся.');
    expect(t).toContain('Поддержка: Telegram @korvex_support_test');
    db.update(schema.users).set({ blockReason: 'спам' }).where(eq(schema.users.id, 'p')).run();
    expect((await login('secret-pass')).status).toBe(401);
  });
});
