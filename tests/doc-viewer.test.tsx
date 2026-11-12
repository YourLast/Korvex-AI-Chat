// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';
import { ImageViewerHost, docItems } from '@/components/ImageViewer';
import { previewKind } from '@/lib/previewKind';

const T1 = 'd'.repeat(32);
const HREF = `/out/${T1}/Obzor.pptx`;
const READY = { kind: 'slides', state: 'ready', v: 'abcdef0123456789', total: 3, pages: [[1600, 900], [1600, 900], [1600, 900]] };
let coarseMq = false;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

beforeEach(() => {
  coarseMq = false;
  window.matchMedia = ((q: string) => ({ matches: q.includes('coarse') ? coarseMq : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  const raf = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame;
  window.requestAnimationFrame = raf; globalThis.requestAnimationFrame = raf;
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof cancelAnimationFrame; globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  if (!(globalThis as { CSS?: unknown }).CSS) (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
  Element.prototype.scrollIntoView ??= function () {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount() {
  const r = render(createElement('div', { className: 'thread' }, createElement(Markdown, { text: `📎 [Obzor.pptx](${HREF}) (85 KB)` }), createElement(ImageViewerHost)));
  return { r, open: r.container.querySelector<HTMLButtonElement>('[data-testid=file-open]')! };
}
const q = (sel: string) => document.querySelector(sel);
const text = (sel: string) => q(sel)?.textContent ?? null;

describe('какие файлы смотрим на сайте', () => {
  it('презентации — слайдами, документы и PDF — страницами, таблицы и прочее — нет', () => {
    expect(['a.pptx', 'b.PPT', 'c.odp'].map(previewKind)).toEqual(['slides', 'slides', 'slides']);
    expect(['a.docx', 'b.pdf', 'c.rtf', 'd.odt'].map(previewKind)).toEqual(['pages', 'pages', 'pages', 'pages']);
    expect(['a.xlsx', 'b.csv', 'c.zip', 'd.png', 'pptx'].map(previewKind)).toEqual([null, null, null, null, null]);
  });
  it('адреса страниц: телефон — 1080 (увеличение — 1600), компьютер — 1600, миниатюры — 320; v в адресе', () => {
    const [p] = docItems(HREF, 'Obzor.pptx', { v: 'v1', pages: [[1600, 900]] }, true);
    expect(p).toMatchObject({ src: `${HREF}?preview=1&page=1&w=1080&v=v1`, hi: `${HREF}?preview=1&page=1&w=1600&v=v1`, thumb: `${HREF}?preview=1&page=1&w=320&v=v1`, nw: 1600, nh: 900, fixed: true });
    expect(docItems(HREF, 'x', { v: 'v1', pages: [[1600, 900]] }, false)[0]).toMatchObject({ src: `${HREF}?preview=1&page=1&w=1600&v=v1`, hi: undefined });
  });
});

describe('просмотр документа', () => {
  it('компьютер: «Готовлю просмотр…» -> слайды, «1 / 3», миниатюры, стрелки, End, миниатюра, Esc -> фокус на карточке', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async (u: string) => {
      expect(u).toBe(`${HREF}?preview=1&wait=15000`);
      n++;
      if (n === 1) { await sleep(60); return new Response(JSON.stringify({ kind: 'slides', state: 'pending' })); }
      return new Response(JSON.stringify(READY));
    }) as unknown as typeof fetch;
    const { open } = mount();
    await act(async () => { open.focus(); fireEvent.click(open); await sleep(20); });
    expect(q('[data-testid=iv]')!.getAttribute('aria-label')).toBe('Просмотр «Obzor.pptx»');
    expect(text('[data-testid=iv-doc-state]')).toContain('Готовлю просмотр…');
    expect(text('[data-testid=iv-name]')).toBe('Obzor.pptx');
    expect(q('[data-testid=iv-count]')).toBeNull();
    expect(q('[data-testid=iv-dl]')!.getAttribute('href')).toBe(HREF);
    await act(async () => { await sleep(600); });
    expect(n).toBe(2);
    expect(q('[data-testid=iv-doc-state]')).toBeNull();
    expect(text('[data-testid=iv-count]')).toBe('1 / 3');
    expect((q('[data-testid=iv-img]') as HTMLImageElement).getAttribute('src')).toBe(`${HREF}?preview=1&page=1&w=1600&v=abcdef0123456789`);
    expect((q('[data-testid=iv-img]') as HTMLImageElement).alt).toBe('Слайд 1');
    const th = document.querySelectorAll<HTMLButtonElement>('[data-testid=iv-th]');
    expect(th).toHaveLength(3);
    expect(th[0].getAttribute('aria-current')).toBe('true');
    expect(th[2].querySelector('img')!.getAttribute('src')).toBe(`${HREF}?preview=1&page=3&w=320&v=abcdef0123456789`);
    expect(q('[data-testid=iv-bot]')).toBeNull();
    expect(q('[data-testid=iv-share]')).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); await sleep(350); });
    expect(text('[data-testid=iv-count]')).toBe('2 / 3');
    await act(async () => { fireEvent.keyDown(window, { key: 'End' }); await sleep(50); });
    expect(text('[data-testid=iv-count]')).toBe('3 / 3');
    expect((q('[data-testid=iv-next]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(document.querySelectorAll('[data-testid=iv-th]')[0]); await sleep(50); });
    expect(text('[data-testid=iv-count]')).toBe('1 / 3');
    expect(document.querySelectorAll('[data-testid=iv-th]')[0].getAttribute('aria-current')).toBe('true');
    await act(async () => { fireEvent.keyDown(window, { key: 'PageDown' }); await sleep(350); });
    expect(text('[data-testid=iv-count]')).toBe('2 / 3');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); await sleep(400); });
    expect(q('[data-testid=iv]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('ошибка конвертации: понятная строка и «Скачать» (ссылка на сам файл)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ kind: 'slides', state: 'error', code: 'convert' }))) as unknown as typeof fetch;
    const { open } = mount();
    await act(async () => { fireEvent.click(open); await sleep(80); });
    expect(text('[data-testid=iv-doc-state]')).toContain('Не получилось показать файл здесь. Скачайте его, чтобы открыть.');
    const dl = q('[data-testid=iv-doc-dl]') as HTMLAnchorElement;
    expect(dl.getAttribute('href')).toBe(HREF);
    expect(dl.hasAttribute('download')).toBe(true);
    expect(q('[data-testid=iv-doc-state]')!.getAttribute('role')).toBe('alert');
  });

  it('чужой или удалённый файл (404) — «Файл недоступен»; слишком большой — свой текст', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })) as unknown as typeof fetch;
    const { open } = mount();
    await act(async () => { fireEvent.click(open); await sleep(80); });
    expect(text('[data-testid=iv-doc-state]')).toContain('Файл недоступен.');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); await sleep(400); });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ kind: 'slides', state: 'error', code: 'too-big' }))) as unknown as typeof fetch;
    await act(async () => { fireEvent.click(open); await sleep(80); });
    expect(text('[data-testid=iv-doc-state]')).toContain('слишком большой');
  });

  it('телефон: без полоски миниатюр, страница 1080 px, «Скачать» — значком в строке названия', async () => {
    coarseMq = true;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(READY))) as unknown as typeof fetch;
    const { open } = mount();
    await act(async () => { fireEvent.click(open); await sleep(80); });
    expect(text('[data-testid=iv-count]')).toBe('1 / 3');
    expect(q('[data-testid=iv-strip]')).toBeNull();
    expect((q('[data-testid=iv-img]') as HTMLImageElement).getAttribute('src')).toContain('w=1080');
    const dl = q('[data-testid=iv-dl]') as HTMLAnchorElement;
    expect(dl.getAttribute('aria-label')).toBe('Скачать');
    expect(dl.textContent).toBe('');
    expect(q('[data-testid=iv]')!.getAttribute('data-desk')).toBe('0');
  });
});
