// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n/react';
import { ShellCtx } from '@/components/Shell';
import { UpRow, fileTone, type Up } from '@/components/UpRow';

afterEach(cleanup);
const wrap = (role: string, c: ReactNode) => createElement(I18nProvider, { lang: 'ru', children: createElement(ShellCtx.Provider, { value: { models: [], refresh: async () => {}, openDrawer() {}, threads: [], role, locked: [] } as never }, c) });
const doc: Up = { tmp: 'd', name: 'Korvex_нагрузка_команды.xlsx', size: 6144, status: 'ready', chip: { id: 'x1', name: 'Korvex_нагрузка_команды.xlsx', size: 6144, tokens: 2048 } as never };
const img: Up = { tmp: 'i', name: 'IMG_2041.png', size: 4096, status: 'ready', img: true, preview: 'blob:x', chip: { id: 'x2', name: 'IMG_2041.png', size: 4096 } as never };

describe('вложения внутри поля (в)', () => {
  it('тон по расширению', () => {
    expect(['a.xlsx', 'b.csv', 'c.pdf', 'd.docx', 'e.pptx', 'f.md'].map(fileTone)).toEqual(['sheet', 'sheet', 'pdf', 'doc', 'slides', 'text']);
  });
  it('документ — плитка с меткой XLSX, имя и размер; картинка — миниатюра; ✕ убирает своё; токенов в тексте нет', () => {
    const onRemove = vi.fn();
    const r = render(wrap('user', createElement(UpRow, { items: [img, doc], onRemove, view: 'c' })));
    const tiles = r.container.querySelectorAll<HTMLElement>('[data-testid=up-chip]');
    expect(tiles[0].className).toContain('ft--img');
    expect(tiles[1].querySelector('.ft-type')!.textContent).toBe('XLSX');
    expect(tiles[1].querySelector('.ft-type')!.getAttribute('data-tone')).toBe('sheet');
    expect(tiles[1].querySelector('small')!.textContent).toBe('6 КБ');
    expect(r.container.textContent).not.toMatch(/ток/);
    expect(tiles[1].title).not.toMatch(/ток/);
    fireEvent.click(tiles[1].querySelector('[data-testid=up-remove]')!);
    expect(onRemove).toHaveBeenCalledWith(doc);
  });
  it('админу и «Альфе» — токены в подсказке при наведении', () => {
    const r = render(wrap('admin', createElement(UpRow, { items: [doc], onRemove: () => {}, view: 'c' })));
    expect(r.container.querySelector<HTMLElement>('[data-testid=up-chip]')!.title).toMatch(/ток/);
  });
});
