import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
// @ts-expect-error — .mjs без типов
import { toolPlan, streamPlan, textOf } from './e2e/mock_tools.mjs';

const dir = tmpData();
const OUT = path.join(dir, 'up-out');
fs.mkdirSync(OUT, { recursive: true });
process.env.KX_OUT_DIR = OUT;
process.env.KX_AGENT_TOOLS = '1';
process.env.KX_TOOLS_PATH = 'agent';
process.env.KX_ASK_TIMEOUT_MS = '1500';
process.env.KX_MAINT_FILE = '';

type Req = { agent: boolean; tools: string[]; messages: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[]; chat: string | undefined; aborted: boolean };
const reqs: Req[] = [];
const flaky = new Map<string, number>();
const cut = new Set<string>();
const maintN = new Map<string, number>();
let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let J: typeof import('@/lib/jobs'), Bus: typeof import('@/lib/bus'), R: typeof import('@/lib/tools/registry');
let eq: typeof import('drizzle-orm').eq;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      const rec: Req = { agent: req.headers['x-korvex-agent'] === '1', tools: (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name), messages: body.messages, chat: req.headers['x-korvex-chat-id'] as string | undefined, aborted: false };
      reqs.push(rec);
      const lastQ = textOf([...body.messages].reverse().find((m: { role: string }) => m.role === 'user')?.content);
      if (/\[flaky\]/.test(lastQ)) {
        const n = (flaky.get(lastQ) ?? 0) + 1; flaky.set(lastQ, n);
        if (n === 1) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'agent gateway: yielded to a user, retry later' } })); return; }
        if (n === 2) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': keepalive\n\n'); setTimeout(() => res.destroy(), 20); return; }
      }
      const fr = (delta: unknown) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
      const mm = /\[(maint|maintalways|hint|refused)\]/.exec(lastQ);
      if (mm) {
        const n = (maintN.get(lastQ) ?? 0) + 1; maintN.set(lastQ, n);
        const merr = { message: 'Модель на обслуживании', type: 'server_error', param: null, code: 'maintenance' };
        if (mm[1] === 'refused') { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'upstream: <urlopen error [Errno 111] Connection refused>' } })); return; }
        if (mm[1] === 'hint' && n <= 2) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'The server failed to generate a response' } })); return; }
        if (mm[1] !== 'hint' && (n === 1 || mm[1] === 'maintalways')) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: merr, retry_after: 7 })); return; }
        if (mm[1] === 'maint' && n === 2) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'upstream: <urlopen error [Errno 111] Connection refused>' } })); return; }
        if (mm[1] === 'maint' && n === 3) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(fr({ reasoning_content: '▸ python: расчёт\n    42\n' })); res.write(fr({ content: 'Половина' }));
          res.write(`data: ${JSON.stringify({ object: 'maintenance', retry_after: 9, error: merr })}\n\n`); res.end('data: [DONE]\n\n'); return;
        }
      }
      if (/\[shimcut\]/.test(lastQ) && !cut.has(lastQ)) {
        cut.add(lastQ);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(fr({ reasoning_content: 'Думаю про обрывок. ' })); res.write(fr({ content: 'Обрывок ответа' }));
        res.write(`data: ${JSON.stringify({ error: { message: 'The answer stream was cut (IncompleteRead).', type: 'server_error', param: null, code: 'upstream_cut' } })}\n\n`);
        res.end('data: [DONE]\n\n'); return;
      }
      if (/\[cutstep\]/.test(lastQ)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(fr({ reasoning_content: '▸ python: расчёт\n    42\n' })); res.write(fr({ content: 'Нач' }));
        setTimeout(() => res.destroy(), 30); return;
      }
      if (/\[cutonce\]/.test(lastQ) && !cut.has(lastQ)) {
        cut.add(lastQ);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(fr({ reasoning_content: 'Думаю про обрывок. ' })); res.write(fr({ content: 'Обрывок ответа' }));
        setTimeout(() => res.destroy(), 30); return;
      }
      let closed = false;
      res.on('close', () => { if (!res.writableEnded) { closed = true; rec.aborted = true; } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (body.tools?.length) { const dm = /\[delay:(\d+)\]/.exec(lastQ); await streamPlan(res, body.model, toolPlan(body), dm ? Number(dm[1]) : 5, () => closed); return; }
      const last = [...body.messages].reverse().find((m: { role: string }) => m.role === 'user');
      const q = textOf(last?.content);
      const slow = /\[slowchat\]/.test(q);
      await streamPlan(res, body.model, { reasoning: '▸ python: расчёт\n    42\n', content: `Рабочее место: ${q.replace(/\s+/g, ' ').slice(0, 300)}`, calls: [] }, slow ? 80 : 5, () => closed);
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
  ({ eq } = await import('drizzle-orm'));
  const now = Date.now();
  for (const u of ['ua', 'ub']) db.insert(schema.users).values({ id: u, email: `${u}@t`, name: u, passwordHash: 'x', role: 'user', createdAt: now }).run();
  J = await import('@/lib/jobs');
  Bus = await import('@/lib/bus');
  R = await import('@/lib/tools/registry');
  await import('@/lib/agentLoop');
  R.registerTool<{ ms?: number }>({ name: 'test_sleep', kind: 'other', description: 'sleep', parameters: { type: 'object', properties: { ms: { type: 'integer' } } }, enabled: () => true,
    title: (a) => `Ждёт ${a.ms ?? 0} мс`,
    run: (a, ctx) => new Promise((res, rej) => { const t = setTimeout(() => res({ content: `поспал ${a.ms} мс` }), Number(a.ms) || 10); ctx.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); }) });
  R.registerTool<{ x?: string }>({ name: 'test_pay', kind: 'browser', description: 'pay', parameters: { type: 'object', properties: { x: { type: 'string' } } }, enabled: () => true,
    title: () => 'Оплачивает заказ', confirm: (a) => `Оплатить ${a.x ?? '1 290 ₽'}?`,
    run: async (_a, ctx) => { const ok = await ctx.confirm('И подтвердить доставку?'); const shot = await ctx.attach({ name: 'Снимок — магазин.png', mime: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') }); return { content: ok ? 'оплачено, доставка подтверждена' : 'оплачено, доставка не подтверждена', attachments: [shot] }; } });
  R.registerTool({ name: 'test_boom', kind: 'other', description: 'boom', parameters: { type: 'object', properties: {} }, enabled: () => true, title: () => 'Падает', run: async () => { throw new Error('сломалось'); } });
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const now = () => Date.now();
function mkThread(userId: string, title: string, extra: Partial<typeof schema.threads.$inferInsert> = {}) {
  const id = randomUUID();
  db.insert(schema.threads).values({ id, userId, title, modelId: 'alpha', effort: 'off', createdAt: now(), updatedAt: now(), ...extra }).run();
  return id;
}
function addTurn(threadId: string, q: string, a: string) {
  const t = db.select().from(schema.threads).where(eq(schema.threads.id, threadId)).get()!;
  const u = randomUUID(), m = randomUUID();
  const seq = db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId)).all().length;
  db.insert(schema.messages).values([
    { id: u, threadId, seq: seq + 1, parentId: t.leafId, role: 'user', content: q, createdAt: now() },
    { id: m, threadId, seq: seq + 2, parentId: u, role: 'assistant', content: a, meta: { modelId: 'alpha', levelId: 'off' }, createdAt: now() },
  ]).run();
  db.update(schema.threads).set({ leafId: m }).where(eq(schema.threads.id, threadId)).run();
}
const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const msg = (id: string) => db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
const submit = (t: string, text: string, userId = 'ua') => J.submitTurn({ thread: thread(t), userId, mode: 'send', text, modelId: 'alpha', levelId: 'low' });
const stepsOf = (mid: string) => ((msg(mid).meta as { steps?: { id: string; kind: string; tool?: string; status: string; title: string; ask?: unknown; agent?: { state: string; answer?: string }; attachments?: { url: string }[]; thumb?: unknown }[] }).steps ?? []);
async function until(f: () => boolean, ms = 4000) { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)); } }
function liveSteps() { const got: { s: { id: string; status: string; kind: string } }[] = []; const sub = Bus.subscribe('ua', null, (e) => { if (e.t === 'step') got.push(e as never); }); return { got, stop: () => sub.unsubscribe() }; }

describe('цикл инструментов', () => {

  it('несколько раундов и параллельные вызовы: размышление и ответ раундов подряд, порядок шагов', async () => {
    const t = mkThread('ua', 'Раунды');
    const s = submit(t, 'два шага [tctext][tc:test_sleep {"ms":30}][tc:test_sleep {"ms":10}]');
    await J.waitJob(s.jobId);
    const st = stepsOf(s.assistantMessageId);
    expect(st.map((x) => x.title)).toEqual(['Ждёт 30 мс', 'Ждёт 10 мс']);
    const m = msg(s.assistantMessageId);
    expect(m.content.startsWith('Сейчас посмотрю.\n\nСейчас посмотрю.\n\nГотово: поспал 10 мс')).toBe(true);
    expect(m.reasoning).toContain('Шаг 1: test_sleep.\n\nШаг 2: test_sleep.');
    const p = submit(mkThread('ua', 'Пар'), 'сразу [tcpar][tc:test_sleep {"ms":5}][tc:chat_list {}]');
    await J.waitJob(p.jobId);
    expect(stepsOf(p.assistantMessageId).map((x) => x.tool)).toEqual(['test_sleep', 'chat_list']);
  });

  it('ошибка инструмента и неизвестный инструмент: шаг err, модель получает текст ошибки, ход продолжается', async () => {
    const s = submit(mkThread('ua', 'Ошибки'), 'x [tc:test_boom {}][tc:nope_tool {}]');
    const r = await J.waitJob(s.jobId)!;
    expect(r.status).toBe('done');
    const st = stepsOf(s.assistantMessageId);
    expect(st.map((x) => x.status)).toEqual(['err', 'err']);
    expect(msg(s.assistantMessageId).content).toContain('нет. Доступны');
  });

  it('подтверждение: wait_user -> «Разрешить» (до запуска и посреди работы), снимок экрана — вложение-файл чата', async () => {
    const t = mkThread('ua', 'Покупка');
    const s = submit(t, 'купи [tc:test_pay {"x":"990 ₽"}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'wait_user');
    expect(J.liveOfMessage(s.assistantMessageId)!.steps![0]).toMatchObject({ ask: { text: 'Оплатить 990 ₽?' } });
    expect(J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ub', 'allow')).toBe(false);
    expect(J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ua', 'allow')).toBe(true);
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.ask?.text === 'И подтвердить доставку?');
    J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ua', 'allow');
    await J.waitJob(s.jobId);
    const st = stepsOf(s.assistantMessageId)[0];
    expect(st.status).toBe('ok');
    expect(st.ask).toBeUndefined();
    expect(st.attachments?.[0].url).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
    expect(st.thumb).toBeTruthy();
    const f = db.select().from(schema.files).where(eq(schema.files.threadId, t)).all();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ userId: 'ua', mime: 'image/png', info: { source: 'tool', tool: 'test_pay' } });
    expect(msg(s.assistantMessageId).content).toContain('доставка подтверждена');
  });

  it('«Отменить» и «нет ответа»: инструмент не запускается, модели — «пользователь отменил», шаг denied', async () => {
    const s = submit(mkThread('ua', 'Отказ'), 'купи [tc:test_pay {}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'wait_user');
    J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ua', 'deny');
    await J.waitJob(s.jobId);
    expect(stepsOf(s.assistantMessageId)[0].status).toBe('denied');
    expect(msg(s.assistantMessageId).content).toContain('Пользователь отменил действие: Оплатить 1 290 ₽?');
    const s2 = submit(mkThread('ua', 'Молчит'), 'купи [tc:test_pay {}]');
    await J.waitJob(s2.jobId);
    expect(stepsOf(s2.assistantMessageId)[0]).toMatchObject({ status: 'denied', detail: 'Нет ответа 10 минут' });
  });

  it('«Стоп» обрывает идущий инструмент и ожидание подтверждения: шаг stopped, задача cancelled', async () => {
    const s = submit(mkThread('ua', 'Стоп'), 'жди [tc:test_sleep {"ms":5000}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'run');
    const t0 = Date.now();
    J.cancelJob(s.jobId, 'ua');
    const r = await J.waitJob(s.jobId)!;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe('cancelled');
    expect(stepsOf(s.assistantMessageId)[0].status).toBe('stopped');
    const s2 = submit(mkThread('ua', 'Стоп2'), 'купи [tc:test_pay {}]');
    await until(() => J.liveOfMessage(s2.assistantMessageId)?.steps?.[0]?.status === 'wait_user');
    J.cancelJob(s2.jobId, 'ua');
    await J.waitJob(s2.jobId);
    expect(stepsOf(s2.assistantMessageId)[0].status).toBe('stopped');
  });

  it('предохранитель: один и тот же вызов — на 3-й «повтор», на 5-й ход останавливается с ошибкой', async () => {
    const n0 = reqs.length;
    const s = submit(mkThread('ua', 'Петля'), 'петля [tcloop:test_sleep {"ms":1}]');
    const r = await J.waitJob(s.jobId)!;
    expect(r.status).toBe('error');
    expect(r.error).toContain('один и тот же вызов test_sleep 5 раз подряд');
    const tools = reqs.slice(n0).flatMap((q) => q.messages.filter((m) => m.role === 'tool').slice(-1));
    expect(tools.some((m) => String(m.content).includes('повторяется 3-й раз'))).toBe(true);
  });

  it('steer next: сообщение на ходу уходит следующим role=user после результатов шага', async () => {
    const s = submit(mkThread('ua', 'Steer'), 'работай [tc:test_sleep {"ms":400}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'run');
    expect(J.steerJob(s.jobId, 'ub', 'чужое')).toBeNull();
    expect(J.steerJob(s.jobId, 'ua', 'и ещё проверь Запуск')).toBeTruthy();
    await J.waitJob(s.jobId);
    const m = msg(s.assistantMessageId);
    expect(m.content).toContain('Учёл: и ещё проверь Запуск');
    const st = stepsOf(s.assistantMessageId);
    expect(st.find((x) => x.kind === 'steer')).toMatchObject({ status: 'ok', title: 'и ещё проверь Запуск' });
  });

  it('steer now: прерывает идущий инструмент, ход продолжается с сообщением', async () => {
    const s = submit(mkThread('ua', 'SteerNow'), 'долго [tc:test_sleep {"ms":8000}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'run');
    const t0 = Date.now();
    J.steerJob(s.jobId, 'ua', 'хватит ждать', 'now');
    const r = await J.waitJob(s.jobId)!;
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.status).toBe('done');
    expect(stepsOf(s.assistantMessageId)[0].status).toBe('stopped');
    expect(msg(s.assistantMessageId).content).toContain('Учёл: хватит ждать');
  });

  it('steer, когда шагов больше нет: после ответа — обычным следующим вопросом в чате', async () => {
    const t = mkThread('ua', 'SteerAfter');
    const s = submit(t, 'просто ответь [slowchat]');
    J.steerJob(s.jobId, 'ua', 'а теперь кратко');
    await J.waitJob(s.jobId);
    await until(() => db.select().from(schema.messages).where(eq(schema.messages.threadId, t)).all().length >= 4);
    const all = db.select().from(schema.messages).where(eq(schema.messages.threadId, t)).all();
    expect(all.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['просто ответь [slowchat]', 'а теперь кратко']);
    await until(() => !J.activeJobs('ua').some((j) => j.threadId === t));
  });

  it('вопрос с картинкой — обычным путём (агентный путь картинок не видит), API /v1 — инструменты клиента', async () => {
    const t = mkThread('ua', 'Картинка');
    const fid = randomUUID();
    db.insert(schema.files).values({ id: fid, userId: 'ua', threadId: null, name: 'a.png', mime: 'image/png', size: 8, sha256: 'z', createdAt: now() }).run();
    fs.mkdirSync(path.join(dir, 'files', fid), { recursive: true });
    fs.writeFileSync(path.join(dir, 'files', fid, 'original.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const n0 = reqs.length;
    const s = J.submitTurn({ thread: thread(t), userId: 'ua', mode: 'send', text: 'что тут? [tc:chat_list {}]', fileIds: [fid], modelId: 'alpha', levelId: 'low' });
    await J.waitJob(s.jobId);
    expect(reqs.slice(n0).map((q) => q.agent)).toEqual([false]);
    expect(stepsOf(s.assistantMessageId)).toEqual([]);
  });
});

describe('повтор раунда модели (вход занят, движок перезапускается)', () => {
  it('503 и обрыв до первого токена — повтор с тихим шагом «Модель занята…», третий раз — ответ; после первого токена — без повтора', async () => {
    process.env.KX_UPSTREAM_RETRY = '4'; process.env.KX_RETRY_PAUSE_MS = '50';
    try {
      const n0 = reqs.length;
      const s = submit(mkThread('ua', 'Повтор'), 'привет [flaky][tc:test_sleep {"ms":5}]');
      const r = await J.waitJob(s.jobId)!;
      expect(r.status).toBe('done');
      expect(reqs.length - n0).toBe(4);
      const st = stepsOf(s.assistantMessageId);
      expect(st.filter((x) => x.title.startsWith('Модель занята, повторю через')).map((x) => [x.status, /попытка 3/.test(x.title)])).toEqual([['ok', true]]);
      expect(st.filter((x) => x.tool === 'test_sleep')).toHaveLength(1);
      expect(msg(s.assistantMessageId).content).toContain('Готово: поспал');
      const sub = Bus.subscribe('ua', null, () => {});
      const s1 = submit(mkThread('ua', 'Обрыв'), 'x [cutonce][tc:test_sleep {"ms":5}]');
      const r1 = await J.waitJob(s1.jobId)!;
      sub.unsubscribe();
      expect(r1.status).toBe('done');
      expect(msg(s1.assistantMessageId).content).not.toContain('Обрывок');
      expect(msg(s1.assistantMessageId).reasoning ?? '').not.toContain('обрывок');
      expect(msg(s1.assistantMessageId).content).toContain('Готово: поспал');
      expect(stepsOf(s1.assistantMessageId).find((x) => x.title.startsWith('Модель прервалась, повторяю'))?.status).toBe('ok');
      expect(stepsOf(s1.assistantMessageId).filter((x) => x.tool === 'test_sleep')).toHaveLength(1);
      const n1 = reqs.length;
      const s2 = submit(mkThread('ua', 'Обрыв2'), 'x [cutstep]');
      const r2 = await J.waitJob(s2.jobId)!;
      expect(r2.status).toBe('error');
      expect(reqs.length - n1).toBe(1);
      expect(msg(s2.assistantMessageId).content).toBe('Нач');
      process.env.KX_RETRY_PAUSE_MS = '5000';
      const s3 = submit(mkThread('ua', 'СтопПовтор'), 'y [flaky]');
      await until(() => !!J.liveOfMessage(s3.assistantMessageId)?.steps?.some((x) => x.title.startsWith('Модель занята')));
      const t0 = Date.now();
      J.cancelJob(s3.jobId, 'ua');
      const r3 = await J.waitJob(s3.jobId)!;
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(r3.status).toBe('cancelled');
    } finally { process.env.KX_UPSTREAM_RETRY = '0'; delete process.env.KX_RETRY_PAUSE_MS; }
  });

  it('обычный ход без инструментов: обрыв после текста — стереть и повторить; API — без повтора после токена', async () => {
    process.env.KX_UPSTREAM_RETRY = '4'; process.env.KX_RETRY_PAUSE_MS = '30'; process.env.KX_AGENT_TOOLS = '0';
    try {
      const s = submit(mkThread('ua', 'ОбрывЧат'), 'обычный [cutonce]');
      const r = await J.waitJob(s.jobId)!;
      expect(r.status).toBe('done');
      expect(msg(s.assistantMessageId).content).toBe('Рабочее место: обычный [cutonce]');
    } finally { process.env.KX_UPSTREAM_RETRY = '0'; delete process.env.KX_RETRY_PAUSE_MS; process.env.KX_AGENT_TOOLS = '1'; }
  });

  it('серв не отвечает шлюзу без известного обслуживания — свой потолок KX_MAINT_REFUSED_S (падение, а не выкатка): дальше «временно недоступна»', async () => {
    process.env.KX_UPSTREAM_RETRY = '0'; process.env.KX_MAINT_PAUSE_MS = '300'; process.env.KX_MAINT_REFUSED_S = '1'; process.env.KX_AGENT_TOOLS = '0';
    try {
      const n0 = reqs.length, t0 = Date.now();
      const s = submit(mkThread('ua', 'СервЛежит'), 'лежит [refused]');
      expect((await J.waitJob(s.jobId)!).status).toBe('error');
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(reqs.length - n0).toBeLessThanOrEqual(4);
      expect((msg(s.assistantMessageId).meta as { errorUser?: string }).errorUser).toMatch(/временно недоступна/);
    } finally { delete process.env.KX_MAINT_PAUSE_MS; delete process.env.KX_MAINT_REFUSED_S; process.env.KX_AGENT_TOOLS = '1'; }
  });

  it('серв без признака, но Korvex знает об обслуживании (файл MAINTENANCE): ошибка «не дозвонились» — тоже ожидание; без файла — ошибка', async () => {
    const f = path.join(dir, 'MAINTENANCE');
    process.env.KX_UPSTREAM_RETRY = '0'; process.env.KX_MAINT_PAUSE_MS = '20'; process.env.KX_AGENT_TOOLS = '0'; process.env.KX_MAINT_FILE = f;
    try {
      const n1 = reqs.length;
      const s1 = submit(mkThread('ua', 'БезФайла'), 'без файла [hint]');
      expect((await J.waitJob(s1.jobId)!).status).toBe('error');
      expect(reqs.length - n1).toBe(1);
      fs.writeFileSync(f, '');
      const n0 = reqs.length;
      const s = submit(mkThread('ua', 'СФайлом'), 'с файлом [hint]');
      expect((await J.waitJob(s.jobId)!).status).toBe('done');
      expect(reqs.length - n0).toBe(3);
      expect(stepsOf(s.assistantMessageId).some((x) => x.title.startsWith('Модель обновлялась'))).toBe(true);
    } finally { fs.rmSync(f, { force: true }); process.env.KX_MAINT_FILE = ''; delete process.env.KX_MAINT_PAUSE_MS; process.env.KX_AGENT_TOOLS = '1'; }
  });

  it('кадр шлюза upstream_cut — как обрыв: выданное стирается, ход повторяется (обычный ход и раунд агента); без повторов — «Ответ оборвался», не сырой текст', async () => {
    process.env.KX_UPSTREAM_RETRY = '4'; process.env.KX_RETRY_PAUSE_MS = '30';
    try {
      for (const tools of ['0', '1']) {
        process.env.KX_AGENT_TOOLS = tools;
        const s = submit(mkThread('ua', 'ШлюзОбрыв' + tools), tools === '1' ? 'x [shimcut][tc:test_sleep {"ms":5}]' : 'обычный [shimcut]');
        const r = await J.waitJob(s.jobId)!;
        expect(r.status).toBe('done');
        expect(msg(s.assistantMessageId).content).not.toContain('Обрывок');
        expect(stepsOf(s.assistantMessageId).find((x) => x.title.startsWith('Модель прервалась, повторяю'))?.status).toBe('ok');
      }
      process.env.KX_UPSTREAM_RETRY = '0'; process.env.KX_AGENT_TOOLS = '0';
      const s2 = submit(mkThread('ua', 'ШлюзОбрывБезПовтора'), 'обычный2 [shimcut]');
      expect((await J.waitJob(s2.jobId)!).status).toBe('error');
      const meta = msg(s2.assistantMessageId).meta as { errorUser?: string; error?: string };
      expect(meta.errorUser).toMatch(/^Ответ оборвался/);
      expect(meta.error).toContain('stream was cut');
    } finally { process.env.KX_UPSTREAM_RETRY = '0'; delete process.env.KX_RETRY_PAUSE_MS; process.env.KX_AGENT_TOOLS = '1'; }
  });

  it('обычный ход без инструментов (KX_AGENT_TOOLS выкл.) тоже повторяется, пока ничего не пришло', async () => {
    process.env.KX_UPSTREAM_RETRY = '4'; process.env.KX_RETRY_PAUSE_MS = '30'; process.env.KX_AGENT_TOOLS = '0';
    try {
      const s = submit(mkThread('ua', 'ПовторЧат'), 'обычный [flaky]');
      const r = await J.waitJob(s.jobId)!;
      expect(r.status).toBe('done');
      expect(msg(s.assistantMessageId).content).toContain('Рабочее место: обычный');
    } finally { process.env.KX_UPSTREAM_RETRY = '0'; delete process.env.KX_RETRY_PAUSE_MS; process.env.KX_AGENT_TOOLS = '1'; }
  });
});

describe('инструменты чатов, облака и папок', () => {
  it('chat_read — без подтверждения (свои данные; и в папке, и вне её); поиск по сообщениям чата', async () => {
    const f = (await import('@/lib/folders')).createFolder('ua', 'Склад');
    const a = mkThread('ua', 'Склад: приход', { folderId: f.id });
    addTurn(a, 'Сколько было на складе на 1 октября?', 'На 1 октября на складе было 1 240 тонн.');
    addTurn(a, 'А на 1 ноября?', 'План — 980 тонн.');
    const me = mkThread('ua', 'Рабочий', { folderId: f.id });
    const s = submit(me, `найди [tc:chat_read {"chat":"Склад: приход","query":"1 октября"}]`);
    await J.waitJob(s.jobId);
    expect(stepsOf(s.assistantMessageId)[0]).toMatchObject({ status: 'ok', title: 'Читает чат «Склад: приход»' });
    expect(msg(s.assistantMessageId).content).toContain('1 240 тонн');
    const out = mkThread('ua', 'Чужая папка');
    const s2 = submit(out, `найди [tc:chat_read {"chat":"Склад: приход"}]`);
    await J.waitJob(s2.jobId);
    expect(stepsOf(s2.assistantMessageId)[0]).toMatchObject({ status: 'ok' });
    expect(stepsOf(s2.assistantMessageId)[0].ask).toBeUndefined();
    expect(msg(s2.assistantMessageId).content).toContain('980 тонн');
  });

  it('«этот чат» — чат хода: files_list {"chat":"этот"} смотрит свои файлы', async () => {
    const me = mkThread('ua', 'Свои файлы');
    db.insert(schema.files).values({ id: randomUUID(), userId: 'ua', threadId: me, name: 'мой.txt', mime: 'text/plain', size: 3, sha256: 'm', text: 'abc', createdAt: now() }).run();
    const s = submit(me, '[tc:files_list {"chat":"этот"}]');
    await J.waitJob(s.jobId);
    expect(stepsOf(s.assistantMessageId)[0]).toMatchObject({ status: 'ok', title: 'Смотрит файлы чата «Свои файлы»' });
    expect(msg(s.assistantMessageId).content).toContain('мой.txt');
  });

  it('chat_list с поиском (FTS) находит чат по сообщению', async () => {
    const a = mkThread('ua', 'Разное');
    addTurn(a, 'Запомни: код склада ПРИЗМА-7', 'Запомнил код.');
    const s = submit(mkThread('ua', 'Поиск'), 'где код? [tc:chat_list {"query":"ПРИЗМА-7"}]');
    await J.waitJob(s.jobId);
    expect(msg(s.assistantMessageId).content).toContain('«Разное»');
  });

  it('agent_message: вопрос в чат той же папки, ответ агента того чата возвращается; журнал agent_msgs; шаг kind agent', async () => {
    const f = (await import('@/lib/folders')).createFolder('ua', 'Запуск-тест');
    const rep = mkThread('ua', 'Отчёт', { folderId: f.id });
    const me = mkThread('ua', 'Координатор', { folderId: f.id });
    const s = submit(me, 'спроси [tc:agent_message {"chat":"Отчёт","message":"файл готов?"}]');
    const r = await J.waitJob(s.jobId)!;
    expect(r.status).toBe('done');
    const st = stepsOf(s.assistantMessageId)[0];
    expect(st).toMatchObject({ kind: 'agent', status: 'ok', title: 'Спрашивает чат «Отчёт»', agent: { state: 'answered' } });
    expect(st.agent!.answer).toContain('Ответ агента: файл готов?');
    expect(msg(s.assistantMessageId).content).toContain('Ответ агента чата «Отчёт»');
    const inRep = db.select().from(schema.messages).where(eq(schema.messages.threadId, rep)).all();
    expect(inRep.find((m) => m.role === 'user')!.content).toContain('[Вопрос от агента чата «Координатор»] файл готов?');
    expect(inRep.find((m) => m.role === 'user')!.meta).toMatchObject({ from: { threadId: me, kind: 'agent', depth: 1 } });
    const log = db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.fromThread, me)).all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'ask', toThread: rep, status: 'answered', userId: 'ua' });
  });

  it('chat_send — всегда с подтверждением; после «Разрешить» в том чате запускается ответ его агента', async () => {
    const other = mkThread('ua', 'Заметки');
    const s = submit(mkThread('ua', 'Отправитель'), 'напиши [tc:chat_send {"chat":"Заметки","text":"купить кабель"}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'wait_user');
    expect(J.liveOfMessage(s.assistantMessageId)!.steps![0].ask).toMatchObject({ text: 'Написать в чат «Заметки»: «купить кабель»?' });
    J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ua', 'allow');
    await J.waitJob(s.jobId);
    await until(() => db.select().from(schema.messages).where(eq(schema.messages.threadId, other)).all().some((m) => m.role === 'assistant' && m.content.includes('Ответ без инструментов')));
    const um = db.select().from(schema.messages).where(eq(schema.messages.threadId, other)).all().find((m) => m.role === 'user')!;
    expect(um.content).toBe('купить кабель');
  });

  it('agent_message вне папки: только после «Разрешить»; «Отменить» — в тот чат ничего не пишется', async () => {
    const other = mkThread('ua', 'Чужая тема');
    const s = submit(mkThread('ua', 'Спрашивающий'), 'спроси [tc:agent_message {"chat":"Чужая тема","message":"как дела?"}]');
    await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'wait_user');
    expect(db.select().from(schema.messages).where(eq(schema.messages.threadId, other)).all()).toHaveLength(0);
    J.answerJobStep(s.jobId, J.liveOfMessage(s.assistantMessageId)!.steps![0].id, 'ua', 'deny');
    await J.waitJob(s.jobId);
    expect(stepsOf(s.assistantMessageId)[0].status).toBe('denied');
    expect(db.select().from(schema.messages).where(eq(schema.messages.threadId, other)).all()).toHaveLength(0);
    expect(db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.toThread, other)).all()).toHaveLength(0);
  });

  it('пинг-понг агентов ограничен: B не может спросить A, пока A ждёт B (чат занят); предел писем за ход и между парой чатов', async () => {
    const f = (await import('@/lib/folders')).createFolder('ua', 'Пинг');
    const a = mkThread('ua', 'Пинг А', { folderId: f.id });
    const b = mkThread('ua', 'Понг Б', { folderId: f.id });
    const s = submit(a, `[tc:agent_message {"chat":"Понг Б","message":"[tc:agent_message {\\"chat\\":\\"Пинг А\\",\\"message\\":\\"а ты?\\"}]"}]`);
    const r = await J.waitJob(s.jobId)!;
    expect(r.status).toBe('done');
    const bAns = db.select().from(schema.messages).where(eq(schema.messages.threadId, b)).all().find((m) => m.role === 'assistant');
    if (!bAns) throw new Error('нет ответа B: ' + msg(s.assistantMessageId).content + JSON.stringify(stepsOf(s.assistantMessageId)));
    expect(bAns.content).toContain('сейчас идёт ответ');
    expect(db.select().from(schema.messages).where(eq(schema.messages.threadId, a)).all().filter((m) => m.role === 'user')).toHaveLength(1);
    const many = Array.from({ length: 9 }, (_, i) => `[tc:agent_message {"chat":"Понг Б","message":"вопрос ${i}"}]`).join('');
    const s2 = submit(mkThread('ua', 'Много', { folderId: f.id }), many);
    await J.waitJob(s2.jobId);
    const st = stepsOf(s2.assistantMessageId).filter((x) => x.kind === 'agent');
    expect(st).toHaveLength(9);
    expect(st.slice(0, 8).every((x) => x.status === 'ok')).toBe(true);
    expect(st[8].status).toBe('err');
    expect(msg(s2.assistantMessageId).content).toContain('Предел переписки в одном ходе');
  });

  it('почта агентов: чат занят — вопрос в очереди, отправитель сразу получает «ответ придёт позже»; ответ приходит в чат отправителя отдельным сообщением', async () => {
    const f = (await import('@/lib/folders')).createFolder('ua', 'Почта');
    const b = mkThread('ua', 'Занятой', { folderId: f.id });
    const a = mkThread('ua', 'Спрашивает', { folderId: f.id });
    const busy = submit(b, 'долго [tc:test_sleep {"ms":1500}]');
    await until(() => J.liveOfMessage(busy.assistantMessageId)?.status === 'running');
    const t0 = Date.now();
    const s = submit(a, '[tc:agent_message {"chat":"Занятой","message":"когда отгрузка?"}]');
    await J.waitJob(s.jobId);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(stepsOf(s.assistantMessageId)[0]).toMatchObject({ status: 'ok', agent: { state: 'queued' } });
    expect(msg(s.assistantMessageId).content).toContain('придёт в этот чат отдельным сообщением');
    await until(() => db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.fromThread, a)).get()?.status === 'delivered', 15_000);
    const inB = db.select().from(schema.messages).where(eq(schema.messages.threadId, b)).all().filter((m) => m.role === 'user').map((m) => m.content);
    expect(inB.at(-1)).toContain('[Вопрос от агента чата «Спрашивает»] когда отгрузка?');
    await until(() => !J.activeJobs('ua').some((j) => j.threadId === a), 15_000);
    const inA = db.select().from(schema.messages).where(eq(schema.messages.threadId, a)).all().sort((x, y) => x.seq - y.seq);
    const reply = inA.filter((m) => m.role === 'user').at(-1)!;
    expect(reply.content).toContain('[Ответ агента чата «Занятой» на вопрос «когда отгрузка?»]');
    expect(reply.content).toContain('Ответ агента: когда отгрузка?');
    expect(reply.meta).toMatchObject({ from: { threadId: b, kind: 'reply', depth: 1 } });
    expect(inA.at(-1)!.role).toBe('assistant');
  }, 30_000);

  it('почта агентов: не дождались за wait_seconds — ответ приходит позже отдельным сообщением', async () => {
    const f = (await import('@/lib/folders')).createFolder('ua', 'Почта2');
    const b = mkThread('ua', 'Медленный', { folderId: f.id });
    const a = mkThread('ua', 'Нетерпеливый', { folderId: f.id });
    const s = submit(a, '[tc:agent_message {"chat":"Медленный","message":"длинный разбор [delay:1800]","wait_seconds":5}]');
    await J.waitJob(s.jobId);
    expect(stepsOf(s.assistantMessageId)[0]).toMatchObject({ status: 'ok', agent: { state: 'queued' } });
    expect(msg(s.assistantMessageId).content).toContain('ещё отвечает');
    await until(() => db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.fromThread, a)).get()?.status === 'delivered', 25_000);
    const reply = db.select().from(schema.messages).where(eq(schema.messages.threadId, a)).all().filter((m) => m.role === 'user').sort((x, y) => x.seq - y.seq).at(-1)!;
    expect(reply.content).toContain('[Ответ агента чата «Медленный»');
    await until(() => !J.activeJobs('ua').some((j) => j.threadId === a || j.threadId === b), 15_000);
  }, 45_000);

  it('глубина переписки: ход, вызванный агентом (depth 2), не видит agent_message / chat_send', async () => {
    const t = mkThread('ua', 'Глубина');
    const n0 = reqs.length;
    const s = J.submitTurn({ thread: thread(t), userId: 'ua', mode: 'send', text: '[tc:chat_list {}]', modelId: 'alpha', levelId: 'low', userMeta: { from: { threadId: 'x', title: 'x', kind: 'agent', depth: 2 } } });
    await J.waitJob(s.jobId);
    expect(reqs[n0].tools).not.toContain('agent_message');
    expect(reqs[n0].tools).not.toContain('chat_send');
  });

  it('chat_move: «перенеси эти три чата в папку „Запуск“» — папка создаётся, чаты переносятся, событие folders', async () => {
    const ids = ['Альфа', 'Бета', 'Гамма'].map((n) => mkThread('ua', `Запуск ${n}`));
    const got: string[] = [];
    const sub = Bus.subscribe('ua', null, (e) => got.push(e.t));
    const s = submit(mkThread('ua', 'Сортировка'), `перенеси [tc:chat_move {"chats":["Запуск Альфа","${ids[1]}","Запуск Гамма"],"folder":"Запуск"}]`);
    await J.waitJob(s.jobId);
    sub.unsubscribe();
    const f = (await import('@/lib/folders')).findFolderByName('ua', 'запуск')!;
    expect(f).toBeTruthy();
    for (const id of ids) expect(thread(id).folderId).toBe(f.id);
    expect(got).toContain('folders');
    expect(stepsOf(s.assistantMessageId)[0].title).toBe('Переносит 3 чата в папку «Запуск»');
  });

  it('инструкция папки уходит в системный промпт хода (и обычного пути)', async () => {
    const F = await import('@/lib/folders');
    const f = F.createFolder('ua', 'С инструкцией', 'Отвечай только цифрами.');
    const t = mkThread('ua', 'В папке', { folderId: f.id });
    const n0 = reqs.length;
    const s = submit(t, 'сколько [tc:model_work {"task":"x"}]');
    await J.waitJob(s.jobId);
    expect(String(reqs[n0].messages[0].content)).toContain('Инструкция папки «С инструкцией»');
    expect(String(reqs[n0 + 1].messages[0].content)).toContain('Отвечай только цифрами.');
  });

  it('files_list + files_get: файл модели из другого чата — текст и копия в этот чат (ссылка /api/files)', async () => {
    const rep = mkThread('ua', 'Отчёт файлы');
    const tok = 'ab'.repeat(16);
    fs.mkdirSync(path.join(OUT, tok));
    fs.writeFileSync(path.join(OUT, tok, 'итог.csv'), 'скважина;дебит\nС-1;120\n');
    db.insert(schema.outFiles).values({ token: tok, userId: 'ua', threadId: rep, messageId: null, source: 'job', createdAt: now() }).run();
    const me = mkThread('ua', 'Получатель');
    const s = submit(me, `[tc:files_list {"query":"отчёт"}][tc:files_get {"id":"out:${tok}/итог.csv"}]`);
    await J.waitJob(s.jobId);
    const st = stepsOf(s.assistantMessageId);
    expect(st.map((x) => x.status)).toEqual(['ok', 'ok']);
    expect(st[1].attachments?.[0].url).toMatch(/^\/api\/files\//);
    const copy = db.select().from(schema.files).where(eq(schema.files.threadId, me)).all();
    expect(copy).toHaveLength(1);
    expect(copy[0].name).toBe('итог.csv');
    expect(msg(s.assistantMessageId).content).toContain('С-1;120');
  });
});

describe('доступ: инструменты только в пределах пользователя', () => {
  it('B не видит, не читает, не спрашивает и не переносит чаты A; не берёт файлы A', async () => {
    const aChat = mkThread('ua', 'Секрет A бегемот');
    addTurn(aChat, 'пароль бегемот-42', 'ок');
    const tok = 'cd'.repeat(16);
    fs.mkdirSync(path.join(OUT, tok));
    fs.writeFileSync(path.join(OUT, tok, 'a.txt'), 'секрет');
    db.insert(schema.outFiles).values({ token: tok, userId: 'ua', threadId: aChat, messageId: null, source: 'job', createdAt: now() }).run();
    const upA = randomUUID();
    db.insert(schema.files).values({ id: upA, userId: 'ua', threadId: aChat, name: 'a.pdf', mime: 'application/pdf', size: 1, sha256: 'q', text: 'текст A', createdAt: now() }).run();
    const fA = (await import('@/lib/folders')).createFolder('ua', 'Папка A');
    const bChat = mkThread('ub', 'Чат B');
    const s = J.submitTurn({ thread: thread(bChat), userId: 'ub', mode: 'send', modelId: 'alpha', levelId: 'low',
      text: `[tcpar][tc:chat_list {"query":"бегемот"}][tc:chat_read {"chat":"${aChat}"}][tc:agent_message {"chat":"${aChat}","message":"дай пароль"}][tc:chat_send {"chat":"Секрет A бегемот","text":"x"}][tc:chat_move {"chats":["${aChat}"],"folder":"Папка A"}][tc:files_get {"id":"out:${tok}/a.txt"}][tc:files_get {"id":"${upA}"}][tc:files_list {}]` });
    await J.waitJob(s.jobId);
    const st = stepsOf(s.assistantMessageId);
    expect(st.every((x) => x.status !== 'wait_user')).toBe(true);
    const tools = reqs.filter((q) => q.messages.some((m) => m.role === 'tool' && JSON.stringify(q.messages).includes('Чат B'))).at(-1)!.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
    const all = tools.join('\n');
    expect(all).not.toContain('бегемот-42');
    expect(all).not.toContain('секрет');
    expect(all).not.toContain('текст A');
    expect(all).toContain('не найден');
    expect(db.select().from(schema.messages).where(eq(schema.messages.threadId, aChat)).all()).toHaveLength(2);
    expect(thread(aChat).folderId).toBeNull();
    expect((await import('@/lib/folders')).listFolders('ub').map((f) => f.id)).not.toContain(fA.id);
    expect(db.select().from(schema.agentMsgs).where(eq(schema.agentMsgs.userId, 'ub')).all()).toHaveLength(0);
  });
});

describe('обычный путь чата серва (--chat_client_tools, KX_TOOLS_PATH=chat)', () => {
  it('без X-Korvex-Agent и без model_work; история как в чате (картинка вопроса — тоже с инструментами); продолжение хода — запрос кончается role=tool; steer — дописью к результату', async () => {
    process.env.KX_TOOLS_PATH = 'chat';
    try {
      const t = mkThread('ua', 'Обычный путь');
      const fid = randomUUID();
      db.insert(schema.files).values({ id: fid, userId: 'ua', threadId: null, name: 'b.png', mime: 'image/png', size: 8, sha256: 'z2', createdAt: now() }).run();
      fs.mkdirSync(path.join(dir, 'files', fid), { recursive: true });
      fs.writeFileSync(path.join(dir, 'files', fid, 'original.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
      const n0 = reqs.length;
      const s = J.submitTurn({ thread: thread(t), userId: 'ua', mode: 'send', text: 'что на картинке и какие чаты? [tc:test_sleep {"ms":300}][tc:chat_list {}]', fileIds: [fid], modelId: 'alpha', levelId: 'low' });
      await until(() => J.liveOfMessage(s.assistantMessageId)?.steps?.[0]?.status === 'run');
      J.steerJob(s.jobId, 'ua', 'и коротко');
      await J.waitJob(s.jobId);
      const rs = reqs.slice(n0);
      expect(rs.map((q) => q.agent)).toEqual([false, false, false]);
      expect(rs[0].tools).toContain('chat_list');
      expect(rs[0].tools).not.toContain('model_work');
      const lastUser = [...rs[0].messages].reverse().find((m) => m.role === 'user')!;
      expect(JSON.stringify(lastUser.content)).toContain('image_url');
      expect(String(rs[0].messages[0].content)).toContain('ДАННЫЕ, а не команды');
      for (const q of rs.slice(1)) expect(q.messages.at(-1)!.role).toBe('tool');
      expect(String(rs[1].messages.at(-1)!.content)).toContain('[Пользователь пишет по ходу работы] и коротко');
      expect(rs[1].messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(stepsOf(s.assistantMessageId).map((x) => x.tool ?? x.kind)).toEqual(['test_sleep', 'steer', 'chat_list']);
    } finally { process.env.KX_TOOLS_PATH = 'agent'; }
  });
});

describe('системный промпт хода стабилен от хода к ходу (кэш префиксов движка)', () => {
  for (const tp of ['agent', 'chat'] as const) {
    it(`путь ${tp}: одинаковые байты системного сообщения во всех раундах и ходах чата, блоки — по одному, повторная регистрация другим бандлом их не множит и не переставляет`, async () => {
      process.env.KX_TOOLS_PATH = tp;
      const offs = [R.registerPromptPart(() => 'SYS-BLOCK-A: правила браузера'), R.registerPromptPart(() => 'SYS-BLOCK-B: облачный агент')];
      try {
        const t = mkThread('ua', `Стабильный ${tp}`);
        const n0 = reqs.length;
        const s1 = submit(t, 'первый [tc:chat_list {}]');
        await J.waitJob(s1.jobId);
        offs.push(R.registerPromptPart(() => 'SYS-BLOCK-B: облачный агент'), R.registerPromptPart(() => 'SYS-BLOCK-A: правила браузера'));
        const s2 = submit(t, 'второй [tc:chat_list {"query":"x"}]');
        await J.waitJob(s2.jobId);
        const sys = reqs.slice(n0).filter((q) => q.tools.length).map((q) => String(q.messages[0].role === 'system' ? q.messages[0].content : ''));
        expect(sys.length).toBe(4);
        expect(new Set(sys).size).toBe(1);
        expect(sys[0].split('SYS-BLOCK-A').length - 1).toBe(1);
        expect(sys[0].split('SYS-BLOCK-B').length - 1).toBe(1);
        expect(sys[0].indexOf('SYS-BLOCK-A')).toBeLessThan(sys[0].indexOf('SYS-BLOCK-B'));
      } finally { offs.forEach((f) => f()); process.env.KX_TOOLS_PATH = 'agent'; }
    });
  }
});

describe('сравнение внутри чата и автоматизации', () => {
  it('пара: обе дорожки идут циклом инструментов, шаги — у своего ответа', async () => {
    const t = mkThread('ua', 'Пара');
    const p = J.submitPair({ thread: thread(t), userId: 'ua', mode: 'send', text: '[tc:test_sleep {"ms":5}]', pair: { a: { modelId: 'alpha', levelId: 'low' }, b: { modelId: 'alpha', levelId: 'xhigh' } } });
    for (const id of p.jobIds) await J.waitJob(id);
    expect(stepsOf(p.a)).toHaveLength(1);
    expect(stepsOf(p.b)).toHaveLength(1);
    expect(msg(p.a).content).toContain('Готово: поспал');
  });

  it('автоматизация (runTurn): ход идёт с инструментами', async () => {
    const t = mkThread('ua', 'Авто');
    const r = await J.runTurn({ thread: thread(t), userId: 'ua', mode: 'send', text: 'сводка [tc:chat_list {}]', modelId: 'alpha', levelId: 'low', userMeta: { auto: { id: 'a1', name: 'Утро' } } });
    expect(r.content).toContain('Готово:');
    expect(stepsOf(r.assistantId)).toHaveLength(1);
  });

  it('выключено (KX_AGENT_TOOLS не 1) — как раньше: без X-Korvex-Agent и без tools', async () => {
    process.env.KX_AGENT_TOOLS = '0';
    try {
      const n0 = reqs.length;
      const s = submit(mkThread('ua', 'Выкл'), 'привет [tc:chat_list {}]');
      await J.waitJob(s.jobId);
      expect(reqs.slice(n0).map((q) => [q.agent, q.tools.length])).toEqual([[false, 0]]);
    } finally { process.env.KX_AGENT_TOOLS = '1'; }
  });
});
