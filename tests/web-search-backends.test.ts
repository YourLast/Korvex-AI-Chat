import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
vi.mock('@/ext/env', () => ({ STAND_ENV: {} }));
let W: typeof import('@/lib/webSearch');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
const ENV = ['KX_SEARX_URL', 'KX_BRAVE_API_KEY', 'KX_TAVILY_API_KEY'];

beforeAll(async () => { W = await import('@/lib/webSearch'); const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema; });
afterEach(async () => {
  for (const k of ENV) delete process.env[k];
  db.delete(schema.settings).run();
  (await import('@/lib/settings'))._resetSettingsCache();
});

type Call = { url: string; init?: RequestInit };
const fake = (body: unknown, calls: Call[], status = 200): typeof fetch => async (u, init) => { calls.push({ url: String(u), init }); return new Response(JSON.stringify(body), { status }); };

describe('выбор поисковика', () => {
  it('ничего не настроено — поиска нет', () => { expect(W.searchConf()).toBeNull(); });
  it('окружение: SearXNG, затем Brave, затем Tavily', () => {
    process.env.KX_TAVILY_API_KEY = 'tv-test';
    expect(W.searchConf()).toMatchObject({ kind: 'tavily', key: 'tv-test', from: 'env' });
    process.env.KX_BRAVE_API_KEY = 'br-test';
    expect(W.searchConf()).toMatchObject({ kind: 'brave', key: 'br-test' });
    process.env.KX_SEARX_URL = 'http://search:8080/';
    expect(W.searchConf()).toMatchObject({ kind: 'searxng', url: 'http://search:8080', key: null });
  });
  it('выбор администратора главнее окружения; ключ в БД только зашифрованным; в виде для админки — только «задан»', () => {
    process.env.KX_SEARX_URL = 'http://search:8080';
    W.saveSearch({ kind: 'brave', key: 'br-admin-key-12345' }, null);
    expect(W.searchConf()).toMatchObject({ kind: 'brave', key: 'br-admin-key-12345', from: 'admin' });
    const raw = JSON.stringify(db.select().from(schema.settings).all());
    expect(raw).not.toContain('br-admin-key-12345');
    const v = W.searchView();
    expect(v).toMatchObject({ kind: 'brave', active: true, keys: { brave: true, tavily: false } });
    expect(JSON.stringify(v)).not.toContain('br-admin-key-12345');
    W.saveSearch({ kind: 'brave', key: null }, null);
    expect(W.searchConf()).toMatchObject({ kind: 'searxng', from: 'env' });
  });
});

describe('запросы', () => {
  it('SearXNG: /search, format=json, срок и язык', async () => {
    const calls: Call[] = [];
    const hits = await W.runSearch({ kind: 'searxng', url: 'http://search:8080', key: null }, 'korvex', { time_range: 'week', language: 'en' }, fake({ results: [{ url: 'https://a.example', title: 'A' }] }, calls));
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/search');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: 'korvex', format: 'json', time_range: 'week', language: 'en' });
    expect(hits).toEqual([{ url: 'https://a.example', title: 'A' }]);
  });
  it('Brave: ключ в X-Subscription-Token, свежесть pw, теги из отрывков убраны', async () => {
    const calls: Call[] = [];
    const hits = await W.runSearch({ kind: 'brave', url: '', key: 'br' }, 'q', { time_range: 'week' },
      fake({ web: { results: [{ url: 'https://b.example', title: '<strong>B</strong>', description: 'x <strong>y</strong>', page_age: '2026-11-01' }] } }, calls));
    expect(calls[0].url).toContain('api.search.brave.com/res/v1/web/search');
    expect(new URL(calls[0].url).searchParams.get('freshness')).toBe('pw');
    expect((calls[0].init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('br');
    expect(hits).toEqual([{ url: 'https://b.example', title: 'B', content: 'x y', publishedDate: '2026-11-01' }]);
  });
  it('Tavily: POST с Bearer, max_results 8', async () => {
    const calls: Call[] = [];
    const hits = await W.runSearch({ kind: 'tavily', url: '', key: 'tv' }, 'q', { time_range: 'day' }, fake({ results: [{ url: 'https://c.example', title: 'C', content: 'z' }] }, calls));
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tv');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ query: 'q', max_results: 8, time_range: 'day' });
    expect(hits[0]).toMatchObject({ url: 'https://c.example', content: 'z' });
  });
  it('ошибка поисковика — исключение с кодом', async () => {
    await expect(W.runSearch({ kind: 'brave', url: '', key: 'bad' }, 'q', {}, fake({}, [], 401))).rejects.toThrow('HTTP 401');
  });
});
