import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { tmpData } from './helpers';
process.env.KX_SUPPORT_TG = 'https://t.me/korvex_support_test'; process.env.KX_SUPPORT_EMAIL = 'support@example.com';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
tmpData();
let S: typeof import('@/lib/seat'), M: typeof import('@/lib/moderation');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
let n = 0, jn = 0;
const HOUR = 3_600_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 10);
beforeAll(async () => { const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema; S = await import('@/lib/seat'); M = await import('@/lib/moderation'); });
afterEach(() => { for (const k of ['KX_SEAT', 'KX_SEAT_ROLES', 'KX_SHARE_SWITCHES', 'KX_SHARE_CONCURRENT']) delete process.env[k]; });

const user = (o: Partial<typeof schema.users.$inferInsert> = {}) => {
  const id = `s${++n}`;
  db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', createdAt: 1, ...o }).run();
  return get(id);
};
const get = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
const sig = (u: { id: string; role: string; timezone: string; seatResetAt: number | null }, session: string, at: number, jobs: string[] = []) =>
  S.recordSignal(u as never, { session, net: 'n', ua: 'Chrome/Linux', jobs }, at);
const event = (userId: string, at: number, day: string) => db.insert(schema.seatEvents).values({ id: `e${++jn}`, userId, day, kind: 'switch', at }).run();
const audit = () => db.select().from(schema.adminAudit).all();

describe('признаки запроса', () => {
  it('сеть: IPv4 /24 и IPv6 /48, 16 hex, адрес не восстановить', () => {
    const a = S.netOf('203.0.113.5');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(S.netOf('203.0.113.250')).toBe(a);
    expect(S.netOf('203.0.114.5')).not.toBe(a);
    expect(S.netOf('2001:db8:1:1::1')).toBe(S.netOf('2001:db8:1:ffff:aaaa::2'));
    expect(S.netOf('2001:db8:2::1')).not.toBe(S.netOf('2001:db8:1::1'));
    expect(S.netOf('::ffff:203.0.113.9')).toBe(a);
    expect(a).not.toContain('203');
  });
  it('браузер/ОС — грубо, ≤ 40 символов', () => {
    expect(S.uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('Chrome/Windows');
    expect(S.uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Safari/604.1')).toBe('Safari/iOS');
    expect(S.uaFamily(null)).toBe('?/?');
  });
});

describe('события', () => {
  it('смены сессий: 6 пар подряд при ≥ 2 сессиях — событие; 5 — нет; не чаще раза в час', () => {
    const u = user();
    let r;
    for (let i = 0; i < 6; i++) r = sig(u, i % 2 ? 'A' : 'B', T0 + i * 60_000);
    expect(r!.event).toBeNull();
    r = sig(u, 'B', T0 + 6 * 60_000);
    expect(r.event).toBe('switch');
    expect(sig(u, 'A', T0 + 7 * 60_000).event).toBeNull();
    expect(db.select().from(schema.seatEvents).where(eq(schema.seatEvents.userId, u.id)).all()).toHaveLength(1);
    expect(db.select().from(schema.seatEvents).all().find((e) => e.userId === u.id)!.detail).toMatch(/^\{"alt":\d+,"sessions":2,"overlaps":0\}$/);
  });
  it('одна сессия сколько угодно — событий нет; окно 60 минут', () => {
    const u = user();
    for (let i = 0; i < 20; i++) expect(sig(u, 'A', T0 + i * 1000).event).toBeNull();
    const v = user();
    for (let i = 0; i < 7; i++) sig(v, i % 2 ? 'A' : 'B', T0 + i * 20 * 60_000);
    expect(db.select().from(schema.seatEvents).where(eq(schema.seatEvents.userId, v.id)).all()).toHaveLength(0);
  });
  it('наложение: 3 хода из другой сессии поверх идущего хода — событие', () => {
    const u = user();
    let r;
    for (let i = 0; i < 3; i++) {
      const a = `ja${n}${i}`, b = `jb${n}${i}`;
      for (const [id, st] of [[a, 'running'], [b, 'queued']] as const) db.insert(schema.jobs).values({ id, userId: u.id, kind: 'chat', modelId: 'm', levelId: 'low', status: st, createdAt: T0 }).run();
      sig(u, 'A', T0 + i * 1000, [a]);
      r = sig(u, 'B', T0 + i * 1000 + 500, [b]);
      db.update(schema.jobs).set({ status: 'done' }).where(eq(schema.jobs.userId, u.id)).run();
    }
    expect(r!.event).toBe('concurrent');
  });
  it('ход из другой сессии после завершения прежнего — не наложение', () => {
    const u = user();
    db.insert(schema.jobs).values({ id: `jx${n}`, userId: u.id, kind: 'chat', modelId: 'm', levelId: 'low', status: 'done', createdAt: T0 }).run();
    sig(u, 'A', T0, [`jx${n}`]);
    sig(u, 'B', T0 + 1000, []);
    expect(db.select().from(schema.seatSignals).where(eq(schema.seatSignals.userId, u.id)).all().every((s) => s.ov === 0)).toBe(true);
  });
  it('сигналы старше 30 дней стираются; адрес и содержимое не хранятся', () => {
    const u = user();
    sig(u, 'A', T0 - 40 * DAY);
    sig(u, 'A', T0);
    expect(S.pruneSignals(T0, true)).toBe(1);
    const row = db.select().from(schema.seatSignals).where(eq(schema.seatSignals.userId, u.id)).get()!;
    expect(Object.keys(row).sort()).toEqual(['at', 'id', 'jobs', 'net', 'ov', 'session', 'ua', 'userId']);
  });
  it('администратор и роли вне KX_SEAT_ROLES не проверяются; KX_SEAT=0 — всё выключено; пороги из env', () => {
    const adm = user({ role: 'admin' });
    process.env.KX_SHARE_SWITCHES = '1';
    expect(sig(adm, 'A', T0).event).toBeNull(); expect(sig(adm, 'B', T0 + 1).event).toBeNull();
    const u = user();
    sig(u, 'A', T0); expect(sig(u, 'B', T0 + 1).event).toBe('switch');
    process.env.KX_SEAT_ROLES = 'alpha';
    const v = user();
    sig(v, 'A', T0); expect(sig(v, 'B', T0 + 1).event).toBeNull();
    process.env.KX_SEAT = '0'; process.env.KX_SEAT_ROLES = 'user,alpha';
    const w = user();
    sig(w, 'A', T0); expect(sig(w, 'B', T0 + 1).event).toBeNull();
    expect(db.select().from(schema.seatSignals).where(eq(schema.seatSignals.userId, w.id)).all()).toHaveLength(0);
  });
});

describe('предупреждения', () => {
  it('нужны события в двух РАЗНЫХ днях за 7 дней; день — в поясе человека', () => {
    const u = user();
    event(u.id, T0, '2026-11-01'); event(u.id, T0 + HOUR, '2026-11-01');
    expect(S.considerStrike(u.id, T0 + 2 * HOUR)).toBeNull();
    event(u.id, T0 + DAY, '2026-11-02');
    expect(S.considerStrike(u.id, T0 + DAY + HOUR)).toBe(1);
  });
  it('1-е — только уведомление («Понятно»), доступ не тронут; запись в журнале от «Системы»', () => {
    const u = user();
    event(u.id, T0, 'a'); event(u.id, T0 + DAY, 'b');
    expect(S.considerStrike(u.id, T0 + DAY)).toBe(1);
    expect(get(u.id).disabled).toBe(0);
    const notes = S.pendingNotices(u.id);
    expect(notes).toHaveLength(1); expect(notes[0].kind).toBe('seat_warn');
    expect(S.dismissNotice(u.id, notes[0].id)).toBe(true);
    expect(S.pendingNotices(u.id)).toHaveLength(0);
    const a = audit().find((x) => x.targetId === u.id)!;
    expect(a).toMatchObject({ action: 'seat_warn', adminId: 'system:seat', adminName: 'Система' });
  });
  it('2-е — пауза на 24 часа (blocked_by system:seat24), сессии отрезаны; снимается сама, но только автоматическая', () => {
    const u = user();
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 8 * DAY }).run();
    db.insert(schema.sessions).values({ id: `ss${jn}`, userId: u.id, createdAt: 1, expiresAt: T0 + DAY }).run();
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    expect(S.considerStrike(u.id, T0)).toBe(2);
    expect(get(u.id)).toMatchObject({ disabled: 1, blockKind: 'pause', blockReason: 'auto:seat-sharing', blockedBy: 'system:seat24' });
    expect(db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id)).all()).toHaveLength(0);
    expect(S.seatAutoUnblock(u.id, T0 + DAY - 1000)).toBe(false);
    expect(S.seatSweep(T0 + DAY + 1000)).toBeGreaterThanOrEqual(1);
    expect(get(u.id).disabled).toBe(0);
    expect(audit().some((x) => x.targetId === u.id && x.action === 'unblock' && x.adminId === 'system:seat24')).toBe(true);
  });
  it('администратор изменил блокировку — сама пауза не снимается', () => {
    const adm = user({ role: 'admin' });
    const u = user();
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 8 * DAY }).run();
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    S.considerStrike(u.id, T0);
    M.blockUser(adm.id, u.id, { kind: 'pause', reason: 'вручную' }, T0 + HOUR);
    expect(get(u.id).blockedBy).toBe(adm.id);
    expect(S.seatAutoUnblock(u.id, T0 + 3 * DAY)).toBe(false);
    expect(get(u.id).disabled).toBe(1);
    const v = user();
    db.update(schema.users).set({ disabled: 1, blockKind: 'ban', blockReason: 'auto:seat-sharing', blockedBy: adm.id, blockedAt: T0 }).where(eq(schema.users.id, v.id)).run();
    expect(S.seatAutoUnblock(v.id, T0 + 3 * DAY)).toBe(false);
  });
  it('3-е и далее — пауза до администратора: сама не снимается', () => {
    const u = user();
    db.insert(schema.seatStrikes).values([{ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 20 * DAY }, { id: `k${++jn}`, userId: u.id, kind: 'pause24', at: T0 - 10 * DAY }]).run();
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    expect(S.considerStrike(u.id, T0)).toBe(3);
    expect(get(u.id)).toMatchObject({ disabled: 1, blockedBy: 'system:seat' });
    expect(S.seatAutoUnblock(u.id, T0 + 30 * DAY)).toBe(false);
    expect(M.unblockUser('admin-x', u.id, T0 + 31 * DAY)).toMatchObject({ ok: true, changed: true });
  });
  it('интервал: ближе 7 дней от прошлого предупреждения — нет; прощение через 90 дней', () => {
    const u = user();
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 5 * DAY }).run();
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    expect(S.considerStrike(u.id, T0)).toBeNull();
    const v = user();
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: v.id, kind: 'pause24', at: T0 - 100 * DAY }).run();
    event(v.id, T0 - 1000, 'a'); event(v.id, T0 - DAY, 'b');
    expect(S.considerStrike(v.id, T0)).toBe(1);
    expect(S.seatStats(get(v.id), T0)).toMatchObject({ warns: 1, pauses: 0 });
  });
  it('уже заблокированного (бан) не переписываем паузой; администратор не получает предупреждений', () => {
    const u = user({ disabled: 1, blockKind: 'ban', blockReason: 'спам' });
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 9 * DAY }).run();
    expect(S.considerStrike(u.id, T0)).toBe(2);
    expect(get(u.id)).toMatchObject({ blockKind: 'ban', blockReason: 'спам' });
    const adm = user({ role: 'admin' });
    event(adm.id, T0 - 1000, 'a'); event(adm.id, T0 - DAY, 'b');
    expect(S.considerStrike(adm.id, T0)).toBeNull();
  });
  it('«Снять предупреждения»: счёт с нуля, запись в журнале', () => {
    const adm = user({ role: 'admin' });
    const u = user();
    db.insert(schema.seatStrikes).values({ id: `k${++jn}`, userId: u.id, kind: 'warn', at: T0 - 9 * DAY }).run();
    event(u.id, T0 - 1000, 'a'); event(u.id, T0 - DAY, 'b');
    expect(S.seatStats(u, T0)).toMatchObject({ events7: 2, warns: 1, pauses: 0 });
    expect(S.clearSeat(adm.id, u.id, T0)).toBe(true);
    expect(S.seatStats(get(u.id), T0 + 1)).toEqual({ events7: 0, warns: 0, pauses: 0 });
    expect(S.considerStrike(u.id, T0 + 1)).toBeNull();
    expect(audit().some((x) => x.action === 'seat_clear' && x.adminId === adm.id)).toBe(true);
  });
});

describe('вход и уведомление', () => {
  it('текст паузы: суточная — с временем возврата в поясе человека, остальные — без; обе с поддержкой; чужая блокировка — null', () => {
    const base = { disabled: 1, blockReason: 'auto:seat-sharing', blockedAt: Date.UTC(2026, 10, 1, 10), timezone: 'Asia/Tokyo' };
    const t24 = S.seatPauseText({ ...base, blockedBy: 'system:seat24' }, 'ru')!;
    expect(t24).toContain('Он вернётся сам 2 ноября в 19:00.');
    expect(t24).toContain('Поддержка: Telegram @korvex_support_test, почта support@example.com');
    const t = S.seatPauseText({ ...base, blockedBy: 'system:seat' }, 'en')!;
    expect(t).toContain('Access is paused for now'); expect(t).not.toContain('come back on its own');
    expect(t).toContain('Support: Telegram @korvex_support_test, email support@example.com');
    expect(S.seatPauseText({ ...base, blockReason: 'спам', blockedBy: 'x' }, 'ru')).toBeNull();
    expect(S.seatPauseText({ ...base, disabled: 0, blockedBy: 'system:seat24' }, 'ru')).toBeNull();
  });
  it('KX_SUPPORT_TG / KX_SUPPORT_EMAIL переопределяют контакты', async () => {
    const sup = await import('@/lib/support');
    process.env.KX_SUPPORT_TG = 'https://t.me/other/'; process.env.KX_SUPPORT_EMAIL = 'a@b.c';
    expect(sup.supportLine('ru')).toBe('Поддержка: Telegram @other, почта a@b.c');
    process.env.KX_SUPPORT_TG = 'https://t.me/korvex_support_test'; process.env.KX_SUPPORT_EMAIL = 'support@example.com';
  });
  it('уведомление одно на ключ (неделя, предупреждение)', () => {
    const u = user();
    expect(S.addNotice(u.id, 'week80', '2026-11-09')).toBe(true);
    expect(S.addNotice(u.id, 'week80', '2026-11-09')).toBe(false);
    expect(S.addNotice(u.id, 'week80', '2026-11-16')).toBe(true);
  });
});
