import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpData } from './helpers';

tmpData();
process.env.KX_NIGHT_SEARCH_GAP_MS = '5';
const calls: { path: string; body: Record<string, unknown> | null }[] = [];
let status: Record<string, unknown> = { window: true, people: 0, searches_tonight: 0, captcha_stop: false };
let srv: http.Server;
beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      calls.push({ path: req.url ?? '', body });
      const send = (code: number, j: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/status') return send(200, status);
      if (req.url === '/search') return body.q.includes('Ромашка') ? send(400, { error: { code: 'pii', what: 'company' }, retry_after: 0 })
        : send(200, { results: [{ title: 'НДФЛ с отпускных', url: 'https://www.nalog.gov.ru/rn77/ndfl', content: 'НДФЛ с отпускных платится не позднее 28-го числа' }], searches_tonight: 1, search_per_night: 30 });
      const name = body.response_format.json_schema.name;
      const content = name === 'night_day'
        ? { notes: [{ section: 'work', text: 'Ведёт расчёт зарплаты и отпускных' }, { section: 'style', text: 'Просит итог в первой строке' }, { section: 'work', text: 'Клиент ООО «Ромашка», ИНН 7701234567' }],
            topics: ['срок уплаты НДФЛ с отпускных 2026', 'ООО «Ромашка» долг'] }
        : { note: 'НДФЛ с отпускных — не позднее 28-го числа', url: 'https://www.nalog.gov.ru/rn77/ndfl' };
      send(200, { choices: [{ message: { content: JSON.stringify(content) } }] });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  process.env.KX_NIGHT_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const { getDb, schema } = await import('@/lib/db');
  const now = Date.now();
  getDb().insert(schema.users).values(['n1', 'n2'].map((id) => ({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user' as const, createdAt: 1, lang: 'ru' }))).run();
  getDb().insert(schema.threads).values([{ id: 't1', userId: 'n1', title: 'Ч', modelId: 'alpha', createdAt: now, updatedAt: now }, { id: 't2', userId: 'n2', title: 'Ч', modelId: 'alpha', createdAt: now, updatedAt: now }]).run();
  getDb().insert(schema.messages).values([
    { id: 'm1', threadId: 't1', seq: 1, role: 'user', content: 'Посчитай отпускные сотруднику', createdAt: now - 1000, parentId: null },
    { id: 'm2', threadId: 't1', seq: 2, role: 'assistant', content: 'Отпускные: …', createdAt: now - 900, parentId: 'm1' },
    { id: 'm3', threadId: 't2', seq: 1, role: 'user', content: 'Привет', createdAt: now - 1000, parentId: null },
  ] as never).run();
  (await import('@/lib/memory')).setPrefs('n2', { on: false });
});
afterAll(() => { srv.close(); });

describe('ночной разбор', () => {
  it('по умолчанию выключен; ключ ночи — дата вечера по МСК', async () => {
    const N = await import('@/lib/night');
    delete process.env.KX_NIGHT;
    expect(N.nightOn()).toBe(false);
    process.env.KX_NIGHT = '1';
    expect(N.nightOn()).toBe(true);
    expect(N.nightKey(Date.UTC(2026, 10, 22, 20))).toBe('2026-11-22');
    expect(N.nightKey(Date.UTC(2026, 10, 23, 3))).toBe('2026-11-22');
  });
  it('поиск и записи без ПДн', async () => {
    const N = await import('@/lib/night');
    expect(N.safeQuery('срок уплаты НДФЛ с отпускных 2026')).toBe(true);
    for (const q of ['ООО «Ромашка» долг', 'ИНН 7701234567', 'перевод 1250000 руб', 'Иванов И. И. зарплата', 'a@b.ru']) expect(N.safeQuery(q), q).toBe(false);
    expect(N.safeNote('Клиент ООО «Ромашка», ИНН 7701234567')).toBe(false);
    for (const q of ['долг АО Вектор 2026', 'ИП Сидоров патент', 'акт от 12.03.2026 НДС', 'НДС с 450 000 руб', 'ООО Ромашка-Тест сверка', 'проверка 770000000101'])
      expect(N.safeQuery(q), q).toBe(false);
    for (const q of ['ставка НДС для УСН 2026', 'срок сдачи 6-НДФЛ за 2026 год', 'лимит доходов УСН 2026']) expect(N.safeQuery(q), q).toBe(true);
    const M = await import('@/lib/memory');
    const { getDb, schema } = await import('@/lib/db');
    getDb().insert(schema.users).values({ id: 'n9', email: 'n9@t', name: 'n9', passwordHash: 'x', role: 'user', createdAt: 1 }).run(); M.setPrefs('n9', { on: false });
    expect(M.addMemory('n9', { section: 'knowledge', text: 'ИП на УСН платит взносы до 28 декабря (п. 2 ст. 432 НК РФ, с 01.01.2023)', origin: 'auto', sure: false })).toMatchObject({ ok: true, action: 'added' });
    expect(M.addMemory('n9', { section: 'work', text: 'ИП на УСН', origin: 'auto', sure: false })).toMatchObject({ ok: false, error: 'guess' });
    expect(N.safeNorm('Ставка НДФЛ 13 % до 2,4 млн руб. дохода в год (п. 1 ст. 224 НК РФ, с 01.01.2025)')).toBe(true);
    expect(N.safeNorm('ООО «Ромашка-Тест» платит 20 %')).toBe(false);
    expect(N.sameUrl('https://www.nalog.gov.ru/rn77/ndfl/', 'http://nalog.gov.ru/rn77/ndfl')).toBe(true);
    expect(N.sameUrl('https://nalog.gov.ru/a', 'https://nalog.gov.ru/b')).toBe(false);
    expect(N.neutralQuery('взносы ИП на патенте 2026')).toBe('взносы предприниматель на патенте 2026');
    expect(N.safeQuery(N.neutralQuery('взносы ИП на патенте 2026'))).toBe(true);
    expect(N.safeQuery('взносы ИП на патенте 2026')).toBe(false);
    expect(N.safeQuery(N.neutralQuery('срок НДФЛ АО «Вектор»'))).toBe(false);
    expect(N.cleanNorm('Лимит доходов на ПСН — 20 млн руб. (ст. 346.43 НК РФ, в ред. ФЗ от 28.12.2025 № 425-ФЗ), с 01.01.2026')).toBe('Лимит доходов на ПСН — 20 млн руб. (ст. 346.43 НК РФ), с 01.01.2026');
    expect(N.cleanNorm('По Федеральному закону от 28.11.2025 № 425-ФЗ лимит ПСН 20 млн руб. с 2026 года')).toBe('Лимит ПСН 20 млн руб. с 2026 года');
    expect(N.cleanNorm('Ставка 13 % (п. 1 ст. 224 НК РФ; № 176-ФЗ от 12.07.2024)')).toBe('Ставка 13 % (п. 1 ст. 224 НК РФ)');
    const src = { title: 'Лимит для ПСН', content: 'в 2026 году лимит доходов составит 20 млн руб., в 2027 году - 15 млн руб.' };
    expect(N.groundNorm('Лимит 20 млн руб. с 2026 (ст. 346.45 НК РФ)', src)).toEqual({ ok: false, missing: 1 });
    expect(N.groundNorm('Лимит 20 млн руб. с 2026', src)).toEqual({ ok: true, missing: 0 });
    expect(N.groundNorm('Лимит 20 млн руб. с 2026', undefined).ok).toBe(false);
    expect(N.groundNorm('Платить до 28.12.2026, взносы 1 240 000 руб., ставка 2,4 %', { content: 'срок — 28 декабря 2026 года; 1240000 руб.; 2.4 %' }).ok).toBe(true);
    expect(N.groundNorm('п. 7 ст. 346.21 НК РФ: уменьшение на взносы', { title: 'УСН: уменьшение налога', content: 'налог уменьшают на страховые взносы' }).ok).toBe(false);
    expect(N.nightDup('Предоставлять списки отчетов в формате таблицы', 'Предпочитает получать списки отчётов в виде таблицы')).toBe(true);
    expect(N.nightDup('Просит итог в первой строке', 'Хочет итог первой строкой')).toBe(true);
    expect(N.nightDup('Просит итог в первой строке', 'Просит без таблиц, списком')).toBe(false);
    expect(N.nightDup('Ведёт расчёт зарплаты и отпускных', 'Ведёт учёт в 1С:Бухгалтерии')).toBe(false);
  });
  it('проход: догадки и норма с источником — «Возможно»; клиентское — мимо; выключенная память — не разбирается; утренняя строка', async () => {
    const N = await import('@/lib/night');
    const M = await import('@/lib/memory');
    const r = await N.nightPass();
    expect(r).toEqual({ done: 1 });
    const rows = M.listMemory('n1');
    expect(rows.map((x) => [x.section, x.sure, x.text])).toEqual(expect.arrayContaining([
      ['work', 0, 'Ведёт расчёт зарплаты и отпускных'], ['style', 0, 'Просит итог в первой строке'],
      ['knowledge', 0, expect.stringMatching(/^НДФЛ с отпускных — не позднее 28-го числа \(nalog\.gov\.ru, сверено \d\d\.\d\d\.\d{4}\)$/)],
    ]));
    expect(rows.some((x) => /Ромашка|7701234567/.test(x.text))).toBe(false);
    expect(calls.filter((c) => c.path === '/search').map((c) => c.body!.q)).toEqual(['срок уплаты НДФЛ с отпускных 2026']);
    expect(M.listMemory('n2')).toEqual([]);
    expect(N.nightNotice('n1')).toEqual({ notes: 2, norms: 1, fixes: [] });
    N.nightSeen('n1');
    expect(N.nightNotice('n1')).toBeNull();
    expect((await N.nightPass()).done).toBe(0);
  });
  it('окно закрыто или люди на кластере — не начинает', async () => {
    const N = await import('@/lib/night');
    status = { window: false };
    expect((await N.nightPass()).stopped).toBe('night_closed');
    status = { window: true, people: 2 };
    expect((await N.nightPass()).stopped).toBe('people_present');
  });
  it('B3: проверка ответов дня кодом B — поправка в утренней строке со ссылкой на чат; сбой проверки — без поправок', async () => {
    const N = await import('@/lib/night');
    const { getDb, schema } = await import('@/lib/db');
    const now = Date.now();
    getDb().insert(schema.users).values({ id: 'n3', email: 'n3@t', name: 'n3', passwordHash: 'x', role: 'user', createdAt: 1, lang: 'ru' }).run();
    getDb().insert(schema.threads).values({ id: 't3', userId: 'n3', title: 'Ч', modelId: 'alpha', createdAt: now, updatedAt: now }).run();
    getDb().insert(schema.messages).values([
      { id: 'q3', threadId: 't3', seq: 1, role: 'user', content: 'Срок НДФЛ за декабрь?', createdAt: now - 1000, parentId: null },
      { id: 'a3', threadId: 't3', seq: 2, role: 'assistant', content: 'До 11.01.2027.', createdAt: now - 900, parentId: 'q3', meta: { status: 'done' } },
    ] as never).run();
    expect(N.dayPairs('n3', now)).toEqual([{ id: 'a3', th: 't3', q: 'Срок НДФЛ за декабрь?', a: 'До 11.01.2027.', lang: 'ru' }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-daycheck-'));
    const script = path.join(dir, 'day_check.py');
    fs.writeFileSync(script, 'import json,sys\nd=json.load(sys.stdin)\nprint(json.dumps([{"id":x["id"],"kind":"ndfl_yearend","wrong":"11.01.2027","right":"30.12.2026","basis":"п. 6 ст. 226 НК","fix":"Вчера я ошиблась: срок не 11.01.2027, а 30.12.2026 (п. 6 ст. 226 НК)."} for x in d]))\n');
    expect(await N.runDayCheck([{ id: 'a3', q: 'q', a: 'a', lang: 'ru' }], path.join(dir, 'нет.py'))).toEqual([]);
    process.env.KX_NIGHT_DAYCHECK = script;
    status = { window: true, people: 0, searches_tonight: 0, captcha_stop: false };
    try { await N.nightPass(); } finally { delete process.env.KX_NIGHT_DAYCHECK; }
    const { getDb: gd, schema: sc } = await import('@/lib/db');
    expect((gd().select().from(sc.messages).all().find((x) => x.id === 'a3')!.meta as { dayFix?: string }).dayFix).toContain('Вчера я ошиблась');
    expect(N.nightNotice('n3')?.fixes).toEqual([{ id: 'a3', th: 't3', kind: 'ndfl_yearend', fix: 'Вчера я ошиблась: срок не 11.01.2027, а 30.12.2026 (п. 6 ст. 226 НК).' }]);
  });
});
