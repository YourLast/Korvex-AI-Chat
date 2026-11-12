// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { ChatSheet, type ChatRef, type ChatView } from '@/components/ChatSheet';
import { ShellCtx, Topbar } from '@/components/Shell';
import { FolderSection } from '@/components/Folders';
import type { FolderView } from '@/lib/types';

const push = vi.fn();
let pathname = '/c/t1';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: () => {} }), usePathname: () => pathname }));
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => createElement('a', { href: p.href }, p.children) }));

const calls: { url: string; method: string; body: unknown }[] = [];
let respond: (url: string, method: string) => { status: number; json?: unknown } = () => ({ status: 200, json: { ok: true } });
beforeEach(() => {
  calls.length = 0; push.mockClear(); pathname = '/c/t1'; respond = () => ({ status: 200, json: { ok: true } });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respond(url, method);
    return { ok: r.status < 400, status: r.status, json: async () => r.json ?? {} } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const chat = (o: Partial<ChatRef> = {}): ChatRef => ({ id: 't1', title: 'Отчёт по скважинам', muted: false, folderId: null, ...o });
const folders = [{ id: 'f1', name: 'Ремонт', color: 'green', instruction: '', collapsed: false, sort: 0, count: 0 }, { id: 'f2', name: 'Работа', color: '', instruction: '', collapsed: false, sort: 1, count: 0 }] as FolderView[];

function Host({ guardMs = 0, lang = 'ru' as Lang, target = chat() as ChatRef | null, first = 'menu' as ChatView, refresh = vi.fn(async () => {}), onClose = vi.fn(), f = folders }) {
  const [view, setView] = useState<ChatView>(first);
  return createElement(I18nProvider, { lang, children: createElement(ChatSheet, { target, view, onView: setView, onClose, folders: f, refresh, reloadFolders: async () => {}, guardMs }) });
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('меню действий', () => {
  it('Переименовать, Переместить в проект, Не уведомлять, Удалить (красным); название чата сверху', () => {
    render(createElement(Host));
    expect(screen.getByTestId('chat-sheet-title').textContent).toBe('Отчёт по скважинам');
    expect(screen.getByTestId('chat-act-rename').textContent).toBe('Переименовать');
    expect(screen.getByTestId('chat-act-move').textContent).toBe('Переместить в проект');
    expect(screen.getByTestId('chat-act-mute').textContent).toBe('Не уведомлять');
    const del = screen.getByTestId('chat-act-delete');
    expect(del.textContent).toBe('Удалить');
    expect(del.classList.contains('ca-danger')).toBe(true);
  });

  it('уведомления выключены — «Уведомлять об ответах»; на en и sr — свои подписи', () => {
    render(createElement(Host, { target: chat({ muted: true }) }));
    expect(screen.getByTestId('chat-act-mute').textContent).toBe('Уведомлять об ответах');
    cleanup();
    render(createElement(Host, { lang: 'en' }));
    expect([...document.querySelectorAll('.ca-item')].map((x) => x.textContent)).toEqual(['Rename', 'Move to project', 'Don’t notify', 'Delete']);
    cleanup();
    render(createElement(Host, { lang: 'sr' }));
    expect([...document.querySelectorAll('.ca-item')].map((x) => x.textContent)).toEqual(['Preimenuj', 'Premesti u projekat', 'Ne obaveštavaj', 'Obriši']);
  });

  it('временный чат — без «в проект» и «уведомлять»; сравнение — без «в проект»', () => {
    render(createElement(Host, { target: chat({ temporary: true }) }));
    expect(screen.queryByTestId('chat-act-move')).toBeNull(); expect(screen.queryByTestId('chat-act-mute')).toBeNull();
    expect(screen.getByTestId('chat-act-rename')).not.toBeNull(); expect(screen.getByTestId('chat-act-delete')).not.toBeNull();
    cleanup();
    render(createElement(Host, { target: chat({ groupId: 'g1' }) }));
    expect(screen.queryByTestId('chat-act-move')).toBeNull();
  });

  it('«Не уведомлять» — PATCH {muted:true} и закрытие листа', async () => {
    const onClose = vi.fn(), refresh = vi.fn(async () => {});
    render(createElement(Host, { onClose, refresh }));
    fireEvent.click(screen.getByTestId('chat-act-mute')); await flush();
    expect(calls).toEqual([{ url: '/api/threads/t1', method: 'PATCH', body: { muted: true } }]);
    expect(onClose).toHaveBeenCalled(); expect(refresh).toHaveBeenCalled();
  });

  it('сравнение: действия — по группе (id группы в адресе)', async () => {
    render(createElement(Host, { target: chat({ groupId: 'g1' }), first: 'rename' }));
    fireEvent.change(screen.getByTestId('chat-rename-input'), { target: { value: 'Новое' } });
    fireEvent.click(screen.getByTestId('chat-rename-save')); await flush();
    expect(calls[0].url).toBe('/api/threads/g1');
  });
});

describe('защита от «щелчка сквозь» после долгого нажатия', () => {
  it('первые мс после открытия щелчки по пунктам игнорируются, потом работают', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(createElement(Host, { guardMs: 400, onClose }));
    fireEvent.click(screen.getByTestId('chat-act-rename'));
    expect(screen.queryByTestId('chat-rename-input')).toBeNull();
    fireEvent.mouseDown(document.querySelector('.pj-scrim')!);
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.click(screen.getByTestId('chat-act-rename'));
    expect(screen.getByTestId('chat-rename-input')).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('переименование', () => {
  it('из меню: поле в фокусе с выделенным названием, Enter сохраняет (PATCH title), лист закрывается, список обновляется', async () => {
    const onClose = vi.fn(), refresh = vi.fn(async () => {});
    render(createElement(Host, { onClose, refresh }));
    fireEvent.click(screen.getByTestId('chat-act-rename'));
    const input = screen.getByTestId('chat-rename-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Отчёт по скважинам');
    fireEvent.change(input, { target: { value: '  Сводка за октябрь  ' } });
    fireEvent.keyDown(input, { key: 'Enter' }); await flush();
    expect(calls).toEqual([{ url: '/api/threads/t1', method: 'PATCH', body: { title: 'Сводка за октябрь' } }]);
    expect(onClose).toHaveBeenCalled(); expect(refresh).toHaveBeenCalled();
  });

  it('пустое название — «Сохранить» неактивна, запроса нет; то же название — просто закрывается', async () => {
    const onClose = vi.fn();
    render(createElement(Host, { first: 'rename', onClose }));
    const input = screen.getByTestId('chat-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByTestId('chat-rename-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' }); await flush();
    expect(calls).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'Отчёт по скважинам' } });
    fireEvent.click(screen.getByTestId('chat-rename-save')); await flush();
    expect(calls).toHaveLength(0); expect(onClose).toHaveBeenCalled();
  });

  it('ошибка сервера — лист остаётся открытым, список не обновляется', async () => {
    respond = () => ({ status: 500 });
    const onClose = vi.fn(), refresh = vi.fn(async () => {});
    render(createElement(Host, { first: 'rename', onClose, refresh }));
    fireEvent.change(screen.getByTestId('chat-rename-input'), { target: { value: 'Другое' } });
    fireEvent.click(screen.getByTestId('chat-rename-save')); await flush();
    expect(onClose).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  });
});

describe('удаление', () => {
  it('подтверждение: вопрос, название чата, текст, «Отмена» и красная «Удалить»; браузерных window.prompt / confirm нет', () => {
    const prompt = vi.spyOn(window, 'prompt'), confirm = vi.spyOn(window, 'confirm');
    render(createElement(Host));
    fireEvent.click(screen.getByTestId('chat-act-delete'));
    expect(document.querySelector('.pj-eyebrow')!.textContent).toBe('Удалить чат?');
    expect(screen.getByTestId('chat-delete-title').textContent).toBe('Отчёт по скважинам');
    expect(document.querySelector('.pj-text')!.textContent).toContain('без возврата');
    expect(screen.getByTestId('chat-delete-ok').classList.contains('pj-danger')).toBe(true);
    expect(screen.getByTestId('chat-delete-ok').textContent).toBe('Удалить');
    expect(document.activeElement).not.toBe(screen.getByTestId('chat-delete-ok'));
    expect(prompt).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });

  it('«Удалить»: DELETE, открытый чат — на главную; другой чат — остаёмся', async () => {
    const onClose = vi.fn(), refresh = vi.fn(async () => {});
    render(createElement(Host, { first: 'delete', onClose, refresh }));
    fireEvent.click(screen.getByTestId('chat-delete-ok')); await flush();
    expect(calls).toEqual([{ url: '/api/threads/t1', method: 'DELETE', body: undefined }]);
    expect(onClose).toHaveBeenCalled(); expect(refresh).toHaveBeenCalled(); expect(push).toHaveBeenCalledWith('/');
    cleanup(); push.mockClear(); pathname = '/c/other';
    render(createElement(Host, { first: 'delete' }));
    fireEvent.click(screen.getByTestId('chat-delete-ok')); await flush();
    expect(push).not.toHaveBeenCalled();
  });

  it('отказ сервера (чат — цель автоматизации): лист не закрывается, на главную не уходим', async () => {
    respond = () => ({ status: 409, json: { error: 'Чат используется автоматизацией «Сводка»: сначала измените или удалите её' } });
    const onClose = vi.fn();
    render(createElement(Host, { first: 'delete', onClose }));
    fireEvent.click(screen.getByTestId('chat-delete-ok')); await flush();
    expect(onClose).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });
});

describe('перенос в проект', () => {
  it('список проектов; текущий — неактивен; выбор — POST /api/threads/move', async () => {
    const onClose = vi.fn();
    render(createElement(Host, { first: 'move', target: chat({ folderId: 'f1' }), onClose }));
    const items = screen.getAllByTestId('chat-move-to') as HTMLButtonElement[];
    expect(items.map((x) => x.textContent)).toEqual(['Ремонт', 'Работа']);
    expect(items[0].disabled).toBe(true);
    expect(screen.getByTestId('chat-move-out')).not.toBeNull();
    fireEvent.click(items[1]); await flush();
    expect(calls[0]).toEqual({ url: '/api/threads/move', method: 'POST', body: { ids: ['t1'], folderId: 'f2' } });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('шапка чата и меню', () => {
  const ctx = (chatMenu: ReturnType<typeof vi.fn>) => ({ models: [], refresh: async () => {}, openDrawer: () => {}, threads: [], role: 'user', chatMenu: chatMenu as unknown as (c: ChatRef, v?: ChatView) => void });
  const bar = (chatMenu: ReturnType<typeof vi.fn>, c?: ChatRef) => render(createElement(I18nProvider, { lang: 'ru', children: createElement(ShellCtx.Provider, { value: ctx(chatMenu), children: createElement(Topbar, { title: 'Отчёт', sub: 'Alpha', chat: c }) }) }));

  it('название и «⋯» открывают действия этого чата', () => {
    const chatMenu = vi.fn();
    bar(chatMenu, chat());
    fireEvent.click(screen.getByTestId('top-title'));
    fireEvent.click(screen.getByTestId('top-more'));
    expect(chatMenu).toHaveBeenCalledTimes(2);
    expect(chatMenu.mock.calls[0][0]).toMatchObject({ id: 't1', title: 'Отчёт по скважинам' });
    expect(screen.getByTestId('top-title').getAttribute('aria-label')).toBe('Действия с чатом');
  });

  it('без чата (главная, настройки) — обычное название без кнопок', () => {
    bar(vi.fn());
    expect(screen.queryByTestId('top-title')).toBeNull(); expect(screen.queryByTestId('top-more')).toBeNull();
    expect(document.querySelector('.top-title b')!.textContent).toBe('Отчёт');
  });
});

describe('проект: «⋯» и лист действий', () => {
  const proj = { id: 'f1', name: 'Ремонт', color: 'green', instruction: '', collapsed: true, sort: 0, count: 2 } as FolderView;
  const sec = (lang: Lang = 'ru') => render(createElement(I18nProvider, { lang, children: createElement(FolderSection, { folders: [proj], threads: [], row: () => null, onChanged: () => {}, setFolders: () => {} }) }));

  it('у проекта есть «⋯» с названием в подписи; нажатие — лист «Настроить проект» / «Удалить проект» (красным)', () => {
    sec();
    const more = screen.getByTestId('folder-more');
    expect(more.getAttribute('aria-label')).toBe('Действия с проектом «Ремонт»');
    fireEvent.click(more);
    expect([...document.querySelectorAll('[data-testid=folder-menu] .ca-item')].map((x) => x.textContent)).toEqual(['Настроить проект', 'Удалить проект']);
    expect(screen.getByTestId('folder-act-del').classList.contains('ca-danger')).toBe(true);
  });

  it('«Настроить проект» открывает окно проекта, «Удалить проект» — подтверждение в листе', () => {
    sec();
    fireEvent.click(screen.getByTestId('folder-more')); fireEvent.click(screen.getByTestId('folder-act-config'));
    expect(screen.getByTestId('folder-sheet')).not.toBeNull();
    cleanup(); sec();
    fireEvent.click(screen.getByTestId('folder-more')); fireEvent.click(screen.getByTestId('folder-act-del'));
    expect(screen.getByTestId('folder-del-dlg').textContent).toContain('Удалить проект «Ремонт»?');
  });
});

describe('нет браузерных окон', () => {
  it('в исходниках оболочки нет window.prompt и window.confirm', async () => {
    const fs = await import('node:fs');
    for (const f of ['src/components/Shell.tsx', 'src/components/ChatSheet.tsx', 'src/components/Folders.tsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/window\.(prompt|confirm)\(/);
    }
  });
});

void waitFor;
