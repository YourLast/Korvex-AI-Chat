import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { armJobTimeout, holdMaxMs, modelFetch, timeoutPlan, upstreamBytes, upstreamHold, upstreamNetMs, withUpstreamActivity, JOB_TIMEOUT_MS, MAX_IDLE_MS, MAX_CEILING_MS } from '@/lib/jobTimeout';
import { streamChat } from '@/lib/upstream';

afterEach(() => { vi.useRealTimers(); });

describe('план ожидания по уровню', () => {
  it('через серв — любой уровень по тишине и потолку (тяжёлый ход 37–75 мин); Claude напрямую ниже max — 30 минут на ход', () => {
    for (const id of ['max', 'off', 'low', 'medium', 'high', 'xhigh', undefined, null]) expect(timeoutPlan(id)).toEqual({ kind: 'idle', idleMs: MAX_IDLE_MS, ceilingMs: MAX_CEILING_MS });
    expect(timeoutPlan('max', true)).toEqual({ kind: 'idle', idleMs: MAX_IDLE_MS, ceilingMs: MAX_CEILING_MS });
    for (const id of ['off', 'low', 'medium', 'high', 'xhigh', undefined, null]) expect(timeoutPlan(id, true)).toEqual({ kind: 'total', ms: JOB_TIMEOUT_MS });
    expect(JOB_TIMEOUT_MS).toBe(30 * 60_000);
    expect(MAX_IDLE_MS).toBe(15 * 60_000);
    expect(MAX_CEILING_MS).toBe(4 * 3_600_000);
  });
});

describe('armJobTimeout (фейковые часы)', () => {
  it('Claude напрямую ниже max: 30 минут на ход, байты не продлевают', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const g = armJobTimeout(timeoutPlan('xhigh', true), (m) => got.push(m));
    for (let i = 0; i < 179; i++) { vi.advanceTimersByTime(10_000); g.touch(); }
    expect(got).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(got).toEqual(['Превышено время ответа (30 минут)']);
  });

  it('ниже max: ожидание модели на обслуживании (hold) сдвигает срок хода на это время', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const g = armJobTimeout(timeoutPlan('xhigh', true), (m) => got.push(m));
    vi.advanceTimersByTime(25 * 60_000);
    g.hold(10 * 60_000);
    vi.advanceTimersByTime(14 * 60_000);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(60_000 + 1);
    expect(got).toEqual(['Превышено время ответа (30 минут)']);
    g.hold(60_000);
    vi.advanceTimersByTime(10 * 60_000);
    expect(got.length).toBe(1);
  });

  it('upstreamHold — в контексте задачи сдвигает срок, без hold — как байты, вне задачи — ничего', async () => {
    const seen: string[] = [];
    await withUpstreamActivity(() => seen.push('touch'), async () => { upstreamHold(5); }, (ms) => seen.push(`hold ${ms}`));
    await withUpstreamActivity(() => seen.push('touch2'), async () => { upstreamHold(5); });
    upstreamHold(5);
    expect(seen).toEqual(['hold 5', 'touch2']);
  });

  it('через серв: ход ждал в очереди сервера (hold) — потолок 4 ч сдвигается на это время, но суммарно не больше чем на 4 ч', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const g = armJobTimeout(timeoutPlan('xhigh'), (m) => got.push(m));
    for (let i = 0; i < 6 * 150; i++) { vi.advanceTimersByTime(10_000); g.touch(); g.hold(10_000); }
    for (let i = 0; i < 6 * 239; i++) { vi.advanceTimersByTime(10_000); g.touch(); }
    expect(got).toEqual([]);
    vi.advanceTimersByTime(70_000);
    expect(got).toEqual(['Превышено время ответа (4 ч)']);
    const got2: string[] = [];
    const g2 = armJobTimeout(timeoutPlan('max'), (m) => got2.push(m));
    for (let i = 0; i < 6 * 60 * 12 - 1; i++) { vi.advanceTimersByTime(10_000); g2.touch(); g2.hold(10_000); }
    expect(got2).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(got2).toEqual(['Превышено время ответа (4 ч)']);
    process.env.KX_HOLD_MAX_H = '1';
    expect(holdMaxMs(MAX_CEILING_MS)).toBe(MAX_CEILING_MS);
    process.env.KX_HOLD_MAX_H = '10';
    expect(holdMaxMs(MAX_CEILING_MS)).toBe(10 * 3_600_000);
    delete process.env.KX_HOLD_MAX_H;
  });

  it('max: ход 90 минут с keepalive каждые 10 с не рвётся; после 15 минут тишины — рвётся один раз', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const g = armJobTimeout(timeoutPlan('max'), (m) => got.push(m));
    for (let i = 0; i < 6 * 90; i++) { vi.advanceTimersByTime(10_000); g.touch(); }
    expect(got).toEqual([]);
    vi.advanceTimersByTime(MAX_IDLE_MS - 20_000);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(40_000);
    expect(got).toEqual(['Модель не отвечает 15 минут']);
    vi.advanceTimersByTime(MAX_CEILING_MS);
    expect(got.length).toBe(1);
  });

  it('max: аварийный потолок 4 ч даже при живом потоке; clear() снимает всё', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const g = armJobTimeout(timeoutPlan('max'), (m) => got.push(m));
    for (let i = 0; i < 6 * 60 * 4 - 1; i++) { vi.advanceTimersByTime(10_000); g.touch(); }
    expect(got).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(got).toEqual(['Превышено время ответа (4 ч)']);
    const got2: string[] = [];
    const g2 = armJobTimeout(timeoutPlan('max'), (m) => got2.push(m));
    g2.clear();
    vi.advanceTimersByTime(MAX_CEILING_MS * 2);
    expect(got2).toEqual([]);
  });
});

describe('сеть до шлюза для запросов к модели (modelFetch): без 5-минутных потолков Node', () => {
  it('по умолчанию 20 мин (больше тишины задачи); KX_UPSTREAM_NET_S действует: заголовки позже потолка — ошибка, раньше — ответ', async () => {
    expect(upstreamNetMs()).toBe(20 * 60_000);
    expect(upstreamNetMs()).toBeGreaterThan(MAX_IDLE_MS);
    const srv = http.createServer((req, res) => {
      const ms = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('ms'));
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ок'); }, ms);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
    process.env.KX_UPSTREAM_NET_S = '1';
    try {
      expect(await (await modelFetch(url + '?ms=200')).text()).toBe('ок');
      const err = await modelFetch(url + '?ms=1600').then(() => null, (e: unknown) => e as { cause?: { code?: string } });
      expect(err?.cause?.code).toBe('UND_ERR_HEADERS_TIMEOUT');
    } finally { delete process.env.KX_UPSTREAM_NET_S; srv.close(); }
  });
});

describe('байты от модели отмечаются у задачи', () => {
  it('upstreamBytes — только в контексте задачи', async () => {
    let n = 0;
    upstreamBytes();
    await withUpstreamActivity(() => { n++; }, async () => {
      upstreamBytes();
      await new Promise((r) => setTimeout(r, 5));
      upstreamBytes();
    });
    upstreamBytes();
    expect(n).toBe(2);
  });

  const serve = (keepalives: number) => new Promise<{ url: string; close: () => void }>((resolve) => {
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] }) + '\n\n');
        for (let i = 0; i < keepalives; i++) { await new Promise((r) => setTimeout(r, 15)); res.write(': thinking\n\n'); }
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'Итого 42.' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, close: () => srv.close() }));
  });
  const model = (baseUrl: string) => ({ id: 'up-alpha', baseUrl, upstreamModel: 'up-alpha-35b' }) as never;
  const level = { id: 'max', label: 'Max', effort: 'max' } as never;

  for (const path of ['agent', 'sdk'] as const) {
    it(`путь ${path}: каждый «: thinking» — признак жизни, ответ доходит`, async () => {
      const s = await serve(6);
      try {
        let touches = 0;
        let text = '';
        await withUpstreamActivity(() => { touches++; }, async () => {
          const ac = new AbortController();
          const opts = { model: model(s.url), level, chatId: 't1', messages: [{ role: 'user' as const, content: 'q' }], signal: ac.signal,
            ...(path === 'agent' ? { agent: { messages: [{ role: 'user', content: 'q' }] } } : {}) };
          for await (const ev of streamChat(opts)) if (ev.t === 'c') text += ev.d;
        });
        expect(text).toBe('Итого 42.');
        expect(touches).toBeGreaterThanOrEqual(6);
      } finally { s.close(); }
    });
  }
});
