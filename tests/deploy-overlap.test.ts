import { beforeAll, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let I: typeof import('@/lib/instance');
let J: typeof import('@/lib/jobs');
let R: typeof import('@/lib/relay');
let B: typeof import('@/lib/bus');
let eq: typeof import('drizzle-orm').eq;

const NOW = Date.now();
const job = (id: string, status: string, owner: string | null) => {
  db.insert(schema.messages).values({ id: `m-${id}`, threadId: 't', seq: Math.floor(Math.random() * 1e6), parentId: null, session: 't', role: 'assistant', content: 'част', meta: { status }, createdAt: NOW }).run();
  db.insert(schema.jobs).values({ id, userId: 'u', threadId: 't', kind: 'chat', mode: 'send', messageId: `m-${id}`, modelId: 'alpha', levelId: 'low', status, owner, createdAt: NOW, startedAt: NOW }).run();
};
const inst = (id: string, state: string, hbAgo: number) =>
  db.insert(schema.instances).values({ id, pid: 1, state, startedAt: NOW - 60_000, heartbeatAt: NOW - hbAgo }).run();
const jobRow = (id: string) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;

beforeAll(async () => {
  process.env.KX_INSTANCE = 'kx-new';
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  I = await import('@/lib/instance');
  J = await import('@/lib/jobs');
  R = await import('@/lib/relay');
  B = await import('@/lib/bus');
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  db.insert(schema.threads).values({ id: 't', userId: 'u', title: 'T', modelId: 'alpha', effort: 'low', createdAt: 1, updatedAt: 1 }).run();
  inst('kx-old', 'draining', 2_000);
  inst('kx-dead', 'live', 120_000);
  inst('kx-gone', 'gone', 1_000);
});

describe('живость хозяина', () => {
  it('свой — жив; свежий heartbeat — жив; старый, gone, неизвестный и пустой — мёртв', () => {
    I.startInstance({ build: 'B2' });
    expect(I.instanceId()).toBe('kx-new');
    expect(I.ownerAlive('kx-new')).toBe(true);
    expect(I.ownerAlive('kx-old')).toBe(true);
    expect(I.ownerAlive('kx-dead')).toBe(false);
    expect(I.ownerAlive('kx-gone')).toBe(false);
    expect(I.ownerAlive('kx-nobody')).toBe(false);
    expect(I.ownerAlive(null)).toBe(false);
    expect(I.otherInstances(Date.now() + 2000).map((o) => o.id)).toEqual(['kx-old']);
  });
});

describe('старт нового процесса', () => {
  it('ход живого старого не трогает; ход мёртвого и ход без хозяина — «Прервано перезапуском»', () => {
    job('j-old', 'running', 'kx-old');
    job('j-dead', 'running', 'kx-dead');
    job('j-none', 'running', null);
    J.boot();
    expect(jobRow('j-old').status).toBe('running');
    expect(jobRow('j-dead')).toMatchObject({ status: 'error', error: 'Прервано перезапуском сервера' });
    expect(jobRow('j-none').status).toBe('error');
    const meta = db.select().from(schema.messages).where(eq(schema.messages.id, 'm-j-old')).get()!.meta as { status?: string };
    expect(meta.status).toBe('running');
  });

  it('запуск автоматизации живого старого не трогает; мёртвого — прерван', async () => {
    db.insert(schema.automations).values({ id: 'a1', userId: 'u', name: 'A', prompt: 'p', cron: '0 9 * * *', timezone: 'UTC', modelId: 'alpha', levelId: 'low', targetThreadId: 't', enabled: 1, lastStatus: 'running', createdAt: 1, updatedAt: 1 } as typeof schema.automations.$inferInsert).run();
    db.insert(schema.automations).values({ id: 'a2', userId: 'u', name: 'B', prompt: 'p', cron: '0 9 * * *', timezone: 'UTC', modelId: 'beta', levelId: 'off', targetThreadId: 't', enabled: 1, lastStatus: 'running', createdAt: 1, updatedAt: 1 } as typeof schema.automations.$inferInsert).run();
    db.insert(schema.automationRuns).values({ id: 'r-old', automationId: 'a1', startedAt: NOW, status: 'running', trigger: 'schedule', owner: 'kx-old' }).run();
    db.insert(schema.automationRuns).values({ id: 'r-dead', automationId: 'a2', startedAt: NOW, status: 'running', trigger: 'schedule', owner: 'kx-dead' }).run();
    const S = await import('@/lib/scheduler');
    S.startScheduler(3_600_000);
    const run = (id: string) => db.select().from(schema.automationRuns).where(eq(schema.automationRuns.id, id)).get()!;
    const auto = (id: string) => db.select().from(schema.automations).where(eq(schema.automations.id, id)).get()!;
    expect(run('r-old').status).toBe('running');
    expect(auto('a1').lastStatus).toBe('running');
    expect(run('r-dead').status).toBe('error');
    expect(auto('a2').lastStatus).toBe('error');
    const A = await import('@/lib/automations');
    expect(A.modelBusy('alpha')).toBe(true);
    expect(A.modelBusy('beta')).toBe(false);
  });
});

describe('команды к ходу другого процесса', () => {
  it('стоп / на ходу / разрешить — строкой хозяину; хозяин забирает ровно один раз; чужой и законченный — false', () => {
    expect(J.cancelJob('j-old', 'u')).toBe(true);
    expect(J.cancelJob('j-old', 'intruder')).toBe(false);
    expect(J.cancelJob('j-dead', 'u')).toBe(false);
    const st = J.steerJob('j-old', 'u', 'короче', 'next');
    expect(st?.id).toMatch(/^[0-9a-f]{8}$/);
    expect(J.answerJobStep('j-old', 'step-1', 'u', 'allow')).toBe(true);
    const cmds = db.select().from(schema.jobCommands).all();
    expect(cmds.map((c) => [c.owner, c.kind])).toEqual([['kx-old', 'cancel'], ['kx-old', 'steer'], ['kx-old', 'answer']]);
    expect((cmds[1].payload as { steerId?: string }).steerId).toBe(st!.id);
    expect(J.takeCommands()).toBe(0);
  });
});

describe('мост событий', () => {
  it('в доводке события шины пишутся в bus_relay; живой процесс отдаёт их своим подписчикам тем же видом, по разу', () => {
    R.startRelay();
    db.insert(schema.busRelay).values({ origin: 'kx-old', userId: 'u', event: { t: 'd', th: 't', m: 'm-j-old', k: 'c', o: 4, d: ' ещё', id: 77, at: 1 }, at: Date.now() }).run();
    db.insert(schema.busRelay).values({ origin: 'kx-old', userId: 'u', event: { t: 'job', job: 'j-old', status: 'done', id: 78, at: 1 }, at: Date.now() }).run();
    db.insert(schema.busRelay).values({ origin: 'kx-new', userId: 'u', event: { t: 'd', d: 'своё — не пересылать' }, at: Date.now() }).run();
    const got: { t: string; [k: string]: unknown }[] = [];
    const sub = B.subscribe('u', null, (e) => got.push(e));
    expect(R.relayPull()).toBe(2);
    expect(R.relayPull()).toBe(0);
    sub.unsubscribe();
    expect(got.map((e) => e.t)).toEqual(['d', 'job']);
    expect(got[0]).toMatchObject({ th: 't', m: 'm-j-old', k: 'c', o: 4, d: ' ещё' });
    expect(got[0].id).not.toBe(77);
    expect(got[1]).toMatchObject({ job: 'j-old', status: 'done' });
  });
});

describe('доводка', () => {
  it('новых ходов не начинает, очередь отдаёт (в БД остаётся queued), события пишет в мост; занятость — по ходам', () => {
    I.startDrain();
    expect(I.isDraining()).toBe(true);
    job('j-q', 'queued', null);
    expect(J.adoptQueued()).toBe(0);
    expect(jobRow('j-q').status).toBe('queued');
    expect(Object.keys(I.busyNow())).toEqual(expect.arrayContaining(['jobs', 'automations']));
    B.publish('u', { t: 'thread', th: 't' });
    const rows = db.select().from(schema.busRelay).all().filter((r) => r.origin === 'kx-new' && (r.event as { t?: string }).t === 'thread');
    expect(rows.length).toBe(1);
    const row = db.select().from(schema.instances).where(eq(schema.instances.id, 'kx-new')).get()!;
    expect(row.state).toBe('draining');
  });
});
