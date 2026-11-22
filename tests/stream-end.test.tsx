// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { AssistantMsg } from '@/components/Message';
import { keepTop, useChatStream } from '@/components/useChatStream';
import { SETTLE_MS } from '@/lib/workView';
import { live, type LiveEv } from '@/lib/live';
import type { MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import { THINK_DEFAULT } from '@/lib/thinkPref';
THINK_DEFAULT.on = true;

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => createElement('a', { href: p.href }, p.children) }));

const models = [{ id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'xhigh', levels: [{ id: 'xhigh', label: 'xhigh' }] }] as unknown as PublicModel[];
const meta = { modelId: 'alpha', levelId: 'xhigh' };
const u = (id: string, content: string): MsgView => ({ id, role: 'user', content });
const a = (id: string, content: string, extra: Partial<MsgView> = {}): MsgView => ({ id, role: 'assistant', content, reasoning: 'Думаю.', reasoningMs: 3000, meta, ...extra });

const REASONING = 'Нужно найти свежие данные.\n\n[поиск: guardrails benchmark 2026]\n[найдено: 12 источников]\nСверю с документацией.\n\n[поиск: openai agents approval]\n[найдено: 8 источников]\nОтвечаю.\n';
const ANSWER = 'Первый абзац ответа: агенту нужны ограничения.\n\nВторой абзац — опасные действия требуют «approval» [[developers.openai.com]].\n\n- пункт один\n- пункт два';

const OLD = [u('u0', 'Самый старый вопрос'), a('a0', 'Старый ответ')];
const SHOWN = [u('u1', 'Вопрос 1'), a('a1', 'Ответ 1'), u('u2', 'Вопрос 2'), a('a2', 'Ответ 2')];
const LIVE = { ...a('a3', '', { reasoning: '', reasoningMs: null }), streaming: true, phase: 'wait' as const, startedAt: Date.now() - 5000, jobId: 'j3' };
const FINAL = a('a3', ANSWER, { reasoning: REASONING, reasoningMs: 88000, meta: { ...meta, durationMs: 88000, usage: { completion_tokens: 900 } } });

let snapshot: MsgView[] = [];
const fetches: string[] = [];
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
beforeEach(() => {
  fetches.length = 0;
  snapshot = [...OLD, ...SHOWN, u('u3', 'Вопрос 3'), FINAL];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetches.push(url);
    if (url.includes('/path')) return { ok: true, status: 200, json: async () => ({ messages: snapshot, hasMore: false }) } as Response;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Feed({ initial }: { initial: MsgView[] }) {
  const { msgs, hasMore } = useChatStream(initial, true, 't1');
  return createElement('div', { className: 'thread', 'data-more': String(hasMore) },
    msgs.map((m) => (m.role === 'user'
      ? createElement('div', { key: m.id, id: `m-${m.id}`, 'data-testid': 'user-msg' }, m.content)
      : createElement(AssistantMsg, { key: m.id, m, models, last: m.id === 'a3' }))));
}
const emit = (e: LiveEv) => act(() => { (live as unknown as { handlers: Set<(e: LiveEv) => void> }).handlers.forEach((h) => h(e)); });
const delta = (k: 'r' | 'c', o: number, d: string) => emit({ t: 'd', th: 't1', m: 'a3', k, o, d });
const ans = (c: HTMLElement) => c.querySelector('#m-a3') as HTMLElement;
const view = (c: HTMLElement) => (ans(c).querySelector('[data-testid=reasoning]') as HTMLElement | null)?.dataset.view;

async function stream(c: HTMLElement) {
  delta('r', 0, REASONING);
  await waitFor(() => expect(view(c)).toBe('window'));
  const almost = ANSWER.slice(0, ANSWER.length - 12);
  delta('c', 0, almost);
  await waitFor(() => expect(ans(c).querySelectorAll(':scope > .prose.md p').length).toBe(2), { timeout: 2000 });
}

describe('снимок ветки поверх показанного (keepTop)', () => {
  it('ход выше верхнего показанного не вставляется; выше — догрузка прокруткой (hasMore)', () => {
    const shown = [...SHOWN, u('u3', 'Вопрос 3'), LIVE];
    const r = keepTop(shown, [...OLD, ...SHOWN, u('u3', 'Вопрос 3'), FINAL], false);
    expect(r.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(r.hasMore).toBe(true);
  });
  it('ход с другого устройства (на экране его ещё нет) — приходит снизу, верх тот же', () => {
    const r = keepTop(SHOWN, [...OLD, ...SHOWN, u('u9', 'с телефона'), a('a9', 'ответ')], true);
    expect(r.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u9', 'a9']);
  });
  it('верхнего показанного в снимке нет (ветку переключили) или он и так первый — снимок как есть', () => {
    const other = [u('x1', 'другая ветка'), a('x2', '…')];
    expect(keepTop(SHOWN, other, false)).toEqual({ messages: other, hasMore: false });
    expect(keepTop(SHOWN, SHOWN, true)).toEqual({ messages: SHOWN, hasMore: true });
    expect(keepTop([], other, true)).toEqual({ messages: other, hasMore: true });
  });
});

describe('конец генерации: подмена потокового ответа сохранённым', () => {
  it('над лентой ничего не появляется, ответ и его абзацы — те же узлы DOM (опора прокрутки на месте), лента размышления не пересоздана и не раскрыта', async () => {
    const { container: c } = render(createElement(Feed, { initial: [...SHOWN, u('u3', 'Вопрос 3'), LIVE] }));
    await stream(c);
    const before = {
      first: c.querySelector('.thread > *')!, root: ans(c), wk: ans(c).querySelector('[data-testid=reasoning]'),
      p2: ans(c).querySelectorAll(':scope > .prose.md p')[1], above: [...c.querySelectorAll('.thread > *')].indexOf(ans(c)),
    };
    expect(before.p2.textContent).toContain('Второй абзац');
    expect(view(c)).toBe('window');

    emit({ t: 'job', th: 't1', m: 'a3', status: 'done' });
    await waitFor(() => expect(ans(c).querySelector('.ans-foot')).not.toBeNull());
    expect(fetches.some((x) => x.startsWith('/api/threads/t1/path'))).toBe(true);

    expect(c.querySelector('.thread > *')).toBe(before.first);
    expect(c.querySelector('#m-u0')).toBeNull();
    expect([...c.querySelectorAll('.thread > *')].indexOf(ans(c))).toBe(before.above);
    expect((c.querySelector('.thread') as HTMLElement).dataset.more).toBe('true');
    expect(ans(c)).toBe(before.root);
    expect(before.p2.isConnected).toBe(true);
    expect(ans(c).querySelectorAll(':scope > .prose.md p')[1]).toBe(before.p2);
    expect(ans(c).querySelector('[data-testid=reasoning]')).toBe(before.wk);
    expect(ans(c).textContent).not.toContain('[[');
    expect(ans(c).querySelector('[data-testid=web-chip]')?.textContent).toBe('developers.openai.com');
    expect(view(c)).toBe('window');
    await waitFor(() => expect(view(c)).toBe('line'), { timeout: SETTLE_MS + 1500 });
    expect(ans(c).querySelector('[data-testid=work-done]')?.textContent).toMatch(/^Работал 1 мин 28 с · 2 шага$/);
  });

  it('выбор человека во время потока (свернул или раскрыл ленту) переживает подмену и не сбрасывается', async () => {
    for (const taps of [1, 2]) {
      const { container: c, unmount } = render(createElement(Feed, { initial: [...SHOWN, u('u3', 'Вопрос 3'), LIVE] }));
      await stream(c);
      for (let i = 0; i < taps; i++) fireEvent.click(ans(c).querySelector('[data-testid=work-summary]')!);
      const want = taps === 1 ? 'full' : 'line';
      expect(view(c)).toBe(want);
      const wk = ans(c).querySelector('[data-testid=reasoning]');
      emit({ t: 'job', th: 't1', m: 'a3', status: 'done' });
      await waitFor(() => expect(ans(c).querySelector('.ans-foot')).not.toBeNull());
      expect(ans(c).querySelector('[data-testid=reasoning]')).toBe(wk);
      expect(view(c)).toBe(want);
      await new Promise((r) => setTimeout(r, SETTLE_MS + 200));
      expect(view(c)).toBe(want);
      unmount();
    }
  });
});
