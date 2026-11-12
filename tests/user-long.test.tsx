// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { UserTurn } from '@/components/Message';
import type { MsgView } from '@/lib/types';

const msg = (content: string): MsgView => ({ id: 'm1', role: 'user', content, meta: {} } as unknown as MsgView);

describe('длинное сообщение пользователя', () => {
  it('короткое — без сворачивания и без кнопки', () => {
    const { container, queryByTestId } = render(createElement(UserTurn, { m: msg('Привет! Как дела?') }));
    expect(container.querySelector('.bubble')!.className).toBe('bubble');
    expect(queryByTestId('user-more')).toBeNull();
  });
  it('50 000 знаков — свёрнуто, «Показать полностью» раскрывает и «Свернуть» сворачивает; текст целиком в разметке', () => {
    const text = 'Длинный абзац отчёта по скважинам. '.repeat(1500).slice(0, 50000);
    const { container, getByTestId } = render(createElement(UserTurn, { m: msg(text) }));
    const b = container.querySelector('.bubble')!;
    expect(b.className).toContain('is-clamped');
    expect(b.textContent!.length).toBe(text.length);
    const more = getByTestId('user-more');
    expect(more.textContent).toContain('Показать полностью');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(container.querySelector('.bubble')!.className).not.toContain('is-clamped');
    expect(getByTestId('user-more').textContent).toBe('Свернуть');
    fireEvent.click(getByTestId('user-more'));
    expect(container.querySelector('.bubble')!.className).toContain('is-clamped');
  });
  it('много коротких строк (60) — тоже свёрнуто', () => {
    const text = Array.from({ length: 60 }, (_, i) => `строка ${i}`).join('\n');
    const { container } = render(createElement(UserTurn, { m: msg(text) }));
    expect(container.querySelector('.bubble')!.className).toContain('is-clamped');
  });
});
