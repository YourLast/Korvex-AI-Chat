import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
import type { Message } from '@/lib/db/schema';

const dir = tmpData();
type Seen = { model: string; chat: string; msgs: { role: string; content: string }[]; q: string; effort?: string };
const seen: Seen[] = [];
const active: Record<string, number> = {};
let peakSolo = 0, peakAlpha = 0;
let srv: http.Server;
const tag = (s: string, k: string, d: number) => { const m = new RegExp(`\\[${k}:(\\d+)\\]`).exec(s); return m ? Number(m[1]) : d; };
const text = (c: unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join(' ') : '');

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs'), C: typeof import('@/lib/compare'), B: typeof import('@/lib/bus'), L: typeof import('@/lib/load'), N: typeof import('@/lib/notify');
let eq: typeof import('drizzle-orm').eq;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b) as { model: string; messages: { role: string; content: unknown }[]; reasoning_effort?: string };
      const msgs = body.messages.map((m) => ({ role: m.role, content: text(m.content) }));
      const q = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
      seen.push({ model: body.model, chat: String(req.headers['x-korvex-chat-id']), msgs, q, effort: body.reasoning_effort });
      active[body.model] = (active[body.model] ?? 0) + 1;
      const beta = (active['up-beta-0-4b'] ?? 0) + (active['up-beta-0-4b-plain'] ?? 0);
      peakSolo = Math.max(peakSolo, beta); peakAlpha = Math.max(peakAlpha, active['up-alpha-35b'] ?? 0);
      let closed = false;
      res.on('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      const n = tag(q, 'chunks', 3), delay = tag(q, 'delay', 10);
      ch({ role: 'assistant', content: '' });
      for (let i = 0; i < n && !closed; i++) { ch({ content: i === 0 ? `[${body.model}] ` : `ч${i}.` }); await new Promise((r) => setTimeout(r, delay)); }
      if (!closed) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: n, total_tokens: 10 + n, memory: { total_tokens: 5, limit_tokens: 100, remaining_tokens: 95 } } })}\n\n`);
        res.end('data: [DONE]\n\n');
      }
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
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'admin', createdAt: 1 }).run();
  for (let i = 0; i < 12; i++) db.insert(schema.threads).values({ id: `c${i}`, userId: 'u', title: 'T', modelId: 'alpha', effort: 'low', createdAt: 1, updatedAt: 1 }).run();
  J = await import('@/lib/jobs');
  C = await import('@/lib/compare');
  B = await import('@/lib/bus');
  L = await import('@/lib/load');
  N = await import('@/lib/notify');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const msg = (id: string) => db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
const EvS = { a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'beta', levelId: 'off' } };
const SvP = { a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'off' } };
async function ask(t: string, q: string, pair = EvS, mode: 'send' | 'edit' = 'send', editId?: string) {
  const s = J.submitPair({ thread: thread(t), userId: 'u', mode, text: q, editId, pair });
  await Promise.all(s.jobIds.map((id) => J.waitJob(id)));
  return s;
}
async function single(t: string, q: string, modelId = 'alpha', levelId = 'low') {
  const s = J.submitTurn({ thread: thread(t), userId: 'u', mode: 'send', text: q, modelId, levelId });
  await J.waitJob(s.jobId);
  return s;
}
const reqOf = (q: string, model?: string) => seen.filter((x) => x.q.includes(q) && (!model || x.model === model));
const asst = (r: Seen) => r.msgs.filter((m) => m.role === 'assistant').map((m) => m.content);

describe('пары сравнения: дерево и чистые функции', () => {
  it('laneView / resolvePlan / expandPairs / laneSessions / pairChild', async () => {
    const P = await import('@/lib/pairs');
    const mk = (id: string, role: 'user' | 'assistant', parentId: string | null, meta: Record<string, unknown> | null = null, session: string | null = null): Message =>
      ({ id, threadId: 't', seq: 0, parentId, session, role, content: id, reasoning: null, reasoningMs: null, meta, createdAt: 0 });
    const all = [
      mk('u1', 'user', null, null, 't'), mk('s1', 'assistant', 'u1'),
      mk('u2', 'user', 's1', { pair: { a: 'a2', b: 'b2' } }, 't'), mk('a2', 'assistant', 'u2', { lane: 'a', session: 't' }), mk('b2', 'assistant', 'u2', { lane: 'b', session: 't:x' }),
      mk('u3', 'user', 'a2', { pair: { a: 'a3', b: 'b3' } }, 't'), mk('a3', 'assistant', 'u3', { lane: 'a', session: 't' }), mk('b3', 'assistant', 'u3', { lane: 'b', session: 't:x' }),
    ];
    const byId = (id: string) => all.find((m) => m.id === id)!;
    const path = ['u1', 's1', 'u2', 'a2', 'u3', 'a3'].map(byId);
    expect(P.laneView(all, path, 'b').map((m) => m.id)).toEqual(['u1', 's1', 'u2', 'b2', 'u3', 'b3']);
    expect(P.laneView(all, path, 'a').map((m) => m.id)).toEqual(['u1', 's1', 'u2', 'a2', 'u3', 'a3']);
    expect(P.expandPairs(all, path).map((m) => m.id)).toEqual(['u1', 's1', 'u2', 'a2', 'b2', 'u3', 'a3', 'b3']);
    const plan = P.resolvePlan(all, path, 'b', 'a3');
    expect(plan.picks.map((p) => [p.questionId, p.pair.pick])).toEqual([['u2', 'b'], ['u3', 'b']]);
    expect(plan.moves).toEqual([{ from: 'a2', to: 'b2' }, { from: 'a3', to: 'b3' }]);
    expect(plan.leaf).toBe('b3');
    expect(P.resolvePlan(all, path, 'a', 'a3')).toMatchObject({ moves: [], leaf: null });
    expect(P.laneSessions(all, path, 't', () => 'NEW', 'send')).toEqual({ a: 't', b: 't:x' });
    expect(P.laneSessions(all, path.slice(0, 2), 't', () => 'NEW', 'send')).toEqual({ a: 't', b: 'NEW' });
    expect(P.laneSessions(all, path, 't:e', () => 'NEW', 'edit')).toEqual({ a: 't:e', b: 'NEW' });
    expect(P.defaultLane([{ a: 'a2', b: 'b2' }, { a: 'a3', b: 'b3' }], (p) => (p.a === 'a2' ? 'b' : 'tie'))).toBe('b');
    expect(P.defaultLane([{ a: 'a2', b: 'b2' }], () => null)).toBe('a');
    expect(P.pairChild(all, byId('u2'))).toBe('a2');
    expect(P.pairChild(all, byId('u3'))).toBe('a3');
    const { deepestLatest, sessionOfPath } = await import('@/lib/tree');
    expect(deepestLatest(all, 'u2')).toBe('a3');
    expect(sessionOfPath([...path.slice(0, 2), byId('u2'), byId('b2')], 't')).toBe('t:x');
    expect(sessionOfPath([...path.slice(0, 2), byId('u2')], 't')).toBe('t');
    expect(sessionOfPath([byId('s1'), byId('b2')], 't')).toBe('t:x');
  });
});

describe('запоминание пары (levels.ts)', () => {
  const lv = (ids: string[]) => ids.map((id) => ({ id, label: id }));
  const ms = [
    { id: 'alpha', name: 'Alpha', defaultLevel: 'low', levels: lv(['off', 'low', 'medium', 'xhigh', 'max']) },
    { id: 'beta', name: 'Beta', defaultLevel: 'off', levels: lv(['off', 'on']), variantName: 'С ускорителем' },
    { id: 'beta-plain', name: 'Beta', defaultLevel: 'off', levels: lv(['off', 'on']), variantOf: 'beta', variantName: 'Без ускорителя' },
  ];
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it('pairFor: пара чата → запомненная с моделью чипа → чип против другого семейства / варианта', async () => {
    const { pairFor, readPair, rememberPair } = await import('@/lib/levels');
    const p = { model: 'alpha', levels: { beta: 'on' } };
    const e = { modelId: 'alpha', levelId: 'xhigh' };
    expect(pairFor(ms, p, e)).toEqual({ pair: { a: e, b: { modelId: 'beta', levelId: 'on' } }, tab: 'a' });
    const st = mem();
    rememberPair(ms, { a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'on' } }, st);
    const rp = readPair(ms, st);
    expect(rp).toEqual({ a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'on' } });
    expect(pairFor(ms, p, { modelId: 'beta-plain', levelId: 'off' }, null, rp)).toEqual({ pair: { a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'off' } }, tab: 'b' });
    expect(pairFor(ms, p, e, null, rp)).toEqual({ pair: { a: e, b: { modelId: 'beta-plain', levelId: 'on' } }, tab: 'a' });
    const tp = { a: { modelId: 'beta-plain', levelId: 'on' }, b: { modelId: 'alpha', levelId: 'max' } };
    expect(pairFor(ms, p, e, tp, rp)).toEqual({ pair: tp, tab: 'b' });
    expect(pairFor([ms[1], ms[2]], { model: 'beta', levels: {} }, { modelId: 'beta', levelId: 'on' }).pair.b.modelId).toBe('beta-plain');
    expect(readPair(ms, { getItem: () => '{bad', setItem: () => {} })).toBeNull();
  });

  it('одна модель в выборе (Beta свёрнута): пара — та же модель с другим уровнем; запомненная пара уровней — как есть', async () => {
    const { pairFor, readPair, rememberPair, contrastLevel, fixPair, pairFromPrefs } = await import('@/lib/levels');
    const one = [ms[0]];
    const p = { model: 'alpha', levels: {} };
    const low = { modelId: 'alpha', levelId: 'low' }, xh = { modelId: 'alpha', levelId: 'xhigh' };
    expect(['off', 'low', 'medium', 'xhigh', 'max'].map((l) => contrastLevel(ms[0], l))).toEqual(['xhigh', 'xhigh', 'xhigh', 'low', 'low']);
    expect(pairFor(one, p, low)).toEqual({ pair: { a: low, b: xh }, tab: 'a' });
    expect(pairFor(one, p, xh)).toEqual({ pair: { a: xh, b: low }, tab: 'a' });
    const st = mem();
    rememberPair(one, { a: { modelId: 'alpha', levelId: 'medium' }, b: { modelId: 'alpha', levelId: 'max' } }, st);
    const rp = readPair(one, st);
    expect(pairFor(one, p, { modelId: 'alpha', levelId: 'max' }, null, rp)).toEqual({ pair: rp, tab: 'b' });
    expect(pairFor(one, p, low, null, rp)).toEqual({ pair: rp, tab: 'a' });
    expect(pairFor(one, p, xh, { a: low, b: xh }, rp)).toEqual({ pair: { a: low, b: xh }, tab: 'b' });
    const st2 = mem();
    rememberPair(ms, { a: low, b: { modelId: 'beta', levelId: 'on' } }, st2);
    expect(readPair(one, st2)).toBeNull();
    expect(fixPair(one, p, { a: low, b: { modelId: 'beta', levelId: 'off' } })).toEqual({ a: low, b: xh });
    expect(fixPair(one, p, { a: { modelId: 'beta', levelId: 'off' }, b: { modelId: 'beta-plain', levelId: 'on' } })).toBeNull();
    expect(pairFromPrefs(one, p)).toEqual({ a: low, b: xh });
  });
});

describe('сравнение внутри чата (сервер)', () => {
  it('вопрос паре: одно сообщение, два ответа дорожек, две задачи; Alpha и Beta отвечают параллельно', async () => {
    await single('c0', 'Привет до сравнения');
    const s = await ask('c0', 'Первый вопрос паре');
    const u = msg(s.userMessageId), a = msg(s.a), b = msg(s.b);
    expect(u.meta).toMatchObject({ pair: { a: s.a, b: s.b } });
    expect(a.meta).toMatchObject({ lane: 'a', modelId: 'alpha', levelId: 'low', status: 'done' });
    expect(b.meta).toMatchObject({ lane: 'b', modelId: 'beta', levelId: 'off', status: 'done' });
    expect(a.content).toContain('[up-alpha-35b]');
    expect(b.content).toContain('[up-beta-0-4b]');
    expect(a.parentId).toBe(u.id); expect(b.parentId).toBe(u.id);
    expect(thread('c0')).toMatchObject({ leafId: s.a, compare: { on: true, ...EvS } });
    const ra = reqOf('Первый вопрос паре', 'up-alpha-35b')[0], rb = reqOf('Первый вопрос паре', 'up-beta-0-4b')[0];
    expect(ra.chat).toBe('c0');
    expect(rb.chat).not.toBe('c0');
    expect(rb.chat.startsWith('c0:')).toBe(true);
    const v = L.loadThread('u', 'c0')!;
    expect(v.messages.map((m) => m.meta?.lane ?? m.role)).toEqual(['user', 'assistant', 'user', 'a', 'b']);
    expect(v.messages[2].pair).toEqual({ a: s.a, b: s.b, pick: null, vote: null });
    expect(v.compare).toEqual({ on: true, ...EvS });
  });

  it('каждая дорожка видит свои прошлые ответы и продолжает свою сессию', async () => {
    const s = await ask('c0', 'Второй вопрос паре');
    const ra = reqOf('Второй вопрос паре', 'up-alpha-35b')[0], rb = reqOf('Второй вопрос паре', 'up-beta-0-4b')[0];
    expect(asst(ra).some((x) => x.includes('[up-alpha-35b]'))).toBe(true);
    expect(asst(ra).some((x) => x.includes('[up-beta-0-4b]'))).toBe(false);
    expect(asst(rb).some((x) => x.includes('[up-beta-0-4b]'))).toBe(true);
    expect(asst(rb).filter((x) => x.includes('[up-alpha-35b]')).length).toBe(1);
    const rb1 = reqOf('Первый вопрос паре', 'up-beta-0-4b')[0];
    expect(rb.chat).toBe(rb1.chat);
    expect(ra.chat).toBe('c0');
    expect((msg(msg(s.userMessageId).parentId!).meta as { lane?: string }).lane).toBe('a');
  });

  it('голос «какой лучше» → по умолчанию в историю уходит победитель; выключение переносит вопросы к его ответам', async () => {
    const v0 = L.loadThread('u', 'c0')!;
    const pairs = v0.messages.filter((m) => m.pair).map((m) => m.pair!);
    expect(C.setVote('u', pairs[1].a, pairs[1].b, 'b')).toEqual({ winner: 'b' });
    expect(L.loadThread('u', 'c0')!.messages.filter((m) => m.pair)[1].pair!.vote).toBe('b');
    const r = C.setCompare('u', thread('c0'), { on: false });
    expect(r!.resolved).toEqual({ lane: 'b', changed: true });
    const t = thread('c0');
    expect(t.compare).toMatchObject({ on: false });
    expect(t.leafId).toBe(pairs[1].b);
    const u2 = db.select().from(schema.messages).where(eq(schema.messages.threadId, 'c0')).all().find((m) => m.content === 'Второй вопрос паре')!;
    expect(u2.parentId).toBe(pairs[0].b);
    await single('c0', 'После сравнения', 'beta', 'off');
    const rq = reqOf('После сравнения')[0];
    expect(asst(rq).filter((x) => x.includes('[up-beta-0-4b]')).length).toBe(2);
    expect(asst(rq).filter((x) => x.includes('[up-alpha-35b]')).length).toBe(1);
    expect(rq.chat).toBe(reqOf('Первый вопрос паре', 'up-beta-0-4b')[0].chat);
    const v = L.loadThread('u', 'c0')!;
    expect(v.messages.filter((m) => m.pair).map((m) => m.pair!.pick)).toEqual(['b', 'b']);
    expect(v.messages.at(-1)!.meta?.lane).toBeUndefined();
  });

  it('включили снова: новая пара; дорожка b — новая сессия (старая видела другую историю); «продолжить с этим ответом» — модель и дорожка ответа', async () => {
    const s = await ask('c0', 'Снова сравниваю', { a: { modelId: 'beta', levelId: 'off' }, b: EvS.a });
    const ra = reqOf('Снова сравниваю', 'up-beta-0-4b')[0], rb = reqOf('Снова сравниваю', 'up-alpha-35b')[0];
    const oldB = reqOf('Первый вопрос паре', 'up-beta-0-4b')[0].chat;
    expect(ra.chat).toBe(oldB);
    expect(rb.chat).not.toBe(oldB); expect(rb.chat).not.toBe('c0');
    const r = C.pickAnswer('u', thread('c0'), s.b);
    expect(r).toMatchObject({ lane: 'b', sel: EvS.a });
    expect(thread('c0')).toMatchObject({ modelId: 'alpha', effort: 'low', leafId: s.b, compare: { on: false } });
    await single('c0', 'Дальше одной', 'alpha', 'low');
    expect(reqOf('Дальше одной')[0].chat).toBe(rb.chat);
  });

  it('повтор и правка в паре; одной моделью ответ пары не повторяется', async () => {
    const s = await ask('c1', 'Вопрос для повтора');
    const l = J.submitLane({ thread: thread('c1'), userId: 'u', lane: 'b', mode: 'regenerate', modelId: 'beta', levelId: 'on' });
    await J.waitJob(l.jobId);
    const u = msg(s.userMessageId);
    expect((u.meta as { pair: { a: string; b: string } }).pair).toEqual({ a: s.a, b: l.assistantMessageId });
    expect(thread('c1').leafId).toBe(s.a);
    expect(reqOf('Вопрос для повтора', 'up-beta-0-4b').map((x) => x.chat)).toEqual([reqOf('Вопрос для повтора', 'up-beta-0-4b')[0].chat, reqOf('Вопрос для повтора', 'up-beta-0-4b')[0].chat]);
    const v = L.loadThread('u', 'c1')!;
    const bAns = v.messages.find((m) => m.id === l.assistantMessageId)!;
    expect(bAns.siblings).toEqual({ ids: [s.b, l.assistantMessageId], index: 1 });
    expect(v.messages.find((m) => m.id === s.a)!.siblings).toBeUndefined();
    expect(() => J.submitTurn({ thread: thread('c1'), userId: 'u', mode: 'regenerate', modelId: 'alpha', levelId: 'low' })).toThrow(/сравнения/);
    const e = await ask('c1', 'Правленый вопрос', EvS, 'edit', s.userMessageId);
    const ea = reqOf('Правленый вопрос', 'up-alpha-35b')[0], eb = reqOf('Правленый вопрос', 'up-beta-0-4b')[0];
    expect(ea.chat).not.toBe('c1'); expect(eb.chat).not.toBe(ea.chat);
    expect(msg(e.userMessageId).parentId).toBe(null);
    expect(L.loadThread('u', 'c1')!.messages.find((m) => m.role === 'user')!.siblings).toEqual({ ids: [s.userMessageId, e.userMessageId], index: 1 });
  });

  it('одна модель после открытых пар (с другого устройства): пары закрываются сами, по умолчанию — a', async () => {
    const s = await ask('c2', 'Открытая пара');
    await single('c2', 'Сразу одной моделью', 'alpha', 'low');
    expect((msg(s.userMessageId).meta as { pair: { pick?: string } }).pair.pick).toBe('a');
    expect(thread('c2').compare).toMatchObject({ on: false });
    const rq = reqOf('Сразу одной моделью')[0];
    expect(rq.chat).toBe('c2');
    expect(asst(rq).some((x) => x.includes('[up-beta-0-4b]'))).toBe(false);
  });

  it('общая очередь Mac: Beta и Beta без ускорителя не идут одновременно, Alpha — до 2', async () => {
    peakSolo = 0; peakAlpha = 0;
    expect(J.queueStats('beta')).toMatchObject({ limit: 1 });
    expect(J.queueStats('beta-plain')).toMatchObject({ limit: 1 });
    expect(J.queueStats('alpha')).toMatchObject({ limit: 2 });
    const s1 = J.submitPair({ thread: thread('c3'), userId: 'u', mode: 'send', text: 'Два Beta [chunks:6] [delay:20]', pair: SvP });
    const s2 = J.submitPair({ thread: thread('c4'), userId: 'u', mode: 'send', text: 'Два Alpha [chunks:6] [delay:20]', pair: { a: EvS.a, b: { modelId: 'alpha', levelId: 'medium' } } });
    expect(J.queueStats('beta-plain')).toMatchObject({ active: 1, queued: 1 });
    await Promise.all([...s1.jobIds, ...s2.jobIds].map((id) => J.waitJob(id)));
    expect(peakSolo).toBe(1);
    expect(peakAlpha).toBe(2);
    expect(msg(s1.b).content).toContain('[up-beta-0-4b-plain]');
    const r = reqOf('Два Beta');
    expect(new Set(r.map((x) => x.chat)).size).toBe(2);
    expect((msg(s1.a).meta as { gen?: { n: number } }).gen?.n).toBeGreaterThan(0);
    expect((msg(s1.b).meta as { gen?: { n: number } }).gen?.n).toBeGreaterThan(0);
  });

  it('пара из одной модели (Alpha · low против Alpha · xhigh): обе стороны параллельно в лимите Alpha, свои уровни, сессии и истории', async () => {
    peakAlpha = 0;
    const lx = { a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'alpha', levelId: 'xhigh' } };
    const got: Record<string, unknown>[] = [];
    const sub = B.subscribe('u', null, (e) => got.push(e));
    const s1 = J.submitPair({ thread: thread('c8'), userId: 'u', mode: 'send', text: 'Уровни: первый [chunks:6] [delay:25]', pair: lx });
    expect(J.queueStats('alpha')).toMatchObject({ active: 2, queued: 0, limit: 2 });
    await Promise.all(s1.jobIds.map((id) => J.waitJob(id)));
    sub.unsubscribe();
    expect(peakAlpha).toBe(2);
    const r1 = reqOf('Уровни: первый');
    expect(r1.map((x) => x.effort).sort()).toEqual(['low', 'xhigh']);
    expect(new Set(r1.map((x) => x.chat)).size).toBe(2);
    expect(msg(s1.a).meta).toMatchObject({ modelId: 'alpha', levelId: 'low', lane: 'a' });
    expect(msg(s1.b).meta).toMatchObject({ modelId: 'alpha', levelId: 'xhigh', lane: 'b' });
    const fin = got.filter((e) => e.t === 'job' && e.status === 'done');
    expect((fin.at(-1)!.both as { model: string }[]).map((x) => x.model)).toEqual(['Alpha · low', 'Alpha · xhigh']);
    const pp = N.payloadOf({ modelId: 'alpha', title: 'Т', preview: 'x', status: 'done', threadId: 'c8', groupId: null, messageId: s1.b,
      pair: { waiting: false, both: [{ lane: 'a', modelId: 'alpha', levelId: 'low', status: 'done', preview: 'A', messageId: s1.a }, { lane: 'b', modelId: 'alpha', levelId: 'xhigh', status: 'done', preview: 'B', messageId: s1.b }] } });
    expect(pp.body).toMatch(/^Alpha · low и Alpha · xhigh/);
    db.update(schema.messages).set({ content: 'ОТВЕТ-B' }).where(eq(schema.messages.id, s1.b)).run();
    db.update(schema.messages).set({ content: 'ОТВЕТ-A' }).where(eq(schema.messages.id, s1.a)).run();
    await ask('c8', 'Уровни: второй', lx);
    const r2 = reqOf('Уровни: второй');
    const byEff = Object.fromEntries(r2.map((x) => [x.effort, x]));
    expect(asst(byEff.low).at(-1)).toBe('ОТВЕТ-A');
    expect(asst(byEff.xhigh).at(-1)).toBe('ОТВЕТ-B');
    expect(byEff.low.chat).toBe(r1.find((x) => x.effort === 'low')!.chat);
    expect(byEff.xhigh.chat).toBe(r1.find((x) => x.effort === 'xhigh')!.chat);
    const pr = L.loadThread('u', 'c8')!.messages.filter((m) => m.pair).at(-1)!.pair!;
    C.setVote('u', pr.a, pr.b, 'b');
    const { analytics } = await import('@/lib/analytics');
    const row = analytics(7).compare.pairs.find((r) => r.a.modelId === 'alpha' && r.b.modelId === 'alpha' && [r.a.levelId, r.b.levelId].sort().join() === 'low,xhigh')!;
    expect(row).toMatchObject({ votes: 1 });
    expect(row.a.levelId === 'xhigh' ? row.aWins : row.bWins).toBe(1);
    C.setCompare('u', thread('c8'), { on: false });
    await single('c8', 'Уровни: после', 'alpha', 'xhigh');
    const r3 = reqOf('Уровни: после')[0];
    expect(asst(r3)).toContain('ОТВЕТ-B');
    expect(asst(r3)).not.toContain('ОТВЕТ-A');
    expect(r3.chat).toBe(byEff.xhigh.chat);
  });

  it('уведомления: первый ответ пары — без тоста, последний — «оба ответа готовы»', async () => {
    const got: Record<string, unknown>[] = [];
    const sub = B.subscribe('u', null, (e) => got.push(e));
    const s = J.submitPair({ thread: thread('c5'), userId: 'u', mode: 'send', text: 'Уведоми [chunks:4] [delay:15]', pair: SvP });
    await Promise.all(s.jobIds.map((id) => J.waitJob(id)));
    sub.unsubscribe();
    const fin = got.filter((e) => e.t === 'job' && e.status === 'done');
    expect(fin.length).toBe(2);
    expect(fin[0].waiting).toBe(true);
    expect(fin[0].notice).not.toMatch(/toast|push/);
    expect(fin[1].both).toEqual([
      { model: 'Beta с ускорителем', status: 'done', lane: 'a', m: s.a },
      { model: 'Beta без ускорителя', status: 'done', lane: 'b', m: s.b },
    ]);
    const p = N.payloadOf({ modelId: 'beta-plain', title: 'Т', preview: 'x', status: 'done', threadId: 'c5', groupId: null, messageId: s.b,
      pair: { waiting: false, both: [{ lane: 'a', modelId: 'beta', status: 'done', preview: 'Ответ A', messageId: s.a }, { lane: 'b', modelId: 'beta-plain', status: 'error', preview: '', messageId: s.b }] } });
    expect(p.title).toBe('Один ответ из двух готов в чате «Т»');
    expect(p.url).toBe(`/c/c5#m-${s.a}`);
    expect(p.body).toContain('Beta без ускорителя не ответила');
  });

  it('аналитика: голоса по видам пар (модели, варианты, уровни), «Beta против Alpha» = «Alpha против Beta»', async () => {
    const v = L.loadThread('u', 'c3')!;
    const pr = v.messages.find((m) => m.pair)!.pair!;
    C.setVote('u', pr.a, pr.b, 'a');
    const v2 = L.loadThread('u', 'c4')!.messages.find((m) => m.pair)!.pair!;
    C.setVote('u', v2.a, v2.b, 'tie');
    const { analytics } = await import('@/lib/analytics');
    const an = analytics(7);
    expect(an.compare.questions).toBeGreaterThanOrEqual(6);
    const sp = an.compare.pairs.find((r) => [r.a.modelId, r.b.modelId].sort().join() === 'beta,beta-plain')!;
    expect(sp).toMatchObject({ votes: 1, ties: 0, bad: 0 });
    expect(sp.a.modelId === 'beta' ? sp.aWins : sp.bWins).toBe(1);
    const ev = an.compare.pairs.filter((r) => [r.a.modelId, r.b.modelId].sort().join() === 'alpha,beta');
    expect(ev.length).toBe(1);
    expect(an.compare.pairs.find((r) => r.a.modelId === 'alpha' && r.b.modelId === 'alpha' && [r.a.levelId, r.b.levelId].sort().join() === 'low,medium')).toMatchObject({ ties: 1 });
    expect(C.setVote('u', pr.a, 'nope', 'a')).toBe('not-found');
    expect(C.setVote('u', pr.a, pr.b, null)).toBeNull();
  });

  it('одна из моделей недоступна: её ответ — понятная ошибка сразу, вторая отвечает; обе — отказ до записи', async () => {
    const S = await import('@/lib/status');
    S.setLoad({ state: 'down', model: 'beta', until: Date.now() + 60_000 });
    try {
      const s = J.submitPair({ thread: thread('c6'), userId: 'u', mode: 'send', text: 'Одна недоступна', pair: EvS });
      expect(s.jobIds.length).toBe(1);
      await Promise.all(s.jobIds.map((id) => J.waitJob(id)));
      expect(msg(s.b).meta).toMatchObject({ lane: 'b', status: 'error' });
      expect(String((msg(s.b).meta as { errorUser?: string }).errorUser)).toMatch(/Beta/);
      expect(msg(s.a).content).toContain('[up-alpha-35b]');
      S.setLoad({ state: 'down', model: 'alpha', until: Date.now() + 60_000 });
      const n0 = db.select().from(schema.messages).all().length;
      expect(() => J.submitPair({ thread: thread('c7'), userId: 'u', mode: 'send', text: 'Обе недоступны', pair: EvS })).toThrow(/недоступны/);
      expect(db.select().from(schema.messages).all().length).toBe(n0);
    } finally { S.setLoad({ state: 'normal' }); }
  });

  it('старый чат сравнения (две ветки с group_id) открывается и отвечает как раньше', async () => {
    const now = Date.now();
    db.insert(schema.threads).values([{ id: 'ga', userId: 'u', title: 'Старое', modelId: 'alpha', effort: 'low', groupId: 'g1', side: 'a', createdAt: now, updatedAt: now },
      { id: 'gb', userId: 'u', title: 'Старое', modelId: 'beta', effort: 'off', groupId: 'g1', side: 'b', createdAt: now, updatedAt: now }]).run();
    const x = J.submitTurn({ thread: thread('ga'), userId: 'u', mode: 'send', text: 'Старое сравнение', modelId: 'alpha', levelId: 'low' });
    const y = J.submitTurn({ thread: thread('gb'), userId: 'u', mode: 'send', text: 'Старое сравнение', modelId: 'beta', levelId: 'off' });
    await Promise.all([J.waitJob(x.jobId), J.waitJob(y.jobId)]);
    const g = L.loadGroup('u', 'g1')!;
    expect(g.msgsA.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(g.msgsB.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(C.setVote('u', x.assistantMessageId, y.assistantMessageId, 'b')).toEqual({ winner: 'b' });
    expect(L.loadGroup('u', 'g1')!.votes).toEqual({ [`${x.assistantMessageId}|${y.assistantMessageId}`]: 'b' });
    expect(reqOf('Старое сравнение').map((r) => r.chat).sort()).toEqual(['ga', 'gb']);
  });
});
