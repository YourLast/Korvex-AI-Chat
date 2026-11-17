// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminTour } from '@/components/AdminTour';

const blocks = ['users-table', 'invites', 'feature-memory', 'load-table', 'audit-log'];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
function setup() {
  for (const id of blocks) { const d = document.createElement('div'); d.dataset.testid = id; d.scrollIntoView = () => {}; document.body.appendChild(d); }
  const fetch = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetch);
  const onTab = vi.fn(), onClose = vi.fn();
  render(createElement(AdminTour, { open: true, onTab, onClose }));
  return { fetch, onTab, onClose };
}
const step = () => screen.getByTestId('admin-tour').dataset.step;
const lit = () => [...document.querySelectorAll('.k-tour-on')].map((e) => (e as HTMLElement).dataset.testid);

describe('AdminTour', () => {
  it('пять шагов по порядку: раздел открывается, блок подсвечен; «Назад»; «Готово» — отметка на сервере', async () => {
    const { fetch, onTab, onClose } = setup();
    const want = [['people', 'users', 'users-table'], ['invites', 'users', 'invites'], ['memory', 'features', 'feature-memory'], ['model', 'state', 'load-table'], ['journal', 'users', 'audit-log']];
    for (let i = 0; i < want.length; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(step()).toBe(want[i][0]);
      expect(onTab).toHaveBeenLastCalledWith(want[i][1]);
      expect(lit()).toEqual([want[i][2]]);
      expect(screen.getByText(`Шаг ${i + 1} из 5`)).toBeTruthy();
      if (i === 1) { fireEvent.click(screen.getByTestId('tour-back')); expect(step()).toBe('people'); fireEvent.click(screen.getByTestId('tour-next')); }
      if (i < want.length - 1) fireEvent.click(screen.getByTestId('tour-next'));
    }
    expect(screen.getByTestId('tour-next').textContent).toBe('Готово');
    fireEvent.click(screen.getByTestId('tour-next'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/admin/tour', expect.objectContaining({ method: 'POST', body: JSON.stringify({ done: true }) }));
    expect(lit()).toEqual([]);
  });
  it('«Пропустить» с первого шага и Esc — тур закрыт и отмечен', () => {
    const a = setup();
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    cleanup(); document.body.innerHTML = '';
    const b = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(b.onClose).toHaveBeenCalledTimes(1);
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });
});
