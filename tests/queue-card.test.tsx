// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { QueueCard } from '@/components/QueueCard';
import { AssistantMsg } from '@/components/Message';
import { Announce, StatusCtx } from '@/components/Announce';
import { AdminNotices, type NoticesSnap } from '@/components/AdminNotices';
import type { BusySnap, StatusView } from '@/lib/announce';
import type { PublicModel } from '@/lib/models';
import type { MsgView } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/admin' }));

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', blurb: 'умная', defaultLevel: 'low', levels: [{ id: 'low', label: 'low', hint: 'Быстро' }] }] as unknown as PublicModel[];
const q = (o: Partial<MsgView>): MsgView => ({ id: 'a1', role: 'assistant', content: '', reasoning: '', streaming: true, phase: 'queued', ahead: 2, eta: 40, meta: { modelId: 'alpha', levelId: 'low' }, ...o });

describe('карточка очереди', () => {
  it('«Вы в очереди — 3-й», ниже «Перед вами 2 · ~40 с» и подсказка про закрытую вкладку', () => {
    render(createElement(QueueCard, { ahead: 2, eta: 40 }));
    const card = screen.getByTestId('queued');
    expect(card.getAttribute('data-position')).toBe('3');
    expect(screen.getByTestId('queued-title').textContent).toBe('Вы в очереди — 3-й');
    expect(screen.getByTestId('queued-sub').textContent).toBe('Перед вами 2 · ~40 с');
    expect(card.textContent).toContain('Ответ начнётся сам — можно закрыть вкладку, он сохранится в чате.');
    expect(card.getAttribute('role')).toBe('status');
  });
  it('формат ожидания: до минуты секунды, 1–2 минуты, дольше двух', () => {
    const sub = (eta: number) => { const { unmount } = render(createElement(QueueCard, { ahead: 4, eta })); const t = screen.getByTestId('queued-sub').textContent; unmount(); return t; };
    expect(sub(35)).toBe('Перед вами 4 · ~35 с');
    expect(sub(90)).toBe('Перед вами 4 · ~1–2 мин');
    expect(sub(121)).toBe('Перед вами 4 · больше 2 мин');
    expect(sub(0)).toBe('Перед вами 4');
  });
  it('ahead = 0: «Вы следующий»', () => {
    render(createElement(QueueCard, { ahead: 0, eta: 30 }));
    expect(screen.getByTestId('queued-title').textContent).toBe('Вы следующий');
    expect(screen.getByTestId('queued-sub').textContent).toBe('Ждём свободное место · ~30 с');
    expect(screen.getByTestId('queued').className).toContain('is-next');
  });
  it('полоска продвижения растёт, когда место приближается; назад не убывает при сдвиге очереди «вперёд»', () => {
    const { rerender } = render(createElement(QueueCard, { ahead: 4, eta: 120 }));
    const val = () => Number(screen.getByTestId('queued-bar').getAttribute('aria-valuenow'));
    const v5 = val();
    rerender(createElement(QueueCard, { ahead: 2, eta: 60 }));
    const v3 = val();
    rerender(createElement(QueueCard, { ahead: 0, eta: 30 }));
    const v1 = val();
    expect(v5).toBeGreaterThan(0);
    expect(v3).toBeGreaterThan(v5);
    expect(v1).toBe(100);
    expect(screen.getByTestId('queued-bar').getAttribute('aria-valuetext')).toBe('Место 1');
    expect((screen.getByTestId('queued-bar').firstElementChild as HTMLElement).style.width).toBe('100%');
  });
  it('место стало дальше (человек встал перед вами): полоска пересчитывается от самого дальнего места', () => {
    const { rerender } = render(createElement(QueueCard, { ahead: 1, eta: 60 }));
    rerender(createElement(QueueCard, { ahead: 3, eta: 120 }));
    expect(screen.getByTestId('queued-title').textContent).toBe('Вы в очереди — 4-й');
    expect(Number(screen.getByTestId('queued-bar').getAttribute('aria-valuenow'))).toBe(25);
  });
  it('в ответе чата карточка стоит на месте серой строки; в просмотре администратором чужого чата мест нет', () => {
    const own = renderToStaticMarkup(createElement(AssistantMsg, { m: q({}), models }));
    expect(own).toContain('data-testid="queued"');
    expect(own).toContain('Вы в очереди — 3-й');
    expect(own).not.toContain('Думаю');
    const other = renderToStaticMarkup(createElement(AssistantMsg, { m: q({}), models, readOnly: true }));
    expect(other).toContain('data-testid="queued"');
    expect(other).not.toContain('Перед вами');
    expect(other).not.toContain('Вы в очереди');
    expect(other).not.toContain('qcard');
    expect(renderToStaticMarkup(createElement(AssistantMsg, { m: q({ phase: 'wait' }), models }))).not.toContain('qcard');
  });
  it('стили: только токены, анимация уважает prefers-reduced-motion, на телефоне без бокового скролла', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/queue-card.css'), 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toMatch(/max-width: 760px/);
    expect(css).toContain('min-width: 0');
    expect(css).toContain('box-sizing: border-box');
  });
});

describe('баннер высокой нагрузки у всех', () => {
  const st = (banners: StatusView['banners']): StatusView => ({ now: 1, banners, models: { alpha: { state: 'ok', until: null } } });
  it('третья полоса с id busy, уровень info, кнопка «Скрыть»', () => {
    const text = 'Сейчас высокая нагрузка — ответы могут задерживаться (~2 мин). Сообщения обрабатываются по очереди, место в очереди видно в чате.';
    const h = renderToStaticMarkup(createElement(StatusCtx.Provider, { value: st([{ id: 'manual', sig: 'm1', level: 'info', text: 'Работы' }, { id: 'load', sig: 'l1', level: 'info', text: 'Идёт дообучение' }, { id: 'busy', sig: 'b1', level: 'info', text }]) }, createElement(Announce)));
    expect(h).toContain('data-testid="ann-busy"');
    expect(h).toContain('ann--info');
    expect(h).toContain(text);
    expect(h.match(/aria-label="Скрыть объявление"/g)).toHaveLength(3);
    expect(h).toContain('data-testid="ann-hide-busy"');
  });
});

describe('администратор: «Высокая нагрузка — Авто / Выкл / Вкл» и живые числа', () => {
  const busy = (o: Partial<BusySnap> = {}): BusySnap => ({
    mode: 'auto', on: false, auto: false, eta: 0, since: null, checkedAt: null, now: 1,
    queues: [{ key: 'alpha', name: 'Alpha', active: 5, queued: 3, limit: 5, avg: 34.2, etaNext: 68 }], ...o,
  });
  const snap = (b?: BusySnap): NoticesSnap => ({ now: 1, banner: { enabled: false, text: '', level: 'info', until: null, rev: 0, at: 0 }, load: {}, models: [], busy: b });
  const fetchMock = (reply: () => BusySnap) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, ...reply() }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }));
    return calls;
  };

  it('числа: в работе из лимита, в очереди, среднее время хода, ожидание; режим сейчас', async () => {
    fetchMock(() => busy());
    render(createElement(AdminNotices, { snap: snap(busy({ on: true, mode: 'auto', auto: true })) }));
    expect(screen.getByTestId('busy-active-alpha').textContent).toBe('5 из 5');
    expect(screen.getByTestId('busy-queued-alpha').textContent).toBe('3');
    expect(screen.getByTestId('busy-avg-alpha').textContent).toBe('34 с');
    expect(screen.getByTestId('busy-eta-alpha').textContent).toBe('~68 с');
    expect(screen.getByTestId('busy-now').textContent).toBe('включён');
    expect(screen.getByTestId('busy-auto').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('busy-off').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('busy-form').textContent).toContain('Высокая нагрузка');
  });

  it('нажатие «Вкл» / «Выкл» шлёт POST /api/admin/busy и показывает ответ сервера', async () => {
    let cur = busy();
    const calls = fetchMock(() => cur);
    render(createElement(AdminNotices, { snap: snap(cur) }));
    cur = busy({ mode: 'on', on: true });
    fireEvent.click(screen.getByTestId('busy-on'));
    await waitFor(() => expect(screen.getByTestId('busy-on').getAttribute('aria-checked')).toBe('true'));
    const posts = calls.filter((c) => c.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/admin/busy');
    expect(JSON.parse(String(posts[0].init!.body))).toEqual({ mode: 'on' });
    expect(screen.getByTestId('busy-now').textContent).toBe('включён');
    cur = busy({ mode: 'off', on: false, auto: true });
    fireEvent.click(screen.getByTestId('busy-off'));
    await waitFor(() => expect(screen.getByTestId('busy-off').getAttribute('aria-checked')).toBe('true'));
    expect(JSON.parse(String(calls.filter((c) => c.init?.method === 'POST')[1].init!.body))).toEqual({ mode: 'off' });
    expect(screen.getByTestId('busy-now').textContent).toBe('выключен');
  });

  it('числа обновляются сами раз в 5 секунд', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let cur = busy();
      const calls = fetchMock(() => cur);
      render(createElement(AdminNotices, { snap: snap(cur) }));
      expect(screen.getByTestId('busy-queued-alpha').textContent).toBe('3');
      cur = busy({ queues: [{ key: 'alpha', name: 'Alpha', active: 4, queued: 0, limit: 5, avg: 31, etaNext: 0 }] });
      await act(async () => { vi.advanceTimersByTime(5_000); });
      await waitFor(() => expect(screen.getByTestId('busy-queued-alpha').textContent).toBe('0'));
      expect(screen.getByTestId('busy-eta-alpha').textContent).toBe('сразу');
      expect(calls.filter((c) => c.url === '/api/admin/busy' && c.init?.method !== 'POST').length).toBeGreaterThanOrEqual(2);
    } finally { vi.useRealTimers(); }
  });

  it('снимка нет (старый сервер): раздел всё равно рисуется — режим «Авто», без чисел', () => {
    fetchMock(() => busy({ queues: [] }));
    render(createElement(AdminNotices, { snap: snap(undefined) }));
    expect(screen.getByTestId('busy-auto').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('busy-now').textContent).toBe('выключен');
  });
});
