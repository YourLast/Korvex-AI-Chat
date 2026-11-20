import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public/sw.js'), 'utf8');
type Ev = { request: { method: string; url: string; mode?: string }; preloadResponse?: Promise<Response | undefined>; respondWith: (p: Promise<Response>) => void };

function load(o: { net: 'ok' | 'down'; cache: Record<string, Response | undefined>; cacheThrows?: boolean }) {
  const handlers: Record<string, (e: Ev) => void> = {};
  const self = { addEventListener: (k: string, f: (e: Ev) => void) => { handlers[k] = f; }, registration: {}, clients: {} };
  const caches = {
    match: async (r: { url?: string } | string) => { if (o.cacheThrows) throw new Error('no cache'); const k = typeof r === 'string' ? r : new URL(r.url!).pathname; return o.cache[k]?.clone(); },
    open: async () => ({ put: async () => {} }), keys: async () => [], delete: async () => true,
  };
  const fetch = async () => { if (o.net === 'down') throw new TypeError('Load failed'); return new Response('net', { status: 200 }); };
  new Function('self', 'caches', 'fetch', 'location', 'Response', SRC)(self, caches, fetch, { origin: 'https://k.test' }, Response);
  return async (url: string, mode?: string): Promise<Response | null | undefined> => {
    let got: Promise<Response> | null = null;
    handlers.fetch({ request: { method: 'GET', url: 'https://k.test' + url, mode }, preloadResponse: Promise.resolve(undefined), respondWith: (p) => { got = p; } });
    if (!got) return null;
    return got;
  };
}

describe('сервис-воркер: всегда Response', () => {
  it('страница, сервер недоступен, offline.html в кэше — она', async () => {
    const go = load({ net: 'down', cache: { '/offline.html': new Response('<offline>', { headers: { 'Content-Type': 'text/html' } }) } });
    const r = await go('/c/123', 'navigate');
    expect(r).toBeInstanceOf(Response);
    expect(await r!.text()).toBe('<offline>');
  });
  it('страница, сервер недоступен, кэш выселен — запасная страница 503, не null', async () => {
    for (const cacheThrows of [false, true]) {
      const r = await load({ net: 'down', cache: {}, cacheThrows })('/', 'navigate');
      expect(r).toBeInstanceOf(Response);
      expect(r!.status).toBe(503);
      expect(r!.headers.get('content-type')).toContain('text/html');
      const html = await r!.text();
      expect(html).toContain('Нет связи с сервером');
      expect(html).toContain('location.reload');
    }
  });
  it('статика, сервер недоступен, в кэше нет — пустой 503, не отказ', async () => {
    const r = await load({ net: 'down', cache: {} })('/_next/static/chunks/a.js');
    expect(r).toBeInstanceOf(Response);
    expect(r!.status).toBe(503);
  });
  it('статика из кэша и из сети — как раньше', async () => {
    const hit = await load({ net: 'down', cache: { '/mark.png': new Response('png') } })('/mark.png');
    expect(await hit!.text()).toBe('png');
    const net = await load({ net: 'ok', cache: {} })('/icon-192.png');
    expect(await net!.text()).toBe('net');
  });
  it('страница, сеть есть — ответ сети; API и чужие адреса воркер не трогает', async () => {
    const go = load({ net: 'ok', cache: {} });
    expect(await (await go('/', 'navigate'))!.text()).toBe('net');
    expect(await go('/api/me')).toBeNull();
  });
});
