// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@/components/Markdown';
import { ImageViewerHost, galleryOf } from '@/components/ImageViewer';
import { _test, saveImage, shareImage } from '@/lib/imageActions';

const T1 = 'a'.repeat(32), T2 = 'b'.repeat(32);
const ANSWER = `Готово:\n\n📎 [chart-1.png](/out/${T1}/chart-1.png) (12 KB)\n\n📎 [chart-2.png](/out/${T2}/chart-2.png) (9 KB)`;

beforeEach(() => {
  _test.reset();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } })) as unknown as typeof fetch;
  if (!window.requestAnimationFrame || (window.requestAnimationFrame as { _fake?: boolean })._fake === undefined) {
    const raf = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame & { _fake?: boolean };
    raf._fake = true;
    window.requestAnimationFrame = raf; globalThis.requestAnimationFrame = raf;
    window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof cancelAnimationFrame; globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  }
  if (!(globalThis as { CSS?: unknown }).CSS) (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/"/g, '\\"') };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('миниатюры', () => {
  it('картинка модели — кнопка с data-iv, курсор увеличения, подпись и «Скачать»; без перехода по ссылке', () => {
    const h = renderToStaticMarkup(createElement(Markdown, { text: ANSWER }));
    expect(h).toContain(`data-iv-src="/out/${T1}/chart-1.png"`);
    expect(h).toContain('class="md-fig-img iv-thumb"');
    expect(h).toContain('aria-label="Открыть картинку «chart-1.png»"');
    expect(h).not.toContain('target="_blank"');
    expect(h).toContain('Скачать');
  });
  it('картинка markdown без подписи — имя из адреса', () => {
    const h = renderToStaticMarkup(createElement(Markdown, { text: `![](/out/${T1}/%D1%81%D1%85%D0%B5%D0%BC%D0%B0.png)` }));
    expect(h).toContain('data-iv-name="схема.png"');
  });
});

describe('окно просмотра', () => {
  it('нажатие открывает окно: имя, «1 из 2», «Поделиться» и «Скачать»; → листает; Esc закрывает и возвращает фокус', async () => {
    const r = render(createElement('div', { className: 'thread' }, createElement(Markdown, { text: ANSWER }), createElement(ImageViewerHost)));
    const thumbs = r.container.querySelectorAll<HTMLButtonElement>('[data-iv]');
    expect(thumbs).toHaveLength(2);
    for (const t of thumbs) t.getClientRects = () => [{}] as unknown as DOMRectList;
    expect(galleryOf(thumbs[1]).index).toBe(1);
    await act(async () => { fireEvent.click(thumbs[0]); });
    const dlg = document.querySelector('[data-testid=iv]')!;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('[data-testid=iv-name]')!.textContent).toContain('chart-1.png');
    expect(document.querySelector('[data-testid=iv-count]')!.textContent).toBe('1 из 2');
    expect(document.querySelector('[data-testid=iv-share]')!.textContent).toBe('Поделиться');
    expect(document.querySelector('[data-testid=iv-save]')!.textContent).toBe('Скачать');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('iv-close');
    expect(thumbs[0].style.visibility).toBe('hidden');
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); await new Promise((ok) => setTimeout(ok, 350)); });
    expect(document.querySelector('[data-testid=iv-count]')!.textContent).toBe('2 из 2');
    expect(document.querySelector('[data-testid=iv-name]')!.textContent).toContain('chart-2.png');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); await new Promise((ok) => setTimeout(ok, 400)); });
    expect(document.querySelector('[data-testid=iv]')).toBeNull();
    expect(thumbs[1].style.visibility).toBe('');
    expect(document.activeElement).toBe(thumbs[1]);
  });
});

describe('поделиться и скачать', () => {
  const img = { src: `/out/${T1}/chart-1.png`, name: 'chart-1.png' };
  const setNav = (ua: string, share?: (d: ShareData) => Promise<void>, canShare?: (d: ShareData) => boolean) => {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
  };
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  it('«Поделиться»: сам файл (File с именем и типом) в navigator.share', async () => {
    const share = vi.fn(async () => {});
    setNav(IPHONE, share, (d) => !!d.files?.length);
    const o = await shareImage(img);
    expect(o).toMatchObject({ ok: true, kind: 'shared', note: null });
    const files = (share.mock.calls[0] as unknown as [ShareData])[0].files!;
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe('chart-1.png');
    expect(files[0].type).toBe('image/png');
  });
  it('«Поделиться» отменили — тихо; файл поделить нельзя — ссылкой; нет листа — ссылка в буфер с честной подписью', async () => {
    setNav(IPHONE, vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }), () => true);
    expect(await shareImage(img)).toMatchObject({ ok: true, kind: 'cancelled', note: null });
    const share = vi.fn(async () => {});
    setNav('Mozilla/5.0 (X11; Linux x86_64) Chrome/140', share, () => false);
    expect(await shareImage(img)).toMatchObject({ kind: 'link' });
    expect((share.mock.calls[0] as unknown as [ShareData])[0].url).toBe(`http://localhost:3000${img.src}`.replace('http://localhost:3000', window.location.origin));
    setNav('Mozilla/5.0 (X11; Linux x86_64) Chrome/140', undefined, undefined);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await shareImage(img)).toMatchObject({ kind: 'link', note: 'Ссылка скопирована. Откроется только в вашем аккаунте' });
  });
  it('«Скачать» на iPhone — лист «Поделиться» с файлом; на компьютере — файл с именем, подпись «Загрузка началась»', async () => {
    const share = vi.fn(async () => {});
    setNav(IPHONE, share, () => true);
    expect(await saveImage(img)).toMatchObject({ kind: 'shared' });
    expect(share).toHaveBeenCalledTimes(1);
    setNav('Mozilla/5.0 (X11; Linux x86_64) Chrome/140', undefined, undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clicks: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push({ download: this.download, href: this.href }); });
    const o = await saveImage(img);
    expect(o).toMatchObject({ ok: true, kind: 'downloaded', note: 'Загрузка началась: chart-1.png' });
    expect(clicks).toEqual([{ download: 'chart-1.png', href: 'blob:x' }]);
  });
  it('файл недоступен (404) — «Не удалось получить файл», без «скачано»', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    setNav('Mozilla/5.0 (X11; Linux x86_64) Chrome/140', undefined, undefined);
    const o = await saveImage(img);
    expect(o.ok).toBe(false);
    expect(o.note).toMatch(/Не удалось получить файл/);
  });
});
