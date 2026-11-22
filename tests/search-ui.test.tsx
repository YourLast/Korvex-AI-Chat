// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { SearchPalette, SearchResults, type Hit } from '@/components/ChatSearch';
import { FolderSection } from '@/components/Folders';
import type { ThreadLite } from '@/lib/types';
import type { PublicModel } from '@/lib/models';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => '/' }));
beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const models = [{ id: 'alpha', name: 'Alpha' }] as unknown as PublicModel[];
const th = (id: string, title: string): ThreadLite => ({ id, title, modelId: 'alpha', groupId: null, side: null, updatedAt: Date.now() - 3_600_000, answeredAt: null, readAt: null, muted: false } as unknown as ThreadLite);
const wrap = (lang: Lang, el: React.ReactElement) => createElement(I18nProvider, { lang, children: el });
const palette = (lang: Lang, threads: ThreadLite[], q = '') => render(wrap(lang, createElement(SearchPalette, { open: true, onClose: () => {}, q, setQ: () => {}, onPick: () => {}, threads, models })));

describe('окно поиска', () => {
  it('пустой запрос: короткая подсказка в поле, раздел «Недавние», абзаца на виду нет; «?» раскрывает и прячет подсказку', () => {
    palette('ru', [th('a', 'Счёт на оплату'), th('b', 'Курсы валют')]);
    const input = screen.getByTestId('search-input') as HTMLInputElement;
    expect(input.placeholder).toBe('Чаты, сообщения, файлы');
    expect(document.querySelector('.find-hint')).toBeNull();
    expect(screen.queryByTestId('search-help')).toBeNull();
    expect(document.querySelector('.find-count')!.textContent).toBe('Недавние');
    expect(screen.getAllByTestId('search-hit')).toHaveLength(2);
    const q = screen.getByTestId('search-help-btn');
    expect(q.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(q);
    expect(screen.getByTestId('search-help').textContent).toContain('в кавычках');
    expect(screen.getByTestId('search-help-btn').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('search-help-btn'));
    expect(screen.queryByTestId('search-help')).toBeNull();
  });

  it('нет ни одного чата — пустое состояние с рисунком, без списка', () => {
    palette('en', []);
    const blank = screen.getByTestId('search-blank');
    expect(blank.querySelector('svg.find-art')).not.toBeNull();
    expect(blank.textContent).toContain('Nothing to search yet');
    expect(screen.queryAllByTestId('search-hit')).toHaveLength(0);
  });

  it('есть запрос — «?» уступает место «очистить»', () => {
    palette('sr', [th('a', 'Račun')], 'ra');
    expect(screen.queryByTestId('search-help-btn')).toBeNull();
    expect(screen.getByTestId('search-clear')).not.toBeNull();
  });

  it('подсказки на трёх языках без кириллицы в en/sr', () => {
    for (const [lang, ph] of [['ru', 'Чаты, сообщения, файлы'], ['en', 'Chats, messages, files'], ['sr', 'Čatovi, poruke, fajlovi']] as const) {
      palette(lang, [th('a', 'x')]);
      expect((screen.getByTestId('search-input') as HTMLInputElement).placeholder).toBe(ph);
      cleanup();
    }
  });
});

describe('результаты', () => {
  const hit = (o: Partial<Hit> = {}): Hit => ({ key: 'k', href: '/c/k?m=m1#m-m1', title: [['Настройка ', 0], ['Zed', 1]], model: 'Alpha', at: Date.now() - 86_400_000 * 2, where: 'answer',
    snippet: [['в разделе ', 0], ['настройки', 1], [' провайдер', 0]], marks: ['настройки'], msgId: 'm1', more: 2, ...o });
  const res = (hits: Hit[]) => ({ q: 'zed', hits, total: hits.length });

  it('строка: название и фрагмент с подсвеченными словами, справа время и модель, «+2» тихо', () => {
    render(wrap('ru', createElement(SearchResults, { q: 'zed', res: res([hit()]), loading: false, active: 0, setActive: () => {}, onPick: () => {}, idBase: 't' })));
    const row = screen.getByTestId('search-hit');
    expect(row.querySelector('.find-t')!.textContent).toBe('Настройка Zed');
    expect(row.querySelectorAll('.find-t mark')).toHaveLength(1);
    expect(row.querySelector('.find-snip mark')!.textContent).toBe('настройки');
    expect(row.querySelector('.find-snip-box')).not.toBeNull();
    expect(row.querySelector('.find-side .find-when')).not.toBeNull();
    expect(row.querySelector('.find-side .find-model')!.textContent).toBe('Alpha');
    expect(row.querySelector('.find-more')!.textContent).toBe('+2');
    expect(document.querySelector('.find-count')!.textContent).toBe('Нашлось: 1 чат');
  });

  it('файл — значок файла перед фрагментом; сравнение — значок колонок у названия', () => {
    render(wrap('en', createElement(SearchResults, { q: 'x', res: res([hit({ where: 'file', href: '/g/g1' })]), loading: false, active: 0, setActive: () => {}, onPick: () => {}, idBase: 't' })));
    const row = screen.getByTestId('search-hit');
    expect(row.querySelector('.find-snip .find-ic')).not.toBeNull();
    expect(row.querySelector('.find-t .find-ic')).not.toBeNull();
  });

  it('ничего не нашлось — рисунок, заголовок и совет по виду запроса', () => {
    render(wrap('ru', createElement(SearchResults, { q: '"точная фраза"', res: { q: '"точная фраза"', hits: [], total: 0 }, loading: false, active: 0, setActive: () => {}, onPick: () => {}, idBase: 't' })));
    const e = screen.getByTestId('search-empty');
    expect(e.querySelector('svg.find-art.is-apart')).not.toBeNull();
    expect(e.querySelector('b')!.textContent).toBe('Ничего не нашлось');
    expect(e.textContent).toContain('Уберите кавычки');
  });
});

describe('карточка пустого раздела «Проекты»', () => {
  const props = { threads: [] as ThreadLite[], row: () => null, onChanged: () => {}, setFolders: () => {} };
  const folder = { id: 'f1', name: 'Ремонт', color: 'blue', instruction: '', visible: true, collapsed: false, n: 0 } as never;

  it('на трёх языках: одна строка, кнопка «Новый проект» открывает окно; старого серого абзаца нет', () => {
    for (const [lang, line, btn] of [['ru', 'Чаты по теме — в одном месте', 'Новый проект'], ['en', 'Keep related chats in one place', 'New project'], ['sr', 'Čatovi po temi na jednom mestu', 'Novi projekat']] as const) {
      render(wrap(lang, createElement(FolderSection, { ...props, folders: [] })));
      const card = screen.getByTestId('folders-empty');
      expect(card.textContent).toContain(line);
      expect(screen.getByTestId('folder-new-card').textContent).toBe(btn);
      expect(card.querySelector('svg.fld-art')).not.toBeNull();
      expect(document.querySelector('.fld-empty')).toBeNull();
      cleanup();
    }
  });

  it('первый проект: карточка сворачивается (is-leaving) и через 0,3 с убирается; проектов нет — возвращается', () => {
    vi.useFakeTimers();
    const { rerender } = render(wrap('ru', createElement(FolderSection, { ...props, folders: [] })));
    expect(screen.getByTestId('folders-empty').classList.contains('is-leaving')).toBe(false);
    rerender(wrap('ru', createElement(FolderSection, { ...props, folders: [folder] })));
    expect(screen.getByTestId('folders-empty').classList.contains('is-leaving')).toBe(true);
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByTestId('folders-empty')).toBeNull();
    rerender(wrap('ru', createElement(FolderSection, { ...props, folders: [] })));
    expect(screen.getByTestId('folders-empty').classList.contains('is-leaving')).toBe(false);
  });

  it('есть проект с самого начала — карточки нет', () => {
    render(wrap('ru', createElement(FolderSection, { ...props, folders: [folder] })));
    expect(screen.queryByTestId('folders-empty')).toBeNull();
  });
});
