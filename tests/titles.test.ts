import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
process.env.KX_TITLE_BACKFILL = '0';
process.env.KX_TITLE_BUSY_MS = '150';
const active: Record<string, number> = {};
const titleReqs: { model: string; chat: string; effort: unknown; ctk: unknown; maxTokens: unknown; sys: string; user: string; aborted: boolean }[] = [];
let titleDelay = 30, titleReply = (_u: string) => 'Настройка Zed Code.';
let gwMode = 'idle', titleFail: 'none' | '503' | 'cut' = 'none', gateBase = '';
let srv: http.Server;
const tag = (s: string, k: string, d: number) => { const m = new RegExp(`\\[${k}:(\\d+)\\]`).exec(s); return m ? Number(m[1]) : d; };

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, eq: typeof import('drizzle-orm').eq;
let J: typeof import('@/lib/jobs'), B: typeof import('@/lib/bus'), TT: typeof import('@/lib/titles'), ST: typeof import('@/lib/status');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/gw/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ mode: gwMode, cap: 1 })); }
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b) as { model: string; stream?: boolean; reasoning_effort?: string; chat_template_kwargs?: unknown; max_tokens?: number; messages: { role: string; content: string }[] };
      active[body.model] = (active[body.model] ?? 0) + 1;
      let closed = false;
      res.on('close', () => { closed = true; });
      const done = () => { active[body.model]--; };
      if (body.stream === false) {
        const u = body.messages.find((m) => m.role === 'user')?.content ?? '';
        const rec = { model: body.model, chat: String(req.headers['x-korvex-chat-id'] ?? ''), effort: body.reasoning_effort, ctk: body.chat_template_kwargs, maxTokens: body.max_tokens, sys: body.messages[0].content, user: u, aborted: false };
        titleReqs.push(rec);
        if (titleFail === '503') { titleFail = 'none'; done(); res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"yielded","type":"yielded"}}'); }
        if (titleFail === 'cut') { titleFail = 'none'; done(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"choices":[{"index":0,"mess'); return void setTimeout(() => res.socket?.destroy(), 20); }
        let fin = false;
        res.on('close', () => { if (!fin) { fin = true; rec.aborted = true; done(); } });
        await new Promise((r) => setTimeout(r, titleDelay));
        if (fin) return;
        fin = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: titleReply(u) }, finish_reason: 'stop' }] }));
        return done();
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const ch = (delta: unknown) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      ch({ role: 'assistant', content: '' });
      const n = tag(String(last), 'chunks', 3), delay = tag(String(last), 'delay', 10);
      for (let i = 0; i < n && !closed; i++) { ch({ content: `ответ ${i}. ` }); await new Promise((r) => setTimeout(r, delay)); }
      if (!closed) {
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      }
      done();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  process.env.KX_TITLE_ENGINE_URL = gateBase = base;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  J = await import('@/lib/jobs');
  B = await import('@/lib/bus');
  TT = await import('@/lib/titles');
  ST = await import('@/lib/status');
  TT.registerTitles();
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

let n = 0;
const newThread = (o: { title?: string; modelId?: string; groupId?: string; side?: string } = {}) => {
  const id = `t${++n}`;
  db.insert(schema.threads).values({ id, userId: 'u', title: o.title ?? 'Новый чат', modelId: o.modelId ?? 'alpha', effort: 'off', groupId: o.groupId ?? null, side: o.side ?? null, createdAt: 1, updatedAt: 1 }).run();
  return id;
};
const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const say = async (t: string, text: string, modelId = 'alpha') => { const s = J.submitTurn({ thread: thread(t), userId: 'u', mode: 'send', text, modelId, levelId: 'off' }); await J.waitJob(s.jobId); return s; };
const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };

describe('чистка ответа модели', () => {
  it.each([
    ['«Настройка Zed Code».', 'Настройка Zed Code'],
    ['Название: "Сравнение Qwerty 3.6 в Google"', 'Сравнение Qwerty 3.6 в Google'],
    ['<think>думаю</think>\nКурсы валют на утро 💱', 'Курсы валют на утро'],
    ['настройка редактора', 'Настройка редактора'],
    ['**Отчёт по продажам**\nвторая строка', 'Отчёт по продажам'],
    ['один два три четыре пять шесть семь восемь девять', 'Один два три четыре пять шесть'],
  ])('%s -> %s', (raw, out) => expect(TT.cleanTitle(raw)).toBe(out));
  it.each(['', '   ', 'ОСТАВИТЬ', 'оставить.', '😀', 'Извините, я не могу', '...'])('%j -> null', (raw) => expect(TT.cleanTitle(raw)).toBeNull());
  it('автоматическое название: «Новый чат» или обрезанное первое сообщение', () => {
    const long = 'Po gugli koroce model Qwerty 3.6 35b A3B - ctobi ona rabotala bystree na moej karte';
    expect(TT.isAutoTitle('Новый чат', null)).toBe(true);
    expect(TT.isAutoTitle('Po gugli koroce model Qwerty 3.6 35b A3B - ctobi oon…'.replace('oon', 'ona'), long)).toBe(true);
    expect(TT.isAutoTitle('Мой проект', long)).toBe(false);
  });
  it('в запрос — только начало первых реплик, обрезанное', () => {
    const msgs = TT.titleMessages({ user: 'а'.repeat(2000), answer: 'б '.repeat(1000), files: ['отчёт.xlsx'] });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content.length).toBeLessThan(1000);
    expect(msgs[1].content).toContain('Приложены файлы: отчёт.xlsx');
  });
});

describe('название после первого ответа', () => {
  it('фоном, через вход к движку без размышления, короткий max_tokens; событие thread всем устройствам', async () => {
    const got: Record<string, unknown>[] = [];
    const sub = B.subscribe('u', null, (e) => got.push(e));
    const t = newThread();
    await say(t, 'ya normalno nastroil to? Korvex AI v Zed Code');
    expect(thread(t).title).toBe('ya normalno nastroil to? Korvex AI v Zed Code');
    await until(() => thread(t).title === 'Настройка Zed Code');
    sub.unsubscribe();
    const r = titleReqs.at(-1)!;
    expect(r).toMatchObject({ model: 'alpha-engine', chat: '', ctk: { enable_thinking: false }, maxTokens: 32 });
    expect(r.effort).toBeUndefined();
    expect(r.user).toContain('ya normalno nastroil');
    expect(r.user).toContain('Ассистент: ответ 0.');
    expect(thread(t).titleGen).toBe(1);
    expect(got.some((e) => e.t === 'thread' && e.title === 'Настройка Zed Code')).toBe(true);
    expect(thread(t).updatedAt).toBeGreaterThan(1);
  });
  it('переименованное вручную не трогаем (и во время запроса тоже)', async () => {
    const t = newThread();
    const before = titleReqs.length;
    titleDelay = 300;
    await say(t, 'Сколько будет 2+2?');
    await until(() => titleReqs.length > before);
    db.update(schema.threads).set({ title: 'Мой расчёт', titleManual: 1 }).where(eq(schema.threads.id, t)).run();
    await new Promise((r) => setTimeout(r, 450));
    expect(thread(t).title).toBe('Мой расчёт');
    titleDelay = 30;
    const t2 = newThread({ title: 'Своё имя' });
    db.update(schema.threads).set({ titleManual: 1 }).where(eq(schema.threads.id, t2)).run();
    const k = titleReqs.length;
    await say(t2, 'Привет');
    await new Promise((r) => setTimeout(r, 200));
    expect(titleReqs.length).toBe(k);
    expect(thread(t2).title).toBe('Своё имя');
  });
  it('сравнение: одно название на обе ветки', async () => {
    const a = newThread({ groupId: 'g1', side: 'a', modelId: 'alpha' }), b = newThread({ groupId: 'g1', side: 'b', modelId: 'beta' });
    titleReply = () => 'Умножение 17 на 23';
    await Promise.all([say(a, 'Сколько будет 17 умножить на 23?', 'alpha'), say(b, 'Сколько будет 17 умножить на 23?', 'beta')]);
    await until(() => thread(a).title === 'Умножение 17 на 23' && thread(b).title === 'Умножение 17 на 23');
    expect(titleReqs.filter((r) => r.user.includes('17 умножить на 23'))).toHaveLength(1);
  });
  it('вход уступил людям (503 или оборванный ответ) — повтор позже, не ошибка', async () => {
    const st0 = TT.titleStats();
    for (const kind of ['503', 'cut'] as const) {
      titleReply = () => `Повтор после ${kind}`;
      titleFail = kind;
      const t = newThread();
      const k = titleReqs.length;
      await say(t, `вопрос с отказом входа ${kind}`);
      await until(() => thread(t).title === `Повтор после ${kind}`, 6000);
      expect(titleReqs.length - k).toBe(2);
    }
    const st1 = TT.titleStats();
    expect(st1.busy - st0.busy).toBe(2);
    expect(st1.fail).toBe(st0.fail);
  });
  it('вход недоступен (отказ соединения) — пауза и повтор; запасной модели нет', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    process.env.KX_TITLE_ENGINE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.KX_TITLE_DOWN_MS = '300';
    titleReply = () => 'После паузы';
    const st0 = TT.titleStats();
    const t = newThread({ modelId: 'beta' });
    const k = titleReqs.length;
    await say(t, 'вопрос, когда вход лежит', 'beta');
    await until(() => TT.titleStats().busy > st0.busy);
    expect(titleReqs.length).toBe(k);
    expect(thread(t).title).toBe('вопрос, когда вход лежит');
    process.env.KX_TITLE_ENGINE_URL = gateBase;
    await until(() => thread(t).title === 'После паузы', 6000);
    expect(titleReqs.slice(k)).toHaveLength(1);
    expect(titleReqs.at(-1)).toMatchObject({ model: 'alpha-engine', ctk: { enable_thinking: false } });
    expect(TT.titleStats().fail).toBe(st0.fail);
    delete process.env.KX_TITLE_DOWN_MS;
  }, 15000);
  it('пустой адрес входа — названия выключены', () => {
    process.env.KX_TITLE_ENGINE_URL = '';
    expect(TT.gateUrl()).toBe('');
    process.env.KX_TITLE_ENGINE_URL = gateBase;
  });
  it('после 4-го хода — одна проверка смены темы; ОСТАВИТЬ — название прежнее', async () => {
    titleReply = () => 'Тема А';
    const t = newThread();
    await say(t, 'про тему А');
    await until(() => thread(t).title === 'Тема А');
    titleReply = (u) => (u.includes('Сейчас чат называется: Тема А') ? 'ОСТАВИТЬ' : 'Не то');
    for (const q of ['ещё А', 'и ещё А']) await say(t, q);
    expect(thread(t).titleGen).toBe(1);
    const k = titleReqs.length;
    await say(t, 'последний про А');
    await until(() => thread(t).titleGen === 2);
    expect(thread(t).title).toBe('Тема А');
    expect(titleReqs.slice(k)[0].user).toContain('Позже пользователь писал');
    await say(t, 'пятый');
    await new Promise((r) => setTimeout(r, 150));
    expect(titleReqs.length).toBe(k + 1);
  });
  it('старые чаты: обрезанное первое сообщение -> название, чужие имена и автоматизации не трогаем', async () => {
    titleReply = () => 'Старый чат';
    const t = newThread();
    await say(t, 'старый вопрос без названия');
    await until(() => thread(t).titleGen === 1);
    db.update(schema.threads).set({ title: 'старый вопрос без названия', titleGen: 0 }).where(eq(schema.threads.id, t)).run();
    const named = newThread({ title: 'Курсы валют на утро' });
    await say(named, 'Курс доллара на сегодня');
    db.insert(schema.automations).values({ id: 'a1', userId: 'u', name: 'Курсы валют на утро', prompt: 'x', modelId: 'alpha', levelId: 'off', cron: '0 9 * * *', timezone: 'UTC', targetThreadId: named, createdAt: 1 }).run();
    db.update(schema.threads).set({ titleGen: 0 }).where(eq(schema.threads.id, named)).run();
    const k = titleReqs.length;
    TT._test.T().failed.clear();
    gwMode = 'busy';
    TT._test.scanOld();
    await new Promise((r) => setTimeout(r, 400));
    await TT._test.tick();
    expect(titleReqs.length).toBe(k);
    expect(thread(t).title).toBe('старый вопрос без названия');
    gwMode = 'idle';
    await new Promise((r) => setTimeout(r, 2100));
    await TT._test.tick();
    await until(() => thread(t).title === 'Старый чат');
    await new Promise((r) => setTimeout(r, 150));
    expect(thread(named).title).toBe('Курсы валют на утро');
    expect(titleReqs.slice(k).map((r) => r.user.includes('старый вопрос без названия'))).toEqual([true]);
  });
});
