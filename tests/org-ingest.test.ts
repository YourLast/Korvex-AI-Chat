import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpData } from './helpers';

vi.mock('@/lib/extract', async (orig) => ({
  ...(await orig<typeof import('@/lib/extract')>()),
  ingestDocument: async (b: Buffer, name: string) => ({ ok: true, text: /\.txt$/.test(name) ? b.toString('utf8') : `текст ${name}`, info: { format: 'x', extractor: 'test' } }),
}));
let me = 'u';
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, authed: async () => { const { getDb, schema } = await import('@/lib/db'); const { eq } = await import('drizzle-orm'); return { user: getDb().select().from(schema.users).where(eq(schema.users.id, me)).get()! }; } };
});

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let I: typeof import('@/lib/orgIngest');
const KL = '1CClientBankExchange\nДатаНачала=01.10.2026\nДатаКонца=31.10.2026\nСекцияРасчСчет\nКонецРасчСчет\n';
const form = (fields: Record<string, string>, files: [string, string][] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const [name, body] of files) f.append('file', new File([body], name, { type: 'text/plain' }));
  return f;
};

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values([{ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }, { id: 'v', email: 'v@t', name: 'V', passwordHash: 'x', role: 'user', createdAt: 1 }]).run();
  db.insert(schema.folders).values([{ id: 'org1', userId: 'u', name: 'Ромашка', createdAt: 1, updatedAt: 1 }, { id: 'org2', userId: 'u', name: 'Лютик', createdAt: 1, updatedAt: 1 }, { id: 'orgV', userId: 'v', name: 'Чужая', createdAt: 1, updatedAt: 1 }]).run();
  I = await import('@/lib/orgIngest');
});
afterEach(() => { delete process.env.KX_ORG_INGEST; });

describe('приём по ключу организации', () => {
  it('ключ — только своя организация; файл в её библиотеке, тип определён, пометка «откуда»', async () => {
    const key = I.issueKey('u', 'org1');
    expect(key).toMatch(/^kxo_[A-Za-z0-9]{32}$/);
    expect(I.inboxView('u', 'org1')).toMatchObject({ hasKey: true, keyHint: key.slice(-4) });
    expect(JSON.stringify(db.select().from(schema.orgInbox).all())).not.toContain(key);
    const { POST } = await import('@/app/api/orgs/[id]/ingest/route');
    const call = (id: string, k: string) => POST(new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${k}` }, body: form({}, [['kl_to_1c.txt', KL], ['Счет_77.txt', 'Счёт на оплату № 77 от 21.10.2026']]) }), { params: Promise.resolve({ id }) });
    const r = await call('org1', key);
    expect(r.status).toBe(200);
    const j = await r.json() as { files: { file_id: string; doc_type: string }[] };
    expect(j.files.map((f) => f.doc_type)).toEqual(['statement', 'invoice']);
    const row = db.select().from(schema.files).all().find((f) => f.id === j.files[0].file_id)!;
    expect(row).toMatchObject({ folderId: 'org1', threadId: null, userId: 'u', docFrom: '2026-10-01', docTo: '2026-10-31' });
    expect((row.info as { ingest?: { via: string } }).ingest?.via).toBe('key');
    expect((await call('org2', key)).status).toBe(401);
    expect(await (await call('org1', 'kxo_wrong')).json()).toMatchObject({ reason: 'key' });
    I.revokeKey('u', 'org1');
    expect((await call('org1', key)).status).toBe(401);
    process.env.KX_ORG_INGEST = '0';
    expect((await call('org1', key)).status).toBe(503);
  });
});

describe('приём по ключу: имя файла по RFC 5987', () => {
  it('filename*=UTF-8\'\'… (так шлют requests и часть программ 1С) — принят, имя в UTF-8', async () => {
    const key = I.issueKey('u', 'org1');
    const B = '----kx5987';
    const body = [`--${B}`, `Content-Disposition: form-data; name="file"; filename*=UTF-8''${encodeURIComponent('Выписка_октябрь.txt')}`, 'Content-Type: text/plain', '', KL, `--${B}--`, ''].join('\r\n');
    const { POST } = await import('@/app/api/orgs/[id]/ingest/route');
    const r = await POST(new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': `multipart/form-data; boundary=${B}` }, body }), { params: Promise.resolve({ id: 'org1' }) });
    expect(r.status).toBe(200);
    const j = await r.json() as { files: { file_id: string; doc_type: string }[] };
    expect(j.files[0].doc_type).toBe('statement');
    expect(db.select().from(schema.files).all().find((f) => f.id === j.files[0].file_id)?.name).toBe('Выписка_октябрь.txt');
    I.revokeKey('u', 'org1');
  });
});

describe('приём от сборщика почты', () => {
  const collector = 'test-collector';
  const send = async (fields: Record<string, string>, headers: Record<string, string> = {}, file: [string, string] = ['kl_to_1c.txt', KL]) => {
    process.env.KX_COLLECTOR_KEY_SHA256 = createHash('sha256').update(collector).digest('hex');
    const { POST } = await import('@/app/api/orgs/mail-ingest/route');
    const r = await POST(new Request('http://x', { method: 'POST', headers: { 'X-Collector-Key': collector, ...headers }, body: form(fields, [file]) }));
    return { status: r.status, j: await r.json() as Record<string, unknown> };
  };
  it('метка, SPF/DKIM, отправитель, повтор, через прокси и чужой секрет — отказ с причиной', async () => {
    const tag = I.inboxView('u', 'org2').tag;
    I.setSenders('u', 'org2', ['buh@client.ru', '@bank.ru', 'не адрес']);
    expect(I.inboxView('u', 'org2').senders).toEqual(['buh@client.ru', '@bank.ru']);
    const base = { tag, sender: 'Bank <noreply@bank.ru>', auth: 'pass', message_id: '<m1@bank.ru>' };
    expect(await send(base, { 'X-Forwarded-For': '1.2.3.4' })).toMatchObject({ status: 401, j: { reason: 'proxy' } });
    expect(await send(base, { 'CF-Connecting-IP': '5.6.7.8' })).toMatchObject({ status: 401, j: { reason: 'proxy' } });
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '127.0.0.1' }))).toBe(false);
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '::ffff:127.0.0.1' }))).toBe(false);
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '203.0.113.7, 127.0.0.1' }))).toBe(true);
    expect(await send(base, { 'X-Collector-Key': 'nope' })).toMatchObject({ status: 401, j: { reason: 'key' } });
    expect(await send({ ...base, tag: 'zzzzzzzzzzzz' })).toMatchObject({ status: 404, j: { reason: 'tag' } });
    expect(await send({ ...base, auth: 'fail' })).toMatchObject({ status: 403, j: { reason: 'auth' } });
    expect(await send({ ...base, sender: 'evil@other.ru' })).toMatchObject({ status: 403, j: { reason: 'sender' } });
    const ok = await send({ ...base, tag: tag.toUpperCase() });
    expect(ok).toMatchObject({ status: 200, j: { doc_type: 'statement' } });
    const again = await send(base);
    expect(again).toMatchObject({ status: 200, j: { file_id: ok.j.file_id, duplicate: true } });
    const row = db.select().from(schema.files).all().find((f) => f.id === ok.j.file_id)!;
    expect(row).toMatchObject({ folderId: 'org2', threadId: null });
    expect(row.info).toMatchObject({ ingest: { via: 'mail' }, mail: { messageId: '<m1@bank.ru>', sender: 'bank <noreply@bank.ru>' } });
    expect(I.acceptedToday('org2')).toBe(1);
  });
  it('перевыпуск метки — старая больше не работает; без секрета в окружении — отказ', async () => {
    const old = I.inboxView('u', 'org2').tag;
    I.reissueTag('u', 'org2');
    expect(I.inboxView('u', 'org2').tag).not.toBe(old);
    expect((await send({ tag: old, sender: 'buh@client.ru', auth: 'pass', message_id: 'x' })).status).toBe(404);
    expect(I.collectorOk(null)).toBe(false);
  });
});

describe('настройки приёма в организации', () => {
  it('адрес из KX_ORG_MAIL, отправители, ключ один раз в ответе; чужая организация — 404', async () => {
    process.env.KX_ORG_MAIL = 'in@example.com';
    const { GET, POST } = await import('@/app/api/folders/[id]/inbox/route');
    const v = await (await GET(new Request('http://x'), { params: Promise.resolve({ id: 'org1' }) })).json() as { address: string; tag: string };
    expect(v.address).toBe(`in+${v.tag}@example.com`);
    const r = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ issueKey: true, senders: ['1c@romashka.ru'] }) }), { params: Promise.resolve({ id: 'org1' }) })).json() as { key?: string; senders: string[]; hasKey: boolean };
    expect(r.key).toMatch(/^kxo_/);
    expect(r).toMatchObject({ senders: ['1c@romashka.ru'], hasKey: true });
    const again = await (await GET(new Request('http://x'), { params: Promise.resolve({ id: 'org1' }) })).json() as { key?: string };
    expect(again.key).toBeUndefined();
    expect((await GET(new Request('http://x'), { params: Promise.resolve({ id: 'orgV' }) })).status).toBe(404);
    delete process.env.KX_ORG_MAIL;
  });
});
