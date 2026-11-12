// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminNotices, type NoticesSnap } from '@/components/AdminNotices';
import type { AlertsSnap } from '@/lib/loadAlerts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/admin' }));

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const now = Date.UTC(2027, 0, 15, 12, 0, 0);
const alerts = (o: Partial<AlertsSnap> = {}): AlertsSnap => ({
  now, on: true, waiting: [{ name: 'Анна', sec: 22, n: 2 }, { name: 'Борис', sec: 17, n: 1 }],
  log: [
    { at: now - 60_000, kind: 'busyOn', push: true, title: 'Включился режим высокой нагрузки', body: 'Пользователи видят баннер. Ожидание ~2 мин, в работе 5, в очереди 4.', line: '', running: 5, queued: 4, eta: 90, who: ['Анна'] },
    { at: now - 90_000, kind: 'queue', push: false, title: 'Появилась очередь', body: 'Самое долгое ожидание места — 22 с. В работе 5, в очереди 3. Ждут: Анна, Борис.', line: '', running: 5, queued: 3, eta: 70, who: ['Анна', 'Борис'] },
  ], ...o,
});
const snap = (a?: AlertsSnap): NoticesSnap => ({ now, banner: { enabled: false, text: '', level: 'info', until: null, rev: 0, at: 0 }, load: {}, models: [], alerts: a });
function fetchMock(cur: () => AlertsSnap) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url === '/api/admin/load-alerts' ? { ok: true, ...cur() } : { mode: 'auto', on: false, auto: false, eta: 0, since: null, checkedAt: null, now, queues: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

describe('администратор: оповещения о нагрузке', () => {
  it('журнал: новые сверху, с текстом, временем и пометкой «без push»; «Ждут места сейчас» с именами и секундами', () => {
    fetchMock(() => alerts());
    render(createElement(AdminNotices, { snap: snap(alerts()) }));
    const rows = screen.getAllByTestId(/^alert-(busyOn|queue)$/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['alert-busyOn', 'alert-queue']);
    expect(rows[0].textContent).toContain('Включился режим высокой нагрузки');
    expect(rows[1].textContent).toContain('Ждут: Анна, Борис.');
    expect(rows[1].textContent).toContain('без push');
    expect(rows[0].textContent).not.toContain('без push');
    expect(screen.getByTestId('alerts-waiting').textContent).toBe('Анна ×2 22 с, Борис 17 с');
    expect(screen.getByTestId('alerts-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('пустой журнал и нет снимка (старый сервер): раздел рисуется', () => {
    fetchMock(() => alerts({ log: [], waiting: [] }));
    render(createElement(AdminNotices, { snap: snap(undefined) }));
    expect(screen.getByTestId('alerts-log').textContent).toContain('Событий пока не было');
    expect(screen.queryByTestId('alerts-waiting')).toBeNull();
    expect(screen.getByTestId('alerts-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('выключатель шлёт POST /api/admin/load-alerts {on} и показывает ответ сервера; ошибка возвращает прежнее', async () => {
    let cur = alerts();
    const calls = fetchMock(() => cur);
    render(createElement(AdminNotices, { snap: snap(cur) }));
    cur = alerts({ on: false });
    fireEvent.click(screen.getByTestId('alerts-toggle'));
    await waitFor(() => expect(screen.getByTestId('alerts-toggle').getAttribute('aria-checked')).toBe('false'));
    const posts = calls.filter((c) => c.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/admin/load-alerts');
    expect(JSON.parse(String(posts[0].init!.body))).toEqual({ on: false });
    expect(screen.getByTestId('alerts-form').textContent).toContain('выключены');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (init?.method === 'POST' ? new Response(JSON.stringify({ error: 'нет' }), { status: 400 }) : new Response(JSON.stringify(url === '/api/admin/load-alerts' ? alerts({ on: false }) : { mode: 'auto', on: false, auto: false, eta: 0, since: null, checkedAt: null, now, queues: [] }), { status: 200 }))));
    fireEvent.click(screen.getByTestId('alerts-toggle'));
    await waitFor(() => expect(screen.getByTestId('alerts-toggle').getAttribute('aria-checked')).toBe('false'));
  });
});
