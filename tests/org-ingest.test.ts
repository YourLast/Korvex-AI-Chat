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
    const base = { tag, sender: 'noreply@bank.ru', auth: 'pass', aligned_domain: 'bank.ru', message_id: '<m1@bank.ru>' };
    expect(await send(base, { 'X-Forwarded-For': '1.2.3.4' })).toMatchObject({ status: 401, j: { reason: 'proxy' } });
    expect(await send(base, { 'CF-Connecting-IP': '5.6.7.8' })).toMatchObject({ status: 401, j: { reason: 'proxy' } });
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '127.0.0.1' }))).toBe(false);
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '::ffff:127.0.0.1' }))).toBe(false);
    expect(I.viaProxy(new Headers({ 'x-forwarded-for': '203.0.113.7, 127.0.0.1' }))).toBe(true);
    expect(await send(base, { 'X-Collector-Key': 'nope' })).toMatchObject({ status: 401, j: { reason: 'key' } });
    expect(await send({ ...base, tag: 'zzzzzzzzzzzz' })).toMatchObject({ status: 404, j: { reason: 'tag' } });
    expect(await send({ ...base, auth: 'fail' })).toMatchObject({ status: 403, j: { reason: 'auth' } });
    expect(await send({ ...base, sender: 'evil@other.ru', aligned_domain: 'other.ru' })).toMatchObject({ status: 403, j: { reason: 'sender' } });
    const ok = await send({ ...base, tag: tag.toUpperCase() });
    expect(ok).toMatchObject({ status: 200, j: { doc_type: 'statement' } });
    const again = await send(base);
    expect(again).toMatchObject({ status: 200, j: { file_id: ok.j.file_id, duplicate: true } });
    const row = db.select().from(schema.files).all().find((f) => f.id === ok.j.file_id)!;
    expect(row).toMatchObject({ folderId: 'org2', threadId: null });
    expect(row.info).toMatchObject({ ingest: { via: 'mail' }, mail: { messageId: '<m1@bank.ru>', sender: 'noreply@bank.ru' } });
    expect(I.acceptedToday('org2')).toBe(1);
  });
  it('перевыпуск метки — старая больше не работает; без секрета в окружении — отказ', async () => {
    const old = I.inboxView('u', 'org2').tag;
    I.reissueTag('u', 'org2');
    expect(I.inboxView('u', 'org2').tag).not.toBe(old);
    expect((await send({ tag: old, sender: 'buh@client.ru', auth: 'pass', aligned_domain: 'client.ru', message_id: 'x' })).status).toBe(404);
    expect(I.collectorOk(null)).toBe(false);
  });
});

describe('подделка отправителя (ревью безопасности 13.11, п.1)', () => {
  const collector = 'test-collector';
  const send = async (fields: Record<string, string>) => {
    process.env.KX_COLLECTOR_KEY_SHA256 = createHash('sha256').update(collector).digest('hex');
    const { POST } = await import('@/app/api/orgs/mail-ingest/route');
    const r = await POST(new Request('http://x', { method: 'POST', headers: { 'X-Collector-Key': collector }, body: form(fields, [['kl_to_1c.txt', KL]]) }));
    return { status: r.status, j: await r.json() as Record<string, unknown> };
  };
  it('From: "<buh@client.ru>"@evil.com при разрешённых buh@client.ru и @client.ru — отказ, файла нет; другие виды того же — тоже', async () => {
    const tag = I.inboxView('u', 'org1').tag;
    I.setSenders('u', 'org1', ['buh@client.ru', '@client.ru']);
    const files = () => db.select().from(schema.files).all().length;
    const before = files();
    const base = { tag, auth: 'pass', message_id: '<spoof@evil.com>' };
    for (const sender of ['"<buh@client.ru>"@evil.com', '"x" <"<buh@client.ru>"@evil.com>', 'buh@client.ru <x@evil.com>', 'Бух <buh@client.ru>', 'grp: buh@client.ru;', '=?utf-8?q?buh=40client.ru?=@evil.com', 'buh@client.ru@evil.com', 'buh @client.ru', '(c)buh@client.ru'])
      expect(await send({ ...base, sender, aligned_domain: 'evil.com' }), sender).toMatchObject({ status: 403, j: { reason: 'sender_format' } });
    expect(await send({ ...base, sender: 'buh@client.ru', aligned_domain: 'evil.com' })).toMatchObject({ status: 403, j: { reason: 'auth' } });
    expect(await send({ ...base, sender: 'buh@client.ru' })).toMatchObject({ status: 403, j: { reason: 'auth' } });
    expect(await send({ ...base, sender: 'buh@docs.client.ru', aligned_domain: 'docs.client.ru' })).toMatchObject({ status: 403, j: { reason: 'sender' } });
    expect(files()).toBe(before);
    expect(await send({ ...base, message_id: '<ok@client.ru>', sender: ' BUH@Client.RU ', aligned_domain: 'CLIENT.ru' })).toMatchObject({ status: 200 });
    expect(files()).toBe(before + 1);
  });
  it('голый адрес: имя, кавычки, скобки, пробелы, две @, две точки подряд — не адрес; список отправителей — только голые адреса и @домен', () => {
    expect(I.bareAddress('Noreply@Bank.RU')).toEqual({ addr: 'noreply@bank.ru', local: 'noreply', domain: 'bank.ru' });
    expect(I.bareAddress('a.b+tag=x%y_z-1@xn--80a1acny.xn--p1ai')?.domain).toBe('xn--80a1acny.xn--p1ai');
    for (const bad of ['"a"@b.ru', '<a@b.ru>', 'a b@c.ru', 'a@@b.ru', 'a..b@c.ru', '.a@b.ru', 'a.@b.ru', 'a@b', 'a@-b.ru', 'a@b.r', 'бух@client.ru', 'a@клиент.рф', 'a@b.ru\nx@evil.com', 'a\tb@c.ru'])
      expect(I.bareAddress(bad), bad).toBeNull();
    expect(I.cleanSenders(['buh@client.ru', '@bank.ru', '"<x@y.ru>"@evil.com', 'Bank <n@bank.ru>', '@evil', 'не адрес'])).toEqual(['buh@client.ru', '@bank.ru']);
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
