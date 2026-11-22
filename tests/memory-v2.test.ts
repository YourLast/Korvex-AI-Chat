import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpData } from './helpers';

const dir = tmpData();
process.env.KX_MEMORY_RESCAN_MS = '600000';
type Seen = { sys: string; q: string; body: Record<string, unknown> };
const gateway: Seen[] = [];
const engine: { user: string; body: Record<string, unknown> }[] = [];
type Op = { op: string; id?: string; section: string; key?: string; text: string; sure?: boolean; sensitive?: string; asked?: boolean };
let judge: (user: string, req: string) => Op[] = () => [];
let answer = 'Хорошо.';
let srv: http.Server, eng: http.Server;

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      const sys = body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: string }) => m.content).join('\n');
      const last = [...body.messages].reverse().find((m: { role: string }) => m.role === 'user');
      gateway.push({ sys, q: typeof last?.content === 'string' ? last.content : '', body });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
      ch({ role: 'assistant', content: '' }); ch({ content: answer }); ch({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  eng = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      const content = String((body.messages as { content: string }[])[1].content);
      const user = (content.match(/\nПользователь: (.*)/) ?? [])[1] ?? '';
      engine.push({ user, body });
      const ops = judge(user, content).map((o) => ({ id: '', key: 'none', sure: true, sensitive: 'no', asked: false, ...o }));
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
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const { getDb, schema } = await import('@/lib/db');
  const u = (id: string, name: string, email = `${id}@t`) => ({ id, email, name, passwordHash: 'x', role: 'user' as const, createdAt: 1 });
  getDb().insert(schema.users).values([u('a1', 'Ivan'), u('a2', 'U2'), u('a3', 'Anna'), u('a4', 'Mila'), u('a5', 'ivan.ts', 'ivan.ts@t'), u('a6', 'U6'), u('a7', 'U7')]).run();
  (await import('@/lib/curator')).registerCurator();
});
afterAll(() => { srv.close(); eng.close(); });

async function thread(userId: string, temporary = 0) {
  const { getDb, schema } = await import('@/lib/db');
  const id = randomUUID();
  getDb().insert(schema.threads).values({ id, userId, title: 'Новый чат', modelId: 'alpha', effort: 'off', temporary, createdAt: Date.now(), updatedAt: Date.now() }).run();
  return getDb().select().from(schema.threads).all().find((t) => t.id === id)!;
}
const fresh = async (id: string) => { const { getDb, schema } = await import('@/lib/db'); return getDb().select().from(schema.threads).all().find((t) => t.id === id)!; };
async function idle(userId: string) {
  const { activeJobs } = await import('@/lib/jobs');
  for (let i = 0; i < 400 && activeJobs(userId).length; i++) await new Promise((r) => setTimeout(r, 10));
  await (await import('@/lib/curator')).curatorIdle();
}
async function turn(userId: string, th: { id: string }, text: string) {
  const { submitTurn } = await import('@/lib/jobs');
  const s = submitTurn({ thread: await fresh(th.id), userId, mode: 'send', text, modelId: 'alpha', levelId: 'off' });
  await idle(userId);
  return s;
}
const memOf = async (userId: string) => (await import('@/lib/memory')).listMemory(userId);
const metaOf = async (id: string) => { const { getDb, schema } = await import('@/lib/db'); return getDb().select().from(schema.messages).all().find((m) => m.id === id)?.meta as Record<string, unknown>; };

describe('имя: профиль — слабый источник, спросить — один раз; «бюджет любопытства»', () => {
  it('профиль «Ivan» — «в профиле указано», не «зовут»; модель спросила имя — больше не просим; личный вопрос в чате — второй нет', async () => {
    const M = await import('@/lib/memory');
    expect(M.looksLikeName('Ivan')).toBe(true);
    expect(M.looksLikeName('Пётр Смирнов')).toBe(true);
    for (const bad of ['ivan.ts', 'e2e-abc', 'admin', 'user42', 'a@b.c', 'E2E Админ', 'x']) expect(M.looksLikeName(bad)).toBe(false);
    expect(M.looksLikeName('petrsmirnov', 'petrsmirnov@x.org')).toBe(false);
    const th = await thread('a1');
    answer = 'Привет! Чем помочь? Кстати, как тебя зовут?';
    await turn('a1', th, 'привет');
    const s1 = gateway.at(-1)!.sys;
    expect(s1).toContain('В профиле аккаунта указано имя «Ivan»');
    expect(s1).not.toMatch(/Кто: Зовут Ivan/);
    expect(s1).toContain('можно один раз между делом спросить, как его зовут');
    expect(s1).toContain('Можно задать один короткий дружеский вопрос');
    expect(M.memoryMeta('a1').askedName).toBeGreaterThan(0);
    answer = 'Хорошо.';
    await turn('a1', th, 'расскажи про логистику');
    const s2 = gateway.at(-1)!.sys;
    expect(s2).not.toContain('спросить, как его зовут');
    expect(s2).toContain('В этом разговоре ты уже задал личный вопрос — больше не спрашивай.');
    await turn('a1', await thread('a1'), 'новый чат');
    expect(gateway.at(-1)!.sys).toContain('Можно задать один короткий дружеский вопрос');
    await turn('a5', await thread('a5'), 'привет');
    expect(gateway.at(-1)!.sys).not.toContain('В профиле аккаунта указано имя');
    expect(M.asksPersonal('Отлично! А чем ты занимаешься?')).toBe(true);
    expect(M.asksPersonal('Как к вам лучше обращаться?')).toBe(true);
    expect(M.asksPersonal('Хочешь, расскажу подробнее?')).toBe(false);
    expect(M.asksPersonal('Сделать таблицей? Или списком?')).toBe(false);
  });
});

describe('извлечение (подставной движок решает, код проверяет)', () => {
  it('имя (подпись), город с обновлением, стиль; запрос — с профилем и пометкой догадок', async () => {
    judge = (u) => {
      if (u.includes('— Иван')) return [{ op: 'add', section: 'who', key: 'name', text: 'Зовут Иван' }];
      if (u.includes('в Москве')) return [{ op: 'add', section: 'who', key: 'city', text: 'Живёт в Москве' }];
      if (u.includes('Казань')) return [{ op: 'add', section: 'who', key: 'city', text: 'Живёт в Казани' }];
      if (u.includes('короче')) return [{ op: 'add', section: 'style', key: 'length', text: 'Отвечать коротко, без воды' }];
      return [];
    };
    const th = await thread('a2');
    const s = await turn('a2', th, 'сделай план на неделю, спасибо!\n— Иван');
    expect((await memOf('a2')).map((r) => r.text)).toContain('Зовут Иван');
    expect(((await metaOf(s.assistantMessageId)).memUpd as { text: string }[])[0].text).toBe('Зовут Иван');
    await turn('a2', th, 'я сейчас в Москве живу');
    await turn('a2', await thread('a2'), 'кстати, переехал в Казань');
    const city = (await memOf('a2')).filter((r) => r.key === 'city');
    expect(city.map((r) => r.text)).toEqual(['Живёт в Казани']);
    await turn('a2', th, 'отвечай короче, без воды');
    const req = engine.at(-1)!.body as { messages: { content: string }[]; response_format: { json_schema: { schema: { properties: { ops: { items: { required: string[] } } } } } } };
    expect(req.messages[0].content).toContain('факты о человеке прячутся в банальностях');
    expect(req.response_format.json_schema.schema.properties.ops.items.required).toContain('sure');
    const t2 = await thread('a2');
    await turn('a2', t2, 'что нового?');
    expect(gateway.at(-1)!.sys).toMatch(/Кто: Зовут Иван; Живёт в Казани\./);
    expect(gateway.at(-1)!.sys).toMatch(/Как общаться: Отвечать коротко, без воды/);
    expect(gateway.at(-1)!.sys).toContain('Длина ответа: он просил коротко — отвечай в 3–6 предложениях');
    expect(gateway.at(-1)!.sys).toContain('Пользуйся памятью как хороший друг');
  });

  it('интерес по вопросу — «Возможно»; повтор в том же чате — всё ещё догадка; в другом — точно; без повтора 60 дней — уходит', async () => {
    const M = await import('@/lib/memory');
    judge = (u) => (/бород|стрич/i.test(u) ? [{ op: 'add', section: 'interests', text: 'Возможно, стрижки и уход за бородой', sure: false }]
      : /Лейкерс|НБА/.test(u) ? [{ op: 'add', section: 'interests', text: 'баскетбол, НБА', sure: false }] : []);
    const th = await thread('a6');
    const s = await turn('a6', th, 'как правильно подстричь бороду машинкой?');
    let r = (await memOf('a6')).find((x) => x.section === 'interests')!;
    expect(r.text).toBe('Стрижки и уход за бородой');
    expect(r.sure).toBe(0);
    const items = (await metaOf(s.assistantMessageId)).memUpd as { maybe?: boolean; section?: string }[];
    expect(items[0].maybe).toBe(true);
    const { memUpdText } = await import('@/components/MemUpd');
    expect(memUpdText(items as never)).toBe('Похоже, тебе интересно: стрижки и уход за…');
    await turn('a6', th, 'а триммер какой взять для стрижки?');
    r = (await memOf('a6')).find((x) => x.section === 'interests')!;
    expect(r.sure).toBe(0);
    expect(gateway.at(-1)!.sys).toMatch(/Возможно \(догадки.*\): Стрижки и уход за бородой\./);
    expect(gateway.at(-1)!.sys).not.toMatch(/Интересы: Стрижки/);
    await turn('a6', await thread('a6'), 'снова про стрижку бороды');
    r = (await memOf('a6')).find((x) => x.section === 'interests')!;
    expect(r.sure).toBe(1);
    await turn('a6', await thread('a6'), 'кто выиграл, Лейкерс или Бостон?');
    expect((await memOf('a6')).find((x) => x.text.startsWith('Баскетбол'))?.sure).toBe(0);
    expect(M.sweepMaybe('a6', Date.now() + 59 * 864e5)).toBe(0);
    expect(M.sweepMaybe('a6', Date.now() + 61 * 864e5)).toBe(1);
    expect((await memOf('a6')).map((x) => x.text)).toEqual(['Стрижки и уход за бородой']);
  });

  it('чувствительное по догадке — никогда (даже если модель не пометила); разовая справка — не интерес; «не расспрашивай» — без вопросов', async () => {
    judge = (u) => (/прыщ/.test(u) ? [{ op: 'add', section: 'interests', text: 'уход за кожей, прыщи', sure: false, sensitive: 'health' }]
      : /диет/.test(u) ? [{ op: 'add', section: 'interests', text: 'диеты для похудения', sure: false }]
      : /кредит/.test(u) ? [{ op: 'add', section: 'facts', text: 'Думает взять кредит', sure: false }]
      : /девушк/.test(u) ? [{ op: 'add', section: 'facts', text: 'Есть девушка', sure: false }]
      : /курс/.test(u) ? [{ op: 'add', section: 'interests', text: 'курс доллара', sure: false }]
      : /погода/.test(u) ? [{ op: 'add', section: 'interests', text: 'погода в Париже', sure: false }]
      : /расспрашивай/.test(u) ? [{ op: 'add', section: 'style', key: 'curious', text: 'Не расспрашивать о личном' }] : []);
    const th = await thread('a7');
    for (const q of ['подскажи крем от прыщей', 'какую диету выбрать', 'как взять кредит на машину', 'что подарить девушке', 'какой курс доллара', 'какая погода в Париже']) await turn('a7', th, q);
    const facts = async () => (await memOf('a7')).filter((r) => r.key !== 'writes').map((r) => r.text);
    expect(await facts()).toEqual([]);
    judge = () => [{ op: 'add', section: 'facts', text: 'Аллергия на орехи', sensitive: 'health', asked: true }];
    await turn('a7', th, 'запомни: у меня аллергия на орехи');
    expect(await facts()).toEqual(['Аллергия на орехи']);
    judge = (u) => (/расспрашивай/.test(u) ? [{ op: 'add', section: 'style', key: 'curious', text: 'Не расспрашивать о личном' }] : []);
    await turn('a7', th, 'и не расспрашивай меня о жизни');
    await turn('a7', await thread('a7'), 'привет');
    expect(gateway.at(-1)!.sys).toContain('Он просил не расспрашивать: личных вопросов не задавай.');
    expect(gateway.at(-1)!.sys).not.toContain('Можно задать один короткий');
  });

  it('как человек пишет — по его сообщениям: «Пишет: …» в «Как общаться», без пометки «Запомнил»', async () => {
    const M = await import('@/lib/memory');
    expect(M.writingProfile(['глянь код плиз', 'норм, а щас?', 'сделай короче', 'ок', 'а ты можешь таблицей?'])).toBe('Пишет: очень коротко, без эмодзи, на «ты», часто с маленькой буквы, разговорно, по-русски');
    expect(M.writingProfile(['Hello! 😊 Could you help me with my resume please?', 'Thanks 🙏 that is great', 'Can you make it shorter? 😅', 'Perfect, thank you so much!', 'One more thing about the cover letter'])).toMatch(/^Пишет: коротко, часто с эмодзи, .*по-английски$/);
    expect(M.writingProfile(['a', 'b'])).toBeNull();
    judge = () => [];
    const th = await thread('a2');
    for (const q of ['глянь код плиз', 'норм, а щас?', 'сделай короче', 'ок', 'а ты можешь таблицей?']) await turn('a2', th, q);
    const w = (await memOf('a2')).find((r) => r.key === 'writes');
    expect(w?.section).toBe('style');
    expect(w?.text).toMatch(/^Пишет: /);
    M.updateMemory('a2', w!.id, { text: 'Пишет коротко, любит сленг', origin: 'manual' });
    await turn('a2', th, 'ещё вопрос');
    expect((await memOf('a2')).find((r) => r.key === 'writes')?.text).toBe('Пишет коротко, любит сленг');
  });
});

describe('временный чат: память не читается и не пишется', () => {
  it('ни записей, ни имени профиля, ни вопроса об имени; куратор не зовётся; инструменты памяти выключены; сообщения не считаются', async () => {
    const M = await import('@/lib/memory');
    M.addMemory('a3', { section: 'who', key: 'city', text: 'Живёт в Нише', origin: 'manual' });
    const tmp = await thread('a3', M.TEMP);
    const n0 = engine.length;
    judge = () => [{ op: 'add', section: 'who', key: 'name', text: 'Зовут Анна' }];
    answer = 'Как тебя зовут?';
    for (const q of ['меня зовут Анна, я из Ниша', 'отвечай короче', 'люблю теннис', 'а ещё баскетбол', 'и футбол']) await turn('a3', tmp, q);
    answer = 'Хорошо.';
    const sys = gateway.at(-1)!.sys;
    expect(sys).toContain('Это временный чат');
    for (const w of ['Ниш', 'Anna', 'Правила Korvex', 'Память о пользователе', 'спросить', 'личный вопрос']) expect(sys).not.toContain(w);
    expect(engine.length).toBe(n0);
    expect((await memOf('a3')).map((r) => r.text)).toEqual(['Живёт в Нише']);
    expect(M.memoryMeta('a3').askedName).toBeUndefined();
    expect(M.recentUserTexts('a3')).toEqual([]);
    await import('@/lib/tools/memory');
    const { toolsFor, promptParts } = await import('@/lib/tools/registry');
    const pc = { userId: 'a3', threadId: tmp.id, folderId: null, kind: 'chat' as const, modelId: 'alpha', depth: 0 };
    expect(toolsFor(pc).filter((t) => t.name.startsWith('memory_'))).toEqual([]);
    expect(promptParts(pc).join('\n')).not.toContain('Ниш');
    const { considerIntro, rescanRecent } = await import('@/lib/curator');
    expect(considerIntro('a3', tmp.id, 'x', 'y')).toBe(false);
    rescanRecent(); await idle('a3');
    expect(engine.length).toBe(n0);
  });
});

describe('знакомство (служебный чат)', () => {
  it('модель начинает первой на Alpha xhigh без инструментов; вопросы по неизвестному; ответ — в память сразу; нет в списке и поиске; продолжение', async () => {
    const M = await import('@/lib/memory');
    const I = await import('@/lib/intro');
    const { getDb, schema } = await import('@/lib/db');
    M.setPrefs('a4', { auto: false });
    answer = 'Привет! Давай познакомимся. Как к тебе обращаться?';
    const o = I.openIntro('a4');
    expect(o.started).toBe(true);
    await idle('a4');
    const t = I.introThread('a4')!;
    expect(t.temporary).toBe(M.INTRO);
    const job = getDb().select().from(schema.jobs).all().find((j) => j.threadId === t.id)!;
    expect([job.modelId, job.levelId]).toEqual(['alpha', 'xhigh']);
    const first = gateway.at(-1)!;
    expect(first.body.tools).toBeUndefined();
    expect(first.q.startsWith('Давай познакомимся.\n\n[Служебная заметка Korvex')).toBe(true);
    expect(first.sys).toContain('## Знакомство');
    expect(first.q).toMatch(/Ещё не знаешь \(по порядку\): чем он занимается/);
    expect(first.sys).not.toContain('Ещё не знаешь');
    expect(first.sys).not.toContain('Можно задать один короткий');
    let v = I.introView('a4');
    expect(v.messages.map((m) => m.role)).toEqual(['assistant']);
    judge = (u) => (u === 'Мила' ? [{ op: 'add', section: 'who', key: 'name', text: 'Зовут Мила' }] : u.includes('дизайнер') ? [{ op: 'add', section: 'work', key: 'role', text: 'Дизайнер интерфейсов' }] : []);
    answer = 'Приятно, Мила! А чем занимаешься?';
    const s = I.sendIntro('a4', 'Мила');
    await idle('a4');
    const um = await metaOf(s.userMessageId!);
    expect((um.memUpd as { text: string }[]).map((x) => x.text)).toEqual(['Зовут Мила']);
    expect(engine.find((e) => e.user === 'Мила')!.body.messages).toBeDefined();
    expect(String((engine.find((e) => e.user === 'Мила')!.body.messages as { content: string }[])[1].content)).toContain('Ассистент (перед этим): Привет! Давай познакомимся. Как к тебе обращаться?');
    I.sendIntro('a4', 'я дизайнер интерфейсов'); await idle('a4');
    expect((await memOf('a4')).map((r) => r.text).sort()).toEqual(['Дизайнер интерфейсов', 'Зовут Мила']);
    v = I.introView('a4');
    expect(v.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(v.messages[1].memUpd?.map((x) => x.text)).toEqual(['Зовут Мила']);
    const { threadList } = await import('@/lib/threadlist');
    expect(threadList('a4').map((x) => x.id)).not.toContain(t.id);
    const { searchChats } = await import('@/lib/search');
    expect(JSON.stringify(searchChats('a4', 'дизайнер'))).not.toContain(t.id);
    const n0 = gateway.length;
    expect(I.openIntro('a4').started).toBe(false);
    const o2 = I.openIntro('a4', { now: Date.now() + 11 * 60_000 });
    expect([o2.started, o2.waiting, o2.threadId]).toEqual([false, true, t.id]);
    await idle('a4');
    expect(gateway.length).toBe(n0);
    I.sendIntro('a4', 'потом скажу'); await idle('a4');
    const note = gateway.at(-1)!.q.split('[Служебная заметка Korvex')[1];
    expect(note).toContain('Узнала в этом разговоре: Зовут Мила; Дизайнер интерфейсов.');
    expect(note).not.toMatch(/Ещё не знаешь[^.]*как к нему обращаться/);
    expect(note).not.toMatch(/Ещё не знаешь[^.]*чем занимается/);
    expect(note).toContain('с какими программами и форматами');
    expect(I.introThread('a4')!.titleManual).toBe(1);
    expect(engine.some((e) => e.user.includes('познакомимся'))).toBe(false);
    M.setPrefs('a4', { auto: true });
    answer = 'Хорошо.';
  });
});

describe('свежая память — сразу в следующем ходе и в новом чате; размер под контролем', () => {
  it('запись появилась — следующий ход того же чата и новый чат её видят; 60 записей — блок в бюджете, догадки уходят первыми', async () => {
    const M = await import('@/lib/memory');
    const th = await thread('a2');
    await turn('a2', th, 'раз');
    expect(gateway.at(-1)!.sys).not.toContain('Любит джаз');
    M.addMemory('a2', { section: 'interests', text: 'Любит джаз', origin: 'manual' });
    await turn('a2', th, 'два');
    expect(gateway.at(-1)!.sys).toMatch(/Интересы: Любит джаз\./);
    await turn('a2', await thread('a2'), 'три');
    expect(gateway.at(-1)!.sys).toMatch(/Интересы: Любит джаз\./);
    const sys = gateway.at(-1)!.sys;
    expect(sys.indexOf('## Правила Korvex')).toBeLessThan(sys.indexOf('## Память о пользователе'));
    expect(sys.trimEnd().endsWith('(«вы с нами N дней» — нельзя).')).toBe(true);
    expect(sys.indexOf('сначала ответь на его вопрос.')).toBeLessThan(sys.indexOf('Стаж в Korvex:'));
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, userId: 'x', section: i < 10 ? 'who' : i < 40 ? 'interests' : 'facts', key: null, text: `Запись номер ${i} про что-то довольно длинное и подробное`, origin: 'auto', sure: i % 3 === 0 ? 0 : 1, threadId: null, messageId: null, createdAt: i, updatedAt: Date.now() - i }));
    const b = M.renderBlock(rows as never, 600);
    expect(b.stats.records).toBeLessThanOrEqual(600 + 30);
    expect(b.stats.dropped).toBeGreaterThan(0);
    expect(b.text).toMatch(/Кто: Запись номер 1 /);
    expect(b.text).not.toContain('Возможно (догадки');
  });
});

describe('«Отменить» под ответом', () => {
  it('добавленное — удаляется, обновлённое — возвращается как было; пометка «Отменено»', async () => {
    const M = await import('@/lib/memory');
    const { undoMemUpd } = await import('@/lib/memoryUndo');
    M.clearMemory('a3');
    M.addMemory('a3', { section: 'who', key: 'city', text: 'Живёт в Нише', origin: 'auto' });
    judge = () => [{ op: 'add', section: 'who', key: 'city', text: 'Живёт в Казани' }, { op: 'add', section: 'interests', text: 'теннис' }];
    const s = await turn('a3', await thread('a3'), 'переехал в Казань, играю в теннис');
    expect((await memOf('a3')).map((r) => r.text).sort()).toEqual(['Живёт в Казани', 'Теннис']);
    const r = undoMemUpd('a3', s.assistantMessageId)!;
    expect(r.undone).toBe(2);
    expect((await memOf('a3')).map((x) => x.text)).toEqual(['Живёт в Нише']);
    const { memUpdText } = await import('@/components/MemUpd');
    expect(memUpdText(r.items as never)).toBe('Отменено');
    expect(undoMemUpd('a3', s.assistantMessageId)).toBeNull();
  });
});

describe('опровержение записи: «Исправил» и «Отменить»', () => {
  const mine = async () => (await memOf('a7')).filter((r) => r.key !== 'writes');
  const refOf = (req: string, word: string) => req.split('\n').find((l) => l.includes(word))!.split(' ')[0];
  it('человек поправил догадку — update по id, пометка «Исправил: …»; «Отменить» возвращает прежнюю догадку; без новых слов — delete, тоже с «Отменить»', async () => {
    const M = await import('@/lib/memory');
    const { undoMemUpd } = await import('@/lib/memoryUndo');
    const { memUpdText } = await import('@/components/MemUpd');
    M.clearMemory('a7');
    M.addMemory('a7', { section: 'work', text: 'Учится, делает проекты по базам данных', origin: 'auto', sure: false });
    judge = (_u, req) => [{ op: 'update', id: refOf(req, 'баз'), section: 'work', text: 'Учится в гимназии', sure: true }];
    const s = await turn('a7', await thread('a7'), 'я не учусь дб. а у меня такой урок в гимназии просто');
    expect((await mine()).map((r) => [r.text, r.sure])).toEqual([['Учится в гимназии', 1]]);
    const items = (await metaOf(s.assistantMessageId)).memUpd as { op: string; fix?: boolean; prev?: { text: string; sure: number } }[];
    expect(items[0]).toMatchObject({ op: 'update', fix: true, prev: { text: 'Учится, делает проекты по базам данных', sure: 0 } });
    expect(memUpdText(items as never)).toBe('Исправил: учится в гимназии');
    expect(undoMemUpd('a7', s.assistantMessageId)!.undone).toBe(1);
    expect((await mine()).map((r) => [r.text, r.sure])).toEqual([['Учится, делает проекты по базам данных', 0]]);
    judge = (_u, req) => [{ op: 'delete', id: refOf(req, 'баз'), section: 'work', text: '', asked: true }];
    const s2 = await turn('a7', await thread('a7'), 'это не так, я не учусь');
    expect(await mine()).toHaveLength(0);
    const items2 = (await metaOf(s2.assistantMessageId)).memUpd as { op: string; fix?: boolean }[];
    expect(items2[0]).toMatchObject({ op: 'delete', fix: true });
    expect(memUpdText(items2 as never)).toMatch(/^Исправил: убрал учится, делает/);
    expect(undoMemUpd('a7', s2.assistantMessageId)!.undone).toBe(1);
    expect((await mine()).map((r) => [r.text, r.sure])).toEqual([['Учится, делает проекты по базам данных', 0]]);
    judge = (_u, req) => [{ op: 'delete', id: refOf(req, 'баз'), section: 'work', text: '', asked: true }];
    await turn('a7', await thread('a7'), 'расскажи про индексы в PostgreSQL');
    expect(await mine()).toHaveLength(1);
  });
});

describe('разбор переживает перезапуск вебки', () => {
  it('ход без пометки «разобран» дочитывается при запуске; помеченный — нет', async () => {
    const C = await import('@/lib/curator');
    const { getDb, schema } = await import('@/lib/db');
    judge = () => [];
    const s = await turn('a2', await thread('a2'), 'я веду проект «Маяк»');
    expect((await metaOf(s.userMessageId!)).cur).toBe(1);
    const n0 = engine.length;
    expect(C.rescanRecent()).toBe(0);
    C._test.S().done.clear();
    const m = getDb().select().from(schema.messages).all().find((x) => x.id === s.userMessageId)!;
    getDb().update(schema.messages).set({ meta: { ...(m.meta as object), cur: undefined } }).run();
    expect(C.rescanRecent()).toBeGreaterThanOrEqual(1);
    await idle('a2');
    expect(engine.length).toBeGreaterThan(n0);
  });
});

describe('миграция 0025_memory_v2', () => {
  it('накат: sure, memory_meta, роль и компания — в «Работа и проекты»; откат: догадки и служебный чат знакомства убраны', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const { execFileSync } = await import('node:child_process');
    const d = tmpData();
    const file = path.join(d, 'korvex.db');
    const migrations = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
    const w = Object.fromEntries(journal.entries.map((e) => [e.tag, e.when]));
    expect(w['0025_memory_v2']).toBeGreaterThan(w['0024_claude_usage']);
    const before = journal.entries.filter((e) => e.tag < '0025');
    const tmpMig = path.join(d, 'mig');
    fs.mkdirSync(path.join(tmpMig, 'meta'), { recursive: true });
    for (const e of before) fs.copyFileSync(path.join(migrations, `${e.tag}.sql`), path.join(tmpMig, `${e.tag}.sql`));
    fs.writeFileSync(path.join(tmpMig, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));
    let db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: tmpMig });
    db.prepare(`insert into users (id, email, name, password_hash, role, disabled, created_at) values ('u', 'u@t', 'U', 'x', 'user', 0, 1)`).run();
    db.prepare(`insert into user_memory (id, user_id, section, key, text, origin, created_at, updated_at) values ('m1', 'u', 'who', 'role', 'Техдиректор', 'auto', 1, 1), ('m2', 'u', 'who', 'name', 'Зовут Иван', 'auto', 1, 1)`).run();
    db.close();
    db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: migrations });
    const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('user_memory')).toContain('sure');
    expect(cols('users')).toContain('memory_meta');
    expect(db.prepare(`select section, sure from user_memory where id = 'm1'`).get()).toEqual({ section: 'work', sure: 1 });
    expect(db.prepare(`select section from user_memory where id = 'm2'`).get()).toEqual({ section: 'who' });
    db.prepare(`insert into user_memory (id, user_id, section, key, text, origin, sure, created_at, updated_at) values ('m3', 'u', 'interests', null, 'Теннис', 'auto', 1, 1, 1), ('m4', 'u', 'interests', null, 'Стрижки', 'auto', 0, 1, 1)`).run();
    db.prepare(`insert into threads (id, user_id, title, model_id, effort, temporary, created_at, updated_at) values ('ti', 'u', 'Знакомство', 'alpha', 'xhigh', 2, 1, 1), ('tn', 'u', 'Чат', 'alpha', 'off', 0, 1, 1)`).run();
    db.prepare(`insert into messages (id, thread_id, seq, role, content, created_at) values ('x1', 'ti', 1, 'user', 'Давай познакомимся.', 1), ('x2', 'tn', 1, 'user', 'привет', 1)`).run();
    db.close();
    execFileSync(process.execPath, ['scripts/db-rollback.mjs', '0025_memory_v2'], { env: { ...process.env, DATA_DIR: d }, stdio: 'pipe' });
    db = new Database(file);
    expect(cols('user_memory')).not.toContain('sure');
    expect(cols('users')).not.toContain('memory_meta');
    expect(db.prepare(`select id, section from user_memory order by id`).all()).toEqual([{ id: 'm1', section: 'who' }, { id: 'm2', section: 'who' }, { id: 'm3', section: 'facts' }]);
    expect(db.prepare(`select id from threads order by id`).all()).toEqual([{ id: 'tn' }]);
    expect(db.prepare(`select id from messages order by id`).all()).toEqual([{ id: 'x2' }]);
    db.close();
    expect(fs.readdirSync(d).some((f) => f.startsWith('korvex.db.bak_'))).toBe(true);
    db = new Database(file);
    migrate(drizzle(db), { migrationsFolder: migrations });
    expect(cols('user_memory')).toContain('sure');
    db.close();
  });
});
