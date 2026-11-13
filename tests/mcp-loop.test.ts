import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
// @ts-expect-error — .mjs без типов
import { toolPlan, streamPlan, textOf } from './e2e/mock_tools.mjs';

const dir = tmpData();
process.env.KX_AGENT_TOOLS = '1';
process.env.KX_TOOLS_PATH = 'chat';
process.env.KX_MAINT_FILE = '';

const modelReqs: { tools: string[]; messages: { role: string; content: unknown }[] }[] = [];
const mcpCalls: unknown[] = [];
let model: http.Server, mcp: http.Server, mcpUrl = '';
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;

beforeAll(async () => {
  model = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      modelReqs.push({ tools: (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name), messages: body.messages });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (body.tools?.length) { await streamPlan(res, body.model, toolPlan(body), 2, () => false); return; }
      const q = textOf([...body.messages].reverse().find((m: { role: string }) => m.role === 'user')?.content);
      await streamPlan(res, body.model, { content: `Без инструментов: ${q.slice(0, 40)}`, calls: [] }, 2, () => false);
    });
  });
  mcp = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
      const msg = JSON.parse(b) as { id?: number; method: string; params?: { name?: string; arguments?: { text?: string } } };
      const ok = (result: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') return ok({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'echoes' } });
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (msg.method === 'tools/list') return ok({ tools: [{ name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
      if (msg.method === 'tools/call') { mcpCalls.push(msg.params); return ok({ content: [{ type: 'text', text: `echo: ${msg.params?.arguments?.text}` }] }); }
      res.writeHead(400); res.end();
    });
  });
  await Promise.all([new Promise<void>((r) => model.listen(0, '127.0.0.1', r)), new Promise<void>((r) => mcp.listen(0, '127.0.0.1', r))]);
  mcpUrl = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
  const base = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'adm', email: 'adm@t', name: 'A', passwordHash: 'x', role: 'admin', createdAt: 1 }).run();
  db.insert(schema.threads).values({ id: 't1', userId: 'adm', title: 'T', modelId: 'alpha', effort: 'off', createdAt: 1, updatedAt: 1 }).run();
});
afterAll(() => Promise.all([new Promise<void>((r) => model.close(() => r())), new Promise<void>((r) => mcp.close(() => r()))]));

describe('инструмент MCP в ходе', () => {
  it('модель видит инструмент сервера, вызывает его, ответ сервера доходит до модели; шаг в ленте ответа', async () => {
    const Sv = await import('@/lib/mcp/servers');
    const s = Sv.saveMcpServer({ name: 'Echoes', url: mcpUrl }, 'adm');
    expect((await Sv.checkMcpServer(s.id, 'adm')).tools.map((t) => t.name)).toEqual(['echo']);
    const J = await import('@/lib/jobs');
    const { eq } = await import('drizzle-orm');
    const thread = db.select().from(schema.threads).where(eq(schema.threads.id, 't1')).get()!;
    const sub = J.submitTurn({ thread, userId: 'adm', mode: 'send', text: 'Повтори [tc:mcp_echoes_echo {"text":"из цикла"}]', modelId: 'alpha', levelId: 'off' });
    const r = await J.waitJob(sub.jobId)!;
    expect(r.status).toBe('done');
    expect(modelReqs[0].tools).toContain('mcp_echoes_echo');
    expect(mcpCalls).toEqual([{ name: 'echo', arguments: { text: 'из цикла' } }]);
    const toolMsg = modelReqs.at(-1)!.messages.find((m) => m.role === 'tool');
    expect(textOf(toolMsg?.content)).toContain('echo: из цикла');
    expect(r.content).toContain('echo: из цикла');
    const m = db.select().from(schema.messages).where(eq(schema.messages.id, sub.assistantMessageId)).get()!;
    const steps = (m.meta as { steps?: { tool?: string; status: string; title: string }[] }).steps ?? [];
    expect(steps.find((x) => x.tool === 'mcp_echoes_echo')).toMatchObject({ status: 'ok', title: 'Echoes: echo' });
  });
});
