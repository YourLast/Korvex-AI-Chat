import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
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
const OUT = path.join(dir, 'up-out');
fs.mkdirSync(OUT, { recursive: true });
process.env.KX_OUT_DIR = OUT;
const FIX = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const A = { id: 'pa', token: 'tok-pa' }, B = { id: 'pb', token: 'tok-pb' }, ADM = { id: 'padm', token: 'tok-padm' };

type PV = typeof import('@/lib/preview');
let PV: PV;
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;

function deliver(name: string, body: Buffer | string, owner: string | null = A.id): string {
  const t = randomBytes(16).toString('hex');
  fs.mkdirSync(path.join(OUT, t));
  fs.writeFileSync(path.join(OUT, t, name), body);
  if (owner) db.insert(schema.outFiles).values({ token: t, userId: owner, threadId: null, messageId: null, source: 'job', createdAt: Date.now() }).run();
  return t;
}

const calls: string[] = [];
function fake(n = 3, opt: { delay?: number; fail?: 'convert' | 'timeout'; junk?: boolean } = {}): import('@/lib/preview').Converter {
  return async ({ src, outDir, widths }) => {
    calls.push(fs.readFileSync(src, 'utf8').slice(0, 40));
    if (opt.delay) await new Promise((r) => setTimeout(r, opt.delay));
    if (opt.fail) return { ok: false, code: opt.fail, detail: 'подставная ошибка' };
    for (let i = 1; i <= n; i++) for (const w of widths) fs.writeFileSync(path.join(outDir, `${i}-${w}.webp`), `RIFF page ${i} w ${w}`);
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ pages: Array.from({ length: n }, () => [1600, 900]), total: n }));
    if (opt.junk) { fs.writeFileSync(path.join(outDir, 'evil.sh'), 'x'); fs.symlinkSync('/etc/passwd', path.join(outDir, 'link.webp')); }
    return { ok: true };
  };
}

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  const now = Date.now();
  for (const u of [A, B, ADM]) {
    db.insert(schema.users).values({ id: u.id, email: `${u.id}@t`, name: u.id, passwordHash: 'x', role: u === ADM ? 'admin' : 'user', createdAt: now }).run();
    db.insert(schema.sessions).values({ id: sha(u.token), userId: u.id, createdAt: now, expiresAt: now + 864e5 }).run();
  }
  PV = await import('@/lib/preview');
});
afterAll(() => { PV?._test.setConverter(null); });

const as = (u: { token: string } | null) => { jar.token = u?.token ?? ''; };
const H = { Origin: 'http://localhost', Host: 'localhost' };
async function get(token: string, name: string, q = '') {
  const { GET } = await import('@/app/out/[token]/[...name]/route');
  return GET(new Request(`http://localhost/out/${token}/${encodeURIComponent(name)}${q}`, { headers: H }), { params: Promise.resolve({ token, name: [name] }) });
}
const state = async (token: string, name: string, q = '&wait=5000') => {
  const r = await get(token, name, `?preview=1${q}`);
  return { status: r.status, body: (await r.json()) as { state: string; kind?: string; v?: string; pages?: number[][]; total?: number; code?: string }, headers: r.headers };
};

describe('просмотр файла модели: доступ как к самому файлу', () => {
  it('владелец получает страницы; чужой — 404 как «нет такого» и как на сам файл; без входа — 401', async () => {
    PV._test.setConverter(fake(3));
    const t = deliver('Обзор.pptx', 'deck-access');
    as(A);
    const s = await state(t, 'Обзор.pptx');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ state: 'ready', kind: 'slides', total: 3 });
    expect(s.body.pages).toHaveLength(3);
    expect(s.headers.get('cache-control')).toContain('no-store');
    const img = await get(t, 'Обзор.pptx', `?preview=1&page=2&w=1080&v=${s.body.v}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(await img.text()).toBe('RIFF page 2 w 1080');

    as(B);
    const foreign = await get(t, 'Обзор.pptx', '?preview=1');
    const foreignPage = await get(t, 'Обзор.pptx', `?preview=1&page=1&w=1600&v=${s.body.v}`);
    const none = await get('0'.repeat(32), 'Обзор.pptx', '?preview=1');
    const fileItself = await get(t, 'Обзор.pptx');
    for (const r of [foreign, foreignPage, none, fileItself]) expect(r.status).toBe(404);
    expect(await foreign.text()).toBe(await none.text());

    as(null);
    expect((await get(t, 'Обзор.pptx', '?preview=1')).status).toBe(401);
    expect((await get(t, 'Обзор.pptx', '?preview=1&page=1&w=1600')).status).toBe(401);
  });

  it('админ открывает просмотр чужого файла: одна запись в журнал за открытие, страницы — без записей', async () => {
    PV._test.setConverter(fake(2));
    const t = deliver('plan.docx', 'docx-admin');
    as(ADM);
    const s = await state(t, 'plan.docx');
    expect(s.body).toMatchObject({ state: 'ready', kind: 'pages' });
    for (const n of [1, 2]) expect((await get(t, 'plan.docx', `?preview=1&page=${n}&w=320&v=${s.body.v}`)).status).toBe(200);
    const logs = db.select().from(schema.adminViews).all().filter((v) => v.target === t);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ adminId: ADM.id, ownerId: A.id, kind: 'file' });
  });

  it('таблица — не показывается (415), страница вне диапазона и чужая ширина — 404', async () => {
    PV._test.setConverter(fake(2));
    as(A);
    const x = deliver('wells.xlsx', 'xlsx');
    const r = await state(x, 'wells.xlsx');
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ state: 'error', code: 'unsupported' });
    const t = deliver('brief.pdf', '%PDF-range');
    const s = await state(t, 'brief.pdf');
    expect(s.body.state).toBe('ready');
    for (const q of ['page=3&w=1600', 'page=0&w=1600', 'page=1&w=999', 'page=../../x&w=1600']) expect((await get(t, 'brief.pdf', `?preview=1&${q}`)).status, q).toBe(404);
  });
});

describe('кэш по sha256', () => {
  it('повторное открытие, тот же файл в другом токене и «перезапуск» вебки — без новой конвертации', async () => {
    PV._test.setConverter(fake(4));
    as(A);
    const t1 = deliver('q3.pptx', 'deck-cache-same-bytes');
    const n0 = PV._test.runs();
    const s1 = await state(t1, 'q3.pptx');
    expect(s1.body.state).toBe('ready');
    expect(PV._test.runs()).toBe(n0 + 1);
    expect(fs.existsSync(path.join(dir, 'previews', sha('deck-cache-same-bytes'), 'manifest.json'))).toBe(true);
    const t0 = Date.now();
    const s2 = await state(t1, 'q3.pptx');
    expect(Date.now() - t0).toBeLessThan(500);
    const t2 = deliver('копия.pptx', 'deck-cache-same-bytes');
    const s3 = await state(t2, 'копия.pptx');
    PV._test.reset();
    const s4 = await state(t1, 'q3.pptx');
    expect([s2.body.v, s3.body.v, s4.body.v]).toEqual([s1.body.v, s1.body.v, s1.body.v]);
    expect(PV._test.runs()).toBe(0);
  });

  it('одновременные открытия одного файла — одна конвертация; пока идёт — pending', async () => {
    PV._test.setConverter(fake(2, { delay: 300 }));
    as(A);
    const t = deliver('live.pptx', 'deck-concurrent');
    const before = calls.length;
    const first = await state(t, 'live.pptx', '&wait=0');
    expect(first.body.state).toBe('pending');
    const all = await Promise.all([state(t, 'live.pptx'), state(t, 'live.pptx'), state(t, 'live.pptx')]);
    expect(all.map((x) => x.body.state)).toEqual(['ready', 'ready', 'ready']);
    expect(calls.length - before).toBe(1);
  });

  it('выход конвертера проверяется: лишние файлы и ссылки убраны', async () => {
    PV._test.setConverter(fake(1, { junk: true }));
    as(A);
    const t = deliver('junk.pptx', 'deck-junk');
    expect((await state(t, 'junk.pptx')).body.state).toBe('ready');
    expect(fs.readdirSync(path.join(dir, 'previews', sha('deck-junk'))).sort()).toEqual(['1-1080.webp', '1-1600.webp', '1-320.webp', 'manifest.json']);
    expect(fs.readdirSync(path.join(dir, 'previews')).filter((f) => f.startsWith('.tmp-'))).toEqual([]);
  });
});

describe('уборка кэша', () => {
  it('не открывали 60 дней — удалён; открывали — остаётся; незаконченная конвертация старше часа — удалена', async () => {
    PV._test.setConverter(fake(1));
    as(A);
    const t1 = deliver('old.pptx', 'deck-sweep-old'), t2 = deliver('fresh.pptx', 'deck-sweep-fresh');
    await state(t1, 'old.pptx'); await state(t2, 'fresh.pptx');
    const root = path.join(dir, 'previews'), old = path.join(root, sha('deck-sweep-old')), fresh = path.join(root, sha('deck-sweep-fresh'));
    const long = (Date.now() - PV.KEEP_MS - 86_400_000) / 1000;
    fs.utimesSync(old, long, long); fs.utimesSync(fresh, long, long);
    PV._test.reset();
    await state(t2, 'fresh.pptx');
    const tmp = path.join(root, '.tmp-deadbeef-0000'); fs.mkdirSync(tmp); fs.utimesSync(tmp, Date.now() / 1000 - 7200, Date.now() / 1000 - 7200);
    PV.sweep(root, Date.now(), true);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(tmp)).toBe(false);
    const n0 = PV._test.runs();
    expect((await state(t1, 'old.pptx')).body.state).toBe('ready');
    expect(PV._test.runs()).toBe(n0 + 1);
  });
});

describe('ошибка конвертации', () => {
  it('понятный код, запоминается на 10 минут (без повторных запусков), потом — новая попытка', async () => {
    PV._test.setConverter(fake(1, { fail: 'convert' }));
    as(A);
    const t = deliver('broken.pptx', 'not-a-pptx');
    const n0 = PV._test.runs();
    const s = await state(t, 'broken.pptx');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ state: 'error', code: 'convert', kind: 'slides' });
    expect((await state(t, 'broken.pptx')).body).toMatchObject({ state: 'error', code: 'convert' });
    expect(PV._test.runs()).toBe(n0 + 1);
    expect((await get(t, 'broken.pptx', '?preview=1&page=1&w=1600')).status).toBe(404);
    const ef = path.join(dir, 'previews', `${sha('not-a-pptx')}.err.json`);
    fs.writeFileSync(ef, JSON.stringify({ code: 'convert', at: Date.now() - PV.RETRY_MS - 1 }));
    PV._test.setConverter(fake(2));
    expect((await state(t, 'broken.pptx')).body).toMatchObject({ state: 'ready', total: 2 });
    expect(fs.existsSync(ef)).toBe(false);
  });

  it('тайм-аут и слишком большой файл — свои коды; файл при этом скачивается как обычно', async () => {
    PV._test.setConverter(fake(1, { fail: 'timeout' }));
    as(A);
    const t = deliver('slow.pptx', 'deck-timeout');
    expect((await state(t, 'slow.pptx')).body).toMatchObject({ state: 'error', code: 'timeout' });
    const dl = await get(t, 'slow.pptx');
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const big = deliver('huge.pptx', Buffer.alloc(PV.MAX_BYTES + 1));
    expect((await state(big, 'huge.pptx')).body).toMatchObject({ state: 'error', code: 'too-big' });
  });

  it('нет docker или образа — «unavailable», а не зависание', async () => {
    PV._test.setConverter(null);
    process.env.KX_PREVIEW_IMAGE = 'korvex-no-such-image:0';
    as(A);
    const t = deliver('noimg.pptx', 'deck-no-image');
    try {
      const s = await state(t, 'noimg.pptx', '&wait=20000');
      expect(s.body).toMatchObject({ state: 'error' });
      expect(['unavailable', 'convert']).toContain(s.body.code);
    } finally { delete process.env.KX_PREVIEW_IMAGE; }
  });
});

describe('просмотр файла, загруженного человеком (поле ввода): /api/files/<id>?preview=…', () => {
  function upload(name: string, body: string, owner = A.id): string {
    const id = randomUUID();
    fs.mkdirSync(path.join(dir, 'files', id), { recursive: true });
    fs.writeFileSync(path.join(dir, 'files', id, 'original' + path.extname(name)), body);
    db.insert(schema.files).values({ id, userId: owner, threadId: null, name, mime: 'application/octet-stream', size: body.length, sha256: sha(body), createdAt: Date.now() }).run();
    return id;
  }
  async function getFile(id: string, q = '') {
    const { GET } = await import('@/app/api/files/[id]/route');
    return GET(new Request(`http://localhost/api/files/${id}${q}`, { headers: H }), { params: Promise.resolve({ id }) });
  }

  it('владелец: страницы презентации и документа; чужой — 404; без входа — 401; сам файл по-прежнему вложением', async () => {
    PV._test.setConverter(fake(3));
    const id = upload('Отчёт.pdf', '%PDF-user-upload');
    as(A);
    const r = await getFile(id, '?preview=1&wait=5000');
    expect(r.status).toBe(200);
    const s = (await r.json()) as { state: string; kind: string; v: string; total: number };
    expect(s).toMatchObject({ state: 'ready', kind: 'pages', total: 3 });
    const img = await getFile(id, `?preview=1&page=2&w=1080&v=${s.v}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(await img.text()).toBe('RIFF page 2 w 1080');
    const own = await getFile(id);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-disposition')).toContain('attachment');

    as(B);
    expect((await getFile(id, '?preview=1')).status).toBe(404);
    expect((await getFile(id, `?preview=1&page=1&w=1600&v=${s.v}`)).status).toBe(404);
    as(null);
    expect((await getFile(id, '?preview=1')).status).toBe(401);
  });

  it('таблица — 415 «не показывается»; админ открывает чужой файл: одна запись в журнал, страницы — без записей', async () => {
    PV._test.setConverter(fake(2));
    const x = upload('wells.xlsx', 'xlsx-user-upload');
    as(A);
    const r = await getFile(x, '?preview=1');
    expect(r.status).toBe(415);
    const d = upload('plan.docx', 'docx-user-upload');
    as(ADM);
    const s = (await (await getFile(d, '?preview=1&wait=5000')).json()) as { v: string };
    for (const n of [1, 2]) expect((await getFile(d, `?preview=1&page=${n}&w=320&v=${s.v}`)).status).toBe(200);
    const logs = db.select().from(schema.adminViews).all().filter((v) => v.target === d);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ adminId: ADM.id, ownerId: A.id, kind: 'file' });
  });
});

let hasImage = false;
try { execFileSync('docker', ['image', 'inspect', 'up-sandbox:py312-4', '--format', '{{.Id}}'], { stdio: 'ignore', timeout: 15_000 }); hasImage = true; } catch {  }

describe.skipIf(!hasImage)('настоящая конвертация в контейнере', () => {
  it('pptx из 12 слайдов -> 12 страниц 16:9 трёх ширин; контейнер kxprev-* убран', async () => {
    PV._test.setConverter(null);
    as(A);
    const t = deliver('deck.pptx', fs.readFileSync(path.join(FIX, 'deck.pptx')));
    let s = await state(t, 'deck.pptx', '&wait=25000');
    for (let i = 0; i < 6 && s.body.state === 'pending'; i++) s = await state(t, 'deck.pptx', '&wait=25000');
    expect(s.body).toMatchObject({ state: 'ready', kind: 'slides', total: 12 });
    expect(s.body.pages!.every(([w, h]) => w === 1600 && Math.abs(h - 900) < 3)).toBe(true);
    const img = await get(t, 'deck.pptx', `?preview=1&page=12&w=320&v=${s.body.v}`);
    const buf = Buffer.from(await img.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe('RIFF');
    expect(buf.subarray(8, 12).toString()).toBe('WEBP');
    const left = execFileSync('docker', ['ps', '-a', '--filter', 'label=korvex.preview=1', '--filter', 'status=exited', '--format', '{{.Names}}'], { encoding: 'utf8' });
    expect(left.split('\n').filter((n) => n.startsWith('kxprev-'))).toEqual([]);
  }, 120_000);
});
