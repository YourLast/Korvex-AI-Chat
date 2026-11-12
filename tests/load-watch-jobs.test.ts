import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs');
let eq: typeof import('drizzle-orm').eq;
const submit = (t: string, userId = 'u') => J.submitTurn({ thread: db.select().from(schema.threads).where(eq(schema.threads.id, t)).get()!, userId, mode: 'send', text: 'нагрузка [chunks:20] [delay:30]', modelId: 'alpha', levelId: 'low' });

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      let closed = false;
      res.on('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      ch({ role: 'assistant', content: '' });
      for (let i = 0; i < 20 && !closed; i++) { ch({ content: `ч${i}.` }); await new Promise((r) => setTimeout(r, 30)); }
      if (!closed) { res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`); res.end('data: [DONE]\n\n'); }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; if (m.id === 'alpha') m.maxConcurrent = 2; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  process.env.KX_PROBE = '0';
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values([
    { id: 'u', email: 'u@t', name: 'Анна', passwordHash: 'x', role: 'user', createdAt: 1 },
    { id: 'w', email: 'w@t', name: 'Борис', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  for (let i = 0; i < 6; i++) db.insert(schema.threads).values({ id: `t${i}`, userId: i < 3 ? 'u' : 'w', title: 'T', modelId: 'alpha', effort: 'low', createdAt: 1, updatedAt: 1 }).run();
  J = await import('@/lib/jobs');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

describe('замеры для оповещений о нагрузке', () => {
  it('ждущие места: кто и сколько; идущие не считаются; приходы за минуту — по очередям', async () => {
    expect(J.waitingJobs(['alpha'])).toEqual([]);
    expect(J.arrivalsIn(['alpha'])).toBe(0);
    const s = [submit('t0'), submit('t1'), submit('t3', 'w'), submit('t4', 'w')];
    const now = Date.now();
    const w = J.waitingJobs(['alpha'], now + 20_000);
    expect(w.map((x) => [x.userId, x.kind])).toEqual([['w', 'chat'], ['w', 'chat']]);
    expect(w.every((x) => x.sinceMs >= 19_900 && x.sinceMs < 22_000)).toBe(true);
    expect(J.waitingJobs(['beta-mac'])).toEqual([]);
    expect(J.arrivalsIn(['alpha'])).toBe(4);
    expect(J.arrivalsIn(['beta-mac'])).toBe(0);
    expect(J.arrivalsIn(['alpha'], 60_000, now + 61_000)).toBe(0);
    expect(J.queuesStats().find((q) => q.key === 'alpha')).toMatchObject({ active: 2, queued: 2, limit: 2 });
    await Promise.all(s.map((x) => J.waitJob(x.jobId)!));
    expect(J.waitingJobs(['alpha'])).toEqual([]);
  });
});
