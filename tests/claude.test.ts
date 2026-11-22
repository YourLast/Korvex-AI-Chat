import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema, eq: typeof import('drizzle-orm').eq;
let J: typeof import('@/lib/jobs'), M: typeof import('@/lib/models'), P: typeof import('@/lib/levelPolicy'), C: typeof import('@/lib/anthropic/client'), A: typeof import('@/lib/analytics');
let mock: { srv: import('node:http').Server; port: number; state: { requests: { path: string; key: string; beta: string; body: Record<string, unknown> }[] } };

beforeAll(async () => {
  // @ts-expect-error — .mjs без типов
  const { startMockAnthropic } = await import('./e2e/mock_anthropic.mjs');
  mock = await startMockAnthropic(0, '');
  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'keys', 'main.key'), 'sk-test-main-k1\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'keys', 'spare.key'), 'sk-test-spare-k2\n', { mode: 0o600 });
  process.env.KX_ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.port}`;
  process.env.KX_ANTHROPIC_RETRIES = '0';
  process.env.KX_RETRY_PAUSE_MS = '1';
  process.env.KX_ANTHROPIC_NOFUNDS_RETRY_MS = '1200';
  process.env.KX_PUSH_SINK = '1';
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8'));
  for (const m of cfg.models) { if (m.provider !== 'anthropic') m.baseUrl = 'http://127.0.0.1:9/v1'; else { delete m.via; delete m.baseUrl; } delete m.systemPromptFile; delete m.extract; }
  cfg.anthropicKeys = ['main.key', 'spare.key'];
  fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
  process.env.MODELS_CONFIG = path.join(dir, 'models.json');
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  ({ eq } = await import('drizzle-orm'));
  db.insert(schema.users).values([
    { id: 'adm', email: 'adm@t.rs', name: 'Админ', passwordHash: 'x', role: 'admin', createdAt: 1 },
    { id: 'alp', email: 'alp@t.rs', name: 'Альфа', passwordHash: 'x', role: 'alpha', createdAt: 1 },
    { id: 'usr', email: 'usr@t.rs', name: 'Тестер', passwordHash: 'x', role: 'user', createdAt: 1 },
  ]).run();
  J = await import('@/lib/jobs'); M = await import('@/lib/models'); P = await import('@/lib/levelPolicy'); C = await import('@/lib/anthropic/client'); A = await import('@/lib/analytics');
});
afterAll(() => new Promise<void>((r) => mock.srv.close(() => r())));

let tn = 0;
const newThread = (userId: string, modelId = 'gamma', levelId = 'medium') => {
  const id = `t${++tn}`;
  db.insert(schema.threads).values({ id, userId, title: 'Новый чат', modelId, effort: levelId, createdAt: 1, updatedAt: 1 }).run();
  return id;
};
const thread = (id: string) => db.select().from(schema.threads).where(eq(schema.threads.id, id)).get()!;
const msg = (id: string) => db.select().from(schema.messages).where(eq(schema.messages.id, id)).get()!;
const ask = async (t: string, userId: string, text: string, levelId = 'medium', modelId = 'gamma') => {
  const s = J.submitTurn({ thread: thread(t), userId, mode: 'send', text, modelId, levelId });
  await J.waitJob(s.jobId);
  return { s, m: msg(s.assistantMessageId), job: db.select().from(schema.jobs).where(eq(schema.jobs.id, s.jobId)).get()! };
};
const reqs = () => mock.state.requests.filter((r) => r.path.startsWith('/v1/messages') && !r.path.includes('count_tokens'));
type Meta = { claude?: { msgs: { role: string; content: { type: string; id?: string; tool_use_id?: string }[] }[]; mode: string; top: string; effort: string; pre?: unknown[] }; usage?: Record<string, unknown> & { claude?: Record<string, unknown> }; error?: string | null; errorUser?: string | null; steps?: { tool?: string; status: string }[] };

describe('Gamma: ход через Claude API', () => {

  it('смена уровня посреди чата — effort-сообщением (верхний effort беседы не меняется, кэш цел)', async () => {
    const t = newThread('alp');
    await ask(t, 'alp', 'Вопрос на medium');
    const n0 = reqs().length;
    const { m } = await ask(t, 'alp', 'Вопрос на max', 'max');
    const r = reqs()[n0];
    const b = r.body as { output_config: { effort: string }; messages: { role: string; content: unknown; output_config?: unknown }[] };
    expect(b.output_config.effort).toBe('medium');
    expect(b.messages.at(-2)).toEqual({ role: 'system', content: [], output_config: { effort: 'max' } });
    expect(r.beta).toContain('mid-conversation-output-config-2026-07-01');
    expect(m.reasoning).toContain('уровень max');
    const n1 = reqs().length;
    await ask(t, 'alp', 'Ещё на max', 'max');
    const b2 = reqs()[n1].body as { messages: { role: string }[] };
    expect(b2.messages.filter((x) => x.role === 'system')).toHaveLength(1);
  });

  it('Off — thinking between_tools; после ходов с мыслями история без мыслей и effort-сообщений', async () => {
    const t = newThread('alp');
    await ask(t, 'alp', 'С мыслями', 'high');
    const n0 = reqs().length;
    const { m } = await ask(t, 'alp', 'Без мыслей', 'off');
    const b = reqs()[n0].body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.thinking).toEqual({ type: 'between_tools' });
    expect(b.output_config.effort).toBe('medium');
    expect(reqs()[n0].beta).not.toContain('mid-conversation-output-config');
    expect(JSON.stringify(b.messages)).not.toContain('"thinking"');
    expect((m.meta as Meta).claude!.mode).toBe('between_tools');
  });

  it('инструменты Korvex: tool_use -> шаг в ленте -> tool_result тем же id -> ответ', async () => {
    const t = newThread('alp');
    const n0 = reqs().length;
    const { m } = await ask(t, 'alp', 'Покажи мои чаты [tool]');
    expect(m.content).toBe('Готово: нашёл то, что нужно.');
    const meta = m.meta as Meta;
    expect(meta.steps?.find((s) => s.tool === 'chat_list')?.status).toBe('ok');
    const second = reqs()[n0 + 1].body as { messages: { role: string; content: { type: string; id?: string; tool_use_id?: string }[] }[] };
    const use = second.messages.at(-2)!.content.find((x) => x.type === 'tool_use')!;
    const res = second.messages.at(-1)!.content.find((x) => x.type === 'tool_result')!;
    expect(res.tool_use_id).toBe(use.id);
    expect(meta.claude!.msgs.map((x) => x.role)).toEqual(['assistant', 'user', 'assistant']);
    expect((meta.usage!.claude as { requests: number }).requests).toBe(2);
  });

  it('отказ: «Gamma не может с этим помочь.», частичный вывод не остаётся ответом', async () => {
    const t = newThread('alp');
    const { m, job } = await ask(t, 'alp', 'Опасное [refuse]');
    const meta = m.meta as Meta;
    expect(job.status).toBe('error');
    expect(meta.errorUser).toBe('Gamma не может с этим помочь.');
    expect(meta.error).toBe('refusal: cyber');
    expect(m.content).toBe('');
    expect(JSON.stringify(meta)).not.toContain('"type":"error"');
  });

  it('перегрузка API (529): понятная фраза, без сырого JSON', async () => {
    const t = newThread('alp');
    const { m } = await ask(t, 'alp', 'Тяжело [busy]');
    expect((m.meta as Meta).errorUser).toBe('Gamma сейчас перегружена — попробуйте через минуту.');
  });
});

describe('роли', () => {
  it('выбор моделей: user — без Gamma и Delta, alpha и admin — обе; max у Gamma открыт альфе', () => {
    const ids = (role: string) => P.modelsFor(role).map((m) => m.id);
    expect(ids('user')).not.toContain('gamma'); expect(ids('user')).not.toContain('delta');
    expect(ids('alpha')).toContain('gamma'); expect(ids('alpha')).toContain('delta');
    expect(ids('admin')).toEqual(expect.arrayContaining(['alpha', 'gamma', 'delta']));
    expect(P.modelsFor('alpha').find((m) => m.id === 'gamma')!.levels.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(P.modelsFor('admin').find((m) => m.id === 'delta')!.levels.map((l) => l.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(M.usableModel('gamma', 'user')).toBeUndefined();
    expect(M.usableModel('gamma', 'alpha')?.id).toBe('gamma');
    expect(M.usableModel('delta', 'alpha')?.id).toBe('delta');
    expect(M.usableModel('delta', 'user')).toBeUndefined();
    expect(JSON.stringify(P.modelsFor('admin'))).not.toMatch(/anthropic|claude/i);
  });

  it('через ключи API Gamma не отдаётся', () => {
    expect(() => J.submitInline({ userId: 'alp', modelId: 'gamma', levelId: 'medium', input: { messages: [{ role: 'user', content: 'x' }], session: 's' }, apiKeyId: null })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => J.submitInline({ userId: 'usr', modelId: 'gamma', levelId: 'medium', input: { messages: [{ role: 'user', content: 'x' }], session: 's' }, apiKeyId: null })).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('ключи Anthropic: основной без денег -> запасной без потери хода', () => {
  it('402 billing_error на основном: тот же ход на запасном; учёт $ по ключам; через 30 мин (в тесте 1,2 с) — снова основной', async () => {
    C._resetClaudeKeys();
    const t = newThread('alp');
    const n0 = reqs().length;
    const { m, job } = await ask(t, 'alp', 'Деньги [nofunds]');
    expect(job.status).toBe('done');
    expect(m.content).toContain('Ответ claude-sonnet-5-5');
    const rs = reqs().slice(n0);
    expect(rs.map((r) => r.key)).toEqual(['k1', 'k2']);
    expect((m.meta as Meta).usage!.claude!.usd_by_key).toEqual({ 2: expect.any(Number) });
    const v = C.keysView();
    expect(v.active).toMatchObject({ n: 2, main: false, last4: 'e-k2' });
    expect(v.lastSwitch).toMatchObject({ from: 1, to: 2, why: 'без денег' });
    expect(v.noFunds.map((x) => x.n)).toEqual([1]);
    expect(JSON.stringify(v)).not.toContain('sk-test');
    const n1 = reqs().length;
    await ask(t, 'alp', 'Ещё вопрос');
    expect(reqs().slice(n1).map((r) => r.key)).toEqual(['k2']);
    await new Promise((r) => setTimeout(r, 1250));
    const n2 = reqs().length;
    await ask(t, 'alp', 'Снова основной');
    expect(reqs().slice(n2).map((r) => r.key)).toEqual(['k1']);
    const v2 = C.keysView();
    expect(v2.active).toMatchObject({ n: 1, main: true });
    expect(v2.noFunds).toEqual([]);
    expect(v2.lastSwitch).toMatchObject({ from: 2, to: 1, why: 'вернулся на основной' });
    expect(fs.readFileSync(path.join(dir, 'claude_keys.json'), 'utf8')).not.toContain('sk-test');
  });
});

describe('strict у инструментов', () => {
  it('не больше 20 strict и 24 необязательных параметров, выбор детерминирован (чаты, поиск, память, код — раньше браузера)', async () => {
    const R = await import('@/lib/anthropic/run');
    const { allTools } = await import('@/lib/tools/registry');
    const all = allTools().filter((t) => t.name !== 'model_work') as never[];
    const a = R.toolDefs(all, true) as { name: string; strict?: boolean }[];
    const on = a.filter((x) => x.strict) as unknown as { input_schema: unknown }[];
    expect(on.length).toBeGreaterThan(5); expect(on.length).toBeLessThanOrEqual(20);
    expect(on.reduce((s, x) => s + R.optionalCount(x.input_schema), 0)).toBeLessThanOrEqual(24);
    expect(a.find((x) => x.name === 'chat_list')!.strict).toBe(true);
    expect(a.find((x) => x.name === 'web_search')!.strict).toBe(true);
    expect(R.toolDefs([...all].reverse(), true).filter((x) => (x as { strict?: boolean }).strict).map((x) => (x as { name: string }).name).sort()).toEqual(a.filter((x) => x.strict).map((x) => x.name).sort());
  });
});
