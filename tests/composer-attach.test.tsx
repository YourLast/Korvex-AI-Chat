// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Composer } from '@/components/Composer';
import { FILE_UI, UpRow, viewSrc, type Up } from '@/components/UpRow';
import type { FileChip } from '@/lib/types';
FILE_UI.view = 0;

const viewer = vi.hoisted(() => ({ thumbClick: vi.fn(), openDoc: vi.fn() }));
vi.mock('@/components/iv', async (orig) => ({ ...(await orig<typeof import('@/components/iv')>()), openDoc: viewer.openDoc }));
vi.mock('@/components/OutImage', async (orig) => ({ ...(await orig<typeof import('@/components/OutImage')>()), thumbClick: viewer.thumbClick }));
vi.mock('@/lib/imgprep', () => ({ prepImage: async (f: File) => ({ blob: f as Blob, w: 1200, h: 1600, name: f.name }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

let blobN = 0;
const revoked: string[] = [];
type Reply = { ok: boolean; status: number; body: Record<string, unknown> };
let reply: (name: string) => Promise<Reply> | Reply;
beforeEach(() => {
  blobN = 0; revoked.length = 0; viewer.thumbClick.mockClear(); viewer.openDoc.mockClear();
  URL.createObjectURL = () => `blob:test-${++blobN}`;
  URL.revokeObjectURL = (u: string) => { revoked.push(u); };
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  let n = 0;
  reply = (name) => ({ ok: true, status: 200, body: { id: `f-${++n}`, name, size: 4096, mime: /\.(jpe?g|png)$/.test(name) ? 'image/jpeg' : 'application/pdf' } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const f = (init?.body as FormData).get('file') as File;
    const r = await reply(f.name);
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const photo = (n: string) => new File([new Uint8Array(2048)], n, { type: 'image/jpeg' });
const pdf = (n: string) => new File(['%PDF'], n, { type: 'application/pdf' });
const mount = () => render(createElement(Composer, { busy: false, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSend: () => true }));
const attach = async (...fs: File[]) => { await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: fs } }); }); };
const chipsOf = () => screen.queryAllByTestId('up-chip') as HTMLElement[];
const names = () => chipsOf().map((c) => c.dataset.name);

describe('вложения у поля ввода: ряд миниатюр и чипов', () => {
  it('две картинки и документ — один ряд: миниатюры (up-img) и чип (up-doc), ряд — группа «Вложения»', async () => {
    mount();
    await attach(photo('IMG_0926.jpg'), photo('IMG_0927.jpg'), pdf('отчёт.pdf'));
    await waitFor(() => expect(chipsOf().every((c) => c.dataset.status === 'ready')).toBe(true));
    expect(names()).toEqual(['IMG_0926.jpg', 'IMG_0927.jpg', 'отчёт.pdf']);
    expect(chipsOf().map((c) => c.classList.contains('up-img'))).toEqual([true, true, false]);
    expect(document.querySelectorAll('.up-row').length).toBe(1);
    const row = screen.getByTestId('up-row');
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe('Вложения');
    expect(row.hasAttribute('data-iv-scope')).toBe(true);
    expect(chipsOf().every((c) => c.parentElement === row)).toBe(true);
    const doc = chipsOf()[2];
    expect(doc.querySelector('.ficon')).toBeTruthy();
    expect(doc.querySelector('b')!.textContent).toBe('отчёт.pdf');
    expect(doc.querySelector('small')!.textContent).toBe('4 Б');
    const open = chipsOf()[0].querySelector('button.up-open')!;
    expect(open.getAttribute('aria-label')).toBe('Открыть картинку «IMG_0926.jpg»');
    expect(open.getAttribute('title')).toContain('IMG_0926.jpg');
    expect(chipsOf()[0].querySelector('img.up-thumb')!.getAttribute('src')).toBe('blob:test-1');
  });

  it('просмотр: до конца загрузки — локальная копия, после — файл с сервера; нажатие зовёт просмотрщик', async () => {
    let finish!: (r: Reply) => void;
    reply = () => new Promise<Reply>((r) => { finish = r; });
    mount();
    await attach(photo('IMG_1.jpg'));
    await waitFor(() => expect(chipsOf()[0].dataset.status).toBe('uploading'));
    let open = chipsOf()[0].querySelector<HTMLElement>('[data-iv]')!;
    expect(open.dataset.ivSrc).toBe('blob:test-1');
    expect(open.dataset.ivName).toBe('IMG_1.jpg');
    expect(open.dataset.ivW).toBe('1200');
    expect(open.dataset.ivH).toBe('1600');
    expect(screen.getByTestId('up-state').querySelector('.up-spin')).toBeTruthy();
    fireEvent.click(open);
    expect(viewer.thumbClick).toHaveBeenCalledTimes(1);
    expect(viewer.thumbClick.mock.calls[0][1]).toBe('blob:test-1');
    await act(async () => { finish({ ok: true, status: 200, body: { id: 'f-77', name: 'IMG_1.jpg', size: 2048, mime: 'image/jpeg' } }); });
    await waitFor(() => expect(chipsOf()[0].dataset.status).toBe('ready'));
    open = chipsOf()[0].querySelector<HTMLElement>('[data-iv]')!;
    expect(open.dataset.ivSrc).toBe('/api/files/f-77');
    expect(screen.queryByTestId('up-state')).toBeNull();
  });

  it('ошибка загрузки: значок поверх миниатюры и строка с причиной под рядом; крестик убирает', async () => {
    reply = () => ({ ok: false, status: 413, body: { error: 'Файл слишком большой' } });
    mount();
    await attach(photo('большая.jpg'));
    await waitFor(() => expect(chipsOf()[0].dataset.status).toBe('error'));
    expect(chipsOf()[0].classList.contains('is-err')).toBe(true);
    expect(screen.getByTestId('up-state').classList.contains('is-err')).toBe(true);
    const note = screen.getByTestId('up-err');
    expect(note.textContent).toContain('большая.jpg');
    expect(note.textContent).toContain('Файл слишком большой');
    expect(note.getAttribute('role')).toBe('alert');
    expect(chipsOf()[0].querySelector<HTMLElement>('[data-iv]')!.dataset.ivSrc).toBe('blob:test-1');
    fireEvent.click(screen.getByTestId('up-remove'));
    expect(chipsOf()).toEqual([]);
    expect(screen.queryByTestId('up-err')).toBeNull();
    expect(document.querySelector('.up-row')).toBeNull();
    expect(revoked).toEqual(['blob:test-1']);
  });

  it('картинка, которую не удалось подготовить (нет локальной копии): просматривать нечего — кнопка выключена, значок ошибки', () => {
    const u: Up = { tmp: 'x', name: 'битая.png', size: 10, status: 'error', error: 'Формат не поддерживается', img: true };
    render(createElement(UpRow, { items: [u], admin: false, onRemove: () => {} }));
    const open = chipsOf()[0].querySelector<HTMLButtonElement>('button.up-open')!;
    expect(open.disabled).toBe(true);
    expect(open.hasAttribute('data-iv')).toBe(false);
    expect(chipsOf()[0].querySelector('.up-ph')).toBeTruthy();
    expect(screen.getByTestId('up-state').classList.contains('is-err')).toBe(true);
  });

  it('крестик: у каждой миниатюры свой, с именем файла; убирает ровно одно вложение', async () => {
    mount();
    await attach(photo('a.jpg'), photo('b.jpg'), pdf('c.pdf'));
    await waitFor(() => expect(chipsOf().every((c) => c.dataset.status === 'ready')).toBe(true));
    const xs = screen.getAllByTestId('up-remove');
    expect(xs.map((x) => x.getAttribute('aria-label'))).toEqual(['Убрать «a.jpg»', 'Убрать «b.jpg»', 'Убрать «c.pdf»']);
    expect(xs[0].closest('button.up-open')).toBeNull();
    expect(xs[0].classList.contains('up-x')).toBe(true);
    fireEvent.click(xs[1]);
    expect(names()).toEqual(['a.jpg', 'c.pdf']);
    expect(viewer.thumbClick).not.toHaveBeenCalled();
    expect(revoked).toEqual(['blob:test-2']);
    fireEvent.click(screen.getAllByTestId('up-remove')[1]);
    expect(names()).toEqual(['a.jpg']);
  });

  it('документ: презентация/документ/PDF после загрузки открываются просмотром страниц (openDoc), таблицы и текст — боковой панелью «Файл»', async () => {
    mount();
    await attach(pdf('отчёт.pdf'), pdf('таблица.xlsx'));
    await waitFor(() => expect(chipsOf().every((c) => c.dataset.status === 'ready')).toBe(true));
    const [a, b] = chipsOf();
    const open = a.querySelector<HTMLButtonElement>('[data-testid=up-doc-open]')!;
    expect(open.getAttribute('aria-label')).toBe('Открыть «отчёт.pdf»');
    fireEvent.click(open);
    expect(viewer.openDoc).toHaveBeenCalledTimes(1);
    expect(viewer.openDoc.mock.calls[0][0]).toEqual({ href: '/api/files/f-1', name: 'отчёт.pdf', kind: 'pages' });
    expect(viewer.openDoc.mock.calls[0][1]).toBe(open);
    const grid = b.querySelector<HTMLButtonElement>('[data-testid=up-doc-open]')!;
    expect(grid.getAttribute('aria-label')).toBe('Открыть «таблица.xlsx»');
    fireEvent.click(grid);
    expect(viewer.openDoc).toHaveBeenCalledTimes(1);
    const { getFileView, closeFile } = await import('@/lib/fileView');
    expect(getFileView().target).toMatchObject({ id: 'f-2', name: 'таблица.xlsx' });
    closeFile();
    expect(b.querySelector('small')!.textContent).toBe('4 Б');
  });

  it('документ грузится: «читаю файл…» в чипе, просмотр недоступен; ошибка — текст причины в чипе', async () => {
    let finish!: (r: Reply) => void;
    reply = () => new Promise<Reply>((r) => { finish = r; });
    mount();
    await attach(pdf('скан.pdf'));
    await waitFor(() => expect(chipsOf()[0].dataset.status).toBe('uploading'));
    expect(chipsOf()[0].textContent).toContain('читаю файл…');
    expect(chipsOf()[0].querySelector('[data-testid=up-doc-open]')).toBeNull();
    await act(async () => { finish({ ok: false, status: 422, body: { error: 'Текст не распознан' } }); });
    await waitFor(() => expect(chipsOf()[0].dataset.status).toBe('error'));
    expect(chipsOf()[0].classList.contains('is-err')).toBe(true);
    expect(chipsOf()[0].querySelector('small')!.textContent).toContain('Текст не распознан');
    expect(screen.queryByTestId('up-err')).toBeNull();
  });

  it('новое вложение — ряд прокручен к нему', async () => {
    mount();
    const row = () => screen.getByTestId('up-row');
    await attach(photo('a.jpg'));
    await waitFor(() => expect(chipsOf().length).toBe(1));
    Object.defineProperty(row(), 'scrollWidth', { configurable: true, value: 900 });
    row().scrollLeft = 0;
    await attach(photo('b.jpg'));
    await waitFor(() => expect(chipsOf().length).toBe(2));
    expect(row().scrollLeft).toBe(900);
  });
});

describe('прокрутка ряда', () => {
  it('сразу несколько вложений (вход в правку) — ряд с начала, а не с конца', () => {
    const items: Up[] = ['a', 'b', 'c'].map((n) => ({ tmp: n, name: n + '.png', size: 1, status: 'ready' as const, img: true, preview: 'blob:' + n }));
    const { rerender } = render(createElement(UpRow, { items: [], admin: false, onRemove: () => {} }));
    rerender(createElement(UpRow, { items, admin: false, onRemove: () => {} }));
    expect(screen.getByTestId('up-row').scrollLeft).toBe(0);
  });
});

describe('viewSrc', () => {
  const chip: FileChip = { id: 'f9', name: 'x.png', size: 1, mime: 'image/png' };
  it('загруженная — файл сервера; грузится/ошибка — локальная копия; ни того ни другого — нет', () => {
    const base: Up = { tmp: 't', name: 'x.png', size: 1, status: 'ready', img: true };
    expect(viewSrc({ ...base, chip, preview: 'blob:1' })).toBe('/api/files/f9');
    expect(viewSrc({ ...base, status: 'uploading', preview: 'blob:1' })).toBe('blob:1');
    expect(viewSrc({ ...base, status: 'error', preview: 'blob:1' })).toBe('blob:1');
    expect(viewSrc({ ...base, status: 'error' })).toBeUndefined();
    expect(viewSrc({ ...base, status: 'uploading', preview: '/api/files/f9?w=480' })).toBeUndefined();
  });
});
