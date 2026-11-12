import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { capLevelId, isRestrictedLevel, nearestLevel, normalizeSel, withoutRestricted, selFromPrefs, type ModelLite } from '@/lib/levels';
import { tmpData } from './helpers';

const dir = tmpData();
const efforts: string[] = [];
let srv: http.Server;
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, eq: typeof import('drizzle-orm').eq;
let J: typeof import('@/lib/jobs'), P: typeof import('@/lib/levelPolicy'), S: typeof import('@/lib/status'), M: typeof import('@/lib/models'), T: typeof import('@/lib/turn'), K: typeof import('@/lib/apikeys');

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b) as { model: string; reasoning_effort?: string };
      efforts.push(String(body.reasoning_effort));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ch = (delta: unknown, fin: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`);
      ch({ role: 'assistant', content: '' }); ch({ content: 'ок' }); ch({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  for (const m of cfg.models) { m.baseUrl = base; delete m.systemPromptFile; delete m.extract; }
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values([
    { id: 'adm', email: 'adm@t.rs', name: 'Админ', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'usr', email: 'usr@t.rs', name: 'Тестер', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  for (const t of ['t1', 't2', 't3', 't4', 't5', 't6']) db.insert(schema.threads).values({ id: t, userId: t === 't1' ? 'adm' : 'usr', title: 'T', modelId: 'alpha', effort: 'max', createdAt: 1, updatedAt: 1 }).run();
  J = await import('@/lib/jobs'); P = await import('@/lib/levelPolicy'); S = await import('@/lib/status'); M = await import('@/lib/models'); T = await import('@/lib/turn'); K = await import('@/lib/apikeys');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const lastAssistant = (threadId: string) => db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId)).all().filter((m) => m.role === 'assistant').sort((a, b) => b.seq - a.seq)[0];
const ask = async (t: string, userId: string, levelId: string) => { const s = J.submitTurn({ thread: thread(t), userId, mode: 'send', text: 'привет', modelId: 'alpha', levelId }); await J.waitJob(s.jobId); return s; };

const alpha: ModelLite = { id: 'alpha', name: 'Alpha', defaultLevel: 'medium', levels: ['off', 'low', 'medium', 'xhigh', 'max'].map((id) => ({ id, label: id })) };

describe('чистые правила уровней', () => {
  it('max закрыт; закрытый уровень заменяется на xhigh (нет xhigh — на самый высокий из остальных)', () => {
    expect(isRestrictedLevel('max')).toBe(true);
    expect(isRestrictedLevel('xhigh')).toBe(false);
    expect(capLevelId(alpha, 'max')).toBe('xhigh');
    expect(capLevelId(alpha, 'medium')).toBe('medium');
    expect(capLevelId({ ...alpha, levels: alpha.levels.filter((l) => l.id !== 'xhigh') }, 'max')).toBe('medium');
    expect(capLevelId({ ...alpha, levels: [{ id: 'max', label: 'max' }] }, 'max')).toBe('max');
  });
  it('без max: список уровней и «запомненный max» в выборе -> xhigh', () => {
    const m = withoutRestricted(alpha);
    expect(m.levels.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'xhigh']);
    expect(m.defaultLevel).toBe('medium');
    expect(normalizeSel([m], { modelId: 'alpha', levelId: 'max' })).toEqual({ modelId: 'alpha', levelId: 'xhigh' });
    expect(nearestLevel(m, 'max')).toBe('xhigh');
    expect(selFromPrefs([m], { model: 'alpha', levels: { alpha: 'max' } })).toEqual({ modelId: 'alpha', levelId: 'xhigh' });
    expect(selFromPrefs([m], { model: 'alpha', levels: { alpha: 'low' } })).toEqual({ modelId: 'alpha', levelId: 'low' });
    expect(withoutRestricted({ ...alpha, defaultLevel: 'max' }).defaultLevel).toBe('xhigh');
  });
});

describe('конфигурация и выбор', () => {
  it('уровень Alpha по умолчанию — medium; новый выбор берёт его', () => {
    const e = M.getModel('alpha')!;
    expect(e.defaultLevel).toBe('medium');
    expect(normalizeSel(M.publicModels(), null)).toEqual({ modelId: 'alpha', levelId: 'medium' });
  });
  it('обычному пользователю max не отдаётся в список; администратору — отдаётся', () => {
    expect(P.modelsFor('user').find((m) => m.id === 'alpha')!.levels.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'xhigh']);
    expect(P.modelsFor('admin').find((m) => m.id === 'alpha')!.levels.map((l) => l.id)).toContain('max');
    expect(P.modelsFor(undefined).find((m) => m.id === 'alpha')!.levels.map((l) => l.id)).not.toContain('max');
  });
});

describe('на сервере max не доходит до движка у обычного пользователя', () => {
  it('чат: пользователь просит max — в движок уходит xhigh, в ответе и в чате записан xhigh', async () => {
    efforts.length = 0;
    const s = await ask('t2', 'usr', 'max');
    expect(efforts).toEqual(['xhigh']);
    expect(lastAssistant('t2').meta).toMatchObject({ levelId: 'xhigh' });
    expect(thread('t2').effort).toBe('xhigh');
    expect(s.jobId).toBeTruthy();
  });
  it('администратор: max остаётся max', async () => {
    efforts.length = 0;
    await ask('t1', 'adm', 'max');
    expect(efforts).toEqual(['max']);
    expect(lastAssistant('t1').meta).toMatchObject({ levelId: 'max' });
  });
  it('обычные уровни не трогаем (medium, xhigh, low)', async () => {
    efforts.length = 0;
    await ask('t3', 'usr', 'medium'); await ask('t3', 'usr', 'xhigh'); await ask('t3', 'usr', 'low');
    expect(efforts).toEqual(['medium', 'xhigh', 'low']);
  });
  it('сравнение (пара): обе стороны с max у обычного пользователя -> xhigh', async () => {
    efforts.length = 0;
    const s = J.submitPair({ thread: thread('t4'), userId: 'usr', mode: 'send', text: 'сравни', pair: { a: { modelId: 'alpha', levelId: 'max' }, b: { modelId: 'alpha', levelId: 'low' } } });
    await Promise.all(s.jobIds.map((id) => J.waitJob(id)!));
    expect(efforts.sort()).toEqual(['low', 'xhigh']);
  });
  it('API по ключу (submitInline): reasoning_effort max у обычного владельца ключа -> xhigh', async () => {
    efforts.length = 0;
    const { jobId } = J.submitInline({ userId: 'usr', modelId: 'alpha', levelId: 'max', input: { messages: [{ role: 'user', content: 'привет' }] } as never, apiKeyId: null });
    await J.waitJob(jobId);
    expect(efforts).toEqual(['xhigh']);
  });
  it('resolveLevel и capLevel: без пользователя правило не применяется (внутренние вызовы), с пользователем — по его роли', () => {
    expect(T.resolveLevel('alpha', 'max').level.id).toBe('max');
    expect(T.resolveLevel('alpha', 'max', 'usr').level.id).toBe('xhigh');
    expect(T.resolveLevel('alpha', 'max', 'adm').level.id).toBe('max');
    expect(T.resolveLevel('alpha', 'нет-такого', 'usr').level.id).not.toBe('max');
    const e = M.getModel('alpha')!;
    expect(P.capLevel(e, e.levels.find((l) => l.id === 'max')!, 'usr').id).toBe('xhigh');
    expect(P.capLevel(e, e.levels.find((l) => l.id === 'max')!, 'adm').id).toBe('max');
    expect(P.capLevel(e, e.levels.find((l) => l.id === 'low')!, 'usr').id).toBe('low');
  });
  it('удалённый/неизвестный пользователь считается обычным (max не открываем)', () => {
    const e = M.getModel('alpha')!;
    expect(P.roleOf('нет-такого')).toBe('user');
    expect(P.capLevel(e, e.levels.find((l) => l.id === 'max')!, 'нет-такого').id).toBe('xhigh');
  });
});

describe('переключатель «max только для админов»', () => {
  it('по умолчанию включён; выключили — обычному max снова доступен; включили — закрыт', async () => {
    expect(S.maxAdminOnly()).toBe(true);
    S.setMaxAdminOnly(false);
    expect(S.maxAdminOnly()).toBe(false);
    expect(P.modelsFor('user').find((m) => m.id === 'alpha')!.levels.map((l) => l.id)).toContain('max');
    efforts.length = 0;
    await ask('t5', 'usr', 'max');
    expect(efforts).toEqual(['max']);
    S.setMaxAdminOnly(true);
    expect(P.modelsFor('user').find((m) => m.id === 'alpha')!.levels.map((l) => l.id)).not.toContain('max');
    efforts.length = 0;
    await ask('t6', 'usr', 'max');
    expect(efforts).toEqual(['xhigh']);
  });
  it('выбор администратора переживает перезапуск (data/status.json)', () => {
    S.setMaxAdminOnly(false);
    const f = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')) as { maxAdminOnly: boolean };
    expect(f.maxAdminOnly).toBe(false);
    S.setMaxAdminOnly(true);
    expect((JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')) as { maxAdminOnly: boolean }).maxAdminOnly).toBe(true);
  });
});
