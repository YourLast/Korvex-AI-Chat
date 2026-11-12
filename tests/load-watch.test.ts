import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';
import {
  LW, cfgFromEnv, eventText, fmtWait, persistOf, watchInit, watchStep, whoWaits,
  type LoadCfg, type LoadEvent, type LoadSample, type LoadWatch,
} from '@/lib/loadWatch';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const T0 = 1_800_000_000_000;
const base = (o: Partial<LoadSample> = {}): LoadSample => ({ now: T0, running: 0, queued: 0, etaNext: 0, busyAuto: false, waiting: [], turnsLastMinute: 0, pushOn: true, ...o });

class Sim {
  s: LoadWatch; t = T0; events: LoadEvent[] = []; pushes: LoadEvent[] = [];
  constructor(public cfg: LoadCfg = LW, init?: LoadWatch) { this.s = init ?? watchInit(); }
  step(o: Partial<LoadSample> = {}, dt = 5_000) {
    this.t += dt;
    const r = watchStep(this.s, base({ now: this.t, ...o }), this.cfg);
    this.s = r.state; this.events.push(...r.events); if (r.push) this.pushes.push(r.push);
    return r;
  }
  idle(sec: number, dt = 5_000, o: Partial<LoadSample> = {}) { for (let i = 0; i < Math.round((sec * 1000) / dt); i++) this.step(o, dt); }
  kinds() { return this.events.map((e) => e.kind); }
}
const wait = (name: string, sec: number) => ({ name, sinceMs: sec * 1000 });

describe('резкий рост нагрузки после тишины', () => {
  it('в работе с ~0 до ≥ 3 за минуту — spike и одно push; раньше этого или при 2 — нет', () => {
    const m = new Sim();
    m.idle(70);
    expect(m.step({ running: 2 }).events).toEqual([]);
    const r = m.step({ running: 3, turnsLastMinute: 3 });
    expect(r.events.map((e) => e.kind)).toEqual(['spike']);
    expect(r.push).toMatchObject({ kind: 'spike', running: 3, turns: 3 });
    expect(r.events[0]).toMatchObject({ push: true, running: 3 });
  });

  it('после перезапуска (минуты истории нет) уже идущая нагрузка резким ростом не считается; ровная нагрузка тоже', () => {
    const m = new Sim();
    m.idle(120, 5_000, { running: 5, turnsLastMinute: 12 });
    expect(m.kinds()).toEqual([]);
  });

  it('новых ходов за минуту ≥ 8 при ≤ 3 минутой раньше — spike; при ровных 10 в минуту — нет', () => {
    const m = new Sim();
    m.idle(70);
    const r = m.step({ running: 2, turnsLastMinute: 9 });
    expect(r.events.map((e) => e.kind)).toEqual(['spike']);
    expect(r.events[0].turns).toBe(9);
    const steady = new Sim();
    steady.idle(130, 5_000, { turnsLastMinute: 10 });
    expect(steady.kinds()).toEqual([]);
  });
});

describe('очередь, ожидание, режим высокой нагрузки', () => {
  it('очередь: ждут места дольше 15 с (не 14) — queue с именами ждущих, дольше всех первым', () => {
    const m = new Sim();
    m.idle(10);
    expect(m.step({ queued: 2, waiting: [wait('Анна', 14)] }).events).toEqual([]);
    const r = m.step({ queued: 3, waiting: [wait('Анна', 19), wait('Борис', 16), wait('Анна', 4)] });
    expect(r.events.map((e) => e.kind)).toEqual(['queue']);
    expect(r.events[0].waiting).toEqual([{ name: 'Анна', sec: 19 }, { name: 'Борис', sec: 16 }]);
    expect(r.events[0].people).toBe(2);
    expect(r.push?.kind).toBe('queue');
  });

  it('ожидание для нового сообщения: 59 с — тихо, 60 с — eta', () => {
    const m = new Sim();
    m.idle(10);
    expect(m.step({ etaNext: 59 }).events).toEqual([]);
    const r = m.step({ etaNext: 60, running: 5, queued: 1 });
    expect(r.events.map((e) => e.kind)).toEqual(['eta']);
    expect(r.events[0]).toMatchObject({ eta: 60, running: 5, queued: 1, push: true });
  });

  it('режим высокой нагрузки: включился — busyOn (push), выключился — busyOff только в журнал', () => {
    const m = new Sim();
    m.idle(10);
    const on = m.step({ busyAuto: true, etaNext: 40, queued: 2 });
    expect(on.events.map((e) => e.kind)).toEqual(['busyOn']);
    expect(on.push?.kind).toBe('busyOn');
    m.step({ busyAuto: true, etaNext: 40, queued: 2 });
    expect(m.kinds()).toEqual(['busyOn']);
    const off = m.step({ busyAuto: false });
    expect(off.events.map((e) => e.kind)).toEqual(['busyOff']);
    expect(off.events[0].push).toBe(false);
    expect(off.push).toBeNull();
  });

  it('несколько событий подряд: push не чаще раза в gapMs, в паузу копятся и уходят одним сообщением с самым важным заголовком', () => {
    const m = new Sim();
    m.idle(70);
    const a = m.step({ etaNext: 70, running: 5, queued: 3 });
    expect(a.push?.kind).toBe('eta');
    const b = m.step({ etaNext: 70, running: 5, queued: 3, waiting: [wait('Анна', 20)] }, 15_000);
    expect(b.events.map((e) => e.kind)).toEqual(['queue']);
    expect(b.push).toBeNull();
    const c = m.step({ etaNext: 70, running: 5, queued: 3, waiting: [wait('Анна', 35)], busyAuto: true }, 20_000);
    expect(c.events.map((e) => e.kind)).toEqual(['busyOn']);
    expect(c.push).toBeNull();
    let late: LoadEvent | null = null;
    for (let i = 0; i < 8 && !late; i++) late = m.step({ etaNext: 70, running: 5, queued: 3, waiting: [wait('Анна', 40 + i * 5)], busyAuto: true }, 5_000).push;
    expect(late).toMatchObject({ kind: 'busyOn', queued: 3 });
    expect(m.pushes.length).toBe(2);
  });
});

describe('дребезг: не чаще раза в 10 минут, пока не стало намного хуже', () => {
  const q = (n: number, sec = 30) => ({ queued: n, waiting: [wait('Анна', sec)], running: 5, etaNext: 30 });
  it('тот же вид в течение 10 минут молчит, на десятой минуте при той же картине — снова', () => {
    const m = new Sim();
    m.idle(20);
    m.step(q(2));
    expect(m.kinds()).toEqual(['queue']);
    for (let i = 0; i < 18; i++) m.step(q(2), 30_000);
    expect(m.kinds()).toEqual(['queue']);
    m.step(q(2), 30_000); m.step(q(2), 30_000);
    expect(m.kinds()).toEqual(['queue', 'queue']);
  });
  it('очередь выросла вдвое и ещё на ≥ 2 — снова, не дожидаясь 10 минут; на 1 больше — нет', () => {
    const m = new Sim();
    m.idle(20);
    m.step(q(2));
    m.step(q(3), 70_000);
    expect(m.kinds()).toEqual(['queue']);
    m.step(q(4), 5_000);
    expect(m.kinds()).toEqual(['queue', 'queue']);
    expect(m.events[1].queued).toBe(4);
  });
  it('но не чаще, чем через gapMs после прошлого такого оповещения (лавина при быстром росте)', () => {
    const m = new Sim();
    m.idle(20);
    m.step(q(2));
    m.step(q(4), 20_000);
    expect(m.kinds()).toEqual(['queue']);
    m.step(q(4), 45_000);
    expect(m.kinds()).toEqual(['queue', 'queue']);
  });
  it('ожидание выросло вдвое — снова; на 1,5× — нет', () => {
    const m = new Sim();
    m.idle(20);
    m.step({ etaNext: 60 });
    m.step({ etaNext: 90 }, 90_000);
    expect(m.kinds()).toEqual(['eta']);
    m.step({ etaNext: 120 }, 90_000);
    expect(m.kinds()).toEqual(['eta', 'eta']);
    expect(m.events[1].eta).toBe(120);
  });
});

describe('«спало»: одно сообщение через ~3 минуты спокойствия и только если оповещение уходило', () => {
  it('без оповещения «спало» не бывает', () => {
    const m = new Sim();
    m.idle(400);
    expect(m.events).toEqual([]);
  });
  it('после оповещения: через 3 минуты — clear (push), раньше — нет; потом снова тихо', () => {
    const m = new Sim();
    m.idle(20);
    m.step({ queued: 2, waiting: [wait('Анна', 20)], running: 5, etaNext: 30 });
    expect(m.kinds()).toEqual(['queue']);
    m.idle(175);
    m.step({});
    expect(m.kinds()).toEqual(['queue']);
    const r = m.step({});
    expect(r.events.map((e) => e.kind)).toEqual(['clear']);
    expect(r.push).toMatchObject({ kind: 'clear', running: 0 });
    m.idle(400);
    expect(m.kinds()).toEqual(['queue', 'clear']);
  });
  it('всплеск посреди спокойствия сбрасывает отсчёт', () => {
    const m = new Sim();
    m.idle(20);
    m.step({ etaNext: 80, queued: 2 });
    m.idle(150);
    m.step({ queued: 1, etaNext: 25, waiting: [wait('Анна', 2)] });
    m.idle(170);
    expect(m.kinds()).toEqual(['eta']);
    m.idle(20);
    expect(m.kinds()).toEqual(['eta', 'clear']);
  });
  it('режим высокой нагрузки ещё включён или ожидание ≥ 20 с — это не «спокойно»', () => {
    const m = new Sim();
    m.idle(20);
    m.step({ etaNext: 80, queued: 2 });
    m.idle(300, 5_000, { busyAuto: true, etaNext: 10 });
    expect(m.kinds()).toEqual(['eta', 'busyOn']);
    m.idle(300, 5_000, { etaNext: 25 });
    expect(m.kinds()).toEqual(['eta', 'busyOn', 'busyOff']);
    m.idle(200, 5_000, { etaNext: 5 });
    expect(m.kinds()).toEqual(['eta', 'busyOn', 'busyOff', 'clear']);
  });
});

describe('выключатель администратора', () => {
  it('выключено: события пишутся в журнал (push: false), push нет, «спало» не шлётся', () => {
    const m = new Sim();
    m.idle(20, 5_000, { pushOn: false });
    m.step({ queued: 3, etaNext: 90, waiting: [wait('Анна', 30)], pushOn: false });
    expect(m.events.map((e) => [e.kind, e.push])).toEqual([['queue', false], ['eta', false]]);
    m.idle(200, 5_000, { pushOn: false });
    expect(m.events.map((e) => [e.kind, e.push])).toEqual([['queue', false], ['eta', false], ['clear', false]]);
    expect(m.pushes).toEqual([]);
  });
  it('выключили после оповещения: накопившийся push отменяется', () => {
    const m = new Sim();
    m.idle(70);
    m.step({ etaNext: 80, queued: 2 });
    const b = m.step({ queued: 2, etaNext: 80, waiting: [wait('Анна', 20)] }, 10_000);
    expect(b.push).toBeNull();
    const c = m.step({ queued: 2, etaNext: 80, waiting: [wait('Анна', 30)], pushOn: false }, 60_000);
    expect(c.push).toBeNull();
  });
  it('включили посреди эпизода без push: «спало» без единого оповещения не шлём', () => {
    const m = new Sim();
    m.idle(20, 5_000, { pushOn: false });
    m.step({ etaNext: 80, queued: 2, pushOn: false });
    const r = (() => { m.idle(180, 5_000, { pushOn: true }); return m.step({}); })();
    expect(r.events.map((e) => [e.kind, e.push])).toEqual([['clear', false]]);
    expect(r.push).toBeNull();
  });
});

describe('перезапуск процесса', () => {
  it('эпизод и метки переживают перезапуск (persistOf -> watchInit): «спало» всё равно придёт; первую минуту рост не оценивается', () => {
    const m = new Sim();
    m.idle(20);
    m.step({ etaNext: 80, queued: 2 });
    const saved = JSON.parse(JSON.stringify(persistOf(m.s)));
    const m2 = new Sim(LW, watchInit(saved));
    m2.t = m.t;
    m2.step({ running: 5, etaNext: 0 });
    m2.step({ etaNext: 85, queued: 3 }, 5_000);
    expect(m2.kinds()).toEqual([]);
    m2.idle(200);
    expect(m2.kinds()).toEqual(['clear']);
  });
});

describe('тексты: язык администратора', () => {
  const ev = (o: Partial<LoadEvent> = {}): LoadEvent => ({ kind: 'queue', at: T0, push: true, running: 5, queued: 3, eta: 90, turns: 9, people: 5,
    waiting: [{ name: 'Анна', sec: 22 }, { name: 'Борис', sec: 18 }, { name: 'Вера', sec: 16 }, { name: 'Глеб', sec: 15 }], ...o });
  it('очередь: заголовок, самое долгое ожидание, числа и имена (три и «+N»)', () => {
    expect(eventText('ru', ev())).toMatchObject({ title: 'Появилась очередь', body: 'Самое долгое ожидание места — 22 с. В работе 5, в очереди 3. Ждут: Анна, Борис, Вера +2.' });
    expect(eventText('en', ev())).toMatchObject({ title: 'A queue has formed', body: 'Longest wait for a slot: 22 s. 5 running, 3 queued. Waiting: Анна, Борис, Вера +2.' });
    expect(eventText('sr', ev())).toMatchObject({ title: 'Pojavio se red čekanja', body: 'Najduže čekanje na mesto: 22 s. U radu 5, u redu 3. Čekaju: Анна, Борис, Вера +2.' });
    expect(eventText('ru', ev()).line).toBe('Появилась очередь — Самое долгое ожидание места — 22 с. В работе 5, в очереди 3. Ждут: Анна, Борис, Вера +2.');
  });
  it('все виды на трёх языках: ни одного ключа без перевода, в en и sr нет кириллицы (без имён)', () => {
    for (const kind of ['spike', 'queue', 'eta', 'busyOn', 'busyOff', 'clear'] as const) for (const lang of ['ru', 'en', 'sr'] as const) {
      const t = eventText(lang, ev({ kind, waiting: [], people: 0 }));
      expect(t.title, `${kind}/${lang}`).not.toMatch(/^ops\./);
      expect(t.body, `${kind}/${lang}`).not.toMatch(/ops\.|\{/);
      if (lang !== 'ru') expect(t.line, `${kind}/${lang}`).not.toMatch(/[А-Яа-яЁё]/);
      else expect(t.line).toMatch(/[А-Яа-яЁё]/);
    }
    expect(eventText('en', ev({ kind: 'eta', eta: 150, waiting: [], people: 0 })).body).toBe('A new message would wait ~3 min. 5 running, 3 queued.');
    expect(eventText('sr', ev({ kind: 'spike', waiting: [], people: 0 })).body).toBe('U radu 5, u redu 3, novih zahteva u poslednjem minutu: 9.');
    expect(eventText('ru', ev({ kind: 'clear', running: 1, waiting: [], people: 0 }))).toMatchObject({ title: 'Нагрузка спала', body: 'Очереди и ожидания нет — новые сообщения начинаются сразу.' })
    expect(eventText('en', ev({ kind: 'clear', waiting: [], people: 0 })).body).toBe('No queue and no waiting — new messages start right away.')
    expect(eventText('sr', ev({ kind: 'clear', waiting: [], people: 0 })).body).toBe('Nema reda ni čekanja — nove poruke počinju odmah.');
  });
  it('ожидание словами: до полутора минут — секунды, дальше — минуты; имена без дублей', () => {
    expect(fmtWait(45, 'ru')).toBe('45 с');
    expect(fmtWait(89, 'en')).toBe('89 s');
    expect(fmtWait(90, 'ru')).toBe('2 мин');
    expect(fmtWait(300, 'sr')).toBe('5 min');
    expect(whoWaits([wait('Анна', 5), wait('Борис', 9), wait('Анна', 12)])).toEqual({ list: [{ name: 'Анна', sec: 12 }, { name: 'Борис', sec: 9 }], people: 2 });
  });
  it('конфигурация из окружения: числа берутся, мусор и чужие поля — нет', () => {
    expect(cfgFromEnv(undefined)).toEqual(LW);
    expect(cfgFromEnv('{"calmMs":8000,"gapMs":2000,"bogus":1,"repeatMs":"x"}')).toEqual({ ...LW, calmMs: 8000, gapMs: 2000 });
    expect(cfgFromEnv('не json')).toEqual(LW);
  });
});

describe('оболочка: кому уходит push', () => {
  const dir = tmpData();
  type L = typeof import('@/lib/loadAlerts');
  let A: L, S: typeof import('@/lib/status'), P: typeof import('@/lib/push'), route: typeof import('@/app/api/admin/load-alerts/route');
  let adminKey = '', userKey = '';
  const sent: { userId: string; endpoint: string; p: { title: string; body: string; url: string; tag?: string } }[] = [];
  const send = async (sub: { endpoint: string }, p: { title: string; body: string; url: string; tag?: string }, who: { userId: string }) => { sent.push({ userId: who.userId, endpoint: sub.endpoint, p }); return 'ok' as const; };
  const Q = (o: Partial<{ active: number; queued: number; etaNext: number }> = {}) => [{ key: 'alpha', active: 5, queued: 3, etaNext: 30, ...o }];
  const waiting = (sec: number) => () => [{ userId: 'u1', kind: 'chat' as const, sinceMs: sec * 1000 }, { userId: 'u1', kind: 'chat' as const, sinceMs: (sec - 3) * 1000 }];
  const tick = (q = Q(), now = T0, sec = 20) => A.loadAlertsTick(q, now, { send, waiting: waiting(sec), arrivals: () => 0 })!;
  const fresh = () => { sent.length = 0; A._resetLoadAlerts(); (globalThis as { __kxStatus?: unknown }).__kxStatus = undefined; };

  beforeAll(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/models.json'), 'utf8').replace(/,\s*"hidden": true/g, ''));
    for (const m of cfg.models) { m.baseUrl = 'http://127.0.0.1:9/v1'; delete m.systemPromptFile; }
    fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(cfg));
    process.env.MODELS_CONFIG = path.join(dir, 'models.json');
    process.env.KX_PROBE = '0';
    delete process.env.KX_PUSH_SINK;
    const { getDb, schema } = await import('@/lib/db');
    const db = getDb();
    db.insert(schema.users).values([
      { id: 'a1', email: 'a1@t', name: 'Админ Один', passwordHash: 'x', role: 'admin', createdAt: 1 },
      { id: 'a2', email: 'a2@t', name: 'Admin Two', passwordHash: 'x', role: 'admin', lang: 'en', createdAt: 1 },
      { id: 'a3', email: 'a3@t', name: 'Admin Tri', passwordHash: 'x', role: 'admin', lang: 'sr', createdAt: 1 },
      { id: 'a4', email: 'a4@t', name: 'Без push', passwordHash: 'x', role: 'admin', createdAt: 1 },
      { id: 'a5', email: 'a5@t', name: 'Отключён', passwordHash: 'x', role: 'admin', disabled: 1, createdAt: 1 },
      { id: 'u1', email: 'u1@t', name: 'Анна', passwordHash: 'x', role: 'user', createdAt: 1 },
    ]).run();
    P = await import('@/lib/push');
    for (const id of ['a1', 'a2', 'a3', 'a5', 'u1']) P.saveSub(id, `dev-${id}`, { endpoint: `https://fcm.googleapis.com/x/${id}`, keys: { p256dh: 'k'.repeat(20), auth: 'a'.repeat(8) } }, 'test');
    P.saveSub('a1', 'dev-a1-b', { endpoint: 'https://fcm.googleapis.com/x/a1b', keys: { p256dh: 'k'.repeat(20), auth: 'a'.repeat(8) } }, 'test');
    const K = await import('@/lib/apikeys');
    const users = db.select().from(schema.users).all();
    adminKey = (K.createKey(users.find((u) => u.id === 'a2')!, { name: 'скрипт', models: ['alpha'], rpm: 1000 }) as { key: string }).key;
    userKey = (K.createKey(users.find((u) => u.id === 'u1')!, { name: 'обычный', models: ['alpha'], rpm: 1000 }) as { key: string }).key;
    S = await import('@/lib/status');
    A = await import('@/lib/loadAlerts');
    route = await import('@/app/api/admin/load-alerts/route');
  });
  afterAll(() => { delete process.env.KX_PUSH_SINK; });

  it('очередь: push получают администраторы с подпиской (на всех устройствах), на своём языке, с тегом вида и ссылкой на «Состояние»; обычный пользователь, отключённый и без подписки — нет', async () => {
    fresh(); S.setLoadAlerts(true);
    const r = tick();
    expect(r.events.map((e) => e.kind)).toEqual(['queue']);
    expect(await r.sent).toBe(4);
    const by = (id: string) => sent.filter((x) => x.userId === id);
    expect(sent.map((x) => x.userId).sort()).toEqual(['a1', 'a1', 'a2', 'a3']);
    expect(by('a1')[0].p).toMatchObject({ title: 'Появилась очередь', url: '/admin#state', tag: 'ops-queue' });
    expect(by('a1')[0].p.body).toContain('Ждут: Анна.');
    expect(by('a2')[0].p).toMatchObject({ title: 'A queue has formed', tag: 'ops-queue' });
    expect(by('a2')[0].p.body).toBe('Longest wait for a slot: 20 s. 5 running, 3 queued. Waiting: Анна.');
    expect(by('a3')[0].p).toMatchObject({ title: 'Pojavio se red čekanja' });
  });

  it('тихие часы администратора: push ему не идёт, остальным идёт, событие в журнале есть', async () => {
    fresh();
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    getDb().update(schema.users).set({ notifyQuiet: '00:00-23:59' }).where(eq(schema.users.id, 'a2')).run();
    const r = tick(Q({ queued: 5 }), T0 + 3_600_000);
    expect(await r.sent).toBe(3);
    expect(sent.some((x) => x.userId === 'a2')).toBe(false);
    expect(S.alertLog().at(-1)?.kind).toBe('queue');
    getDb().update(schema.users).set({ notifyQuiet: null }).where(eq(schema.users.id, 'a2')).run();
  });

  it('выключатель: push не идёт, журнал пишется (push: false); включили — снова идёт', async () => {
    fresh();
    const before = S.alertLog().length;
    S.setLoadAlerts(false);
    const r = tick(Q({ queued: 7 }), T0 + 7_200_000);
    expect(r.events.map((e) => [e.kind, e.push])).toEqual([['queue', false]]);
    expect(r.push).toBeNull();
    expect(await r.sent).toBe(0);
    expect(sent).toEqual([]);
    expect(S.alertLog().length).toBe(before + 1);
    expect(S.alertLog().at(-1)).toMatchObject({ kind: 'queue', push: false, queued: 7 });
    S.setLoadAlerts(true);
    const r2 = tick(Q({ queued: 14 }), T0 + 7_200_000 + 120_000, 40);
    expect(r2.events.map((e) => e.kind)).toEqual(['queue']);
    expect(await r2.sent).toBe(4);
  });

  it('данные в data/status.json: журнал (не больше 30) и состояние переживают перезапуск; после неё «спало» всё равно приходит', async () => {
    fresh(); S.setLoadAlerts(true);
    const r = tick(Q({ queued: 9 }), T0 + 10_000_000);
    expect(r.events.length).toBe(1);
    await r.sent;
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    expect(file.loadAlerts).toBe(true);
    expect(file.alertLog.at(-1)).toMatchObject({ kind: 'queue', queued: 9 });
    expect(file.alertState).toMatchObject({ episode: true, pushed: true });
    expect(file.alertLog.length).toBeLessThanOrEqual(30);
    fresh();
    expect(S.alertLog().at(-1)).toMatchObject({ kind: 'queue', queued: 9 });
    const calm = Q({ active: 0, queued: 0, etaNext: 0 });
    let last: ReturnType<typeof tick> | null = null;
    for (let i = 0; i <= 4; i++) { last = A.loadAlertsTick(calm, T0 + 10_100_000 + i * 60_000, { send, waiting: () => [], arrivals: () => 0 }); if (last?.events.some((e) => e.kind === 'clear')) break; }
    expect(last?.events.map((e) => e.kind)).toEqual(['clear']);
    expect(await last!.sent).toBe(4);
    expect(sent.filter((x) => x.p.tag === 'ops-clear').map((x) => x.p.title).sort()).toEqual(['Load has calmed down', 'Opterećenje je splasnulo', 'Нагрузка спала', 'Нагрузка спала'].sort());
  });

  it('журнал не растёт больше 30 записей', async () => {
    fresh();
    const ev = (i: number): LoadEvent => ({ kind: 'eta', at: T0 + i, push: false, running: 1, queued: 1, eta: 60, turns: 0, waiting: [], people: 0 });
    S.recordAlerts(Array.from({ length: 45 }, (_, i) => ev(i)));
    expect(S.alertLog().length).toBe(30);
    expect(S.alertLog().at(-1)?.at).toBe(T0 + 44);
    expect(S.alertLog()[0].at).toBe(T0 + 15);
  });

  it('тестовый приёмник KX_PUSH_SINK: оповещение дописывается в файл стенда, к службе push не идёт', async () => {
    fresh();
    process.env.KX_PUSH_SINK = '1';
    const e: LoadEvent = { kind: 'eta', at: T0, push: true, running: 5, queued: 4, eta: 100, turns: 0, waiting: [], people: 0 };
    expect(await A.deliver(e, T0 + 20_000_000)).toBe(4);
    delete process.env.KX_PUSH_SINK;
    const lines = fs.readFileSync(path.join(dir, 'push-sink.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.length).toBe(4);
    expect(lines.find((l) => l.userId === 'a2').payload).toMatchObject({ title: 'Wait times are growing', tag: 'ops-eta', url: '/admin#state' });
    expect(lines[0]).not.toHaveProperty('payload.endpoint');
  });

  it('ошибка отправки или в замере не выходит наружу', async () => {
    fresh();
    const boom = async () => { throw new Error('служба push упала'); };
    const r = A.loadAlertsTick(Q({ queued: 11 }), T0 + 30_000_000, { send: boom as never, waiting: waiting(25), arrivals: () => 0 });
    expect(r).not.toBeNull();
    expect(await r!.sent).toBe(0);
    expect(A.loadAlertsTick([{ key: 'alpha', active: NaN, queued: 0, etaNext: 0 }], T0, { waiting: () => { throw new Error('сбой'); } })).toBeNull();
  });

  it('GET /api/admin/load-alerts: журнал новыми первыми на языке администратора, кто ждёт; POST переключает; не администратор — 403', async () => {
    fresh(); S.setLoadAlerts(true);
    await tick(Q({ queued: 4 }), T0 + 40_000_000, 33).sent;
    const req = (method: 'GET' | 'POST', key: string | null, body?: unknown) =>
      new Request('http://x/api/admin/load-alerts', { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const g = await route.GET(req('GET', adminKey));
    expect(g.status).toBe(200);
    const j = await g.json() as { on: boolean; log: { kind: string; title: string; line: string; who: string[]; push: boolean }[]; waiting: unknown[] };
    expect(j.on).toBe(true);
    expect(j.log[0]).toMatchObject({ kind: 'queue', title: 'A queue has formed', push: true, who: ['Анна'] });
    expect(j.log[0].line).toContain('Longest wait for a slot: 33 s.');
    const off = await route.POST(req('POST', adminKey, { on: false }));
    expect(off.status).toBe(200);
    expect((await off.json()).on).toBe(false);
    expect(S.loadAlertsOn()).toBe(false);
    expect((await route.POST(req('POST', adminKey, { on: 'нет' }))).status).toBe(400);
    expect((await route.POST(req('POST', userKey, { on: true }))).status).toBe(403);
    expect((await route.GET(req('GET', userKey))).status).toBe(403);
    expect(S.loadAlertsOn()).toBe(false);
    expect((await (await route.POST(req('POST', adminKey, { on: true }))).json()).on).toBe(true);
    expect(S.adminSnapshot().loadAlerts).toBe(true);
  });
});
