// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import fs from 'node:fs';
import { Markdown } from '@/components/Markdown';
import { SrcCtx } from '@/components/SrcChip';
import { setChatFiles } from '@/lib/fileView';

afterEach(() => { cleanup(); setChatFiles([]); });

const TABLE = '| Пункт | Цитата | Сумма |\n|---|---|---|\n| 3.2 | «Исполнитель вправе…» | 150 000 |\n| 4.2 | «Если Заказчик…» | 3 |\n';

describe('таблица в ответе', () => {
  it('разметка: фигура .tbl.md-tbl с обёрткой прокрутки; числовой столбец помечен .n (в заголовке тоже), текстовый — нет', () => {
    const { container } = render(createElement(Markdown, { text: TABLE }));
    const fig = container.querySelector('figure.tbl.md-tbl')!;
    expect(fig).toBeTruthy();
    expect(fig.querySelector('.md-tbl-scroll > table')).toBeTruthy();
    const ths = [...fig.querySelectorAll('th')].map((t) => t.className);
    expect(ths).toEqual(['', '', 'n']);
    expect([...fig.querySelectorAll('tbody tr:first-child td')].map((t) => t.className)).toEqual(['', '', 'n']);
  });

  it('затухание краёв: нечего прокручивать — ни одного атрибута; можно вправо — data-r; в середине — оба; у правого края — data-l', () => {
    const proto = HTMLElement.prototype;
    const st = { sl: 0, cw: 300, sw: 300 };
    const d = (name: string, get: () => number, set?: (v: number) => void) => Object.defineProperty(proto, name, { configurable: true, get() { return /md-tbl-scroll/.test(this.className) ? get() : 0; }, ...(set ? { set(v: number) { if (/md-tbl-scroll/.test(this.className)) set(v); } } : {}) });
    d('scrollLeft', () => st.sl, (v) => { st.sl = v; }); d('clientWidth', () => st.cw); d('scrollWidth', () => st.sw);
    try {
      const { container, unmount } = render(createElement(Markdown, { text: TABLE }));
      const box = () => container.querySelector<HTMLElement>('.md-tbl-scroll')!;
      expect(box().hasAttribute('data-l') || box().hasAttribute('data-r')).toBe(false);
      unmount();
      st.sw = 900;
      const r2 = render(createElement(Markdown, { text: TABLE }));
      const b2 = () => r2.container.querySelector<HTMLElement>('.md-tbl-scroll')!;
      expect(b2().hasAttribute('data-r')).toBe(true); expect(b2().hasAttribute('data-l')).toBe(false);
      act(() => { st.sl = 200; fireEvent.scroll(b2()); });
      expect(b2().hasAttribute('data-r')).toBe(true); expect(b2().hasAttribute('data-l')).toBe(true);
      act(() => { st.sl = 600; fireEvent.scroll(b2()); });
      expect(b2().hasAttribute('data-r')).toBe(false); expect(b2().hasAttribute('data-l')).toBe(true);
    } finally {
      for (const n of ['scrollLeft', 'clientWidth', 'scrollWidth']) delete (proto as unknown as Record<string, unknown>)[n];
    }
  });

  it('чип источника лежит в ячейке таблицы рядом с текстом, одной кнопкой', () => {
    setChatFiles([{ id: 'f1', name: 'Договор.pdf', size: 1 }]);
    const raw = '[[src:Договор.pdf\\|стр. 1\\|"Исполнитель вправе в одностороннем порядке"]]';
    const t = `| Пункт | Источник |\n|---|---|\n| 3.2 | ${raw} |\n`;
    const { container } = render(createElement(SrcCtx.Provider, { value: { sources: [{ raw, file: 'Договор.pdf', kind: 'page', page: 1, quote: 'Исполнитель вправе в одностороннем порядке', verified: true }], live: false } }, createElement(Markdown, { text: t })));
    const td = container.querySelectorAll('tbody td')[1]!;
    expect(td.querySelectorAll('button[data-testid=src-chip]').length).toBe(1);
  });

  it('стили: без карточки (рамка, радиус, тень, фон), заголовок — одна линия плотнее строчных, строки — волосяные линии без вертикальных, отступы 8 / 12, первый столбец без левого отступа', () => {
    const css = fs.readFileSync(`${__dirname}/../src/styles/app.css`, 'utf8');
    const rule = (sel: string) => (new RegExp(`^${sel.replace(/[.[\]()*+?]/g, '\\$&')} \\{[^}]*\\}`, 'm').exec(css)?.[0] ?? '');
    const fig = rule('.tbl.md-tbl');
    expect(fig).toContain('border: 0'); expect(fig).toContain('border-radius: 0'); expect(fig).toContain('background: none'); expect(fig).toContain('box-shadow: none');
    const cell = rule('.tbl.md-tbl th, .tbl.md-tbl td');
    expect(cell).toContain('padding: 8px 12px'); expect(cell).toContain('border: 0'); expect(cell).toContain('white-space: normal');
    expect(rule('.tbl.md-tbl th:first-child, .tbl.md-tbl td:first-child')).toContain('padding-left: 0');
    expect(rule('.tbl.md-tbl th')).toContain('border-bottom: 1px solid var(--line-3)');
    expect(rule('.tbl.md-tbl tbody tr + tr td')).toContain('border-top: 1px solid var(--line-1)');
    expect(css).not.toMatch(/\.tbl\.md-tbl[^{]*\{[^}]*border-(left|right):/);
    expect(css).not.toMatch(/\.tbl\.md-tbl[^{]*nth-child\((odd|even|2n)/);
    expect(rule('.tbl.md-tbl th.n, .tbl.md-tbl td.n')).toContain('text-align: right');
    expect(rule('.md-tbl-scroll')).toContain('overflow-x: auto');
    expect(css).toContain('.md-tbl-scroll[data-r] {');
  });

  it('ширина: по колонке чата, столбцы переносят текст; при прокрутке вбок первый столбец закреплён', () => {
    const css = fs.readFileSync(`${__dirname}/../src/styles/app.css`, 'utf8');
    const rule = (sel: string) => (new RegExp(`^${sel.replace(/[.[\]()*+?:]/g, '\\$&')} \\{[^}]*\\}`, 'm').exec(css)?.[0] ?? '');
    const table = rule('.tbl.md-tbl table');
    expect(table).toContain('width: 100%');
    expect(table).not.toContain('max-content');
    const cell = rule('.tbl.md-tbl th, .tbl.md-tbl td');
    expect(cell).toContain('min-width: 10ch');
    expect(cell).not.toMatch(/max-width/);
    const sticky = rule('.md-tbl-scroll[data-l] :is(th, td):first-child');
    expect(sticky).toContain('position: sticky'); expect(sticky).toContain('left: 0'); expect(sticky).toContain('background: var(--bg)');
    expect(css).not.toMatch(/\.md-tbl-scroll\[data-l\][^{]*\{[^}]*mask-image/);
  });
});
