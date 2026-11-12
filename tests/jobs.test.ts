import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
const active: Record<string, number> = {}, peak: Record<string, number> = {};
const seen: { model: string; q: string; aborted: boolean }[] = [];
let srv: http.Server;
const tag = (s: string, k: string, d: number) => { const m = new RegExp(`\\[${k}:(\\d+)\\]`).exec(s); return m ? Number(m[1]) : d; };

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs'), B: typeof import('@/lib/bus');
let eq: typeof import('drizzle-orm').eq;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b) as { model: string; messages: { role: string; content: unknown }[] };
      const last = [...body.messages].reverse().find((m) => m.role === 'user');
      const q = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
      const rec = { model: body.model, q, aborted: false };
      seen.push(rec);
      active[body.model] = (active[body.model] ?? 0) + 1;
      peak[body.model] = Math.max(peak[body.model] ?? 0, active[body.model]);
      let closed = false;
      res.on('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      const n = tag(q, 'chunks', 6), delay = tag(q, 'delay', 15), think = tag(q, 'think', 2);
      ch({ role: 'assistant', content: '' });
      for (let i = 0; i < think && !closed; i++) { ch({ reasoning_content: `р${i}.` }); await new Promise((r) => setTimeout(r, delay)); }
      for (let i = 0; i < n && !closed; i++) { ch({ content: `ч${i}.` }); await new Promise((r) => setTimeout(r, delay)); }
      if (!closed) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: n, total_tokens: 10 + n, memory: { total_tokens: 5, limit_tokens: 100, remaining_tokens: 95 } } })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else rec.aborted = true;
      active[body.model]--;
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; if (m.id === 'alpha') m.maxConcurrent = 2; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  for (let i = 0; i < 30; i++) db.insert(schema.threads).values({ id: `t${i}`, userId: 'u', title: 'T', modelId: 'beta', effort: 'off', createdAt: 1, updatedAt: 1 }).run();
  J = await import('@/lib/jobs');
  B = await import('@/lib/bus');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const msg = (id: string) => db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
const job = (id: string) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
const submit = (t: string, text: string, modelId = 'beta', levelId = 'off') => J.submitTurn({ thread: thread(t), userId: 'u', mode: 'send', text, modelId, levelId });
function apply(events: { t: string; m?: unknown; k?: string; o?: number; d?: string }[], mid: string) {
  let c = '', gap = false;
  for (const e of events) {
    if (e.t !== 'd' || e.m !== mid || e.k !== 'c') continue;
    if (e.o! > c.length) { gap = true; continue; }
    if (e.o! + e.d!.length > c.length) c += e.d!.slice(c.length - e.o!);
  }
  return { c, gap };
}

describe('исполнитель задач', () => {

  it('частичный ответ пишется в БД во время генерации (пачками ~300 мс)', async () => {
    const s = submit('t1', 'Долго [chunks:40] [delay:25] [think:0]');
    await new Promise((r) => setTimeout(r, 700));
    const mid = msg(s.assistantMessageId).content;
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan('ч0.'.length * 40);
    await J.waitJob(s.jobId);
  });

  it('второй клиент видит дельты в реальном времени, склейка = итоговый ответ', async () => {
    const got: { t: string; at: number; [k: string]: unknown }[] = [];
    const sub = B.subscribe('u', null, (e) => got.push({ ...e, at: Date.now() } as never));
    const s = submit('t2', 'Смотри [chunks:12] [delay:20]');
    await J.waitJob(s.jobId);
    sub.unsubscribe();
    const doneAt = got.find((e) => e.t === 'job' && e.status === 'done')!.at;
    const ds = got.filter((e) => e.t === 'd' && e.m === s.assistantMessageId);
    expect(ds.length).toBeGreaterThan(2);
    expect(ds[0].at).toBeLessThan(doneAt - 100);
    expect(got.map((e) => e.t)).toContain('msg');
    expect(got.filter((e) => e.t === 'job').map((e) => e.status)).toEqual(expect.arrayContaining(['queued', 'running', 'done']));
    const { c, gap } = apply(got as never, s.assistantMessageId);
    expect(gap).toBe(false);
    expect(c).toBe(msg(s.assistantMessageId).content);
  });

  it('переподключение с позиции: дочитывает пропущенное без потерь и дублей; чужая/старая позиция -> sync', async () => {
    const first: { id: number; t: string }[] = [];
    let lastId = 0;
    const a = B.subscribe('u', null, (e) => { first.push(e); lastId = e.id; if (first.filter((x) => x.t === 'd').length >= 3) a.unsubscribe(); });
    const s = submit('t3', 'Связь рвётся [chunks:16] [delay:20]');
    await new Promise((r) => setTimeout(r, 250));
    const second: { id: number; t: string }[] = [];
    const b = B.subscribe('u', lastId, (e) => second.push(e));
    expect(b.replay).not.toBeNull();
    await J.waitJob(s.jobId);
    b.unsubscribe();
    const all = [...first, ...b.replay!, ...second];
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    const { c, gap } = apply(all as never, s.assistantMessageId);
    expect(gap).toBe(false);
    expect(c).toBe(msg(s.assistantMessageId).content);
    expect(B.parseSince(`otherboot.${lastId}`)).toBeNull();
    expect(B.subscribe('u', -5, () => {}).replay).toBeNull();
  });

  it('cancel: идущая задача обрывается (частичный ответ «остановлено»), в очереди — снимается без запроса к шлюзу', async () => {
    const run1 = submit('t4', 'Длинный [chunks:200] [delay:20] [think:0]');
    const q1 = submit('t5', 'В очереди за ним [chunks:3]');
    await new Promise((r) => setTimeout(r, 300));
    expect(J.liveOfMessage(q1.assistantMessageId)?.status).toBe('queued');
    expect(J.cancelJob(q1.jobId, 'other')).toBe(false);
    expect(J.cancelJob(q1.jobId, 'u')).toBe(true);
    expect(job(q1.jobId).status).toBe('cancelled');
    expect(db.select().from(schema.messages).where(eq(schema.messages.id, q1.assistantMessageId)).get()).toBeUndefined();
    expect(thread('t5').leafId).toBe(q1.userMessageId);
    expect(J.cancelJob(run1.jobId, 'u')).toBe(true);
    const r = await J.waitJob(run1.jobId)!;
    expect(r.status).toBe('cancelled');
    const m = msg(run1.assistantMessageId);
    expect(m.content.length).toBeGreaterThan(0);
    expect(m.meta).toMatchObject({ stopped: true, status: 'cancelled' });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.find((x) => x.q.includes('Длинный'))?.aborted).toBe(true);
    expect(seen.some((x) => x.q.includes('В очереди за ним'))).toBe(false);
  });

  it('очередь соблюдает лимиты: Beta не больше 1, Alpha не больше 2; позиции в очереди объявляются', async () => {
    for (const k of Object.keys(peak)) peak[k] = 0;
    const evs: { t: string; [k: string]: unknown }[] = [];
    const sub = B.subscribe('u', null, (e) => evs.push(e));
    const ids = [
      ...[6, 7, 8].map((i) => submit(`t${i}`, `beta ${i} [chunks:4] [delay:20]`).jobId),
      ...[9, 10, 11].map((i) => submit(`t${i}`, `alpha ${i} [chunks:4] [delay:20]`, 'alpha', 'low').jobId),
    ];
    const rs = await Promise.all(ids.map((id) => J.waitJob(id)!));
    sub.unsubscribe();
    expect(rs.every((r) => r.status === 'done')).toBe(true);
    expect(peak['up-beta-0-4b']).toBe(1);
    expect(peak['up-alpha-35b']).toBe(2);
    const aheads = evs.filter((e) => e.t === 'job' && e.status === 'queued' && e.job === ids[2]).map((e) => e.ahead);
    expect(aheads[0]).toBe(1);
    expect(aheads.at(-1)).toBe(0);
  });

  it('очередь: место и ожидание (eta) в событиях и живом снимке; среднее время хода обновляется только по done', async () => {
    J._test.ex().avg.clear();
    expect(J.queueStats('beta')).toMatchObject({ active: 0, queued: 0, limit: 1, avg: 30, etaNext: 0 });
    const evs: { t: string; [k: string]: unknown }[] = [];
    const sub = B.subscribe('u', null, (e) => evs.push(e));
    const s = [22, 23, 24].map((i) => submit(`t${i}`, `eta ${i} [chunks:4] [delay:20]`));
    expect(J.queueStats('beta')).toMatchObject({ active: 1, queued: 2, limit: 1, avg: 30, etaNext: 90 });
    expect(J.liveOfMessage(s[1].assistantMessageId)).toMatchObject({ status: 'queued', ahead: 0, position: 1, eta: 30 });
    expect(J.liveOfMessage(s[2].assistantMessageId)).toMatchObject({ status: 'queued', ahead: 1, position: 2, eta: 60 });
    expect(J.liveOfMessage(s[0].assistantMessageId)).toMatchObject({ status: 'running', ahead: 0, position: 0, eta: 0 });
    await Promise.all(s.map((x) => J.waitJob(x.jobId)!));
    sub.unsubscribe();
    const q3 = evs.filter((e) => e.t === 'job' && e.status === 'queued' && e.job === s[2].jobId);
    expect(q3[0]).toMatchObject({ ahead: 1, position: 2, eta: 60 });
    expect(q3.at(-1)).toMatchObject({ ahead: 0, position: 1, eta: 24 });
    expect(J.queueStats('beta').avg).toBeCloseTo(15.5, 0);
    expect(J.queueStats('beta')).toMatchObject({ active: 0, queued: 0, etaNext: 0 });
    const before = J.queueStats('beta').avg;
    const c = submit('t25', 'отменю [chunks:200] [delay:20] [think:0]');
    await new Promise((r) => setTimeout(r, 80));
    J.cancelJob(c.jobId, 'u');
    await J.waitJob(c.jobId);
    expect(J.queueStats('beta').avg).toBe(before);
    const got: unknown[] = [];
    const r1 = submit('t26', 'первый [chunks:6] [delay:20]'), r2 = submit('t27', 'второй [chunks:2]'), r3 = submit('t28', 'третий [chunks:2]');
    const off = J.jobListen(r3.jobId, (e) => got.push(e))!;
    await Promise.all([r1, r2, r3].map((x) => J.waitJob(x.jobId)));
    off();
    expect(got.find((e) => (e as { t: string; status?: string }).t === 'state' && (e as { status?: string }).status === 'queued')).toMatchObject({ ahead: 0, position: 1 });
  });

  it('в чате уже идёт ответ -> 409; больше 6 задач у пользователя -> 429', async () => {
    const s = submit('t12', 'раз [chunks:30] [delay:20]');
    expect(() => submit('t12', 'два')).toThrow(/уже идёт ответ/);
    const more = [13, 14, 15, 16, 17].map((i) => submit(`t${i}`, `q${i} [chunks:2]`));
    expect(() => submit('t18', 'седьмая')).toThrow(/Слишком много/);
    for (const x of [s, ...more]) J.cancelJob(x.jobId, 'u');
    await Promise.all([s, ...more].map((x) => J.waitJob(x.jobId) ?? Promise.resolve(null)));
  });

  it('перезапуск: «в работе» -> ошибка «прервано» с частичным ответом, «в очереди» -> выполняется', async () => {
    const now = Date.now();
    db.insert(schema.messages).values({ id: 'mu1', threadId: 't20', seq: 1, parentId: null, session: 't20', role: 'user', content: 'вопрос [chunks:2]', createdAt: now }).run();
    db.insert(schema.messages).values({ id: 'ma1', threadId: 't20', seq: 2, parentId: 'mu1', session: null, role: 'assistant', content: 'половина отв', meta: { status: 'running', jobId: 'jr' }, createdAt: now }).run();
    db.insert(schema.jobs).values({ id: 'jr', userId: 'u', threadId: 't20', kind: 'chat', mode: 'send', messageId: 'ma1', modelId: 'beta', levelId: 'off', status: 'running', createdAt: now }).run();
    db.insert(schema.messages).values({ id: 'mu2', threadId: 't21', seq: 1, parentId: null, session: 't21', role: 'user', content: 'ждал в очереди [chunks:3]', createdAt: now }).run();
    db.insert(schema.messages).values({ id: 'ma2', threadId: 't21', seq: 2, parentId: 'mu2', session: null, role: 'assistant', content: '', meta: { status: 'queued', jobId: 'jq' }, createdAt: now }).run();
    db.insert(schema.jobs).values({ id: 'jq', userId: 'u', threadId: 't21', kind: 'chat', mode: 'send', messageId: 'ma2', modelId: 'beta', levelId: 'off', status: 'queued', createdAt: now }).run();
    (globalThis as { __kxExec?: unknown }).__kxExec = undefined;
    J.boot();
    expect(job('jr')).toMatchObject({ status: 'error', error: 'Прервано перезапуском сервера' });
    expect(msg('ma1')).toMatchObject({ content: 'половина отв' });
    expect(msg('ma1').meta).toMatchObject({ status: 'error', error: 'Прервано перезапуском сервера' });
    const r = await J.waitJob('jq')!;
    expect(r.status).toBe('done');
    expect(msg('ma2').content).toBe('ч0.ч1.ч2.');
  });
});
