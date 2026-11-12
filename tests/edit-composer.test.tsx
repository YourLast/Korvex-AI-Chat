// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer, editLine, type ComposerEdit } from '@/components/Composer';
import { UserTurn } from '@/components/Message';
import { ShellCtx } from '@/components/Shell';
import type { FileChip, MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }), usePathname: () => '/c/t1', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => createElement('a', { href: p.href }, p.children) }));

let mobile = true;
const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
beforeEach(() => {
  calls.length = 0; mobile = true;
  window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 760px') ? mobile : q.includes('pointer: fine') ? !mobile : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | undefined;
    try { body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
    calls.push({ url, method, body });
    if (url === '/api/files') return { ok: true, status: 200, json: async () => ({ id: 'f-new', name: 'новый.pdf', size: 2048, mime: 'application/pdf' }) } as Response;
    if (url === '/api/chat') return { ok: true, status: 202, json: async () => ({ jobId: 'j1', userMessageId: 'u2', assistantMessageId: 'a2' }) } as Response;
    if (url.includes('/path')) {
      const e = calls.find((c) => c.url === '/api/chat')?.body;
      const messages = e ? [{ id: 'u2', role: 'user', content: e.text, files: [], siblings: { ids: ['u1', 'u2'], index: 1 } }, { id: 'a2', role: 'assistant', content: 'Ответ', meta: { modelId: e.modelId, levelId: e.levelId } }] : [];
      return { ok: true, status: 200, json: async () => ({ messages, hasMore: false }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const img: FileChip = { id: 'f-img', name: 'схема.png', size: 120_000, mime: 'image/png' };
const doc: FileChip = { id: 'f-doc', name: 'отчёт.pdf', size: 50_000, mime: 'application/pdf' };
const input = () => screen.getByTestId('composer-input') as HTMLTextAreaElement;
const chips = () => screen.queryAllByTestId('up-chip').map((c) => (c as HTMLElement).dataset.name);

function Host({ onSend, busy = false, onSteer, start = null as ComposerEdit | null }: { onSend: (t: string, f: FileChip[]) => unknown; busy?: boolean; onSteer?: (t: string) => Promise<boolean>; start?: ComposerEdit | null }) {
  const [edit, setEdit] = useState<ComposerEdit | null>(start);
  return createElement('div', null,
    createElement('button', { 'data-testid': 'go-edit', onClick: () => setEdit({ id: 'u1', text: 'Исходный вопрос\nвторой строкой', files: [img, doc] }) }),
    createElement('button', { 'data-testid': 'go-edit2', onClick: () => setEdit({ id: 'u3', text: 'Другой вопрос', files: [] }) }),
    createElement(Composer, { busy, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSteer, edit, onEditCancel: () => setEdit(null),
      onSend: (t: string, f: FileChip[]) => { const r = onSend(t, f); if (edit) setEdit(null); return r as never; } }));
}

describe('поле ввода в режиме правки', () => {
  it('вход: плашка «Редактирование» с исходным текстом одной строкой, текст и вложения сообщения в поле, курсор в конце, черновик в стороне', () => {
    render(createElement(Host, { onSend: () => true }));
    fireEvent.change(input(), { target: { value: 'мой черновик' } });
    expect(screen.queryByTestId('edit-plate')).toBeNull();
    fireEvent.click(screen.getByTestId('go-edit'));
    expect(screen.getByTestId('edit-plate').textContent).toContain('Редактирование');
    expect(screen.getByTestId('edit-src').textContent).toBe('Исходный вопрос второй строкой');
    expect(input().value).toBe('Исходный вопрос\nвторой строкой');
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(input().value.length);
    expect(chips()).toEqual(['схема.png', 'отчёт.pdf']);
    expect(screen.getAllByTestId('up-chip')[0].querySelector('img')!.getAttribute('src')).toBe('/api/files/f-img?w=480');
    expect(screen.getByTestId('send').getAttribute('aria-label')).toBe('Отправить правку');
    expect(input().getAttribute('aria-label')).toBe('Правка сообщения');
    expect(screen.getByTestId('dock').dataset.editing).toBe('true');
  });

  it('отмена крестиком: черновик и его файлы возвращаются, вложения правки уходят', async () => {
    render(createElement(Host, { onSend: () => true }));
    fireEvent.change(input(), { target: { value: 'мой черновик' } });
    const f = new File(['%PDF'], 'новый.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: [f] } }); });
    await waitFor(() => expect(chips()).toEqual(['новый.pdf']));
    fireEvent.click(screen.getByTestId('go-edit'));
    expect(chips()).toEqual(['схема.png', 'отчёт.pdf']);
    fireEvent.click(screen.getByTestId('edit-cancel'));
    expect(screen.queryByTestId('edit-plate')).toBeNull();
    expect(input().value).toBe('мой черновик');
    expect(chips()).toEqual(['новый.pdf']);
  });

  it('Esc отменяет правку; Esc, который закрыл меню или шторку поверх, — нет', () => {
    render(createElement(Host, { onSend: () => true }));
    fireEvent.change(input(), { target: { value: 'черновик' } });
    fireEvent.click(screen.getByTestId('go-edit'));
    const pop = document.createElement('div'); pop.className = 'pop'; document.body.appendChild(pop);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.getByTestId('edit-plate')).toBeTruthy();
    pop.remove();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => { window.dispatchEvent(ev); });
    expect(screen.getByTestId('edit-plate')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByTestId('edit-plate')).toBeNull();
    expect(input().value).toBe('черновик');
  });

  it('отправка: та же onSend с правленым текстом и вложениями из поля (одно убрали, одно добавили); потом черновик возвращается', async () => {
    const onSend = vi.fn(() => true);
    render(createElement(Host, { onSend }));
    fireEvent.change(input(), { target: { value: 'черновик до правки' } });
    fireEvent.click(screen.getByTestId('go-edit'));
    fireEvent.change(input(), { target: { value: 'Правленый вопрос' } });
    fireEvent.click(screen.getAllByTestId('up-remove')[0]);
    const f = new File(['%PDF'], 'новый.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: [f] } }); });
    await waitFor(() => expect(chips()).toEqual(['отчёт.pdf', 'новый.pdf']));
    fireEvent.click(screen.getByTestId('send'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]).toEqual(['Правленый вопрос', [doc, { id: 'f-new', name: 'новый.pdf', size: 2048, mime: 'application/pdf', tokens: undefined, info: undefined }]]);
    expect(screen.queryByTestId('edit-plate')).toBeNull();
    expect(input().value).toBe('черновик до правки');
    expect(chips()).toEqual([]);
  });

  it('пустое поле без вложений не отправляется; только вложения — отправляются', () => {
    const onSend = vi.fn(() => true);
    render(createElement(Host, { onSend }));
    fireEvent.click(screen.getByTestId('go-edit'));
    fireEvent.change(input(), { target: { value: '   ' } });
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getAllByTestId('up-remove')[0]);
    fireEvent.click(screen.getAllByTestId('up-remove')[0]);
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('правка другого сообщения подряд — черновик тот же (первый), текст и файлы — нового сообщения', () => {
    render(createElement(Host, { onSend: () => true }));
    fireEvent.change(input(), { target: { value: 'самый первый черновик' } });
    fireEvent.click(screen.getByTestId('go-edit'));
    fireEvent.click(screen.getByTestId('go-edit2'));
    expect(input().value).toBe('Другой вопрос');
    expect(chips()).toEqual([]);
    fireEvent.click(screen.getByTestId('edit-cancel'));
    expect(input().value).toBe('самый первый черновик');
  });

  it('идёт ответ: в режиме правки агенту на ходу не пишем — на кнопке «Стоп», отправка правки — после ответа', () => {
    const onSteer = vi.fn(async () => true);
    const { rerender } = render(createElement(Host, { onSend: () => true, busy: true, onSteer, start: { id: 'u1', text: 'Вопрос', files: [] } }));
    expect(input().value).toBe('Вопрос');
    expect(screen.queryByTestId('steer-send')).toBeNull();
    expect(screen.getByTestId('stop')).toBeTruthy();
    expect(input().getAttribute('placeholder')).toBe('Напишите');
    rerender(createElement(Host, { onSend: () => true, busy: false, onSteer, start: { id: 'u1', text: 'Вопрос', files: [] } }));
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false);
    expect(onSteer).not.toHaveBeenCalled();
  });

  it('editLine: одна строка; только вложения — их имена', () => {
    expect(editLine({ id: 'x', text: '  a\n\n b\tc ', files: [] })).toBe('a b c');
    expect(editLine({ id: 'x', text: '', files: [img, doc] })).toBe('схема.png, отчёт.pdf');
  });
});

describe('карандаш у вопроса', () => {
  const m: MsgView = { id: 'u1', role: 'user', content: 'Вопрос', files: [] };
  it('телефон (onEditStart): правка не в пузыре — родитель переносит её в поле; вопрос помечен, пока его правят', () => {
    const onEditStart = vi.fn();
    const { container, rerender } = render(createElement(UserTurn, { m, onEdit: () => {}, onEditStart }));
    fireEvent.click(screen.getByTestId('edit'));
    expect(onEditStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('edit-box')).toBeNull();
    rerender(createElement(UserTurn, { m, onEdit: () => {}, onEditStart, marked: true }));
    expect(container.querySelector('.turn-user')!.className).toContain('is-edit-src');
  });
  it('компьютер (без onEditStart): правка в пузыре, как было', () => {
    render(createElement(UserTurn, { m, onEdit: () => {} }));
    fireEvent.click(screen.getByTestId('edit'));
    expect(screen.getByTestId('edit-box')).toBeTruthy();
  });
  it('пока идёт ответ, карандаш недоступен', () => {
    render(createElement(UserTurn, { m, busy: true, onEdit: () => {}, onEditStart: () => {} }));
    expect((screen.getByTestId('edit') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('экран чата: правка на телефоне через поле ввода', () => {
  const models = [
    { id: 'alpha', name: 'Alpha', fullName: 'Alpha', defaultLevel: 'medium', images: true, levels: [{ id: 'low', label: 'low' }, { id: 'medium', label: 'medium' }, { id: 'xhigh', label: 'xhigh' }] },
  ] as unknown as PublicModel[];
  const u1: MsgView = { id: 'u1', role: 'user', content: 'Сколько скважин в отчёте?', files: [doc] };
  const a1: MsgView = { id: 'a1', role: 'assistant', content: 'Двенадцать.', meta: { modelId: 'alpha', levelId: 'medium' } };
  const shell = { models, refresh: async () => {}, openDrawer: () => {}, threads: [], role: 'user' };
  async function mount(initial: MsgView[] = [u1, a1]) {
    const { ChatClient } = await import('@/components/ChatClient');
    return render(createElement(ShellCtx.Provider, { value: shell as never },
      createElement(ChatClient, { models, thread: { id: 't1', title: 'Скважины', modelId: 'alpha', effort: 'xhigh' }, initial, fileNames: [] })));
  }

  it('карандаш -> текст и файл в поле, вопрос приглушён; «Отправить» — POST /api/chat mode edit (та же правка), модель и уровень чипа, вложения поля', async () => {
    await mount();
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(input(), { target: { value: 'черновик' } });
    fireEvent.click(screen.getByTestId('edit'));
    expect(screen.getByTestId('edit-plate')).toBeTruthy();
    expect(input().value).toBe('Сколько скважин в отчёте?');
    expect(chips()).toEqual(['отчёт.pdf']);
    expect(screen.queryByTestId('edit-box')).toBeNull();
    expect(document.querySelector('[data-testid=user-msg]')!.className).toContain('is-edit-src');
    expect((window.history.state as Record<string, unknown> | null)?.kxBack).toBeTruthy();
    fireEvent.change(input(), { target: { value: 'Сколько скважин в отчёте за 2025 год?' } });
    await act(async () => { fireEvent.click(screen.getByTestId('send')); await new Promise((r) => setTimeout(r, 0)); });
    const post = calls.find((c) => c.url === '/api/chat')!;
    expect(post.method).toBe('POST');
    expect(post.body).toMatchObject({ threadId: 't1', mode: 'edit', editId: 'u1', text: 'Сколько скважин в отчёте за 2025 год?', fileIds: ['f-doc'], replaceFiles: true, modelId: 'alpha', levelId: 'xhigh' });
    await waitFor(() => expect(screen.queryByTestId('edit-plate')).toBeNull());
    expect(input().value).toBe('черновик');
    await waitFor(() => expect([...document.querySelectorAll('[data-testid=user-msg] .bubble')].map((b) => b.textContent)).toEqual(['Сколько скважин в отчёте за 2025 год?']));
    await waitFor(() => expect(screen.getByTestId('versions').textContent).toContain('2/2'));
  });

  it('«назад» (popstate) отменяет правку и возвращает черновик; запроса правки нет', async () => {
    await mount();
    fireEvent.change(input(), { target: { value: 'черновик' } });
    fireEvent.click(screen.getByTestId('edit'));
    expect(screen.getByTestId('edit-plate')).toBeTruthy();
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(screen.queryByTestId('edit-plate')).toBeNull());
    expect(input().value).toBe('черновик');
    expect(calls.some((c) => c.url === '/api/chat')).toBe(false);
  });

  it('крестик снимает свою запись истории (следующий «назад» — не пустой)', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('edit'));
    expect((window.history.state as Record<string, unknown> | null)?.kxBack).toBeTruthy();
    const back = vi.spyOn(window.history, 'back');
    fireEvent.click(screen.getByTestId('edit-cancel'));
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect((window.history.state as Record<string, unknown> | null)?.kxBack).toBeFalsy();
  });

  it('идёт ответ — карандаш недоступен, поле не переходит в правку', async () => {
    await mount([u1, { ...a1, id: 'a-live', content: 'Счит', streaming: true, phase: 'answer' }]);
    const pen = screen.getByTestId('edit') as HTMLButtonElement;
    expect(pen.disabled).toBe(true);
    fireEvent.click(pen);
    expect(screen.queryByTestId('edit-plate')).toBeNull();
  });

  it('компьютер — правка в пузыре, как было (POST без replaceFiles: вложения исходного сообщения)', async () => {
    mobile = false;
    await mount();
    fireEvent.click(screen.getByTestId('edit'));
    expect(screen.getByTestId('edit-box')).toBeTruthy();
    expect(screen.queryByTestId('edit-plate')).toBeNull();
    fireEvent.change(screen.getByTestId('edit-input'), { target: { value: 'Правка на компьютере' } });
    await act(async () => { fireEvent.click(screen.getByTestId('edit-send')); await new Promise((r) => setTimeout(r, 0)); });
    const post = calls.find((c) => c.url === '/api/chat')!;
    expect(post.body).toMatchObject({ mode: 'edit', editId: 'u1', text: 'Правка на компьютере', fileIds: [] });
    expect(post.body!.replaceFiles).toBeUndefined();
  });
});
