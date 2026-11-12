// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { Composer } from '@/components/Composer';

afterEach(cleanup);
const input = () => screen.getByTestId('composer-input') as HTMLTextAreaElement;
const mount = (onSend: (t: string) => unknown) =>
  render(createElement(Composer, { busy: false, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSend: onSend as never }));

describe('отправка не удалась — текст остаётся', () => {
  it('onSend -> Promise<false>: поле очищается на время отправки и получает текст обратно', async () => {
    let done!: (v: boolean) => void;
    mount(() => new Promise<boolean>((r) => { done = r; }));
    fireEvent.change(input(), { target: { value: 'Важный вопрос без сети' } });
    fireEvent.click(screen.getByTestId('send'));
    expect(input().value).toBe('');
    await act(async () => { done(false); await Promise.resolve(); });
    expect(input().value).toBe('Важный вопрос без сети');
  });
  it('onSend -> Promise<true> / undefined: поле остаётся пустым', async () => {
    mount(async () => true);
    fireEvent.change(input(), { target: { value: 'Ушло' } });
    fireEvent.click(screen.getByTestId('send'));
    await act(async () => { await Promise.resolve(); });
    expect(input().value).toBe('');
    cleanup();
    mount(() => undefined);
    fireEvent.change(input(), { target: { value: 'Тоже ушло' } });
    fireEvent.click(screen.getByTestId('send'));
    await act(async () => { await Promise.resolve(); });
    expect(input().value).toBe('');
  });
  it('пока шла неудачная отправка, человек начал печатать новое — его текст не затирается', async () => {
    let done!: (v: boolean) => void;
    mount(() => new Promise<boolean>((r) => { done = r; }));
    fireEvent.change(input(), { target: { value: 'Первое' } });
    fireEvent.click(screen.getByTestId('send'));
    fireEvent.change(input(), { target: { value: 'Второе' } });
    await act(async () => { done(false); await Promise.resolve(); });
    expect(input().value).toBe('Второе');
  });
});
