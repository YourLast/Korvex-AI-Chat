import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { tmpData } from './helpers';
import { encodeCp, makeZip } from './archive-helpers';

let cur: { id: string; role: string } | null = null;
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), currentUser: async () => cur }));
const ingest = vi.hoisted(() => ({ fail: null as null | { status: number; message: string }, names: [] as string[] }));
vi.mock('@/lib/extract', async (orig) => ({
  ...(await orig<typeof import('@/lib/extract')>()),
  ingestDocument: async (_b: Buffer, name: string) => {
    ingest.names.push(name);
    if (ingest.fail && /\.bad$|\.dat$/.test(name)) return { ok: false, ...ingest.fail };
    return { ok: true, text: `текст файла ${name}`, info: { format: 'x', extractor: 'test' } };
  },
}));

const dir = tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const T0 = 1_790_000_000_000;
const H = { Host: 'localhost', Origin: 'http://localhost' };

let FILES: typeof import('@/app/api/files/route');
let ARCH: typeof import('@/app/api/files/archive/route');
let VIEW: typeof import('@/app/api/files/[id]/view/route');
let GRID: typeof import('@/app/api/files/[id]/grid/route');
let TEXT: typeof import('@/app/api/files/[id]/text/route');
let PDF: typeof import('@/app/api/files/[id]/pdf/route');

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  for (const id of ['ua', 'ub']) db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', role: 'user', createdAt: T0 }).run();
  FILES = await import('@/app/api/files/route');
  ARCH = await import('@/app/api/files/archive/route');
  VIEW = await import('@/app/api/files/[id]/view/route');
  GRID = await import('@/app/api/files/[id]/grid/route');
  TEXT = await import('@/app/api/files/[id]/text/route');
  PDF = await import('@/app/api/files/[id]/pdf/route');
}, 90_000);
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const up = (body: Record<string, string | Blob>, fname = 'f') => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) { if (v instanceof File) fd.append(k, v); else if (v instanceof Blob) fd.append(k, v, fname); else fd.append(k, v); }
  return FILES.POST(new Request('http://localhost/api/files', { method: 'POST', headers: H, body: fd }));
};
const file = (name: string, data: string | Uint8Array, type = '') => new File([data as BlobPart], name, { type });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://localhost${url}`, { headers: H });

describe('POST /api/files: путь, любое расширение', () => {
  it('имя в чате = относительный путь из поля path; origin папки в info; расширение .dat принимается', async () => {
    cur = { id: 'ua', role: 'user' };
    const r = await up({ file: file('акт.pdf', 'pdf'), path: 'Акты/2026/акт_017.pdf' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.name).toBe('Акты/2026/акт_017.pdf');
    expect(j.info.origin).toEqual({ kind: 'folder', root: 'Акты' });
    expect(ingest.names).toContain('Акты/2026/акт_017.pdf');
    const r2 = await up({ file: file('данные.dat', 'x'), path: 'Свалка/данные.dat' });
    expect(r2.status).toBe(200);
  });
  it('небезопасный путь не используется (остаётся имя файла); служебный файл — 415; пустой — 422; больше 100 МБ — 413', async () => {
    cur = { id: 'ua', role: 'user' };
    const j = await (await up({ file: file('x.txt', 'x'), path: '../../etc/x.txt' })).json();
    expect(j.name).toBe('x.txt');
    expect((await up({ file: file('.DS_Store', 'x'), path: 'Акты/.DS_Store' })).status).toBe(415);
    expect((await up({ file: file('пусто.txt', ''), path: 'Акты/пусто.txt' })).status).toBe(422);
    expect((await up({ file: new File([new Uint8Array(101 * 1024 * 1024)], 'big.bin') })).status).toBe(413);
  });
  it('неизвестный тип, который серв не разобрал, сохраняется карточкой «без разбора»; известный тип с отказом — ошибка с причиной', async () => {
    cur = { id: 'ua', role: 'user' };
    ingest.fail = { status: 422, message: 'Файл «x» не прочитан: не умею' };
    const r = await up({ file: file('мерц.dat', 'bin'), path: 'Свалка/мерц.dat' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.info).toMatchObject({ unparsed: true, format: 'unknown' });
    const row = db.select().from(schema.files).all().find((f) => f.id === j.id)!;
    expect(row.text).toContain('сохранён без разбора');
    expect(row.text).not.toMatch(/не прочитан:/);
    expect(fs.existsSync(path.join(dir, 'files', j.id, 'original.dat'))).toBe(true);
    const r2 = await up({ file: file('сломан.bad', 'x'), path: 'a/сломан.bad' });
    expect(r2.status).toBe(200);
    ingest.fail = null;
  });
});

describe('архив: распаковка -> staged -> файлы чата', () => {
  const zip = makeZip([
    { name: encodeCp('Акты/Акт №1.txt', '866'), data: 'акт один', utf8Flag: false },
    { name: encodeCp('Акты/Акт №2.txt', '866'), data: 'акт два', utf8Flag: false },
    { name: 'Акты/.DS_Store', data: 'x' },
    { name: '../evil.txt', data: 'побег' },
  ]);
  const post = (body: Buffer | Uint8Array, name = 'Акты.zip') => ARCH.POST(new Request('http://localhost/api/files/archive', { method: 'POST', headers: { ...H, 'X-Filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: body as unknown as BodyInit, duplex: 'half' } as RequestInit));
  it('CP866-имена читаются, мусор и обход путей отсеяны; файлы грузятся по staged и получают путь из архива', async () => {
    cur = { id: 'ua', role: 'user' };
    const r = await post(zip);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.entries.map((e: { path: string }) => e.path).sort()).toEqual(['Акты/Акт №1.txt', 'Акты/Акт №2.txt']);
    expect(j.skipped.byReason).toMatchObject({ junk: 1, traversal: 1 });
    cur = { id: 'ub', role: 'user' };
    expect((await up({ staged: j.sid, n: String(j.entries[0].n) })).status).toBe(404);
    cur = { id: 'ua', role: 'user' };
    const got = [];
    for (const e of j.entries) { const f = await up({ staged: j.sid, n: String(e.n) }); expect(f.status).toBe(200); got.push(await f.json()); }
    expect(got.map((g) => g.name).sort()).toEqual(['Акты/Акт №1.txt', 'Акты/Акт №2.txt']);
    expect(got[0].info.origin).toEqual({ kind: 'zip', root: 'Акты', archive: 'Акты.zip' });
    expect((await up({ staged: j.sid, n: String(j.entries[0].n) })).status).toBe(404);
    expect(fs.existsSync(path.join(dir, 'staging', j.sid))).toBe(false);
  });
  it('X-Prefix: архив из папки — файлы внутри неё; небезопасный префикс игнорируется', async () => {
    cur = { id: 'ua', role: 'user' };
    const z = makeZip([{ name: 'а.txt', data: 'один' }, { name: 'б.txt', data: 'два' }]);
    const send = (px: string) => ARCH.POST(new Request('http://localhost/api/files/archive', { method: 'POST', headers: { ...H, 'X-Filename': encodeURIComponent('Опись.zip'), 'X-Prefix': encodeURIComponent(px) }, body: z as unknown as BodyInit, duplex: 'half' } as RequestInit));
    const ok = await (await send('Акты/2026')).json();
    expect(ok.entries.map((e: { path: string }) => e.path).sort()).toEqual(['Акты/2026/Опись/а.txt', 'Акты/2026/Опись/б.txt']);
    const bad = await (await send('../../x')).json();
    expect(bad.entries.map((e: { path: string }) => e.path).sort()).toEqual(['Опись/а.txt', 'Опись/б.txt']);
  });
  it('не архив — 415, повреждённый — 422, бомба — 422; staging после ошибки пуст', async () => {
    cur = { id: 'ua', role: 'user' };
    expect((await post(Buffer.from('x'), 'a.txt')).status).toBe(415);
    const bad = await post(Buffer.from('это не zip'), 'bad.zip');
    expect(bad.status).toBe(422);
    const left = fs.existsSync(path.join(dir, 'staging')) ? fs.readdirSync(path.join(dir, 'staging')) : [];
    expect(left.every((s) => fs.existsSync(path.join(dir, 'staging', s, 'manifest.json')))).toBe(true);
  });
  it('без входа — 401', async () => {
    cur = null;
    expect((await post(zip)).status).toBe(401);
  });
});

describe('просмотр: таблица', () => {
  let id = '';
  beforeAll(async () => {
    cur = { id: 'ua', role: 'user' };
    const rows: (string | number)[][] = [['Дата', 'Документ', 'Сумма'], ...Array.from({ length: 1234 }, (_, i) => [46000 + i, `РТУ-${String(i + 1).padStart(7, '0')}`, (i + 1) * 10])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Реализация');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['второй'], ['лист']]), 'Итоги');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    id = (await (await up({ file: new File([new Uint8Array(buf)], 'выгрузка.xlsx'), path: 'Данные/выгрузка.xlsx' })).json()).id;
  }, 60_000);
  it('view: листы и число строк; grid: окно строк с номерами как в Excel; отдельные строки; чужому — 404', async () => {
    const v = await (await VIEW.GET(get(`/api/files/${id}/view?wait=60000`), idp(id))).json();
    expect(v).toMatchObject({ kind: 'grid', state: 'ready' });
    expect(v.meta.sheets.map((s: { name: string; rows: number }) => [s.name, s.rows])).toEqual([['Реализация', 1235], ['Итоги', 2]]);
    const w = await (await GRID.GET(get(`/api/files/${id}/grid?sheet=0&from=1232&to=1236`), idp(id))).json();
    expect(w.from).toBe(1232);
    expect(w.rows.length).toBe(4);
    expect(w.rows[3][1]).toBe('РТУ-0001234');
    const first = await (await GRID.GET(get(`/api/files/${id}/grid?sheet=0&from=1&to=2`), idp(id))).json();
    expect(first.rows[0]).toEqual(['Дата', 'Документ', 'Сумма']);
    const list = await (await GRID.GET(get(`/api/files/${id}/grid?sheet=0&rows=2,600,9999`), idp(id))).json();
    expect(Object.keys(list.rows)).toEqual(['2', '600']);
    expect(list.rows['600'][1]).toBe('РТУ-0000599');
    cur = { id: 'ub', role: 'user' };
    expect((await GRID.GET(get(`/api/files/${id}/grid?sheet=0&from=1&to=2`), idp(id))).status).toBe(404);
    cur = { id: 'ua', role: 'user' };
  });
  it('книга со стилями: даты, проценты, ИНН текстом, заливки, жирный, объединение, закрепление, ширины, высоты, формула — как в Excel', async () => {
    cur = { id: 'ua', role: 'user' };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Отчёт', { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = 'Реестр актов';
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;
    ['Дата', 'ИНН', 'Ставка', 'Сумма'].forEach((h, i) => { const c = ws.getCell(2, i + 1); c.value = h; c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4, tint: 0.6 } as never }; c.border = { bottom: { style: 'medium', color: { argb: 'FF000000' } } }; });
    ws.getCell('A3').value = new Date(Date.UTC(2026, 9, 16)); ws.getCell('A3').numFmt = 'dd.mm.yyyy';
    ws.getCell('B3').value = '0054737930'; ws.getCell('B3').numFmt = '@';
    ws.getCell('C3').value = 0.2; ws.getCell('C3').numFmt = '0%';
    ws.getCell('D3').value = { formula: 'SUM(1000,184560.4)', result: 185560.4 }; ws.getCell('D3').numFmt = '#,##0.00';
    ws.getCell('B4').value = 12345678901; ws.getCell('B4').numFmt = '0';
    ws.getCell('D4').value = 1234567.891; ws.getCell('D4').numFmt = '# ##0.00';
    ws.getCell('A4').value = new Date(Date.UTC(2026, 6, 20)); ws.getCell('A4').numFmt = 'mm-dd-yy';
    ws.getCell('C4').value = 2193.5; ws.getCell('C4').numFmt = '#,##0.00 "руб."';
    ws.getCell('A5').value = new Date(Date.UTC(2026, 6, 20)); ws.getCell('A5').numFmt = 'yyyy-mm-dd';
    ws.getCell('C5').value = 1234.5; ws.getCell('C5').numFmt = '[$₽-419] #,##0.00';
    ws.getColumn(1).width = 14; ws.getColumn(2).width = 18;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const id = (await (await up({ file: new File([new Uint8Array(buf)], 'стили.xlsx') })).json()).id;
    const v = await (await VIEW.GET(get(`/api/files/${id}/view?wait=60000`), idp(id))).json();
    expect(v.state).toBe('ready');
    const sh = v.meta.sheets[0];
    expect(sh).toMatchObject({ name: 'Отчёт', merges: ['A1:D1'], frozen: { rows: 2, cols: 1 } });
    expect(sh.widths[0]).toBeGreaterThan(90);
    expect(sh.heights[1]).toBe(40);
    const gridIn = async (lang?: string) => (await (await GRID.GET(new Request(`http://localhost/api/files/${id}/grid?sheet=0&from=1&to=5`, { headers: lang ? { ...H, 'Accept-Language': lang } : H }), idp(id))).json());
    const w = await gridIn('ru-RU,ru;q=0.9');
    const txt = (c: unknown) => (typeof c === 'string' ? c : (c as [string])[0]);
    const sid = (c: unknown) => (typeof c === 'string' ? 0 : (c as [string, number])[1]);
    expect(w.rows[2].map(txt)).toEqual(['16.10.2026', '0054737930', '20%', '185\u00a0560,40']);
    expect(w.rows[3].map(txt)).toEqual(['20.07.2026', '12345678901', '2\u00a0193,50 руб.', '1234 567,89']);
    expect(w.rows[4].map(txt)).toEqual(['2026-07-20', '', '₽ 1\u00a0234,50', '']);
    const en = await gridIn('en-US,en;q=0.9');
    expect(en.rows[2].map(txt)).toEqual(['16.10.2026', '0054737930', '20%', '185,560.40']);
    expect(en.rows[3].map(txt)).toEqual(['7/20/2026', '12345678901', '2,193.50 руб.', '1234 567.89']);
    expect(en.rows[4].map(txt)).toEqual(['2026-07-20', '', '₽ 1,234.50', '']);
    const sr = await gridIn('sr-RS,sr;q=0.9');
    expect(sr.rows[2].map(txt)).toEqual(['16.10.2026', '0054737930', '20%', '185.560,40']);
    expect(sr.rows[3].map(txt)).toEqual(['20.07.2026', '12345678901', '2.193,50 руб.', '1234 567,89']);
    expect(sr.rows[4].map(txt)).toEqual(['2026-07-20', '', '₽ 1.234,50', '']);
    expect(w.rows[2][3][2]).toBe('=SUM(1000,184560.4)');
    const st = v.meta.styles;
    expect(st[sid(w.rows[0][0])]).toMatchObject({ b: 1, sz: 16, c: '#ffffff', f: '#1f4e78', h: 'c', v: 'm' });
    expect(st[sid(w.rows[1][1])]).toMatchObject({ b: 1, bd: { b: [2, 's', '#000000'] } });
    expect(st[sid(w.rows[1][1])].f).toMatch(/^#[0-9a-f]{6}$/);
    expect(st[sid(w.rows[2][0])]).toMatchObject({ h: 'r' });
    expect(sid(w.rows[0][1])).toBe(sid(w.rows[0][0]));
  });
  it('csv в cp1251: кодировка определяется, разделитель «;»', async () => {
    const csv = Buffer.from(encodeCp('Дата;Контрагент;Сумма\r\n01.10.2026;Ромашка;100\r\n02.10.2026;Лютик;200\r\n', '1251'));
    const cid = (await (await up({ file: new File([new Uint8Array(csv)], 'выгрузка.csv') })).json()).id;
    const v = await (await VIEW.GET(get(`/api/files/${cid}/view?wait=30000`), idp(cid))).json();
    expect(v.meta.sheets[0]).toMatchObject({ rows: 3, cols: 3 });
    const w = await (await GRID.GET(get(`/api/files/${cid}/grid?sheet=0&from=1&to=3`), idp(cid))).json();
    expect(w.rows[1]).toEqual(['01.10.2026', 'Ромашка', '100']);
  });
});

describe('просмотр: текст', () => {
  it('кодировка cp1251, номера строк как в файле, окна', async () => {
    cur = { id: 'ua', role: 'user' };
    const text = Array.from({ length: 450 }, (_, i) => `строка номер ${i + 1}`).join('\r\n');
    const id = (await (await up({ file: new File([new Uint8Array(encodeCp(text, '1251'))], 'журнал.log') })).json()).id;
    const v = await (await VIEW.GET(get(`/api/files/${id}/view`), idp(id))).json();
    expect(v).toMatchObject({ kind: 'text', total: 450, enc: 'cp1251', binary: false });
    const w = await (await TEXT.GET(get(`/api/files/${id}/text?from=40&to=42`), idp(id))).json();
    expect(w).toMatchObject({ from: 40, total: 450 });
    expect(w.lines).toEqual(['строка номер 40', 'строка номер 41', 'строка номер 42']);
  });
  it('md — kind md; двоичный файл с расширением .txt — binary; для таблицы text — 415', async () => {
    cur = { id: 'ua', role: 'user' };
    const m = (await (await up({ file: new File(['# Заголовок\n\nтекст'], 'читай.md') })).json()).id;
    expect((await (await VIEW.GET(get(`/api/files/${m}/view`), idp(m))).json()).kind).toBe('md');
    const b = (await (await up({ file: new File([new Uint8Array([0, 1, 2, 0, 0, 5, 6, 0])], 'бин.txt') })).json()).id;
    expect((await (await VIEW.GET(get(`/api/files/${b}/view`), idp(b))).json()).binary).toBe(true);
    const x = (await (await up({ file: new File(['a,b\n1,2'], 'т.csv') })).json()).id;
    expect((await TEXT.GET(get(`/api/files/${x}/text`), idp(x))).status).toBe(415);
  });
  it('письма, веб-страницы, книги и выгрузки — «текст, который видит модель» (строки считаются по нему), карточка «без разбора» — нет', async () => {
    cur = { id: 'ua', role: 'user' };
    const e = (await (await up({ file: new File(['From: a@b\nSubject: x\n\nисходник письма'], 'письмо.eml') })).json()).id;
    const v = await (await VIEW.GET(get(`/api/files/${e}/view`), idp(e))).json();
    expect(v).toMatchObject({ kind: 'extracted', state: 'ready', total: 1 });
    const w = await (await TEXT.GET(get(`/api/files/${e}/text?from=1&to=5`), idp(e))).json();
    expect(w.lines).toEqual(['текст файла письмо.eml']);
    ingest.fail = { status: 422, message: 'не умею' };
    const d = (await (await up({ file: new File(['bin'], 'неизвестный.dat') })).json()).id;
    expect((await (await VIEW.GET(get(`/api/files/${d}/view`), idp(d))).json()).kind).toBe('none');
    ingest.fail = null;
    const { getDb: gd, schema: sch } = await import('@/lib/db');
    const { eq: eq2 } = await import('drizzle-orm');
    gd().update(sch.files).set({ text: 'Файл «x.dat»: формат не разобран — тип по сигнатуре: данные', info: { format: 'binary' } }).where(eq2(sch.files.id, d)).run();
    expect((await (await VIEW.GET(get(`/api/files/${d}/view`), idp(d))).json()).kind).toBe('none');
    const p = (await (await up({ file: new File(['bin'], 'выгрузка.parquet') })).json()).id;
    expect((await (await VIEW.GET(get(`/api/files/${p}/view`), idp(p))).json()).kind).toBe('extracted');
  });
  it('метки блоков серва «[lines a-b]» в тексте письма — не строки: нумерация по тексту без них', async () => {
    cur = { id: 'ua', role: 'user' };
    const e = (await (await up({ file: new File(['x'], 'письмо2.eml') })).json()).id;
    const { getDb: gdb, schema: sc } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    gdb().update(sc.files).set({ text: '[lines 1-3]\nСтрока 1\nСтрока 2\nСтрока 3\n[lines 4-5]\nСтрока 4\nСтрока 5' }).where(eq(sc.files.id, e)).run();
    const w = await (await TEXT.GET(get(`/api/files/${e}/text?from=1&to=10`), idp(e))).json();
    expect(w.lines).toEqual(['Строка 1', 'Строка 2', 'Строка 3', 'Строка 4', 'Строка 5']);
    expect(w.total).toBe(5);
    gdb().update(sc.files).set({ text: '[lines 1-2]\nТело письма\nвторая\n\n[вложение «Акт.docx»]\n[вложение «Акт.docx», page 1]\nТекст акта' }).where(eq(sc.files.id, e)).run();
    const f1 = await (await TEXT.GET(get(`/api/files/${e}/text?find=${encodeURIComponent('[вложение «Акт.docx», page 1]')}`), idp(e))).json();
    expect(f1.line).toBe(5);
    const f2 = await (await TEXT.GET(get(`/api/files/${e}/text?find=${encodeURIComponent('[вложение «Нет.docx»')}`), idp(e))).json();
    expect(f2.line).toBeNull();
  });
  it('content=1 — текст файла, как его видела модель (для сравнения)', async () => {
    cur = { id: 'ua', role: 'user' };
    const id = (await (await up({ file: file('a.txt', 'x'), path: 'К/a.txt' })).json()).id;
    const c = await (await VIEW.GET(get(`/api/files/${id}/view?content=1`), idp(id))).json();
    expect(c.text).toBe('текст файла К/a.txt');
  });
});

describe('библиотека pdf.js с нашего адреса', () => {
  it('отдаёт воркер, шрифты и таблицы кодировок; обход каталога и чужие файлы пакета — 404', async () => {
    const { GET } = await import('@/app/pdfjs/[...path]/route');
    const g = (parts: string[]) => GET(new Request('http://localhost/pdfjs/' + parts.join('/')), { params: Promise.resolve({ path: parts }) });
    const w = await g(['legacy', 'build', 'pdf.worker.min.mjs']);
    expect(w.status).toBe(200);
    expect(w.headers.get('content-type')).toContain('text/javascript');
    expect((await w.arrayBuffer()).byteLength).toBeGreaterThan(100_000);
    expect((await g(['legacy', 'build', 'pdf.min.mjs'])).status).toBe(200);
    expect((await g(['standard_fonts', 'FoxitFixedBold.pfb'])).status).toBe(200);
    for (const bad of [['..', 'package.json'], ['build', '..', 'package.json'], ['package.json'], ['legacy', 'web', 'x'], ['build', '..\\..', 'x'], ['build', 'нет.mjs']]) expect((await g(bad)).status, bad.join('/')).toBe(404);
  });
});

describe('просмотр: PDF и документы', () => {
  it('PDF отдаётся как есть, с Range; документ — через PDF-копию (конвертер подменён), ошибка — 422', async () => {
    cur = { id: 'ua', role: 'user' };
    const pdfBytes = Buffer.from('%PDF-1.4\n' + 'x'.repeat(500));
    const pid = (await (await up({ file: new File([new Uint8Array(pdfBytes)], 'д.pdf') })).json()).id;
    const r = await PDF.GET(get(`/api/files/${pid}/pdf`), idp(pid));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await r.arrayBuffer()).equals(pdfBytes)).toBe(true);
    const rr = await PDF.GET(new Request(`http://localhost/api/files/${pid}/pdf`, { headers: { ...H, Range: 'bytes=0-8' } }), idp(pid));
    expect(rr.status).toBe(206);
    expect(rr.headers.get('content-range')).toBe(`bytes 0-8/${pdfBytes.length}`);
    expect(await rr.text()).toBe('%PDF-1.4\n'.slice(0, 9));

    const { _test } = await import('@/lib/pdfcopy');
    let calls = 0;
    _test.setConverter(async ({ outDir, ext }) => { calls++; if (ext === 'rtf') return { ok: false, code: 'convert' }; fs.writeFileSync(path.join(outDir, 'doc.pdf'), '%PDF-1.4\nконвертировано'); return { ok: true }; });
    const did = (await (await up({ file: new File([new Uint8Array(Buffer.from('PK-docx'))], 'д.docx') })).json()).id;
    const d = await PDF.GET(get(`/api/files/${did}/pdf?wait=5000`), idp(did));
    expect(d.status).toBe(200);
    expect(await d.text()).toContain('конвертировано');
    await PDF.GET(get(`/api/files/${did}/pdf?wait=5000`), idp(did));
    expect(calls).toBe(1);
    const rid = (await (await up({ file: new File(['{\\rtf1 x}'], 'д.rtf') })).json()).id;
    const e = await PDF.GET(get(`/api/files/${rid}/pdf?wait=5000`), idp(rid));
    expect(e.status).toBe(422);
    expect(await e.json()).toMatchObject({ state: 'error', code: 'convert' });
    const t = (await (await up({ file: new File(['hi'], 'x.txt') })).json()).id;
    expect((await PDF.GET(get(`/api/files/${t}/pdf`), idp(t))).status).toBe(415);
    _test.setConverter(null);
  });
  it('кэш браузера: PDF и оригинал по id не меняются — ETag (sha256), immutable, повторный запрос с If-None-Match — 304 без тела; Range и If-Range сохраняются', async () => {
    cur = { id: 'ua', role: 'user' };
    const bytes = Buffer.from('%PDF-1.4\n' + 'y'.repeat(300));
    const up1 = await (await up({ file: new File([new Uint8Array(bytes)], 'кэш.pdf') })).json();
    const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const etag = `"${sha}"`;
    const r = await PDF.GET(get(`/api/files/${up1.id}/pdf`), idp(up1.id));
    expect(r.headers.get('etag')).toBe(etag);
    expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(r.headers.get('vary')).toBe('Cookie');
    await r.arrayBuffer();
    const nm = await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, 'If-None-Match': etag } }), idp(up1.id));
    expect(nm.status).toBe(304);
    expect(await nm.text()).toBe('');
    expect(nm.headers.get('etag')).toBe(etag);
    expect(nm.headers.get('cache-control')).toContain('immutable');
    const weak = await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, 'If-None-Match': `"x", W/${etag}` } }), idp(up1.id));
    expect(weak.status).toBe(304);
    const other = await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, 'If-None-Match': '"other"' } }), idp(up1.id));
    expect(other.status).toBe(200);
    await other.arrayBuffer();
    const part = await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, Range: 'bytes=0-8', 'If-Range': etag } }), idp(up1.id));
    expect(part.status).toBe(206); expect(part.headers.get('etag')).toBe(etag);
    await part.arrayBuffer();
    const whole = await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, Range: 'bytes=0-8', 'If-Range': '"stale"' } }), idp(up1.id));
    expect(whole.status).toBe(200); expect((await whole.arrayBuffer()).byteLength).toBe(bytes.length);
    cur = { id: 'ub', role: 'user' };
    expect((await PDF.GET(new Request(`http://localhost/api/files/${up1.id}/pdf`, { headers: { ...H, 'If-None-Match': etag } }), idp(up1.id))).status).toBe(404);
    cur = { id: 'ua', role: 'user' };
    const ORIG = await import('@/app/api/files/[id]/route');
    const o = await ORIG.GET(get(`/api/files/${up1.id}`), idp(up1.id));
    expect(o.headers.get('etag')).toBe(etag);
    expect(o.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    await o.arrayBuffer();
    expect((await ORIG.GET(new Request(`http://localhost/api/files/${up1.id}`, { headers: { ...H, 'If-None-Match': etag } }), idp(up1.id))).status).toBe(304);
    const { _test } = await import('@/lib/pdfcopy');
    _test.setConverter(async ({ outDir }) => { fs.writeFileSync(path.join(outDir, 'doc.pdf'), '%PDF-1.4\nкопия'); return { ok: true }; });
    const did = await (await up({ file: new File([new Uint8Array(Buffer.from('PK-docx2'))], 'к.docx') })).json();
    const c = await PDF.GET(get(`/api/files/${did.id}/pdf?wait=5000`), idp(did.id));
    expect(c.headers.get('etag')).toMatch(/^"[0-9a-f]{64}-pdf"$/);
    expect(c.headers.get('cache-control')).toBe('private, max-age=3600');
    await c.arrayBuffer();
    _test.setConverter(null);
  });
});
