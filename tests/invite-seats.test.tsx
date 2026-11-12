// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { InviteForm } from '@/components/InviteForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/invite/x' }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => createElement('a', { href: p.href }, p.children) }));

let reply: { state: string; left?: number; max?: number } = { state: 'ok', left: 17, max: 29 };
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0; reply = { state: 'ok', left: 17, max: 29 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return { ok: true, status: 200, json: async () => reply } as Response; }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const form = (lang: Lang, seats: { left: number; max: number } | null, state: 'ok' | 'used_up' = 'ok') =>
  render(createElement(I18nProvider, { lang, children: createElement(InviteForm, { token: 'tok-abcdefghij', state, seats }) }));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('осталось мест', () => {
  it('групповая ссылка: «Осталось мест: 17 из 29» под подачей, на трёх языках', () => {
    form('ru', { left: 17, max: 29 });
    expect(screen.getByTestId('invite-seats').textContent).toBe('Осталось мест: 17 из 29');
    cleanup(); form('en', { left: 17, max: 29 });
    expect(screen.getByTestId('invite-seats').textContent).toBe('Spots left: 17 of 29');
    cleanup(); form('sr', { left: 1, max: 29 });
    expect(screen.getByTestId('invite-seats').textContent).toBe('Preostalo mesta: 1 od 29');
    expect(screen.getByTestId('invite-pitch').nextElementSibling).toBe(screen.getByTestId('invite-seats'));
  });

  it('одноразовая ссылка — строки нет, опрос не идёт', () => {
    vi.useFakeTimers();
    form('ru', null);
    expect(screen.queryByTestId('invite-seats')).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(calls).toHaveLength(0);
  });

  it('число обновляется само: через 15 с и при возврате на вкладку', async () => {
    vi.useFakeTimers();
    form('ru', { left: 17, max: 29 });
    reply = { state: 'ok', left: 12, max: 29 };
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); await Promise.resolve(); });
    expect(calls[0]).toBe('/api/auth/invite?t=tok-abcdefghij');
    expect(screen.getByTestId('invite-seats').textContent).toBe('Осталось мест: 12 из 29');
    reply = { state: 'ok', left: 3, max: 29 };
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('invite-seats').textContent).toBe('Осталось мест: 3 из 29');
  });

  it('места кончились, пока страница открыта — «места заняты», как обычно', async () => {
    vi.useFakeTimers();
    form('ru', { left: 1, max: 29 });
    reply = { state: 'used_up' };
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('invite-used_up')).not.toBeNull();
    expect(screen.queryByTestId('invite-seats')).toBeNull();
    expect(screen.queryByTestId('invite-register')).toBeNull();
  });

  it('нет сети — прежнее число остаётся', async () => {
    vi.useFakeTimers();
    form('ru', { left: 17, max: 29 });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { vi.advanceTimersByTime(15_000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('invite-seats').textContent).toBe('Осталось мест: 17 из 29');
  });
});
void flush;
