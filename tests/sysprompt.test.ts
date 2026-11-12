import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
const bodies: { model: string; messages: { role: string; content: unknown }[] }[] = [];
let srv: http.Server;
const sysFile = path.join(dir, 'solo_system_prompt.txt');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      bodies.push(JSON.parse(b));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ок' }, finish_reason: null }] });
      ch({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; if (m.id === 'beta') m.systemPromptFile = sysFile; }
  fs.writeFileSync(sysFile, 'Ты — Beta 0 4B. Правило 1.\n');
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb();
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  for (const [id, model] of [['ts', 'beta'], ['te', 'alpha']]) db.insert(schema.threads).values({ id, userId: 'u', title: 'T', modelId: model, effort: 'off', createdAt: 1, updatedAt: 1 }).run();
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

async function turn(threadId: string, modelId: string, text: string) {
  const { getDb, schema } = await import('@/lib/db');
  const { eq } = await import('drizzle-orm');
  const { runTurn } = await import('@/lib/jobs');
  const thread = getDb().select().from(schema.threads).where(eq(schema.threads.id, threadId)).get()!;
  bodies.length = 0;
  await runTurn({ thread, userId: 'u', mode: 'send', text, modelId, levelId: 'off' });
  return bodies[0];
}

describe('системный промпт модели', () => {
  it('Beta: первым сообщением role=system с текстом файла', async () => {
    const b = await turn('ts', 'beta', 'Привет');
    expect(b.messages[0].role).toBe('system');
    expect(String(b.messages[0].content).startsWith('Ты — Beta 0 4B. Правило 1.\n\n## Правила Korvex')).toBe(true);
    expect(b.messages.at(-1)).toMatchObject({ role: 'user' });
  });
  it('правка файла действует со следующего хода, без перезапуска; system один, в начале', async () => {
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(sysFile, 'Ты — Beta 0 4B. Правило 2.\n');
    const t = new Date(Date.now() + 2000); fs.utimesSync(sysFile, t, t);
    const b = await turn('ts', 'beta', 'Ещё');
    expect(b.messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(String(b.messages[0].content).split('\n\n')[0]).toBe('Ты — Beta 0 4B. Правило 2.');
  });
});
