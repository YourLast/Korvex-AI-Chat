import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpData } from './helpers';

tmpData();
process.env.KX_MEMORY_RESCAN_MS = '600000';
const seen: { body: Record<string, unknown>; user: string }[] = [];
let reply: (user: string) => { pref: string; section: string } = () => ({ pref: '', section: 'style' });
let eng: http.Server;
beforeAll(async () => {
  eng = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      const user = String((body.messages as { content: string }[])[1].content);
      seen.push({ body, user });
      const sig = body.response_format?.json_schema?.name === 'memory_signal';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sig ? reply(user) : { ops: [] }) } }] }));
    });
  });
  await new Promise<void>((r) => eng.listen(0, '127.0.0.1', r));
  process.env.KX_MEMORY_ENGINE_URL = `http://127.0.0.1:${(eng.address() as AddressInfo).port}/v1`;
  process.env.KX_TITLE_ENGINE_URL = '';
  const { getDb, schema } = await import('@/lib/db');
  getDb().insert(schema.users).values(['s1', 's2'].map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1, lang: 'ru' }))).run();
  (await import('@/lib/curator')).registerCurator();
});
afterAll(() => { eng.close(); });

let n = 0;
async function chat(userId: string, answer: string) {
  const { getDb, schema } = await import('@/lib/db');
  const th = `t-${++n}`, u = `u-${n}`, a = `a-${n}`, now = Date.now();
  getDb().insert(schema.threads).values({ id: th, userId, title: 'Чат', modelId: 'alpha', createdAt: now, updatedAt: now }).run();
  getDb().insert(schema.messages).values([
    { id: u, threadId: th, seq: 1, role: 'user', content: 'Посчитай НДС с 120 000', createdAt: now, parentId: null },
    { id: a, threadId: th, seq: 2, role: 'assistant', content: answer, createdAt: now + 1, parentId: u, meta: { status: 'done' } },
  ] as never).run();
  return { th, a };
}

describe('сигналы', () => {
  it('разбор ответа куратора и «ответь иначе»', async () => {
    const C = await import('@/lib/curator');
    expect(C.parseSignal('{"pref":"Хочет итог в первой строке","section":"style"}')).toEqual({ pref: 'Хочет итог в первой строке', section: 'style' });
    expect(C.parseSignal('{"pref":"","section":"style"}')).toBeNull();
    expect(C.parseSignal('мусор')).toBeNull();
    for (const t of ['ответь иначе', 'Переделай, пожалуйста', 'это не то', 'напиши по-другому', 'не так, короче']) expect(C.asksDifferently(t), t).toBe(true);
    for (const t of ['а если доход 200 000?', 'спасибо', 'не так уж и много вышло, а как посчитать взносы за прошлый год и что делать с авансами по УСН, если их не платили вовремя и теперь пени? '.repeat(3)]) expect(C.asksDifferently(t), t).toBe(false);
    const m = C.signalMessages({ kind: 'thumbsdown', before: 'Длинный ответ с таблицей', want: 'отметки: формат; без таблиц' });
    expect(m[0].content).toContain('ОДНО короткое предпочтение');
    expect(m[1].content).toContain('👎');
    expect(m[1].content).toContain('Что он написал: отметки: формат; без таблиц');
  });
  it('👎 с комментарием — догадка «Возможно» и «Похоже: …» под ответом; повтор того же сигнала — нет', async () => {
    const C = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    const { getDb, schema } = await import('@/lib/db');
    reply = () => ({ pref: 'Просит без таблиц, списком', section: 'style' });
    const { th, a } = await chat('s1', '| Ставка | Сумма |\n|---|---|\n| 20 % | 20 000 |');
    expect(C.considerSignal('s1', th, a, 'thumbsdown', { want: '' })).toBe(true);
    expect(C.considerSignal('s1', th, a, 'thumbsdown', { want: 'без таблиц' })).toBe(true);
    await C.curatorIdle();
    const req = seen.at(-1)!;
    expect((req.body.response_format as { json_schema: { name: string } }).json_schema.name).toBe('memory_signal');
    expect(req.user).toContain('Что он написал: без таблиц');
    const row = M.listMemory('s1').find((r) => r.text.includes('без таблиц'))!;
    expect(row).toMatchObject({ section: 'style', sure: 0, origin: 'auto' });
    const meta = getDb().select().from(schema.messages).all().find((x) => x.id === a)!.meta as { memUpd?: { text: string; maybe?: boolean }[] };
    expect(meta.memUpd?.[0]).toMatchObject({ text: 'Просит без таблиц, списком', maybe: true });
    expect(C.considerSignal('s1', th, a, 'thumbsdown')).toBe(false);
  });
  it('причина неясна — ничего; данные клиента в строке — не пишем; память выключена или флаг — сигнала нет', async () => {
    const C = await import('@/lib/curator');
    const M = await import('@/lib/memory');
    reply = () => ({ pref: '', section: 'style' });
    let c = await chat('s2', 'Ответ');
    C.considerSignal('s2', c.th, c.a, 'regen'); await C.curatorIdle();
    reply = () => ({ pref: 'Клиент ООО «Ромашка», ИНН 7701234567', section: 'style' });
    c = await chat('s2', 'Ответ 2');
    C.considerSignal('s2', c.th, c.a, 'differently', { want: 'не то' }); await C.curatorIdle();
    expect(M.listMemory('s2')).toEqual([]);
    process.env.KX_MEMORY_SIGNALS = '0';
    c = await chat('s2', 'Ответ 3');
    expect(C.considerSignal('s2', c.th, c.a, 'regen')).toBe(false);
    delete process.env.KX_MEMORY_SIGNALS;
    M.setPrefs('s2', { on: false });
    c = await chat('s2', 'Ответ 4');
    expect(C.considerSignal('s2', c.th, c.a, 'regen')).toBe(false);
  });
  it('👎 «неверно» без комментария снимает сигнал из очереди', async () => {
    const C = await import('@/lib/curator');
    const c = await chat('s1', 'Ответ 5');
    expect(C.considerSignal('s1', c.th, c.a, 'thumbsdown', { delayMs: 60_000 })).toBe(true);
    expect(C.dropSignal(c.a, 'thumbsdown')).toBe(true);
  });
});
