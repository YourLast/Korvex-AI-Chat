import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpData } from './helpers';

let cur: { id: string } | null = { id: 'adm' };
vi.mock('@/lib/adminAuth', async () => {
  const m = await import('@/lib/api');
  return { adminOrKey: async () => { if (!cur) return { res: m.fail(401, 'no') }; const { getDb, schema } = await import('@/lib/db'); const u = getDb().select().from(schema.users).all().find((x) => x.id === cur!.id)!; return u.role === 'admin' ? { user: u, viaKey: false } : { res: m.fail(403, 'Только для администратора') }; } };
});

type Fake = { url: string; close: () => Promise<void>; calls: { name: string; arguments: Record<string, unknown> }[]; expire: () => void; inits: () => number; set: (o: Partial<Opts>) => void };
type Opts = { sse: boolean; version: string; auth: string | null };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function fakeMcp(): Promise<Fake> {
  const o: Opts = { sse: false, version: '2025-06-18', auth: null };
  const sessions = new Set<string>();
  const calls: Fake['calls'] = [];
  let inits = 0;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (o.auth && req.headers.authorization !== o.auth) { res.writeHead(401); res.end('unauthorized'); return; }
      if (req.method === 'DELETE') { sessions.delete(String(req.headers['mcp-session-id'])); res.writeHead(200); res.end(); return; }
      const msg = JSON.parse(b) as { id?: number; method: string; params?: { cursor?: string; name?: string; arguments?: Record<string, unknown> } };
      const reply = (result: unknown, error?: { code: number; message: string }) => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) });
        if (!o.sse) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
        res.end(`event: message\ndata: ${body}\n\n`);
      };
      if (msg.method === 'initialize') {
        inits++;
        const sid = `s${inits}`;
        sessions.add(sid);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': sid });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: o.version, capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1.2' } } }));
        return;
      }
      if (!sessions.has(String(req.headers['mcp-session-id'] ?? ''))) { res.writeHead(404); res.end(); return; }
      if (req.headers['mcp-protocol-version'] !== o.version) { res.writeHead(400); res.end('no protocol version header'); return; }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (msg.method === 'tools/list') {
        if (!msg.params?.cursor) reply({ tools: [
          { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
          { name: 'make-shot', title: 'Screenshot', inputSchema: { type: 'object', properties: {} } },
        ], nextCursor: 'p2' });
        else reply({ tools: [{ name: 'delete_all', description: 'Deletes everything', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } }, { name: 'boom' }] });
        return;
      }
      if (msg.method === 'tools/call') {
        const p = msg.params!;
        calls.push({ name: p.name!, arguments: p.arguments ?? {} });
        if (p.name === 'echo') reply({ content: [{ type: 'text', text: `echo: ${String(p.arguments?.text)}` }] });
        else if (p.name === 'make-shot') reply({ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }, { type: 'resource_link', uri: 'https://ex.com/shot', name: 'shot' }] });
        else if (p.name === 'delete_all') reply({ content: [{ type: 'text', text: 'nope' }], isError: true });
        else reply(null, { code: -32601, message: 'Tool failed hard' });
        return;
      }
      reply(null, { code: -32601, message: 'Method not found' });
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`, calls, expire: () => sessions.clear(), inits: () => inits,
    set: (x) => Object.assign(o, x), close: () => new Promise<void>((r) => srv.close(() => r())),
  })));
}

let fake: Fake;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let C: typeof import('@/lib/mcp/client'), Sv: typeof import('@/lib/mcp/servers'), R: typeof import('@/lib/tools/registry'), T: typeof import('@/lib/tools/mcp');

beforeAll(async () => {
  tmpData();
  fake = await fakeMcp();
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([
    { id: 'adm', email: 'adm@t', name: 'A', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1, lang: 'en' },
  ]).run();
  db.insert(schema.threads).values([{ id: 'ta', userId: 'adm', title: 'T', modelId: 'local', effort: 'off', createdAt: 1, updatedAt: 1 }, { id: 'tu', userId: 'u', title: 'T', modelId: 'local', effort: 'off', createdAt: 1, updatedAt: 1 }]).run();
  C = await import('@/lib/mcp/client');
  Sv = await import('@/lib/mcp/servers');
  R = await import('@/lib/tools/registry');
  T = await import('@/lib/tools/mcp');
});
afterAll(async () => { await fake.close(); });
beforeEach(() => { fake.set({ sse: false, version: '2025-06-18', auth: null }); cur = { id: 'adm' }; });

describe('клиент MCP (Streamable HTTP)', () => {
  it('initialize, сессия и версия в заголовках, список по страницам, вызов — JSON и SSE', async () => {
    for (const sse of [false, true]) {
      fake.set({ sse });
      const c = new C.McpClient({ url: fake.url });
      expect(await c.init()).toEqual({ protocol: '2025-06-18', name: 'fake-mcp', version: '1.2' });
      expect((await c.listTools()).map((t) => t.name)).toEqual(['echo', 'make-shot', 'delete_all', 'boom']);
      expect(await c.callTool('echo', { text: 'привет' })).toEqual({ content: [{ type: 'text', text: 'echo: привет' }] });
      expect(await c.callTool('delete_all', {})).toMatchObject({ isError: true });
      await expect(c.callTool('boom', {})).rejects.toThrow('Tool failed hard');
      await c.close();
    }
  });
  it('сессия истекла (404) — новое initialize и повтор; неверный адрес — ошибка без повторов', async () => {
    const c = new C.McpClient({ url: fake.url });
    await c.init();
    const before = fake.inits();
    fake.expire();
    expect(await c.callTool('echo', { text: 'снова' })).toEqual({ content: [{ type: 'text', text: 'echo: снова' }] });
    expect(fake.inits()).toBe(before + 1);
    fake.set({ auth: 'Bearer good' });
    await expect(new C.McpClient({ url: fake.url }).init()).rejects.toThrow(/HTTP 401/);
    expect((await new C.McpClient({ url: fake.url, headers: { Authorization: 'Bearer good' } }).listTools()).length).toBe(4);
    fake.set({ version: '2024-11-05' });
    await expect(new C.McpClient({ url: fake.url, headers: { Authorization: 'Bearer good' } }).init()).rejects.toThrow(/unsupported MCP protocol version 2024-11-05/);
    expect(C.validMcpUrl('https://x/mcp')).toBe(true);
    for (const u of ['ftp://x', 'https://user:pw@x/mcp', 'not a url', 'file:///etc/passwd']) expect(C.validMcpUrl(u)).toBe(false);
  });
});

describe('серверы и инструменты в ходе', () => {
  let id = '';
  const ctxOf = (userId: string, threadId: string) => ({ userId, threadId, folderId: null, kind: 'chat' as const, modelId: 'local', depth: 0 });
  const mcpTools = (userId: string, threadId: string) => R.toolsFor(ctxOf(userId, threadId)).filter((t) => t.name.startsWith('mcp_'));

  it('ключ хранится зашифрованным; проверка сохраняет снимок инструментов; другой адрес — снимок сбрасывается', async () => {
    fake.set({ auth: 'Bearer s3cret' });
    const s = Sv.saveMcpServer({ name: 'Fake Tools', url: fake.url, headerName: 'Authorization', headerValue: 'Bearer s3cret' }, 'adm');
    id = s.id;
    expect(s.slug).toBe('faketools');
    expect(JSON.stringify(db.select().from(schema.settings).all())).not.toContain('s3cret');
    expect(Sv.viewOf(s).header).toEqual({ name: 'Authorization', set: true });
    const checked = await Sv.checkMcpServer(id, 'adm');
    expect(checked).toMatchObject({ error: null, info: { name: 'fake-mcp' } });
    expect(checked.tools.map((t) => t.name)).toEqual(['echo', 'make-shot', 'delete_all', 'boom']);
    const twin = Sv.saveMcpServer({ name: 'Fake Tools', url: 'https://example.com/mcp' }, 'adm');
    expect(twin.slug).toBe('faketools2');
    expect(Sv.saveMcpServer({ id: twin.id, url: 'https://example.org/mcp' }, 'adm').tools).toEqual([]);
    expect(Sv.deleteMcpServer(twin.id, 'adm')).toBe(true);
    expect(() => Sv.saveMcpServer({ name: 'x', url: 'ftp://x' }, 'adm')).toThrow('url');
  });

  it('без правила — только администраторам; правило по роли открывает; выключенный инструмент и сервер не предлагаются', async () => {
    expect(mcpTools('adm', 'ta').map((t) => t.name)).toEqual(['mcp_faketools_boom', 'mcp_faketools_delete_all', 'mcp_faketools_echo', 'mcp_faketools_make_shot']);
    expect(mcpTools('u', 'tu')).toEqual([]);
    const { setRule } = await import('@/lib/access');
    setRule('mcp', id, { roles: ['user'], users: [], invites: [] }, 'adm');
    expect(mcpTools('u', 'tu').length).toBe(4);
    Sv.saveMcpServer({ id, off: ['boom'] }, 'adm');
    expect(mcpTools('u', 'tu').map((t) => t.name)).not.toContain('mcp_faketools_boom');
    Sv.saveMcpServer({ id, on: false }, 'adm');
    expect(mcpTools('u', 'tu')).toEqual([]);
    Sv.saveMcpServer({ id, on: true }, 'adm');
    expect(T.mcpToolName('faketools', 'x'.repeat(80))).toMatch(/^mcp_faketools_x{43}_[0-9a-f]{6}$/);
    expect(T.mcpToolName('faketools', 'x'.repeat(80)).length).toBe(64);
    const { taints } = await import('@/lib/tools/taint');
    expect(taints({ name: 'mcp_faketools_echo', kind: 'other' })).toBe(true);
  });

  it('вопрос перед вызовом: «кроме только чтения» / всегда / никогда; вызов, картинка, ошибка инструмента, сервер недоступен', async () => {
    const byName = () => Object.fromEntries(mcpTools('u', 'tu').map((t) => [t.name, t]));
    const attach = vi.fn(async (f: { name: string; mime: string }) => ({ kind: 'image' as const, fileId: 'f1', url: '/api/files/f1', name: f.name, mime: f.mime, size: 1 }));
    const ctx = { ...ctxOf('u', 'tu'), jobId: 'j', messageId: null, callId: 'c', signal: new AbortController().signal, emit: () => {}, confirm: async () => true, attach };
    let t = byName();
    expect(await t.mcp_faketools_echo.confirm!({ text: 'a' }, ctx)).toBeNull();
    expect(await t.mcp_faketools_delete_all.confirm!({}, ctx)).toMatch(/^Run “delete_all” on “Fake Tools”\?/);
    const ru = Object.fromEntries(mcpTools('adm', 'ta').map((x) => [x.name, x]));
    expect(await ru.mcp_faketools_delete_all.confirm!({}, { ...ctx, userId: 'adm', threadId: 'ta' })).toBe('Запустить «delete_all» на сервере «Fake Tools»?');
    Sv.saveMcpServer({ id, ask: 'always' }, 'adm');
    t = byName();
    expect(await t.mcp_faketools_echo.confirm!({ text: 'секрет' }, ctx)).toMatch(/text: секрет/);
    Sv.saveMcpServer({ id, ask: 'never' }, 'adm');
    t = byName();
    expect(await t.mcp_faketools_delete_all.confirm!({}, ctx)).toBeNull();
    expect(t.mcp_faketools_echo.title({ text: 'a' })).toBe('Fake Tools: echo');
    expect(t.mcp_faketools_make_shot.title({})).toBe('Fake Tools: Screenshot');

    expect(await t.mcp_faketools_echo.run({ text: 'из хода' }, ctx)).toEqual({ content: 'echo: из хода' });
    expect(fake.calls.at(-1)).toEqual({ name: 'echo', arguments: { text: 'из хода' } });
    const shot = await t.mcp_faketools_make_shot.run({}, ctx);
    expect(shot).toMatchObject({ content: '[image 1]\n\nshot: https://ex.com/shot', attachments: [{ fileId: 'f1', mime: 'image/png' }] });
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ name: 'faketools-1.png', mime: 'image/png' }));
    expect(await t.mcp_faketools_delete_all.run({}, ctx)).toEqual({ content: 'nope', error: true });
    Sv.saveMcpServer({ id, off: [] }, 'adm');
    t = byName();
    expect(await t.mcp_faketools_boom.run({}, ctx)).toEqual({ content: 'MCP server “Fake Tools” error: Tool failed hard', error: true });
    fake.set({ auth: 'Bearer other' });
    fake.expire();
    const down = await t.mcp_faketools_echo.run({ text: 'x' }, ctx);
    expect(down.error).toBe(true);
    expect(down.content).toMatch(/^MCP server “Fake Tools” error: HTTP 401/);
  });
});

describe('админка → MCP', () => {
  it('список без секрета, сохранение, проверка, удаление (и правило доступа); человеку без роли администратора — 403', async () => {
    fake.set({ auth: 'Bearer k2' });
    const list = await import('@/app/api/admin/mcp/route');
    const one = await import('@/app/api/admin/mcp/[id]/route');
    const check = await import('@/app/api/admin/mcp/[id]/check/route');
    const post = (body: unknown) => list.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
    expect(await (await post({ name: 'Bad', url: 'ftp://x' })).json()).toMatchObject({ error: 'Адрес — http(s)://… без логина и пароля' });
    const r = await (await post({ name: 'Second', url: fake.url, headerName: 'Authorization', headerValue: 'Bearer k2' })).json() as { id: string; servers: { id: string; header: unknown }[] };
    expect(JSON.stringify(r)).not.toContain('Bearer k2');
    expect(r.servers.find((s) => s.id === r.id)?.header).toEqual({ name: 'Authorization', set: true });
    const c = await (await check.POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: r.id }) })).json() as { ok: boolean; server: { tools: unknown[] } };
    expect(c.ok).toBe(true);
    expect(c.server.tools.length).toBe(4);
    const acc = await import('@/app/api/admin/access/route');
    const g = await (await acc.GET(new Request('http://x'))).json() as { mcp: { id: string; rule: unknown }[] };
    expect(g.mcp.find((s) => s.id === r.id)).toMatchObject({ rule: null });
    expect((await acc.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'mcp', id: r.id, rule: { roles: ['user'], users: [], invites: [] } }) }))).status).toBe(200);
    expect((await acc.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'mcp', id: 'nope', rule: null }) }))).status).toBe(400);
    expect((await one.DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: r.id }) })).status).toBe(200);
    const { ruleOf } = await import('@/lib/access');
    expect(ruleOf('mcp', r.id)).toBeNull();
    cur = { id: 'u' };
    expect((await list.GET(new Request('http://x'))).status).toBe(403);
    expect((await post({ name: 'X', url: fake.url })).status).toBe(403);
  });
});
