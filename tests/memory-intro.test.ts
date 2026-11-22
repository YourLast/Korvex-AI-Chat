import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

const jar = { token: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.token ? { name: n, value: jar.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const dir = tmpData();
process.env.KX_MEMORY_RESCAN_MS = '600000';
process.env.KX_SERVE_FORGET = '0';
type Seen = { sys: string; q: string; body: Record<string, unknown>; msgs: { role: string; content: string }[] };
const gateway: Seen[] = [];
const warms: Record<string, unknown>[] = [];
let answer = 'Привет! Как к тебе обращаться?';
let delayMs = 0;
let judge: (user: string) => { op: string; section: string; key?: string; text: string }[] = () => [];
let srv: http.Server, eng: http.Server;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tok = randomBytes(32).toString('base64url');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      if (req.url?.endsWith('/x/chat/warm')) { warms.push(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"warmed":[{}]}'); return; }
      const msgs = body.messages as { role: string; content: string }[];
      const sys = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const last = [...msgs].reverse().find((m) => m.role === 'user');
      gateway.push({ sys, q: typeof last?.content === 'string' ? last.content : '', body, msgs });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
      ch({ role: 'assistant', content: '' });
      const text = answer;
      const half = Math.floor(text.length / 2);
      ch({ content: text.slice(0, half) });
      setTimeout(() => { ch({ content: text.slice(half) }); ch({}, 'stop'); res.end('data: [DONE]\n\n'); }, delayMs);
    });
  });
  eng = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      const content = String((body.messages as { content: string }[])[1].content);
      const user = (content.match(/\nПользователь: (.*)/) ?? [])[1] ?? '';
      const ops = judge(user).map((o) => ({ id: '', key: 'none', sure: true, sensitive: 'no', asked: false, ...o }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ops }) } }] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => eng.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  process.env.KX_MEMORY_ENGINE_URL = `http://127.0.0.1:${(eng.address() as AddressInfo).port}/v1`;
  process.env.KX_TITLE_ENGINE_URL = '';
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  for (const m of cfg.models) { m.baseUrl = base; delete m.extract; if (m.systemPromptFile) m.systemPromptFile = path.join(dir, 'sys.txt'); }
  fs.writeFileSync(path.join(dir, 'sys.txt'), 'Ты — Alpha. Пояс пользователя: {{CURRENT_TIMEZONE}}.');
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const { getDb, schema } = await import('@/lib/db');
  const now = Date.now();
  const u = (id: string, name: string, createdAt = 1) => ({ id, email: `${id}@t`, name, passwordHash: 'x', role: 'user' as const, createdAt, lastTz: 'Europe/Berlin' });
  getDb().insert(schema.users).values([u('b1', 'U1'), u('b2', 'U2'), u('b3', 'U3'), u('b4', 'U4'), u('b5', 'U5', now - 864e5), u('b6', 'U6', now - 25 * 864e5)]).run();
  getDb().insert(schema.sessions).values({ id: sha(tok), userId: 'b4', createdAt: now, expiresAt: now + 864e5 }).run();
  (await import('@/lib/curator')).registerCurator();
});
afterAll(() => { srv.close(); eng.close(); });

async function idle(userId: string) {
  const { activeJobs } = await import('@/lib/jobs');
  for (let i = 0; i < 600 && activeJobs(userId).length; i++) await new Promise((r) => setTimeout(r, 10));
  await (await import('@/lib/curator')).curatorIdle();
}
const roles = (v: { messages: { role: string }[] }) => v.messages.map((m) => m.role).join(',');

describe('знакомство — постоянный разговор', () => {
  it('один чат на человека: закрыл и открыл (сразу, через час, через день) — та же история; вопрос висит — ничего не генерируем', async () => {
    const I = await import('@/lib/intro');
    answer = 'Привет! Как к тебе обращаться?';
    const o = I.openIntro('b1', { timezone: 'Europe/Berlin' });
    expect(o.started).toBe(true);
    await idle('b1');
    const t = I.introThread('b1')!;
    const n = gateway.length;
    for (const dt of [0, 11 * 60_000, 3600_000, 864e5]) {
      const v = I.openIntro('b1', { now: Date.now() + dt });
      expect([v.started, v.waiting, v.threadId, roles(v)]).toEqual([false, true, t.id, 'assistant']);
    }
    await idle('b1');
    expect(gateway.length).toBe(n);
    I.sendIntro('b1', 'Мила'); await idle('b1');
    const v = I.openIntro('b1', { now: Date.now() + 864e5 });
    expect([v.started, v.waiting, roles(v)]).toEqual([false, true, 'assistant,user,assistant']);
    const { getDb, schema } = await import('@/lib/db');
    const { eq, and } = await import('drizzle-orm');
    expect(getDb().select().from(schema.threads).where(and(eq(schema.threads.userId, 'b1'), eq(schema.threads.temporary, 2))).all().length).toBe(1);
  });

  it('закрыл посреди ответа — открыл: виден идущий ответ (без новой задачи); ответ оборвался — догенерировать', async () => {
    const I = await import('@/lib/intro');
    const J = await import('@/lib/jobs');
    answer = 'Привет! Чем ты занимаешься по работе?';
    delayMs = 400;
    I.openIntro('b2');
    await new Promise((r) => setTimeout(r, 150));
    const v = I.openIntro('b2');
    expect(v.started).toBe(false);
    expect(v.busy).toBe(true);
    const a = v.messages.at(-1)!;
    expect(a.streaming).toBe(true);
    expect(a.content).toBe(answer.slice(0, Math.floor(answer.length / 2)));
    await idle('b2'); delayMs = 0;
    const s = I.sendIntro('b2', 'я дизайнер'); await idle('b2');
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    getDb().update(schema.messages).set({ content: 'Отлично! А что', meta: { status: 'error', error: 'Прервано перезапуском сервера' } }).where(eq(schema.messages.id, s.assistantMessageId)).run();
    answer = 'Отлично! А что тебе интересно в свободное время?';
    const n = gateway.length;
    const o = I.openIntro('b2');
    expect(o.started).toBe(true);
    await idle('b2');
    expect(gateway.length).toBe(n + 1);
    expect(gateway.at(-1)!.q.startsWith('я дизайнер')).toBe(true);
    const v2 = I.introView('b2');
    expect(roles(v2)).toBe('assistant,user,assistant');
    expect(v2.messages.at(-1)!.content).toBe(answer);
    expect(J.jobOfThread(v2.threadId!)).toBeNull();
  });

  it('v4 (знакомство v2, 22.11): ядро — 3 вопроса (участок, режимы и программы, формат с «ты»/«вы»), хвост — до 2 уточнений, если отвечает охотно; конец — итог «Спасибо, запомнила: …»', async () => {
    const M = await import('@/lib/memory');
    const rows = (over: Partial<Record<string, string>>) => [
      ['who', 'name', 'Зовут Мила'], ['work', 'role', 'Дизайнер'], ['interests', null, 'велосипед'], ['style', 'length', 'Коротко'],
      ['style', 'address', 'На «ты»'], ['style', 'tone', 'С юмором'], ['who', 'city', 'Казань'],
    ].filter(([, k]) => !(k && over[k] === 'skip')).map(([section, key, text], i) => ({ id: `x${i}`, userId: 'z', section, key, text, origin: 'auto', sure: 1, threadId: null, messageId: null, createdAt: 1, updatedAt: 1 }));
    const Q = ['С какими программами и форматами ты работаешь?'];
    const all = M.introNote(rows({}) as never, new Set(), Q, 'ru', ['Figma и PDF']);
    expect(all).toContain('Знакомство закончено');
    expect(all).toContain('«Спасибо, запомнила: <2–3 главных факта его же словами>. Буду отвечать так. Поправить можно в «Памяти».»');
    expect(all).not.toContain('Ещё не знаешь');
    const left = M.introNote([] as never, new Set(), []);
    const todo = left.split('Ещё не знаешь (по порядку): ')[1];
    expect(todo.indexOf('чем он занимается')).toBeLessThan(todo.indexOf('с какими программами'));
    expect(todo.indexOf('с какими программами')).toBeLessThan(todo.indexOf('как ему удобнее получать ответы'));
    expect(todo).toContain('на «ты» или на «вы»');
    expect(todo).not.toMatch(/пример его документа|город|интересно|юмор/);
    expect(left).toContain('Осталось 3 вопроса вместе с этим');
    expect(M.introNote([] as never, new Set(), ['Чем вы занимаетесь?', 'С какими программами и форматами вы работаете?'], 'ru', ['юрист', 'Word'])).toContain('Это последний вопрос');
    expect(M.INTRO_RULES).toContain('вопроса три и это полминуты');
    expect(M.INTRO_RULES).toContain('«Спасибо, запомнила:');
    expect(M.INTRO_RULES).toContain('пока заметка называет темы, знакомство не заканчивай');
    expect(M.INTRO_RULES).toContain('вопросом не заканчивай');
    expect(M.INTRO_RULES).toContain('без канцелярита');
    expect(M.introNote(rows({}) as never, new Set(), Q, 'ru', [], true)).toContain('знакомство уже закончено');
    const acc = [{ id: 'a1', userId: 'z', section: 'work', key: 'role', text: 'Главный бухгалтер на аутсорсе', origin: 'auto', sure: 1, threadId: null, messageId: null, createdAt: 1, updatedAt: 1 }];
    const an = M.introNote(acc as never, new Set(), []);
    expect(an).toContain('на каких режимах его компании и в какой программе');
    expect(an).toContain('УСН 6 %, 1С:Бухгалтерия 3.0');
    const accQ = ['На каких режимах ваши компании и в какой программе вы ведёте учёт?', 'Как вам удобнее получать ответы: коротко или подробно? На «ты» или на «вы»?'];
    expect(M.introProgress(acc as never, accQ.slice(0, 1), ['УСН и 1С'])).toEqual({ left: 1, tail: false, end: false });
    expect(M.introNote(acc as never, new Set(), accQ, 'ru', ['да', 'нет'])).toContain('Знакомство закончено');
    const eager = ['веду учёт пятнадцати ООО на упрощёнке, всё в 1С', 'коротко с итогом в первой строке, на вы'];
    const t1 = M.introNote(acc as never, new Set(), accQ, 'ru', eager);
    expect(t1).toContain('одно уточнение по его же словам');
    expect(t1).toContain('Главное уже есть');
    expect(M.introProgress(acc as never, accQ, eager)).toEqual({ left: 0, tail: true, end: false });
    expect(M.introProgress(acc as never, ['Вы сказали «15 ООО» — все на УСН 6 %?', ...accQ], ['да, все 6 %', ...eager])).toEqual({ left: 0, tail: true, end: false });
    expect(M.introProgress(acc as never, ['А торговля — опт или розница?', 'Вы сказали «15 ООО» — все на УСН 6 %?', ...accQ], ['опт', 'да, все 6 %', ...eager]).end).toBe(true);
    expect(M.isAccountant([] as never, ['я бухгалтер, веду пять ООО'])).toBe(true);
    expect(M.isAccountant([] as never, ['я программист'])).toBe(false);
    expect(M.introNote([] as never, new Set(), [])).toContain('Это начало знакомства: поздоровайся одной короткой фразой, скажи, что вопроса три и это полминуты');
    expect(M.introNote([] as never, new Set(), ['Привет! Чем вы занимаетесь?'])).not.toContain('Это начало знакомства');
  });

  it('бар ввода шторки — тот же /api/chat: модель и уровень знакомства, ответ сразу в память; правки и сравнения нет', async () => {
    const I = await import('@/lib/intro');
    const { POST } = await import('@/app/api/chat/route');
    jar.token = tok;
    const H = { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' };
    answer = 'Привет! Как к тебе обращаться?';
    I.openIntro('b4'); await idle('b4');
    const t = I.introThread('b4')!;
    judge = (u) => (u === 'Аня' ? [{ op: 'add', section: 'who', key: 'name', text: 'Зовут Аня' }] : []);
    answer = 'Приятно, Аня! Чем занимаешься?';
    const r = await POST(new Request('http://localhost/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ threadId: t.id, text: 'Аня', modelId: 'beta', levelId: 'off', timezone: 'Europe/Berlin' }) }));
    expect(r.status).toBe(202);
    await idle('b4');
    const { getDb, schema } = await import('@/lib/db');
    const job = getDb().select().from(schema.jobs).all().filter((j) => j.threadId === t.id).at(-1)!;
    expect([job.modelId, job.levelId]).toEqual(['alpha', 'xhigh']);
    const v = I.introView('b4');
    expect(v.messages.find((m) => m.role === 'user')!.memUpd?.map((x) => x.text)).toEqual(['Зовут Аня']);
    const bad = await POST(new Request('http://localhost/api/chat', { method: 'POST', headers: H, body: JSON.stringify({ threadId: t.id, text: 'x', mode: 'edit', editId: v.messages[1].id, modelId: 'alpha', levelId: 'xhigh' }) }));
    expect(bad.status).toBe(400);
    const { loadThread } = await import('@/lib/load');
    expect(loadThread('b4', t.id, { turns: 8 })!.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    judge = () => [];
    jar.token = '';
  });
});

describe('стаж в Korvex — строкой в конце системной части', () => {
  it('новичок и давний — словами, без точных чисел; меняется раз в день; чаты, начатые сегодня, — завтра', async () => {
    const M = await import('@/lib/memory');
    const { getDb, schema } = await import('@/lib/db');
    const now = Date.now();
    const th = (userId: string, at: number, temporary = 0) => ({ id: randomUUID(), userId, title: 'x', modelId: 'alpha', effort: 'off', temporary, createdAt: at, updatedAt: at });
    getDb().insert(schema.threads).values([th('b5', now - 864e5), th('b5', now - 864e5 + 1000)]).run();
    const n = M.tenureText(M.tenureOf('b5', now))!;
    expect(n).toMatch(/^Стаж в Korvex: новый — второй день \(зарегистрирован \d{1,2} [а-я]+ \d{4}\), несколько чатов, знакомства ещё не было\./);
    expect(n).not.toContain('Познакомиться');
    expect(n).toContain('что умеет Korvex');
    expect(n).toContain('Стаж не упоминай');
    expect(n).not.toMatch(/\d+\s*(дн|дня|день|чат)/);
    getDb().insert(schema.threads).values([...Array.from({ length: 40 }, (_, i) => th('b6', now - 20 * 864e5 + i * 1000)), th('b6', now - 864e5, 1), th('b6', now - 864e5, 2)]).run();
    const o = M.tenureText(M.tenureOf('b6', now))!;
    expect(o).toMatch(/^Стаж в Korvex: с нами 3 недели \(зарегистрирован [^)]+\), десятки чатов, знакомства ещё не было\./);
    expect(o).toContain('сразу к делу');
    expect(o).not.toContain('что умеет Korvex');
    expect(o).not.toContain('Познакомиться');
    expect(o).not.toMatch(/\d+\s*(дн|дня|день|чат)/);
    const tz = 'Europe/Berlin';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    const dayStart = now - ((+parts.hour * 60 + +parts.minute) * 60_000) - (now % 60_000);
    const noon = dayStart + 12 * 3600_000, evening = dayStart + 23 * 3600_000;
    const a = M.tenureText(M.tenureOf('b5', noon));
    getDb().insert(schema.threads).values(Array.from({ length: 10 }, (_, i) => th('b5', dayStart + 12 * 3600_000 + 60_000 + i))).run();
    expect(M.tenureText(M.tenureOf('b5', evening))).toBe(a);
    const next = M.tenureText(M.tenureOf('b5', dayStart + 24 * 3600_000 + 3600_000))!;
    expect(next).not.toBe(a);
    expect(next).toContain('новый — третий день');
    expect(next).toContain('десятки чатов');
    expect([1, 2, 7, 8, 14, 27, 40, 70, 200, 400, 900].map(M.stayWords)).toEqual(['новый — первый день', 'новый — второй день', 'новый — седьмой день', 'с нами неделю', 'с нами 2 недели', 'с нами 3 недели', 'с нами месяц', 'с нами 2 месяца', 'с нами 6 месяцев', 'с нами больше года', 'с нами больше 2 лет']);
    expect([0, 3, 12, 150, 2000].map(M.chatsWords)).toEqual(['чатов ещё не было', 'несколько чатов', 'десятки чатов', 'сотни чатов', 'тысячи чатов']);
    M.setMemoryMeta('b5', { introDone: now });
    const d = M.tenureText(M.tenureOf('b5', now))!;
    expect(d).toContain('знакомство уже было');
    expect(d).not.toContain('Познакомиться');
    const inIntro = M.tenureText(M.tenureOf('b5', now), { intro: true })!;
    expect(inIntro).not.toMatch(/знакомств/);
    expect(inIntro).not.toContain('что умеет Korvex');
  });

  it('в обычном чате и в знакомстве — последней строкой системной части; во временном чате и при выключенной памяти — нет', async () => {
    const M = await import('@/lib/memory');
    const chat = M.memoryBlockInfo('b6', { id: 'x', temporary: 0 }).text;
    expect(chat.trimEnd().split('\n').at(-1)).toMatch(/^Стаж в Korvex: с нами 3 недели/);
    const intro = M.memoryBlockInfo('b6', { id: 'y', temporary: 2, createdAt: Date.now() }).text;
    expect(intro.trimEnd().split('\n').at(-1)).toMatch(/^Стаж в Korvex: с нами 3 недели[^.]*десятки чатов\./);
    expect(M.memoryBlockInfo('b6', { id: 'z', temporary: 1 }).text).not.toContain('Стаж');
    M.setPrefs('b6', { on: false });
    expect(M.memoryBlockInfo('b6', { id: 'x', temporary: 0 }).text).not.toContain('Стаж');
    M.setPrefs('b6', { on: true });
  });
});
