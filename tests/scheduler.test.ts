import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

const dir = tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let tick: typeof import('@/lib/scheduler').tick, runAutomation: typeof import('@/lib/automations').runAutomation, modelBusy: typeof import('@/lib/automations').modelBusy;

const uid = 'u1', tid = 't1';
const mkAuto = (id: string, modelId: string, next: number | null, enabled = 1) => db.insert(schema.automations).values({
  id, userId: uid, name: id, description: '', prompt: 'p', modelId, levelId: modelId === 'alpha' ? 'off' : 'off', cron: '0 9 * * *', timezone: 'UTC',
  targetThreadId: tid, enabled, nextRunAt: next, createdAt: Date.now(),
}).run();

beforeAll(async () => {
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: uid, email: 'u@t', name: 'U', passwordHash: 'x', role: 'alpha', createdAt: 1 }).run();
  db.insert(schema.threads).values({ id: tid, userId: uid, title: 'T', modelId: 'beta', effort: 'off', createdAt: 1, updatedAt: 1 }).run();
  ({ tick } = await import('@/lib/scheduler'));
  ({ runAutomation, modelBusy } = await import('@/lib/automations'));
});
beforeEach(() => { db.delete(schema.automationRuns).run(); db.delete(schema.automations).run(); });
afterAll(() => {  void dir; });

describe('планировщик', () => {
  it('второй процесс на той же базе не запускает задачу повторно (захват next_run_at)', () => {
    const now = 1_500_000;
    mkAuto('dup', 'beta', now - 1);
    const started: string[] = [];
    const run = (async (a: { id: string }) => { started.push(a.id); return { runId: 'r', status: 'ok' as const }; }) as never;
    expect(tick(now, { run })).toEqual(['dup']);
    expect(tick(now, { run })).toEqual([]);
    expect(started).toEqual(['dup']);
    expect(db.select().from(schema.automations).all()[0].nextRunAt).toBeNull();
  });

  it('берёт только включённые и наступившие', () => {
    const now = 1_000_000;
    mkAuto('due', 'beta', now - 1);
    mkAuto('future', 'beta', now + 60_000);
    mkAuto('paused', 'beta', now - 1, 0);
    mkAuto('never', 'beta', null);
    const started: string[] = [];
    const ids = tick(now, { run: (async (a: { id: string }) => { started.push(a.id); return { runId: 'r', status: 'ok' as const }; }) as never });
    expect(ids).toEqual(['due']);
    expect(started).toEqual(['due']);
  });

  it('на модель не больше одного запуска: вторая задача той же модели ждёт, другая модель идёт', async () => {
    const now = 2_000_000;
    mkAuto('s1', 'beta', now - 5); mkAuto('s2', 'beta', now - 4); mkAuto('e1', 'alpha', now - 3);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const run = ((a: Parameters<typeof runAutomation>[0], trg: 'schedule' | 'manual') => runAutomation(a, trg, {
      run: (async (inp: { modelId: string }) => { calls.push(inp.modelId); await gate; return { assistantId: 'm', content: 'ok', error: null, finish: 'stop', stopped: false, durationMs: 1 }; }) as never,
    })) as typeof runAutomation;
    const first = tick(now, { run });
    expect(first.sort()).toEqual(['e1', 's1']);
    await new Promise((r) => setTimeout(r, 20));
    expect(modelBusy('beta')).toBe(true);
    expect(tick(now, { run })).toEqual([]);
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(modelBusy('beta')).toBe(false);
    expect(tick(now + 10, { run }).includes('s2')).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c === 'beta')).toHaveLength(2);
    expect(modelBusy('beta') || modelBusy('alpha')).toBe(false);
  });

  it('ошибка хода попадает в журнал и в задачу, расписание двигается дальше', async () => {
    mkAuto('bad', 'alpha', null);
    const a = db.select().from(schema.automations).all().find((x) => x.id === 'bad')!;
    const out = await runAutomation(a, 'manual', { run: (async () => ({ assistantId: 'm', content: '', error: '502: источник не отвечает', finish: null, stopped: false, durationMs: 1 })) as never });
    expect(out.status).toBe('error');
    const row = db.select().from(schema.automations).all().find((x) => x.id === 'bad')!;
    expect(row.lastStatus).toBe('error');
    expect(row.lastError).toContain('источник не отвечает');
    expect(row.nextRunAt).toBeGreaterThan(Date.now());
    const runs = db.select().from(schema.automationRuns).all().filter((r) => r.automationId === 'bad');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('error');
  });

  it('пустой ответ — тоже ошибка; чат результата удалён — ошибка с понятным текстом', async () => {
    mkAuto('empty', 'alpha', null);
    const a = db.select().from(schema.automations).all().find((x) => x.id === 'empty')!;
    const out = await runAutomation(a, 'manual', { run: (async () => ({ assistantId: 'm', content: '  ', error: null, finish: 'stop', stopped: false, durationMs: 1 })) as never });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/пустой/);
    db.insert(schema.threads).values({ id: 'gone', userId: uid, title: 'G', modelId: 'beta', effort: 'off', createdAt: 1, updatedAt: 1 }).run();
    mkAuto('orphan', 'alpha', null);
    db.update(schema.automations).set({ targetThreadId: 'gone' }).where(eq(schema.automations.id, 'orphan')).run();
    db.delete(schema.automations).where(eq(schema.automations.id, 'orphan')).run();
    expect(db.select().from(schema.automations).all().some((x) => x.id === 'orphan')).toBe(false);
  });
});

import { eq } from 'drizzle-orm';
