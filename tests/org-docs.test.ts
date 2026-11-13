import { beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let O: typeof import('@/lib/orgDocs');
let eq: typeof import('drizzle-orm').eq;
let me: { id: string; role: string; email: string } = { id: 'u', role: 'user', email: 'u@t' };
vi.mock('@/lib/api', async (orig) => {
  const m = await orig<typeof import('@/lib/api')>();
  return { ...m, authed: async () => { const { getDb, schema: s } = await import('@/lib/db'); const { eq: e } = await import('drizzle-orm'); return { user: getDb().select().from(s.users).where(e(s.users.id, me.id)).get()! }; } };
});

const KL = (from: string, to: string) => `1CClientBankExchange\nДатаНачала=${from}\nДатаКонца=${to}\nСекцияРасчСчет\nКонецРасчСчет\nКонецФайла`;

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  O = await import('@/lib/orgDocs');
  db.insert(schema.users).values([{ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }, { id: 'v', email: 'v@t', name: 'V', passwordHash: 'x', role: 'user', createdAt: 1 }]).run();
  db.insert(schema.folders).values([{ id: 'org1', userId: 'u', name: 'ООО Ромашка', createdAt: 1, updatedAt: 1 }, { id: 'org2', userId: 'u', name: 'ИП Лютик', createdAt: 1, updatedAt: 1 }, { id: 'orgV', userId: 'v', name: 'Чужая', createdAt: 1, updatedAt: 1 }]).run();
  db.insert(schema.threads).values([{ id: 't1', userId: 'u', title: 'Ромашка: октябрь', modelId: 'alpha', effort: 'medium', folderId: 'org1', createdAt: 1, updatedAt: 1 },
    { id: 't2', userId: 'u', title: 'Лютик', modelId: 'alpha', effort: 'medium', folderId: 'org2', createdAt: 1, updatedAt: 1 }]).run();
  const f = (id: string, o: Partial<typeof schema.files.$inferInsert>) => db.insert(schema.files).values({ id, userId: 'u', threadId: null, name: `${id}.txt`, mime: 'text/plain', size: 10, sha256: id, text: '', createdAt: 1, ...o }).run();
  f('st-sep', { folderId: 'org1', name: 'kl_to_1c_sep.txt', text: KL('01.09.2026', '30.09.2026'), ...O.docFields('kl_to_1c_sep.txt', KL('01.09.2026', '30.09.2026'), null) });
  f('st-oct', { folderId: 'org1', name: 'kl_to_1c_oct.txt', text: KL('01.10.2026', '31.10.2026'), ...O.docFields('kl_to_1c_oct.txt', KL('01.10.2026', '31.10.2026'), null) });
  f('upd', { folderId: 'org1', name: 'УПД_245.pdf', text: 'Универсальный передаточный документ\nСчёт-фактура № 245 от 14.10.2026\nВсего к оплате: 118 000,00' });
  f('act', { threadId: 't1', name: 'акт_17.pdf', text: 'Акт № 17 от 20.10.2026 оказанных услуг', ...O.docFields('акт_17.pdf', 'Акт № 17 от 20.10.2026 оказанных услуг', null) });
  f('act-copy', { threadId: 't1', name: 'акт_17 (копия).pdf', sha256: 'act', text: 'Акт № 17 от 20.10.2026', createdAt: 5 });
  f('inv', { threadId: 't2', name: 'Счет_77.pdf', text: 'Счёт на оплату № 77 от 20.10.2026', ...O.docFields('Счет_77.pdf', 'Счёт на оплату № 77 от 20.10.2026', null) });
  f('free', { name: 'черновик.txt' });
});

describe('документы организации', () => {
  it('библиотека и файлы чатов организации; чужая организация и несвязанные загрузки — нет; копии одного файла — одним', () => {
    const all = O.listOrgDocs('u', 'org1');
    expect(all.map((d) => d.id).sort()).toEqual(['act', 'st-oct', 'st-sep', 'upd']);
    expect(all.find((d) => d.id === 'st-oct')).toMatchObject({ type: 'statement', from: '2026-10-01', to: '2026-10-31', library: true });
    expect(all.find((d) => d.id === 'act')).toMatchObject({ type: 'act', library: false, threadId: 't1' });
    expect(O.listOrgDocs('u', null).map((d) => d.id)).not.toContain('free');
    expect(O.listOrgDocs('u', null).map((d) => d.id)).toContain('inv');
  });
  it('старый файл без разметки размечается при показе и запоминается', () => {
    expect(db.select().from(schema.files).where(eq(schema.files.id, 'upd')).get()?.docType).toBe('upd');
    const u = O.listOrgDocs('u', 'org1').find((d) => d.id === 'upd')!;
    expect(u).toMatchObject({ type: 'upd', date: '2026-10-14', number: '245', sum: 118000 });
  });
  it('фильтр: тип и период «с … по …» (выписка — пересечением периода)', () => {
    expect(O.listOrgDocs('u', 'org1', { type: 'statement', from: '2026-10-01', to: '2026-10-31' }).map((d) => d.id)).toEqual(['st-oct']);
    expect(O.listOrgDocs('u', 'org1', { from: '2026-10-15', to: '2026-10-31' }).map((d) => d.id).sort()).toEqual(['act', 'st-oct']);
    expect(O.listOrgDocs('u', 'org1', { q: '245' }).map((d) => d.id)).toEqual(['upd']);
    expect(O.countByType(O.listOrgDocs('u', 'org1'))).toMatchObject({ statement: 2, upd: 1, act: 1, invoice: 0 });
  });
  it('API: /api/docs — фильтр и счёт по типам; чужая организация — 404', async () => {
    const { GET } = await import('@/app/api/docs/route');
    const r = await GET(new Request('http://x/api/docs?folder=org1&type=statement&from=2026-09-01&to=2026-10-31'));
    const j = await r.json() as { docs: { id: string }[]; counts: Record<string, number> };
    expect(j.docs.map((d) => d.id).sort()).toEqual(['st-oct', 'st-sep']);
    expect(j.counts).toMatchObject({ statement: 2, act: 1, upd: 1 });
    expect((await GET(new Request('http://x/api/docs?folder=orgV'))).status).toBe(404);
    expect((await GET(new Request('http://x/api/docs?folder=org1&from=31.10.2026'))).status).toBe(400);
  });
  it('отправка: файл библиотеки копируется в чат, библиотека цела', async () => {
    const T = await import('@/lib/turn');
    const thread = db.select().from(schema.threads).where(eq(schema.threads.id, 't1')).get()!;
    const p = T.prepare({ thread, userId: 'u', mode: 'send', text: 'Сверь выписки', fileIds: ['st-sep', 'st-oct'], modelId: 'alpha', levelId: 'medium' });
    expect(p.fileIds).toHaveLength(2);
    expect(p.fileIds).not.toContain('st-sep');
    const copies = db.select().from(schema.files).all().filter((x) => p.fileIds.includes(x.id));
    expect(copies.every((x) => x.threadId === 't1' && x.folderId === null && x.docType === 'statement')).toBe(true);
    expect(db.select().from(schema.files).where(eq(schema.files.id, 'st-sep')).get()).toMatchObject({ threadId: null, folderId: 'org1' });
    expect(O.listOrgDocs('u', 'org1', { type: 'statement' })).toHaveLength(2);
  });
  it('новый чат в организации: /api/threads с folderId; чужой проект — чат без проекта', async () => {
    const { POST } = await import('@/app/api/threads/route');
    const mk = async (folderId: string) => (await (await POST(new Request('http://x/api/threads', { method: 'POST', body: JSON.stringify({ modelId: 'alpha', levelId: 'medium', folderId }) }))).json()) as { id: string };
    const a = await mk('org2');
    expect(db.select().from(schema.threads).where(eq(schema.threads.id, a.id)).get()?.folderId).toBe('org2');
    const b = await mk('orgV');
    expect(db.select().from(schema.threads).where(eq(schema.threads.id, b.id)).get()?.folderId).toBeNull();
  });
  it('библиотека: убрать документ можно только библиотечный', () => {
    expect(O.removeLibraryDoc('u', 'act')).toBe(false);
    expect(O.removeLibraryDoc('v', 'upd')).toBe(false);
    expect(O.removeLibraryDoc('u', 'upd')).toBe(true);
    expect(O.listOrgDocs('u', 'org1').map((d) => d.id)).not.toContain('upd');
  });
});

describe('модель видит библиотеку организации', () => {
  it('files_list в чате организации — и её библиотека', async () => {
    await import('@/lib/tools/all');
    const { getTool } = await import('@/lib/tools/registry');
    const tool = getTool('files_list')!;
    const r = await tool.run({}, { userId: 'u', threadId: 't1', folderId: 'org1', jobId: 'j', kind: 'chat', modelId: 'alpha', depth: 0, signal: new AbortController().signal, emit: () => {} } as never);
    expect(r.content).toContain('kl_to_1c_oct.txt');
    expect(r.content).toContain('библиотека организации');
    const other = await tool.run({}, { userId: 'u', threadId: 't2', folderId: 'org2', jobId: 'j', kind: 'chat', modelId: 'alpha', depth: 0, signal: new AbortController().signal, emit: () => {} } as never);
    expect(other.content).not.toContain('библиотека организации');
  });
});
