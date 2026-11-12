// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { Markdown } from '@/components/Markdown';
import { _test, needsShare, saveFile, typeOf } from '@/lib/fileSave';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const T1 = 'c'.repeat(32);
const HREF = `/out/${T1}/Kursy.pptx`;

const setNav = (ua: string, standalone: boolean, share?: (d: ShareData) => Promise<void>, canShare?: (d: ShareData) => boolean) => {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
};

beforeEach(() => {
  _test.reset();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('сохранение файла из ответа', () => {
  it('лист нужен только на iPhone в приложении с экрана «Домой»', () => {
    setNav(IPHONE, true); expect(needsShare()).toBe(true);
    setNav(IPHONE, false); expect(needsShare()).toBe(false);
    setNav(DESK, false); expect(needsShare()).toBe(false);
  });
  it('тип по расширению, если сервер не прислал', () => {
    expect(typeOf('a.pptx', '')).toContain('presentationml');
    expect(typeOf('a.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(typeOf('a.bin', '')).toBe('application/octet-stream');
    expect(typeOf('a.pptx', 'text/plain')).toBe('text/plain');
  });
  it('iPhone в приложении: navigator.share с самим файлом (имя и тип pptx)', async () => {
    const share = vi.fn(async () => {});
    setNav(IPHONE, true, share, () => true);
    const o = await saveFile(HREF, 'Kursy.pptx');
    expect(o.kind).toBe('shared');
    const f = (share.mock.calls[0] as unknown as [ShareData])[0].files![0];
    expect(f.name).toBe('Kursy.pptx');
    expect(f.type).toContain('presentationml');
  });
  it('лист не открылся из-за паузы — «Нажмите ещё раз», файл уже в кэше', async () => {
    setNav(IPHONE, true, vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }), () => true);
    const o = await saveFile(HREF, 'Kursy.pptx');
    expect(o.kind).toBe('retry');
    expect(o.note).toBe('Нажмите ещё раз — файл готов');
  });
  it('поделиться файлом нельзя — ссылка в отдельном окне (там есть «Готово»), не переход в самом приложении', async () => {
    setNav(IPHONE, true, undefined, undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const o = await saveFile(HREF, 'Kursy.pptx');
    expect(o.kind).toBe('link');
    expect(open).toHaveBeenCalledWith(HREF, '_blank', 'noopener');
  });
  it('карточка файла: на iPhone в приложении «Скачать» не уходит по ссылке; на компьютере — обычная ссылка download', () => {
    setNav(IPHONE, true, vi.fn(async () => {}), () => true);
    const { container } = render(createElement(Markdown, { text: `📎 [Kursy.pptx](${HREF}) (85 KB)` }));
    expect(container.querySelector('[data-testid=file-open]')!.tagName).toBe('BUTTON');
    const a = container.querySelector('[data-testid=file-dl]') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(HREF);
    expect(a.hasAttribute('download')).toBe(true);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    cleanup();
    setNav(DESK, false);
    const r2 = render(createElement(Markdown, { text: `📎 [Kursy.pptx](${HREF}) (85 KB)` }));
    const a2 = r2.container.querySelector('[data-testid=file-dl]') as HTMLAnchorElement;
    const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    a2.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });
  it('таблица (просмотра нет) — вся карточка по-прежнему ссылка-скачивание; на iPhone в приложении — лист', () => {
    setNav(IPHONE, true, vi.fn(async () => {}), () => true);
    const X = `/out/${T1}/wells.xlsx`;
    const { container } = render(createElement(Markdown, { text: `📎 [wells.xlsx](${X}) (2 KB)` }));
    const a = container.querySelector('[data-testid=file-card]') as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe(X);
    expect(a.hasAttribute('download')).toBe(true);
    expect(container.querySelector('[data-testid=file-open]')).toBeNull();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
