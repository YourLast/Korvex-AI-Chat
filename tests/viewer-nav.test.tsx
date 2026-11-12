// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

const nav = vi.hoisted(() => ({ path: '/c/a' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => ({ push() {}, replace() {} }) }));
vi.mock('@/components/fileview/pdfjs', async (orig) => ({ ...(await orig<typeof import('@/components/fileview/pdfjs')>()), loadPdfjs: async () => { throw new Error('no pdf in this test'); } }));
import { FileViewerSlot, leavesChat } from '@/components/FileViewerSlot';
import { _resetFileView, closeFile, getFileView, openFile, setChatFiles } from '@/lib/fileView';

beforeEach(() => {
  _resetFileView(); nav.path = '/c/a';
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ kind: 'text', state: 'ready', total: 3 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); closeFile(); _resetFileView(); });

describe('панель закрывается при уходе из чата', () => {
  it('правило: другой чат, главная, настройки — да; тот же путь и первая отправка (/ → /c/…) — нет', () => {
    expect(leavesChat('/c/a', '/c/b')).toBe(true);
    expect(leavesChat('/c/a', '/')).toBe(true);
    expect(leavesChat('/c/a', '/settings')).toBe(true);
    expect(leavesChat('/g/x', '/c/y')).toBe(true);
    expect(leavesChat('/c/a', '/c/a')).toBe(false);
    expect(leavesChat('/', '/c/new')).toBe(false);
    expect(leavesChat(null, '/c/a')).toBe(false);
  });
  it('открыт файл чата A, перешли в чат B — панель закрыта; в A остаётся, пока путь тот же', async () => {
    const v = render(createElement(FileViewerSlot));
    act(() => { openFile({ id: 'f1', name: 'заметки.txt' }); });
    expect(getFileView().target?.id).toBe('f1');
    v.rerender(createElement(FileViewerSlot));
    expect(getFileView().target?.id).toBe('f1');
    nav.path = '/c/b';
    v.rerender(createElement(FileViewerSlot));
    expect(getFileView().target).toBeNull();
    expect(document.documentElement.classList.contains('fv-open')).toBe(false);
  });
  it('файл открыт из поля ввода на главной, ответ ушёл и адрес стал /c/…: панель остаётся', () => {
    nav.path = '/';
    const v = render(createElement(FileViewerSlot));
    act(() => { openFile({ id: 'f1', name: 'заметки.txt' }); });
    nav.path = '/c/new';
    v.rerender(createElement(FileViewerSlot));
    expect(getFileView().target?.id).toBe('f1');
  });
});

describe('меню «Сравнить с…»', () => {
  it('Esc закрывает сначала меню, потом панель; нажатие мимо меню закрывает его', async () => {
    setChatFiles([{ id: 'p1', name: 'Положение_2025.pdf', size: 1 }, { id: 'p2', name: 'Положение_2026.pdf', size: 1 }]);
    render(createElement(FileViewerSlot));
    act(() => { openFile({ id: 'p1', name: 'Положение_2025.pdf' }); });
    const btn = await screen.findByTestId('fv-compare');
    fireEvent.click(btn);
    expect(screen.getByTestId('pick-other')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pick-other')).toBeNull();
    expect(getFileView().target?.id).toBe('p1');
    fireEvent.click(btn);
    expect(screen.getByTestId('pick-other')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('file-viewer').querySelector('.fv-body')!);
    expect(screen.queryByTestId('pick-other')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getFileView().target).toBeNull();
  });
});
