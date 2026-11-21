import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { tmpData } from './helpers';

const jar = { token: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.token ? { name: n, value: jar.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const dir = tmpData();
const OUT = path.join(dir, 'up-out');
fs.mkdirSync(OUT, { recursive: true });
process.env.KX_OUT_DIR = OUT;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const A = { id: 'blk-a', token: 'tok-blk-a' }, B = { id: 'blk-b', token: 'tok-blk-b' }, ADM = { id: 'blk-adm', token: 'tok-blk-adm' }, AL = { id: 'blk-al', token: 'tok-blk-al' };
const TOK = 'b'.repeat(32);
const HREF = `/out/${TOK}/svod.kxb.json`;
const table = {
  kx: 1, type: 'table', title: 'Реестр: неоплаченные счета', source: { kind: 'calc', basis: 'выписка за октябрь' },
  data: { preset: 'registry', columns: [{ key: 'date', title: 'Дата', kind: 'date' }, { key: 'doc', title: 'Счёт' }, { key: 'sum', title: 'Сумма, ₽', kind: 'money', total: true }, { key: 'pay', title: 'Оплата', kind: 'status' }],
    rows: [{ date: '2026-10-01', doc: 'Счёт № 12', sum: '120000.50', pay: 'off', note: 'нет оплаты' }, { date: '2026-10-05', doc: 'Счёт № 15', sum: '9999.99', pay: 'pos' }] },
};
const dl = { kx: 1, type: 'deadlines', title: 'Сроки: ноябрь', source: { kind: 'official', url: 'https://www.nalog.gov.ru/' },
  data: { items: [{ date: '2026-11-30', orig: '2026-11-28', reason: 'суббота', what: 'Уплата: НДС (1/3 за III кв.), НДФЛ, взносы; очень длинное название события, чтобы строка календаря была длиннее семидесяти пяти байт', basis: 'п. 7 ст. 6.1 НК' }] } };

beforeAll(async () => {
  const { getDb, schema } = await import('@/lib/db');
  const db = getDb();
  for (const [u, role] of [[A, 'user'], [B, 'user'], [ADM, 'admin'], [AL, 'alpha']] as const) {
    db.insert(schema.users).values({ id: u.id, email: `${u.id}@example.com`, name: u.id, passwordHash: 'x', role, createdAt: 1 }).run();
    db.insert(schema.sessions).values({ id: sha(u.token), userId: u.id, createdAt: 1, expiresAt: Date.now() + 864e5 }).run();
  }
  fs.mkdirSync(path.join(OUT, TOK), { recursive: true });
  fs.writeFileSync(path.join(OUT, TOK, 'svod.kxb.json'), JSON.stringify(table));
  fs.writeFileSync(path.join(OUT, TOK, 'big.kxb.json'), JSON.stringify({ ...table, title: 'x'.repeat(10) }) + ' '.repeat(2 * 1024 * 1024));
  db.insert(schema.outFiles).values({ token: TOK, userId: A.id, threadId: null, messageId: null, createdAt: 1 }).run();
});

describe('файл блока: владение', () => {
  it('владелец — читает; чужой — нет; администратор — да; обход пути и не .kxb.json — нет; больше 2 МБ — нет', async () => {
    const { blockFilePath, readBlockFile } = await import('@/lib/blocks/server');
    const f = blockFilePath(A.id, HREF);
    expect(f).toBe(path.join(OUT, TOK, 'svod.kxb.json'));
    expect(readBlockFile(f!)).toMatchObject({ ok: true, block: { type: 'table' } });
    expect(blockFilePath(B.id, HREF)).toBeNull();
    expect(blockFilePath(ADM.id, HREF, true)).not.toBeNull();
    expect(blockFilePath(A.id, `/out/${TOK}/..%2F..%2Fx.kxb.json`)).toBeNull();
    expect(blockFilePath(A.id, `/out/${TOK}/svod.json`)).toBeNull();
    expect(readBlockFile(blockFilePath(A.id, `/out/${TOK}/big.kxb.json`)!)).toBeNull();
  });
});

describe('выгрузки', () => {
  it('.xlsx: числа — числами, даты — датами, итог формулой, пометки', async () => {
    const { tableXlsx } = await import('@/lib/blocks/server');
    const { parseBlock } = await import('@/lib/blocks/parse');
    const p = parseBlock(JSON.stringify(table), 'file');
    if (!p.ok || p.block.type !== 'table') throw new Error('bad');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await tableXlsx(p.block, 'ru') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Реестр: неоплаченные счета');
    expect(ws.getRow(3).values).toEqual([undefined, 'Дата', 'Счёт', 'Сумма, ₽', 'Оплата', 'проверить']);
    expect(ws.getCell('C4').value).toBe(120000.5);
    expect(ws.getCell('A4').value).toBeInstanceOf(Date);
    expect((ws.getCell('A4').value as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(ws.getCell('D4').value).toBe('нет');
    expect(ws.getCell('E4').value).toBe('нет оплаты');
    expect((ws.getCell('C6').value as { formula: string }).formula).toBe('SUM(C4:C5)');
    expect(ws.getColumn(3).numFmt).toBe('#,##0.00');
  });
  it('.ics: события на весь день, перенос в описании, строки ≤ 75 байт', async () => {
    const { deadlinesIcs } = await import('@/lib/blocks/server');
    const { parseBlock } = await import('@/lib/blocks/parse');
    const p = parseBlock(JSON.stringify(dl), 'file');
    if (!p.ok || p.block.type !== 'deadlines') throw new Error('bad');
    const ics = deadlinesIcs(p.block, 'ru', new Date('2026-11-20T10:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics).toContain('DTEND;VALUE=DATE:20261201');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:Уплата: НДС (1/3 за III кв.)\\, НДФЛ\\, взносы\\; очень длинное');
    expect(unfolded).toContain('DESCRIPTION:п. 7 ст. 6.1 НК\\nсрок 28.11.2026 — суббота\\, перенос на 30.11.2026');
    for (const l of ics.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
  });
});

describe('снимок в meta', () => {
  it('файлы — при завершении (только свои); ограждения курса — параметры для фона', async () => {
    const { fileSnapshots, rateParams } = await import('@/lib/blocks/snapshot');
    const md = `Готово: 📎 [svod.kxb.json](${HREF}) (1 KB)\n\n\`\`\`korvex\n{"kx":1,"type":"rate","title":"Курс","source":{"kind":"official"},"data":{"code":"AED"}}\n\`\`\``;
    expect(Object.keys(fileSnapshots(A.id, md))).toEqual([HREF]);
    expect(fileSnapshots(B.id, md)).toEqual({});
    expect(rateParams(md)).toEqual([{ code: 'AED', date: undefined }]);
  });
  it('курсы — в фоне в meta.blocks.rates сообщения, остальное meta не трогается', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    db.insert(schema.threads).values({ id: 'th-blk', userId: A.id, title: 't', modelId: 'alpha', createdAt: 1, updatedAt: 1 }).run();
    db.insert(schema.messages).values({ id: 'm-blk', threadId: 'th-blk', seq: 1, parentId: null, role: 'assistant', content: 'x', meta: { modelId: 'alpha', blocks: { files: { a: 1 } } }, createdAt: 1 }).run();
    const xml = '<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="20.11.2026" name="Foreign Currency Market"><Valute ID="R01230"><NumCode>784</NumCode><CharCode>AED</CharCode><Nominal>1</Nominal><Name>AED</Name><Value>22,3088</Value><VunitRate>22,3088</VunitRate></Valute></ValCurs>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode(xml))));
    const { snapshotRates } = await import('@/lib/blocks/snapshot');
    await snapshotRates('m-blk', '```korvex\n{"kx":1,"type":"rate","title":"Курс","source":{"kind":"official"},"data":{"code":"AED"}}\n```');
    vi.unstubAllGlobals();
    const meta = db.select({ meta: schema.messages.meta }).from(schema.messages).where(eq(schema.messages.id, 'm-blk')).get()!.meta as Record<string, unknown> & { blocks: { rates: Record<string, { value: string }>; files: unknown } };
    expect(meta.modelId).toBe('alpha');
    expect(meta.blocks.files).toEqual({ a: 1 });
    expect(meta.blocks.rates['AED:'].value).toBe('22.3088');
  });
});

describe('маршруты /api/blocks/*', () => {
  const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, { ...init, headers: { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  it('без входа — 401; плохой код и дата — 400', async () => {
    const { GET } = await import('@/app/api/blocks/rate/route');
    jar.token = '';
    expect((await GET(req('/api/blocks/rate?code=AED'))).status).toBe(401);
    jar.token = A.token;
    expect((await GET(req('/api/blocks/rate?code=AE1'))).status).toBe(400);
    expect((await GET(req('/api/blocks/rate?code=AED&date=20.11.2026'))).status).toBe(400);
  });
  it('xlsx: свой файл по ссылке — да, чужой — 404; присланный блок — да; не таблица — 400', async () => {
    const { POST } = await import('@/app/api/blocks/xlsx/route');
    jar.token = A.token;
    const r = await POST(req('/api/blocks/xlsx', { method: 'POST', body: JSON.stringify({ href: HREF }) }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain("filename*=UTF-8''%D0%A0%D0%B5%D0%B5%D1%81%D1%82%D1%80");
    jar.token = B.token;
    expect((await POST(req('/api/blocks/xlsx', { method: 'POST', body: JSON.stringify({ href: HREF }) }))).status).toBe(404);
    expect((await POST(req('/api/blocks/xlsx', { method: 'POST', body: JSON.stringify({ block: table }) }))).status).toBe(200);
    expect((await POST(req('/api/blocks/xlsx', { method: 'POST', body: JSON.stringify({ block: dl }) }))).status).toBe(400);
  });
  it('ics: блок «сроки» — календарь', async () => {
    const { POST } = await import('@/app/api/blocks/ics/route');
    jar.token = A.token;
    const r = await POST(req('/api/blocks/ics', { method: 'POST', body: JSON.stringify({ block: dl }) }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/calendar');
    expect(await r.text()).toContain('BEGIN:VEVENT');
  });
});

describe('конфиг блоков', () => {
  it('по умолчанию функция выключена (выкатка поэтапно); правило доступа «Альфа»; виды и сужение организации', async () => {
    const { blocksView, setBlockTypes, setOrgTypes, typeOn } = await import('@/lib/blocks/config');
    const { setFeature } = await import('@/lib/features');
    const { setRule } = await import('@/lib/access');
    expect(blocksView(A.id).on).toBe(false);
    setFeature('blocks', true, ADM.id);
    setRule('feature', 'blocks', { roles: ['alpha'] }, ADM.id);
    expect(blocksView(A.id).on).toBe(false);
    expect(blocksView(AL.id).on).toBe(true);
    expect(blocksView(ADM.id).on).toBe(true);
    setRule('feature', 'blocks', null, ADM.id);
    expect(blocksView(A.id).on).toBe(true);
    expect(blocksView(A.id).types).toMatchObject({ table: true, kpi: true, rate: true, deadlines: true, chart: false, map: false, html: false });
    setBlockTypes({ deadlines: false }, ADM.id);
    expect(typeOn('deadlines')).toBe(false);
    setOrgTypes('org-1', { table: false, kpi: true }, ADM.id);
    expect(typeOn('table', 'org-1')).toBe(false);
    expect(typeOn('deadlines', 'org-1')).toBe(false);
    expect(blocksView(A.id, ['org-1', 'org-2']).orgs).toEqual({ 'org-1': { table: false, kpi: true } });
    expect(blocksView(A.id).region).toBe('world');
    process.env.KX_REGION = 'ru';
    expect(blocksView(A.id).region).toBe('ru');
    delete process.env.KX_REGION;
  });
});

describe('виды блоков для запроса к серву (blocksFor)', () => {
  it('функция выключена — null (поля в запросе нет); включена — виды с учётом организации', async () => {
    const { blocksFor, setBlockTypes, setOrgTypes } = await import('@/lib/blocks/config');
    const { setFeature } = await import('@/lib/features');
    setBlockTypes(null, ADM.id); setOrgTypes('org-1', null, ADM.id);
    setFeature('blocks', false, ADM.id);
    expect(blocksFor(A.id)).toBeNull();
    setFeature('blocks', true, ADM.id);
    expect(blocksFor(A.id)).toEqual(['table', 'kpi', 'rate', 'deadlines']);
    setOrgTypes('org-1', { rate: false }, ADM.id);
    expect(blocksFor(A.id, 'org-1')).toEqual(['table', 'kpi', 'deadlines']);
    setFeature('blocks', null, ADM.id);
  });
});
