import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpData } from './helpers';
import { eq } from 'drizzle-orm';

const jar = { token: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (jar.token ? { name: n, value: jar.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const dir = tmpData();
const OUT = path.join(dir, 'up-out');
fs.mkdirSync(OUT, { recursive: true });
process.env.KX_OUT_DIR = OUT;
process.env.KX_SSE_PING_MS = '80';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const chats: { chat: string | undefined; q: string; sys: string }[] = [];

function deliver(name = 'pic.png', ageMs = 0): string {
  const t = randomBytes(16).toString('hex');
  fs.mkdirSync(path.join(OUT, t));
  fs.writeFileSync(path.join(OUT, t, name), PNG);
  if (ageMs) { const at = new Date(Date.now() - ageMs); fs.utimesSync(path.join(OUT, t), at, at); }
  return t;
}

let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
const A = { id: 'user-a', token: randomBytes(32).toString('base64url') };
const B = { id: 'user-b', token: randomBytes(32).toString('base64url') };
const ids = { tA: randomUUID(), qA: randomUUID(), aA: randomUUID(), aA2: randomUUID(), fA: randomUUID(), gA: randomUUID(), tB: randomUUID(), tokA: '', autoA: '', keyA: '' };

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const body = JSON.parse(b);
      const last = [...body.messages].reverse().find((m: { role: string }) => m.role === 'user');
      const q = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p: { text?: string }) => p.text ?? '').join(' ');
      const sys = body.messages.filter((m: { role: string }) => m.role === 'system').map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      chats.push({ chat: req.headers['x-korvex-chat-id'] as string | undefined, q, sys });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      ch({ role: 'assistant', content: '' });
      if (q.includes('[slow]')) await new Promise((r) => setTimeout(r, 600));
      if (q.includes('[img]')) {
        const t = deliver('chart.png');
        const link = `📎 [chart.png](/out/${t}/chart.png) (1 KB)`;
        for (let i = 0; i < link.length; i += 9) { ch({ content: link.slice(i, i + 9) }); await new Promise((r) => setTimeout(r, 2)); }
      }
      if (q.includes('[echo]')) for (const m of q.matchAll(/\/cache\/up-out\/[0-9a-f]{32}\/[^\s)]+/g)) ch({ content: `Вот ваша картинка: ![x](${m[0]}) ` });
      ch({ content: 'Готово.' });
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  const now = Date.now();
  for (const u of [A, B]) {
    db.insert(schema.users).values({ id: u.id, email: `${u.id}@t`, name: u.id, passwordHash: 'x', role: 'alpha', createdAt: now }).run();
    db.insert(schema.sessions).values({ id: sha(u.token), userId: u.id, createdAt: now, expiresAt: now + 864e5 }).run();
  }
  ids.tokA = deliver('secret.png');
  db.insert(schema.outFiles).values({ token: ids.tokA, userId: A.id, threadId: ids.tA, messageId: ids.aA, source: 'job', createdAt: now }).run();
  const link = `/out/${ids.tokA}/secret.png`;
  db.insert(schema.threads).values([
    { id: ids.tA, userId: A.id, title: 'Чат A', modelId: 'alpha', effort: 'off', leafId: ids.aA2, createdAt: now, updatedAt: now },
    { id: ids.gA, userId: A.id, title: 'Сравнение A', modelId: 'alpha', effort: 'off', groupId: 'grp-a', side: 'a', createdAt: now, updatedAt: now },
    { id: ids.tB, userId: B.id, title: 'Чат B', modelId: 'alpha', effort: 'off', createdAt: now, updatedAt: now },
  ]).run();
  db.insert(schema.messages).values([
    { id: ids.qA, threadId: ids.tA, seq: 1, parentId: null, role: 'user', content: 'секретное слово бегемотище', createdAt: now },
    { id: ids.aA, threadId: ids.tA, seq: 2, parentId: ids.qA, role: 'assistant', content: `📎 [secret.png](${link}) (1 KB)`, meta: { modelId: 'alpha', levelId: 'off' }, createdAt: now },
    { id: ids.aA2, threadId: ids.tA, seq: 3, parentId: ids.qA, role: 'assistant', content: 'второй ответ', meta: { modelId: 'alpha', levelId: 'off' }, createdAt: now },
    { id: randomUUID(), threadId: ids.tB, seq: 1, parentId: null, role: 'user', content: `вот ${link}`, createdAt: now },
    { id: randomUUID(), threadId: ids.tB, seq: 2, parentId: null, role: 'assistant', content: `![x](${link})`, meta: { modelId: 'alpha' }, createdAt: now },
  ]).run();
  db.insert(schema.files).values({ id: ids.fA, userId: A.id, threadId: ids.tA, name: 'фото.png', mime: 'image/png', size: PNG.length, sha256: 'x', createdAt: now }).run();
  fs.mkdirSync(path.join(dir, 'files', ids.fA), { recursive: true });
  fs.writeFileSync(path.join(dir, 'files', ids.fA, 'original.png'), PNG);
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const as = (u: { token: string } | null) => { jar.token = u?.token ?? ''; };
const H = { Origin: 'http://localhost', Host: 'localhost', 'Content-Type': 'application/json' };
const rq = (url: string, method = 'GET', body?: unknown) => new Request(`http://localhost${url}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
const P = <T extends Record<string, string | string[]>>(p: T) => ({ params: Promise.resolve(p) });
const outGet = async (token: string, name: string) => (await import('@/app/out/[token]/[...name]/route')).GET(rq(`/out/${token}/${name}`), P({ token, name: [name] }));

async function waitJobs(userId: string) {
  const { activeJobs } = await import('@/lib/jobs');
  for (let i = 0; i < 200 && activeJobs(userId).length; i++) await new Promise((r) => setTimeout(r, 20));
}
async function send(threadId: string, text: string) {
  const { POST } = await import('@/app/api/chat/route');
  const r = await POST(rq('/api/chat', 'POST', { threadId, text, modelId: 'alpha', levelId: 'off' }));
  return { status: r.status, body: (await r.json()) as { jobId?: string; assistantMessageId?: string } };
}

describe('B не получает и не меняет данные A', () => {
  it('загруженный файл, чат, путь сообщений, группа, ветка', async () => {
    const files = (await import('@/app/api/files/[id]/route')).GET;
    as(A); expect((await files(rq(`/api/files/${ids.fA}`), P({ id: ids.fA }))).status).toBe(200);
    as(B); expect((await files(rq(`/api/files/${ids.fA}`), P({ id: ids.fA }))).status).toBe(404);
    const pathR = (await import('@/app/api/threads/[id]/path/route')).GET;
    as(A); expect((await pathR(rq(`/api/threads/${ids.tA}/path`), P({ id: ids.tA }))).status).toBe(200);
    as(B); expect((await pathR(rq(`/api/threads/${ids.tA}/path`), P({ id: ids.tA }))).status).toBe(404);
    const th = await import('@/app/api/threads/[id]/route');
    expect((await th.PATCH(rq(`/api/threads/${ids.tA}`, 'PATCH', { title: 'взлом' }), P({ id: ids.tA }))).status).toBe(404);
    expect((await th.DELETE(rq(`/api/threads/${ids.tA}`, 'DELETE'), P({ id: ids.tA }))).status).toBe(404);
    const t = db.select().from(schema.threads).all().find((x) => x.id === ids.tA);
    expect(t?.title).toBe('Чат A');
    const grp = (await import('@/app/api/groups/[id]/route')).GET;
    expect((await grp(rq('/api/groups/grp-a'), P({ id: 'grp-a' }))).status).toBe(404);
    const branch = (await import('@/app/api/threads/[id]/branch/route')).POST;
    expect((await branch(rq(`/api/threads/${ids.tA}/branch`, 'POST', { messageId: ids.aA }), P({ id: ids.tA }))).status).toBe(404);
    const read = (await import('@/app/api/threads/[id]/read/route')).POST;
    const rr = await read(rq(`/api/threads/${ids.tA}/read`, 'POST', {}), P({ id: ids.tA }));
    expect(rr.status).toBeGreaterThanOrEqual(400);
  });
  it('написать в чат A, оценить и сравнить ответы A, отменить задачу A — нельзя', async () => {
    as(B);
    expect((await send(ids.tA, 'привет')).status).toBe(404);
    const rate = (await import('@/app/api/messages/[id]/rating/route')).PUT;
    expect((await rate(rq(`/api/messages/${ids.aA}/rating`, 'PUT', { value: 1 }), P({ id: ids.aA }))).status).toBe(404);
    expect(db.select().from(schema.ratings).all()).toHaveLength(0);
    const vote = (await import('@/app/api/votes/route')).PUT;
    expect((await vote(rq('/api/votes', 'PUT', { a: ids.aA, b: ids.aA2, winner: 'a' }))).status).toBe(404);
    as(A);
    const s = await send(ids.tA, 'долго [slow]');
    as(B);
    const cancel = (await import('@/app/api/jobs/[id]/cancel/route')).POST;
    const c = await cancel(rq(`/api/jobs/${s.body.jobId}/cancel`, 'POST', {}), P({ id: s.body.jobId! }));
    expect(c.status).toBeGreaterThanOrEqual(400);
    await waitJobs(A.id);
    const job = db.select().from(schema.jobs).all().find((j) => j.id === s.body.jobId)!;
    expect(job.status).toBe('done');
  });
  it('поиск находит только своё', async () => {
    const search = (await import('@/app/api/search/route')).GET;
    as(A);
    const ja = (await (await search(rq('/api/search?q=бегемотище'))).json()) as { hits: unknown[] };
    expect(ja.hits.length).toBeGreaterThan(0);
    as(B);
    const jb = (await (await search(rq('/api/search?q=бегемотище'))).json()) as { hits: unknown[] };
    expect(jb.hits).toHaveLength(0);
  });
  it('автоматизация в чат A — нельзя; чужую — не видно и не изменить', async () => {
    const auto = await import('@/app/api/automations/route');
    as(A);
    const mk = await auto.POST(rq('/api/automations', 'POST', { name: 'Сводка', prompt: 'сводка', modelId: 'alpha', levelId: 'off', cron: '0 9 * * *', targetThreadId: ids.tA }));
    expect(mk.status).toBeLessThan(300);
    ids.autoA = db.select().from(schema.automations).get()!.id;
    as(B);
    const bad = await auto.POST(rq('/api/automations', 'POST', { name: 'Взлом', prompt: 'x', modelId: 'alpha', levelId: 'off', cron: '0 9 * * *', targetThreadId: ids.tA }));
    expect(bad.status).toBe(400);
    const list = (await (await auto.GET(rq('/api/automations'))).json()) as { automations?: { id: string }[] } | { id: string }[];
    expect(JSON.stringify(list)).not.toContain(ids.autoA);
    const one = await import('@/app/api/automations/[id]/route');
    expect((await one.PATCH(rq(`/api/automations/${ids.autoA}`, 'PATCH', { enabled: false }), P({ id: ids.autoA }))).status).toBe(404);
    expect((await one.DELETE(rq(`/api/automations/${ids.autoA}`, 'DELETE'), P({ id: ids.autoA }))).status).toBe(404);
    const runs = (await import('@/app/api/automations/[id]/runs/route')).GET;
    expect((await runs(rq(`/api/automations/${ids.autoA}/runs`), P({ id: ids.autoA }))).status).toBe(404);
    const run = (await import('@/app/api/automations/[id]/run/route')).POST;
    expect((await run(rq(`/api/automations/${ids.autoA}/run`, 'POST', {}), P({ id: ids.autoA }))).status).toBe(404);
  });
  it('ключ API A: B не видит и не отзывает; админские разделы — 403', async () => {
    const K = await import('@/lib/apikeys');
    const ua = db.select().from(schema.users).all().find((u) => u.id === A.id)!;
    const r = K.createKey(ua, { name: 'ключ A', models: ['alpha'] });
    if ('error' in r) throw new Error(r.error);
    ids.keyA = r.view.id;
    as(B);
    const keys = await import('@/app/api/keys/route');
    expect(JSON.stringify(await (await keys.GET(rq('/api/keys'))).json())).not.toContain(ids.keyA);
    const del = (await import('@/app/api/keys/[id]/route')).DELETE;
    expect((await del(rq(`/api/keys/${ids.keyA}`, 'DELETE'), P({ id: ids.keyA }))).status).toBe(404);
    expect(db.select().from(schema.apiKeys).all().find((k) => k.id === ids.keyA)!.revokedAt).toBeNull();
    for (const mod of ['@/app/api/admin/users/route', '@/app/api/admin/analytics/route', '@/app/api/admin/invites/route', '@/app/api/admin/banner/route', '@/app/api/admin/load-state/route']) {
      const m = (await import( mod)) as { GET: (r: Request) => Promise<Response> };
      expect((await m.GET(rq('/api/x'))).status, mod).toBe(403);
    }
  });
  it('события (SSE): B не получает событий A', async () => {
    const { GET } = await import('@/app/api/events/route');
    const { publish } = await import('@/lib/bus');
    as(B);
    const ac = new AbortController();
    const res = await GET(new Request('http://localhost/api/events', { signal: ac.signal }));
    const rd = res.body!.getReader();
    publish(A.id, { t: 'msg', th: ids.tA, secret: 'бегемотище' });
    publish(B.id, { t: 'msg', th: ids.tB, mine: 'своё' });
    let text = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 300 && !text.includes('своё')) {
      const r = await Promise.race([rd.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 100))]);
      if (r && !r.done) text += new TextDecoder().decode(r.value);
    }
    ac.abort();
    expect(text).toContain('своё');
    expect(text).not.toContain('бегемотище');
  });
});

describe('папки, шаги инструментов, steer — только своё', () => {
  it('B не видит, не меняет, не удаляет папки A и не переносит чаты A; не отвечает на шаг и не пишет steer в задачу A', async () => {
    const F = await import('@/app/api/folders/route');
    const F1 = await import('@/app/api/folders/[id]/route');
    const MV = await import('@/app/api/threads/move/route');
    as(A);
    const c = await F.POST(rq('/api/folders', 'POST', { name: 'Запуск A', instruction: 'секрет папки' }));
    expect(c.status).toBe(200);
    const fid = ((await c.json()) as { folder: { id: string } }).folder.id;
    expect((await MV.POST(rq('/api/threads/move', 'POST', { ids: [ids.tA], folderId: fid }))).status).toBe(200);
    as(B);
    const list = (await (await F.GET(rq('/api/folders'))).json()) as { folders: { id: string }[] };
    expect(list.folders.map((f) => f.id)).not.toContain(fid);
    expect((await F1.PATCH(rq(`/api/folders/${fid}`, 'PATCH', { name: 'взлом' }), P({ id: fid }))).status).toBe(404);
    expect((await F1.DELETE(rq(`/api/folders/${fid}`, 'DELETE'), P({ id: fid }))).status).toBe(404);
    expect((await MV.POST(rq('/api/threads/move', 'POST', { ids: [ids.tA], folderId: null }))).status).toBe(404);
    const own = await F.POST(rq('/api/folders', 'POST', { name: 'Запуск B' }));
    const bf = ((await own.json()) as { folder: { id: string } }).folder.id;
    expect((await MV.POST(rq('/api/threads/move', 'POST', { ids: [ids.tA], folderId: bf }))).status).toBe(404);
    expect((await MV.POST(rq('/api/threads/move', 'POST', { ids: [ids.tB], folderId: fid }))).status).toBe(404);
    expect(db.select().from(schema.threads).where(eq(schema.threads.id, ids.tA)).get()!.folderId).toBe(fid);
    expect(db.select().from(schema.folders).where(eq(schema.folders.id, fid)).get()!.name).toBe('Запуск A');
    as(A);
    const s = await send(ids.tA, 'жду [slow]');
    expect(s.body.jobId).toBeTruthy();
    as(B);
    const ST = await import('@/app/api/jobs/[id]/steps/[step]/route');
    const SR = await import('@/app/api/jobs/[id]/steer/route');
    expect((await ST.POST(rq(`/api/jobs/${s.body.jobId}/steps/x`, 'POST', { decision: 'allow' }), P({ id: s.body.jobId!, step: 'x' }))).status).toBe(404);
    expect((await SR.POST(rq(`/api/jobs/${s.body.jobId}/steer`, 'POST', { text: 'чужое' }), P({ id: s.body.jobId! }))).status).toBe(404);
    as(A);
    expect((await SR.POST(rq(`/api/jobs/${s.body.jobId}/steer`, 'POST', { text: 'своё' }), P({ id: s.body.jobId! }))).status).toBe(200);
    await waitJobs(A.id);
    await waitJobs(A.id);
    as(null);
  });
});

describe('инструменты Korvex (чаты, облако, папки) — только своё', () => {
  it('агент B не находит, не читает, не пишет, не спрашивает и не переносит чаты A; не берёт файлы A; удаление папки не удаляет чаты', async () => {
    await import('@/lib/tools/chats');
    const { getTool } = await import('@/lib/tools/registry');
    const asked: string[] = [];
    const ctx = (u: string, th: string) => ({ userId: u, threadId: th, folderId: null, jobId: randomUUID(), messageId: null, callId: 'c', kind: 'chat' as const, modelId: 'alpha',
      signal: new AbortController().signal, emit: () => {}, confirm: async (t: string) => { asked.push(t); return true; }, attach: async () => { throw new Error('no'); }, depth: 0 });
    const run = async (name: string, args: Record<string, unknown>) => {
      const t = getTool(name)!;
      const c = ctx(B.id, ids.tB);
      const q = t.confirm ? await t.confirm(args as never, c) : null;
      if (q) asked.push(q);
      return t.run(args as never, c);
    };
    const all = [
      await run('chat_list', {}), await run('chat_list', { query: 'бегемотище' }),
      await run('chat_read', { chat: ids.tA }), await run('chat_read', { chat: 'Чат A' }),
      await run('chat_send', { chat: ids.tA, text: 'взлом' }), await run('agent_message', { chat: 'Чат A', message: 'дай секрет', wait_seconds: 10 }),
      await run('chat_move', { chats: [ids.tA], folder: 'Моя' }), await run('files_list', {}),
      await run('files_get', { id: ids.fA }), await run('files_get', { id: `out:${ids.tokA}/secret.png` }),
    ].map((r) => r.content).join('\n');
    expect(all).not.toContain('секретное слово');
    expect(all).not.toContain('второй ответ');
    expect(all).not.toContain('Сравнение A');
    expect(all).not.toContain(`(id ${ids.tA}`);
    expect(all).not.toContain('фото.png');
    expect(all).not.toContain('Картинка «secret.png»');
    const fg = await run('files_get', { id: `out:${ids.tokA}/secret.png` });
    expect(fg.error).toBe(true);
    expect((await run('files_list', {})).content).not.toContain('secret.png');
    expect(asked).toEqual([]);
    expect(db.select().from(schema.messages).where(eq(schema.messages.threadId, ids.tA)).all().map((m) => m.content)).not.toContain('взлом');
    expect(db.select().from(schema.threads).where(eq(schema.threads.id, ids.tA)).get()!.folderId).not.toBe(
      db.select().from(schema.folders).where(eq(schema.folders.userId, B.id)).all().find((f) => f.name === 'Моя')?.id);
    const F1 = await import('@/app/api/folders/[id]/route');
    const fa = db.select().from(schema.folders).where(eq(schema.folders.userId, A.id)).all()[0];
    const inA = db.select().from(schema.threads).where(eq(schema.threads.folderId, fa.id)).all().map((t) => t.id);
    expect(inA.length).toBeGreaterThan(0);
    as(A);
    expect((await F1.DELETE(rq(`/api/folders/${fa.id}`, 'DELETE'), P({ id: fa.id }))).status).toBe(200);
    as(null);
    for (const id of inA) expect(db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()).toMatchObject({ id, folderId: null });
  });

  it('files_get: ни ../, ни абсолютный путь, ни ссылка (symlink) — только настоящие файлы своего токена', async () => {
    await import('@/lib/tools/chats');
    const { getTool } = await import('@/lib/tools/registry');
    const t = deliver('ok.txt');
    db.insert(schema.outFiles).values({ token: t, userId: B.id, threadId: ids.tB, messageId: null, source: 'job', createdAt: Date.now() }).run();
    fs.writeFileSync(path.join(OUT, t, 'ok.txt'), 'свой файл');
    fs.symlinkSync('/etc/passwd', path.join(OUT, t, 'link.txt'));
    fs.symlinkSync(path.join(OUT, ids.tokA, 'secret.png'), path.join(OUT, t, 'a.png'));
    const t2 = randomBytes(16).toString('hex');
    fs.symlinkSync(path.join(OUT, ids.tokA), path.join(OUT, t2));
    db.insert(schema.outFiles).values({ token: t2, userId: B.id, threadId: ids.tB, messageId: null, source: 'job', createdAt: Date.now() }).run();
    const c = { userId: B.id, threadId: ids.tB, folderId: null, jobId: 'j', messageId: null, callId: 'c', kind: 'chat' as const, modelId: 'alpha',
      signal: new AbortController().signal, emit: () => {}, confirm: async () => true, attach: async () => { throw new Error('no'); }, depth: 0 };
    const get = (id: string) => getTool('files_get')!.run({ id, attach: false } as never, c);
    expect((await get(`out:${t}/ok.txt`)).content).toContain('свой файл');
    for (const id of [`out:${t}/../${ids.tokA}/secret.png`, `out:${t}/link.txt`, `out:${t}/a.png`, `out:${t2}/secret.png`, '/etc/passwd', `out:${t}//etc/passwd`, `out:../../etc/passwd`, `../${ids.fA}`, `out:${t}/..`]) {
      const r = await get(id);
      expect(r.error, id).toBe(true);
      expect(r.content, id).not.toContain('root:');
    }
    const list = (await getTool('files_list')!.run({} as never, c)).content;
    expect(list).toContain('ok.txt');
    expect(list).not.toContain('link.txt');
    expect(list).not.toContain('secret.png');
  });
});

describe('память о человеке — только владельцу', () => {
  it('B не видит, не правит и не удаляет записи A; «Удалить всё» B не трогает A; блок памяти A не уходит в чат B', async () => {
    const M = await import('@/lib/memory');
    const r = M.addMemory(A.id, { section: 'who', key: 'name', text: 'Зовут Бегемотий', origin: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const idA = r.row.id;
    const list = await import('@/app/api/memory/route');
    const one = await import('@/app/api/memory/[id]/route');
    as(A);
    expect(JSON.stringify(await (await list.GET(rq('/api/memory'))).json())).toContain('Бегемотий');
    as(B);
    expect(JSON.stringify(await (await list.GET(rq('/api/memory'))).json())).not.toContain('Бегемотий');
    expect((await one.PATCH(rq(`/api/memory/${idA}`, 'PATCH', { text: 'взлом' }), P({ id: idA }))).status).toBe(404);
    expect((await one.DELETE(rq(`/api/memory/${idA}`, 'DELETE'), P({ id: idA }))).status).toBe(404);
    expect((await list.DELETE(rq('/api/memory', 'DELETE'))).status).toBe(200);
    expect(M.listMemory(A.id).map((x) => x.text)).toEqual(['Зовут Бегемотий']);
    as(A);
    const bad = await one.DELETE(new Request(`http://localhost/api/memory/${idA}`, { method: 'DELETE', headers: { ...H, Origin: 'https://evil.example' } }), P({ id: idA }));
    expect(bad.status).toBe(403);
    as(null);
    expect((await list.GET(rq('/api/memory'))).status).toBe(401);
    const before = chats.length;
    as(A); await send(ids.tA, 'память-a'); await waitJobs(A.id);
    as(B); await send(ids.tB, 'память-b'); await waitJobs(B.id);
    const got = chats.slice(before);
    expect(got.find((c) => c.q.includes('память-a'))?.sys).toContain('Зовут Бегемотий');
    expect(got.find((c) => c.q.includes('память-b'))?.sys ?? '').not.toContain('Бегемотий');
  });
  it('инструменты памяти работают только со своей памятью', async () => {
    await import('@/lib/tools/memory');
    const { getTool } = await import('@/lib/tools/registry');
    const M = await import('@/lib/memory');
    const ctx = (u: string, th: string) => ({ userId: u, threadId: th, folderId: null, jobId: 'j', messageId: null, callId: 'c', kind: 'chat' as const, modelId: 'alpha',
      signal: new AbortController().signal, emit: () => {}, confirm: async () => true, attach: async () => { throw new Error('no'); }, depth: 0 });
    const idA = M.listMemory(A.id)[0].id;
    const listB = await getTool('memory_list')!.run({}, ctx(B.id, ids.tB));
    expect(listB.content).not.toContain('Бегемотий');
    const forgetB = await getTool('memory_forget')!.run({ ids: [idA.slice(0, 8)], about: 'имя' }, ctx(B.id, ids.tB));
    expect(forgetB.error).toBe(true);
    expect(M.listMemory(A.id)).toHaveLength(1);
  });
});

describe('сессии, вход, приглашения, расписания, ключи API', () => {
  it('SSE закрывается, когда сессия кончилась (выход), — событием logout', async () => {
    const { GET } = await import('@/app/api/events/route');
    const tok = randomBytes(32).toString('base64url');
    db.insert(schema.sessions).values({ id: sha(tok), userId: A.id, createdAt: Date.now(), expiresAt: Date.now() + 864e5 }).run();
    as({ token: tok });
    const res = await GET(new Request('http://localhost/api/events'));
    const rd = res.body!.getReader();
    const { eq } = await import('drizzle-orm');
    db.delete(schema.sessions).where(eq(schema.sessions.id, sha(tok))).run();
    let text = '', done = false;
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 2000) { const r = await rd.read(); done = r.done; if (r.value) text += new TextDecoder().decode(r.value); }
    expect(text).toContain('"t":"logout"');
    expect(done).toBe(true);
  });
  it('лимит входа: подделка X-Forwarded-For не даёт новых попыток (настоящий адрес — последний, его дописывает прокси)', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const { _loginTest } = await import('@/lib/auth');
    _loginTest.reset();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { ...H, 'X-Forwarded-For': `10.0.0.${i}, 198.51.100.5` }, body: JSON.stringify({ email: 'victim@example.com', password: 'не тот' }) }));
      codes.push(r.status);
    }
    expect(codes.slice(0, 6).every((c) => c === 401)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
    _loginTest.reset();
  });
  it('приглашение: два одновременных входа по одной ссылке — один аккаунт', async () => {
    const tok = randomBytes(24).toString('base64url');
    db.insert(schema.invites).values({ id: randomUUID(), tokenHash: sha(tok), role: 'user', note: '', createdBy: A.id, expiresAt: Date.now() + 864e5, createdAt: Date.now() }).run();
    const { POST } = await import('@/app/api/auth/invite/route');
    const mk = (e: string) => POST(new Request('http://localhost/api/auth/invite', { method: 'POST', headers: H, body: JSON.stringify({ token: tok, email: e, password: 'пароль-длинный' }) }));
    const rs = await Promise.all([mk('one@example.com'), mk('two@example.com')]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(db.select().from(schema.users).all().filter((u) => u.email === 'one@example.com' || u.email === 'two@example.com')).toHaveLength(1);
  });
  it('расписание отключённого пользователя не запускается', async () => {
    const { eq } = await import('drizzle-orm');
    const { tick } = await import('@/lib/scheduler');
    db.update(schema.automations).set({ nextRunAt: Date.now() - 1000, enabled: 1 }).where(eq(schema.automations.id, ids.autoA)).run();
    db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, A.id)).run();
    expect(tick(Date.now(), { run: (async () => ({}) ) as never })).not.toContain(ids.autoA);
    db.update(schema.users).set({ disabled: 0 }).where(eq(schema.users.id, A.id)).run();
    expect(tick(Date.now(), { run: (async () => ({}) ) as never })).toContain(ids.autoA);
  });
  it('/v1: ключи A и B с одной беседой — разные сессии серва (чужая память недоступна)', async () => {
    const K = await import('@/lib/apikeys');
    K.registerKeyUsage?.();
    const chat = (await import('@/app/v1/chat/completions/route')).POST;
    const users = db.select().from(schema.users).all();
    const keys = [A.id, B.id].map((id) => { const r = K.createKey(users.find((u) => u.id === id)!, { name: 'k', models: ['alpha'] }); if ('error' in r) throw new Error(r.error); return r.key; });
    const before = chats.length;
    for (const k of keys) {
      const r = await chat(new Request('http://x/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}`, 'X-Korvex-Conversation': 'shared-conv' },
        body: JSON.stringify({ model: 'alpha', messages: [{ role: 'user', content: 'v1-проверка' }] }) }));
      expect(r.status).toBe(200);
      await r.text();
    }
    const got = chats.slice(before).filter((c) => c.q.includes('v1-проверка')).map((c) => c.chat);
    expect(got).toHaveLength(2);
    expect(got[0]).not.toBe(got[1]);
    expect(got).not.toContain(ids.tA);
  });
});

describe('облачный агент · код (агент 5): GitHub и репозиторий чата — только владельцу', () => {
  it('B не видит и не меняет сессию кода A: состояние, дифф, файл, правки, запуски, откат, коммит, PR, открыть репозиторий в чужом чате', async () => {
    const now = Date.now();
    const editId = randomUUID(), runId = randomUUID();
    db.insert(schema.codeSessions).values({ threadId: ids.tA, userId: A.id, repo: 'a/secret-repo', baseBranch: 'main', status: 'error', error: 'тест', origin: 'code', createdAt: now, updatedAt: now }).run();
    db.insert(schema.codeEdits).values({ id: editId, threadId: ids.tA, userId: A.id, path: 'secret.py', source: 'agent', before: 'x = 1\n', after: 'x = 2\n', added: 1, removed: 1, createdAt: now }).run();
    db.insert(schema.codeRuns).values({ id: runId, threadId: ids.tA, userId: A.id, cmd: 'pytest', exitCode: 0, output: 'секретный вывод', createdAt: now }).run();
    const st = await import('@/app/api/code/[threadId]/route');
    as(A);
    const own = await st.GET(rq(`/api/code/${ids.tA}`), P({ threadId: ids.tA }));
    expect(own.status).toBe(200);
    expect(((await own.json()) as { repo: string }).repo).toBe('a/secret-repo');
    as(B);
    const p = P({ threadId: ids.tA });
    expect((await st.GET(rq(`/api/code/${ids.tA}`), p)).status).toBe(404);
    expect((await st.POST(rq(`/api/code/${ids.tA}`, 'POST', { repo: 'b/repo' }), p)).status).toBe(404);
    expect((await (await import('@/app/api/code/[threadId]/diff/route')).GET(rq(`/api/code/${ids.tA}/diff`), p)).status).toBe(404);
    const file = await import('@/app/api/code/[threadId]/file/route');
    expect((await file.GET(rq(`/api/code/${ids.tA}/file?path=secret.py`), p)).status).toBe(404);
    expect((await file.PUT(rq(`/api/code/${ids.tA}/file`, 'PUT', { path: 'secret.py', content: 'взлом' }), p)).status).toBe(404);
    const ed = await import('@/app/api/code/[threadId]/edits/[editId]/route');
    expect((await ed.GET(rq(`/api/code/${ids.tA}/edits/${editId}`), P({ threadId: ids.tA, editId }))).status).toBe(404);
    expect((await ed.POST(rq(`/api/code/${ids.tA}/edits/${editId}`, 'POST', { action: 'revert' }), P({ threadId: ids.tA, editId }))).status).toBe(404);
    db.insert(schema.codeSessions).values({ threadId: ids.tB, userId: B.id, repo: 'b/repo', baseBranch: 'main', status: 'error', origin: 'code', createdAt: now, updatedAt: now }).run();
    expect((await ed.GET(rq(`/api/code/${ids.tB}/edits/${editId}`), P({ threadId: ids.tB, editId }))).status).toBe(404);
    const runs = (await import('@/app/api/code/[threadId]/runs/[runId]/route')).GET;
    expect((await runs(rq(`/api/code/${ids.tA}/runs/${runId}`), P({ threadId: ids.tA, runId }))).status).toBe(404);
    expect((await runs(rq(`/api/code/${ids.tB}/runs/${runId}`), P({ threadId: ids.tB, runId }))).status).toBe(404);
    expect((await (await import('@/app/api/code/[threadId]/revert/route')).POST(rq(`/api/code/${ids.tA}/revert`, 'POST', { path: 'secret.py' }), p)).status).toBe(404);
    expect((await (await import('@/app/api/code/[threadId]/commit/route')).POST(rq(`/api/code/${ids.tA}/commit`, 'POST', { message: 'взлом' }), p)).status).toBe(404);
    expect((await (await import('@/app/api/code/[threadId]/pr/route')).POST(rq(`/api/code/${ids.tA}/pr`, 'POST', { title: 'взлом' }), p)).status).toBe(404);
    expect(db.select().from(schema.codeEdits).all().find((e) => e.id === editId)?.revertedAt).toBeNull();
    as(null);
    expect((await st.GET(rq(`/api/code/${ids.tA}`), p)).status).toBe(401);
  });
  it('GitHub A не виден B: статус, репозитории, ветки; токен A не расшифровывается под B', async () => {
    const { seal } = await import('@/lib/github/secret');
    const now = Date.now();
    db.insert(schema.githubAccounts).values({ userId: A.id, kind: 'pat', login: 'a-login', tokenEnc: seal(JSON.stringify({ t: 'ghp_secretAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), `gh:${A.id}`), createdAt: now, checkedAt: now }).run();
    const gh = await import('@/app/api/github/route');
    as(A);
    const a = await (await gh.GET(rq('/api/github'))).json() as { connected: boolean; login: string };
    expect(a).toMatchObject({ connected: true, login: 'a-login' });
    expect(JSON.stringify(a)).not.toContain('ghp_secret');
    as(B);
    expect(((await (await gh.GET(rq('/api/github'))).json()) as { connected: boolean }).connected).toBe(false);
    expect((await (await import('@/app/api/github/repos/route')).GET(rq('/api/github/repos'))).status).toBe(409);
    expect((await (await import('@/app/api/github/branches/route')).GET(rq('/api/github/branches?repo=a/secret-repo'))).status).toBe(409);
    const { open } = await import('@/lib/github/secret');
    const row = db.select().from(schema.githubAccounts).all().find((r) => r.userId === A.id)!;
    expect(() => open(row.tokenEnc, `gh:${B.id}`)).toThrow();
    expect((await gh.DELETE(rq('/api/github', 'DELETE'))).status).toBe(200);
    expect(db.select().from(schema.githubAccounts).all().some((r) => r.userId === A.id)).toBe(true);
    as(A);
    const bad = new Request('http://localhost/api/github', { method: 'DELETE', headers: { Origin: 'http://evil.example', Host: 'localhost' } });
    expect((await gh.DELETE(bad)).status).toBe(403);
    expect(db.select().from(schema.githubAccounts).all().some((r) => r.userId === A.id)).toBe(true);
  });
  it('инструменты кода не предлагаются модели в чате B для сессии A', async () => {
    await import('@/lib/tools/code');
    const { toolsFor, promptParts } = await import('@/lib/tools/registry');
    const names = toolsFor({ userId: B.id, threadId: ids.tA, folderId: null, kind: 'chat', modelId: 'alpha', depth: 0 }).map((t) => t.name);
    expect(names.filter((n) => n.startsWith('code_') || n.startsWith('github_'))).toEqual([]);
    expect(promptParts({ userId: B.id, threadId: ids.tA, folderId: null, kind: 'chat', modelId: 'alpha', depth: 0 }).join('\n')).not.toContain('secret-repo');
    expect(promptParts({ userId: A.id, threadId: ids.tA, folderId: null, kind: 'chat', modelId: 'alpha', depth: 0 }).join('\n')).toContain('a/secret-repo');
  });
});
