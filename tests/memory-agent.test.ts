import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
// @ts-expect-error — .mjs без типов
import { toolPlan, streamPlan } from './e2e/mock_tools.mjs';

const dir = tmpData();
process.env.KX_AGENT_TOOLS = '1';
type Req = { agent: boolean; tools: string[]; messages: { role: string; content: unknown }[] };
const reqs: Req[] = [];
let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      reqs.push({ agent: req.headers['x-korvex-agent'] === '1', tools: (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name), messages: body.messages });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (body.tools?.length) { await streamPlan(res, body.model, toolPlan(body), 2, () => false); return; }
      await streamPlan(res, body.model, { reasoning: '', content: 'Обычный ответ.', calls: [] }, 2, () => false);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'ua', email: 'ua@t', name: 'ua', passwordHash: 'x', role: 'user', createdAt: Date.now() }).run();
  J = await import('@/lib/jobs');
  await import('@/lib/agentLoop');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

function mkThread(temporary = 0) {
  const id = randomUUID();
  db.insert(schema.threads).values({ id, userId: 'ua', title: 'Память', modelId: 'alpha', effort: 'off', temporary, createdAt: Date.now(), updatedAt: Date.now() }).run();
  return db.select().from(schema.threads).all().find((t) => t.id === id)!;
}
const msg = (id: string) => db.select().from(schema.messages).all().find((m) => m.id === id)!;
const stepsOf = (mid: string) => ((msg(mid).meta as { steps?: { kind: string; tool?: string; status: string; title: string; detail?: string }[] }).steps ?? []);
async function turn(th: ReturnType<typeof mkThread>, text: string) {
  const fresh = db.select().from(schema.threads).all().find((t) => t.id === th.id)!;
  const s = J.submitTurn({ thread: fresh, userId: 'ua', mode: 'send', text, modelId: 'alpha', levelId: 'low' });
  return { s, done: J.waitJob(s.jobId)! };
}

describe('инструменты памяти в цикле', () => {
  it('запомни -> memory_remember: шаг «Запоминает: …», запись есть; следующий ход — блок памяти в системном промпте', async () => {
    const th = mkThread();
    const { s, done } = await turn(th, 'запомни: сравнения присылай таблицей [tc:memory_remember {"text":"Сравнения — таблицей","section":"style"}]');
    expect((await done).status).toBe('done');
    const st = stepsOf(s.assistantMessageId);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'memory', tool: 'memory_remember', status: 'ok' });
    expect(st[0].title).toMatch(/^Запоминает: Сравнения — таблицей/);
    const M = await import('@/lib/memory');
    expect(M.listMemory('ua').map((r) => [r.text, r.origin, r.threadId])).toEqual([['Сравнения — таблицей', 'asked', th.id]]);
    const n0 = reqs.length;
    await (await turn(th, 'что ты обо мне помнишь? [tc:memory_list {}]')).done;
    const first = reqs[n0];
    expect(first.agent).toBe(true);
    expect(first.tools).toEqual(expect.arrayContaining(['memory_list', 'memory_remember', 'memory_forget']));
    expect(String(first.messages[0].content)).toContain('Память о пользователе');
    expect(String(first.messages[0].content)).toContain('Сравнения — таблицей');
    const tool = reqs[n0 + 1].messages.find((m) => m.role === 'tool')!;
    expect(String(tool.content)).toContain('Сравнения — таблицей');
  });
  it('забудь -> memory_forget без подтверждения; без «забудь» в сообщении — ждёт «Разрешить»', async () => {
    const th = mkThread();
    const M = await import('@/lib/memory');
    const { s, done } = await turn(th, 'забудь про таблицы [tc:memory_forget {"about":"таблицей"}]');
    await done;
    expect(stepsOf(s.assistantMessageId)[0]).toMatchObject({ tool: 'memory_forget', status: 'ok' });
    expect(M.listMemory('ua')).toHaveLength(0);
    M.addMemory('ua', { section: 'who', key: 'name', text: 'Зовут Иван', origin: 'manual' });
    const t1 = await turn(th, 'ну и ладно [tc:memory_forget {"about":"имя"}]');
    await t1.done;
    expect(stepsOf(t1.s.assistantMessageId)[0]).toMatchObject({ tool: 'memory_forget', status: 'denied' });
    expect(M.listMemory('ua')).toHaveLength(1);
    const t2 = await turn(mkThread(), 'ну и ладно [tc:memory_forget {"about":"имя"}]');
    const t0 = Date.now();
    while (!stepsOf(t2.s.assistantMessageId).some((x) => x.status === 'wait_user') && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    expect(stepsOf(t2.s.assistantMessageId)[0]?.status).toBe('wait_user');
    J.cancelJob(t2.s.jobId, 'ua');
    await t2.done;
    expect(M.listMemory('ua')).toHaveLength(1);
  });
  it('временный чат и выключенная память: инструментов памяти нет, блока нет', async () => {
    const M = await import('@/lib/memory');
    const n0 = reqs.length;
    await (await turn(mkThread(1), 'привет [tc:chat_list {}]')).done;
    expect(reqs[n0].tools).not.toContain('memory_remember');
    expect(String(reqs[n0].messages[0].content)).not.toContain('Зовут Иван');
    M.setPrefs('ua', { on: false });
    const n1 = reqs.length;
    await (await turn(mkThread(), 'привет [tc:chat_list {}]')).done;
    expect(reqs[n1].tools).not.toContain('memory_list');
    expect(String(reqs[n1].messages[0].content)).not.toContain('Зовут Иван');
    M.setPrefs('ua', { on: true });
  });
});
