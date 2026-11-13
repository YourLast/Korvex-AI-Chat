import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpData } from './helpers';

tmpData();
let L: typeof import('@/lib/localModel');
let srv: http.Server, base = '';
let pulled = false, failPull = false;

beforeAll(async () => {
  L = await import('@/lib/localModel');
  srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: pulled ? [{ name: 'tiny:1b', model: 'tiny:1b' }] : [] })); return; }
    if (req.url === '/api/pull') {
      if (failPull) { res.writeHead(200); res.end(JSON.stringify({ error: 'pull model manifest: file does not exist' }) + '\n'); return; }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      res.write(JSON.stringify({ status: 'pulling a', digest: 'sha256:a', total: 1000, completed: 250 }) + '\n');
      res.write(JSON.stringify({ status: 'pulling b', digest: 'sha256:b', total: 1000, completed: 1000 }) + '\n');
      res.end(JSON.stringify({ status: 'success' }) + '\n');
      pulled = true;
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.close(); delete process.env.KX_OLLAMA_URL; delete process.env.KX_LOCAL_MODEL; });
beforeEach(() => { L._resetLocalForTests(); pulled = false; failPull = false; });

describe('встроенная модель', () => {
  it('имя модели для людей', () => {
    expect(L.prettyName('llama3.2:3b')).toBe('Llama 3.2 3B');
    expect(L.prettyName('gemma3:4b')).toBe('Gemma 3 4B');
    expect(L.prettyName('granite4:micro')).toBe('Granite 4 Micro');
    expect(L.prettyName('phi4-mini')).toBe('Phi 4 Mini');
    expect(L.prettyName('gemma3n:e2b')).toBe('Gemma 3n E2B');
    expect(L.prettyName('mistral:latest')).toBe('Mistral');
  });

  it('без KX_OLLAMA_URL / KX_LOCAL_MODEL — ничего: ни записей, ни баннера, модели не ждут', async () => {
    delete process.env.KX_OLLAMA_URL; delete process.env.KX_LOCAL_MODEL;
    expect(L.localConf()).toBeNull();
    L.startLocalModel();
    const { listProviders } = await import('@/lib/providers');
    expect(listProviders()).toHaveLength(0);
    expect(L.localReady()).toBe(true);
    expect(L.localBanner('en')).toBeNull();
  });

  it('провайдер и модель в админке появляются один раз; удалённые администратором не возвращаются', async () => {
    process.env.KX_OLLAMA_URL = base + '/v1'; process.env.KX_LOCAL_MODEL = 'tiny:1b';
    const c = L.localConf()!;
    expect(c.url).toBe(base);
    L.ensureLocalEntries(c);
    const P = await import('@/lib/providers');
    const { getModel } = await import('@/lib/models');
    expect(P.listProviders()).toMatchObject([{ name: 'Local (Ollama)', kind: 'ollama', baseUrl: base + '/v1', hasKey: false, models: 1 }]);
    expect(getModel(L.LOCAL_ID)).toMatchObject({ upstreamModel: 'tiny:1b', name: 'Tiny 1B', tools: true, contextTokens: 8192 });
    P.deleteProvider(P.listProviders()[0].id);
    L.ensureLocalEntries(c);
    expect(P.listProviders()).toHaveLength(0);
  });

  it('скачивание: ход по слоям в баннере, потом готово; уже скачанная — сразу готово', async () => {
    process.env.KX_OLLAMA_URL = base; process.env.KX_LOCAL_MODEL = 'tiny:1b';
    const c = L.localConf()!;
    expect(L.localReady()).toBe(false);
    const seen: string[] = [];
    const spy: typeof fetch = async (u, init) => {
      const r = await fetch(u, init);
      if (String(u).endsWith('/api/pull')) {
        const reader = r.body!.getReader();
        const body = new ReadableStream<Uint8Array>({ async pull(ctl) {
          const x = await reader.read();
          if (x.done) { ctl.close(); return; }
          ctl.enqueue(x.value);
          const b = L.localBanner('en'); if (b) seen.push(b.text);
        } });
        return new Response(body, { status: r.status });
      }
      return r;
    };
    await L.pullOnce(c, spy);
    expect(L.localPull().state).toBe('ready');
    expect(L.localReady()).toBe(true);
    expect(L.localBanner('en')).toBeNull();
    expect(seen.join('\n')).toMatch(/Downloading the built-in model Tiny 1B: \d+%/);
    L._resetLocalForTests();
    await L.pullOnce(c);
    expect(L.localPull().state).toBe('ready');
  });

  it('ошибка скачивания: баннер-предупреждение только после нескольких неудач подряд', async () => {
    process.env.KX_OLLAMA_URL = base; process.env.KX_LOCAL_MODEL = 'tiny:1b';
    failPull = true;
    L.startLocalModel();
    await new Promise((r) => setTimeout(r, 200));
    expect(L.localPull()).toMatchObject({ state: 'error', fails: 1 });
    expect(L.localBanner('en')).toBeNull();
    await L.attempt(L.localConf()!);
    expect(L.localBanner('en')).toBeNull();
    await L.attempt(L.localConf()!);
    expect(L.localBanner('en')).toMatchObject({ id: 'local', level: 'warn', text: expect.stringContaining('Could not download the built-in model Tiny 1B: pull model manifest') });
    failPull = false;
    expect(await L.attempt(L.localConf()!)).toBe(true);
    expect(L.localBanner('en')).toBeNull();
  });
});
