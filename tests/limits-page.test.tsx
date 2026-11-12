import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { tmpData } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/settings/limits', redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
tmpData();
let W: typeof import('@/lib/week');
let db: ReturnType<typeof import('@/lib/db').getDb>, schema: typeof import('@/lib/db').schema;
beforeAll(async () => { const d = await import('@/lib/db'); db = d.getDb(); schema = d.schema; W = await import('@/lib/week'); });

let n = 0, jn = 0;
const user = (o: Partial<typeof schema.users.$inferInsert> = {}) => {
  const id = `lu${++n}`;
  db.insert(schema.users).values({ id, email: `${id}@t`, name: id, passwordHash: 'x', createdAt: 1, timezone: 'Europe/Moscow', ...o }).run();
  return db.select().from(schema.users).all().find((u) => u.id === id)!;
};
const job = (userId: string, at: number, cardS: number) =>
  db.insert(schema.jobs).values({ id: `lj${++jn}`, userId, kind: 'chat', modelId: 'm', levelId: 'high', status: 'done', createdAt: at, cardS }).run();
const NOW = Date.UTC(2026, 10, 11, 12);
const support = { tg: 'https://t.me/korvex_support_test', handle: '@korvex_support_test', email: 's@x' };
const render = async (d: Omit<import('@/components/LimitsSettings').LimitsData, 'support'>) => {
  const { LimitsSettings } = await import('@/components/LimitsSettings');
  const { ShellCtx } = await import('@/components/Shell');
  return renderToStaticMarkup(createElement(ShellCtx.Provider, { value: { models: [], refresh: async () => {}, openDrawer() {}, threads: [], role: 'user' } as never }, createElement(LimitsSettings, { d: { ...d, support } })));
};

describe('weekView', () => {
  it('с лимитом: проценты и понедельник 00:00 по поясу человека', () => {
    const u = user();
    job(u.id, NOW - 3_600_000, 54_000 * 0.4);
    const v = W.weekView(u, NOW);
    expect(v).toMatchObject({ limited: true, pct: 40, phase: 'ok', tz: 'Europe/Moscow' });
    expect(v.resetAt).toBe(Date.UTC(2026, 10, 15, 21));
  });
  it('администратор и «без лимита»: limited=false, доля обычного лимита для сведения', () => {
    const a = user({ role: 'admin' });
    job(a.id, NOW - 3_600_000, 54_000 * 0.25);
    expect(W.weekView(a, NOW)).toMatchObject({ limited: false, pct: 25, phase: 'ok' });
    const z = user({ weekMult: 0 });
    expect(W.weekView(z, NOW)).toMatchObject({ limited: false, pct: 0 });
  });
});

describe('страница «Лимиты»', () => {
  it('обычная неделя: проценты, полоска, дата обновления, поддержка; часов и токенов нет', async () => {
    const h = await render({ limited: true, pct: 40, phase: 'ok', resetAt: Date.UTC(2026, 10, 15, 21), tz: 'Europe/Moscow' });
    expect(h).toContain('Использовано 40%');
    expect(h).toContain('aria-valuenow="40"');
    expect(h).toContain('Обновится в понедельник, 16 ноября, в 00:00');
    expect(h).toContain('data-testid="lim-tg"');
    expect(h).toContain('href="https://t.me/korvex_support_test"');
    expect(h).toContain('mailto:s@x');
    expect(h).not.toContain('data-testid="lim-note"');
    expect(h).not.toMatch(/час|токен/i);
  });
  it('80 % / сверх лимита / стоп: мягкие тексты, проценты не больше 100', async () => {
    expect(await render({ limited: true, pct: 85, phase: 'warn', resetAt: NOW, tz: 'Europe/Moscow' })).toContain('Вы использовали 80% недельного лимита');
    const over = await render({ limited: true, pct: 130, phase: 'over', resetAt: NOW, tz: 'Europe/Moscow' });
    expect(over).toContain('Использовано 100%');
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('после других');
    expect(over).not.toContain('Не хватает для работы');
    expect(await render({ limited: true, pct: 200, phase: 'blocked', resetAt: NOW, tz: 'Europe/Moscow' })).toContain('новые сообщения — с понедельника');
  });
  it('без лимита: «Без лимита», доля обычного лимита, без блока поддержки', async () => {
    const h = await render({ limited: false, pct: 7, phase: 'ok', resetAt: NOW, tz: 'Europe/Moscow' });
    expect(h).toContain('Без лимита');
    expect(h).toContain('На этой неделе: 7% обычного лимита');
    expect(h).not.toContain('data-testid="lim-support"');
  });
  it('строка в «Настройках» ведёт на страницу и показывает проценты', async () => {
    const { LimitsRowLink } = await import('@/components/LimitsSettings');
    const h = renderToStaticMarkup(createElement(LimitsRowLink, { limited: true, pct: 12 }));
    expect(h).toContain('href="/settings/limits"');
    expect(h).toContain('12%');
    expect(renderToStaticMarkup(createElement(LimitsRowLink, { limited: false, pct: 3 }))).toContain('Без лимита');
  });
  it('пункт «Лимиты» в меню профиля подсвечен на своей странице', async () => {
    const { AccountMenu } = await import('@/components/Shell');
    const h = renderToStaticMarkup(createElement(AccountMenu, { name: 'Е', admin: false, initials: 'Е', onLogout: async () => {}, initialOpen: true }));
    expect(h).toMatch(/aria-current="page"[^>]*data-testid="limits-link"/);
    expect(h).toContain('Лимиты');
  });
});
