import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
// @ts-expect-error — .mjs без типов
import { toolPlan, streamPlan } from './e2e/mock_tools.mjs';
process.env.KX_CODE_GONE = '0';

const dir = tmpData();
delete process.env.KX_AGENT_TOOLS;
const reqs: { agent: boolean; tools: string[] }[] = [];
let srv: http.Server;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      reqs.push({ agent: req.headers['x-korvex-agent'] === '1', tools: (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      await streamPlan(res, body.model, body.tools?.length ? toolPlan(body) : { reasoning: '', content: 'обычный ответ', calls: [] }, 2, () => false);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

describe('цикл инструментов только в чатах с репозиторием (KX_AGENT_TOOLS выключен)', () => {
  it('чат с code_session — агентный путь и code_*; обычный чат — без инструментов', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const db = getDb();
    const now = Date.now();
    db.insert(schema.users).values({ id: 'u1', email: 'u1@t', name: 'u1', passwordHash: 'x', role: 'alpha', createdAt: now }).run();
    const code = randomUUID(), plain = randomUUID();
    db.insert(schema.threads).values([{ id: code, userId: 'u1', title: 'код', modelId: 'alpha', effort: 'off', createdAt: now, updatedAt: now }, { id: plain, userId: 'u1', title: 'чат', modelId: 'alpha', effort: 'off', createdAt: now, updatedAt: now }]).run();
    db.insert(schema.codeSessions).values({ threadId: code, userId: 'u1', repo: 'a/b', baseBranch: 'main', status: 'error', error: 'тест', origin: 'code', createdAt: now, updatedAt: now }).run();
    const J = await import('@/lib/jobs');
    const go = async (threadId: string, text: string) => {
      const t = db.select().from(schema.threads).all().find((x) => x.id === threadId)!;
      const s = J.submitTurn({ thread: t, userId: 'u1', mode: 'send', text, modelId: 'alpha', levelId: 'off' });
      await J.waitJob(s.jobId);
      return db.select().from(schema.messages).all().find((m) => m.id === s.assistantMessageId)!;
    };
    const a = await go(code, 'статус [tc:code_status {}]');
    expect(reqs[0].agent).toBe(true);
    expect(reqs[0].tools).toContain('code_status');
    expect(reqs[0].tools).toContain('code_edit');
    expect(a.content).toContain('Готово:');
    expect(a.content).toContain('Ошибка: тест');
    const n = reqs.length;
    const b = await go(plain, 'привет');
    expect(reqs.slice(n).every((r) => !r.agent && !r.tools.length)).toBe(true);
    expect(b.content).toBe('обычный ответ');
  });
});
