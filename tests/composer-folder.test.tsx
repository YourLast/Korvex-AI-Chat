// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Composer } from '@/components/Composer';
import type { FileChip } from '@/lib/types';

vi.mock('@/lib/imgprep', () => ({ prepImage: async (f: File) => ({ blob: f as Blob, w: 100, h: 100, name: f.name }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

type Call = { url: string; path?: string; staged?: string; n?: string; archive?: string };
let calls: Call[];
let failPaths: Set<string>;
let delay: number;
beforeEach(() => {
  calls = []; failPaths = new Set(); delay = 15;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  let id = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, delay));
    if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (url === '/api/files/archive') {
      calls.push({ url, archive: decodeURIComponent((init!.headers as Record<string, string>)['X-Filename']) });
      return new Response(JSON.stringify({ sid: 'sid-9', entries: [{ n: 1, path: 'Договоры/а.txt', size: 10 }, { n: 2, path: 'Договоры/б/б.txt', size: 20 }, { n: 3, path: 'Договоры/в.docx', size: 30 }], skipped: { total: 2, byReason: { junk: 1, link: 1 } } }));
    }
    const fd = init!.body as FormData;
    const path = (fd.get('path') as string | null) ?? undefined;
    calls.push({ url, path, staged: (fd.get('staged') as string | null) ?? undefined, n: (fd.get('n') as string | null) ?? undefined });
    if (path && failPaths.has(path)) return new Response(JSON.stringify({ error: `Файл «${path}» не прочитан: нет текста` }), { status: 422 });
    return new Response(JSON.stringify({ id: `id-${++id}`, name: path ?? (fd.get('file') as File | null)?.name ?? `staged-${fd.get('n')}`, size: 1 }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const f = (name: string, body: string) => new File([body], name.split('/').pop()!);
const fileEntry = (full: string, body = full) => ({ isFile: true, isDirectory: false, name: full.split('/').pop()!, fullPath: '/' + full, file: (ok: (x: File) => void) => ok(f(full, body)) });
const dirEntry = (full: string, kids: unknown[]) => { let used = false; return { isFile: false, isDirectory: true, name: full.split('/').pop()!, fullPath: '/' + full, createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => { ok(used ? [] : kids); used = true; } }) }; };
function drop(entries: unknown[]) {
  const dt = { types: ['Files'], items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e, getAsFile: () => null })), files: [] };
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  act(() => { window.dispatchEvent(ev); });
}
const mount = (onSend: (t: string, files: FileChip[]) => void = () => {}) => render(createElement(Composer, { busy: false, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onSend: (t, fs) => { onSend(t, fs); return true; }, modelId: 'alpha' }));

describe('папка перетаскиванием', () => {
  it('одна карточка вместо чипов на каждый файл: прогресс, мусор и дубли одной строкой, итог «N файлов · типы»', async () => {
    mount();
    const kids = [
      ...Array.from({ length: 40 }, (_, i) => fileEntry(`Акты/2026/акт_${i}.pdf`)),
      fileEntry('Акты/реестр.xlsx'), fileEntry('Акты/.DS_Store'), fileEntry('Акты/Thumbs.db'), fileEntry('Акты/~$реестр.xlsx'),
      { ...fileEntry('Акты/пусто.txt', ''), file: (ok: (x: File) => void) => ok(new File([], 'пусто.txt')) },
      fileEntry('Акты/копия_реестра.xlsx', 'Акты/реестр.xlsx'),
    ];
    drop([dirEntry('Акты', [dirEntry('Акты/2026', kids.slice(0, 40)), ...kids.slice(40)])]);
    await waitFor(() => expect(screen.getByTestId('upload-card')).toBeTruthy());
    expect(document.querySelectorAll('[data-testid=up-chip]').length).toBe(0);
    expect(screen.getByTestId('upload-card').textContent).toContain('Папка «Акты»');
    await waitFor(() => expect(screen.getByTestId('ucard-sub').textContent).toMatch(/\d+ из 4\d/));
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.phase).toBe('idle'), { timeout: 5000 });
    expect(screen.getByTestId('ucard-sub').textContent).toContain('41 файл');
    expect(screen.getByTestId('ucard-sub').textContent).toContain('2 типа');
    expect(screen.getByTestId('ucard-skipped').textContent).toBe('Пропущено 5: служебные файлы (3), пустые файлы (1), дубли (то же содержимое) (1)');
    expect(calls.length).toBe(41);
  });
  it('все пути имён — относительные («Акты/2026/акт_0.pdf»); одинаковые имена в разных подпапках не сливаются', async () => {
    mount();
    drop([dirEntry('Акты', [dirEntry('Акты/2025', [fileEntry('Акты/2025/акт.pdf', 'a')]), dirEntry('Акты/2026', [fileEntry('Акты/2026/акт.pdf', 'b')])])]);
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.phase).toBe('idle'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls.map((c) => c.path).sort()).toEqual(['Акты/2025/акт.pdf', 'Акты/2026/акт.pdf']);
  });
  it('ошибки по файлам: «Загружено N, не принято M» с причиной у файла и «Повторить»; повтор догружает только упавший', async () => {
    failPaths = new Set(['Акты/плохой.pdf']);
    mount();
    drop([dirEntry('Акты', [fileEntry('Акты/а.txt'), fileEntry('Акты/плохой.pdf'), fileEntry('Акты/б.txt')])]);
    await waitFor(() => expect(screen.getByTestId('ucard-result').textContent).toBe('Загружено 2, не принято 1'));
    fireEvent.click(screen.getByTestId('ucard-toggle'));
    expect(screen.getAllByTestId('ucard-job').find((j) => j.dataset.status === 'error')!.textContent).toContain('нет текста');
    failPaths.clear();
    calls.length = 0;
    fireEvent.click(screen.getByTestId('ucard-retry'));
    await waitFor(() => expect(calls.length).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('ucard-result')).toBeNull());
    expect(calls.map((c) => c.path)).toEqual(['Акты/плохой.pdf']);
    expect(screen.getByTestId('ucard-sub').textContent).toContain('3 файла');
  });
  it('отмена останавливает очередь; карточку можно убрать; пока идёт загрузка отправить можно (сообщение ждёт, tests/send-hold.test.tsx), после — все файлы сразу', async () => {
    delay = 60;
    const sent: FileChip[][] = [];
    mount((_t, fs) => sent.push(fs));
    drop([dirEntry('Акты', Array.from({ length: 30 }, (_, i) => fileEntry(`Акты/${i}.txt`)))]);
    await waitFor(() => expect(screen.getByTestId('ucard-cancel')).toBeTruthy());
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 140)); });
    fireEvent.click(screen.getByTestId('ucard-cancel'));
    await waitFor(() => expect(screen.getByTestId('ucard-retry')).toBeTruthy());
    expect(screen.getByTestId('upload-card').textContent).toContain('Загрузка остановлена');
    const done = calls.length;
    expect(done).toBeLessThan(30);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(calls.length).toBe(done);
    delay = 5;
    fireEvent.click(screen.getByTestId('ucard-retry'));
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.phase).toBe('idle'));
    await waitFor(() => expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('send'));
    expect(sent.length).toBe(1);
    expect(sent[0].length).toBe(30);
    expect(screen.queryByTestId('upload-card')).toBeNull();
  });
  it('крестик убирает карточку и обрывает загрузку', async () => {
    delay = 80;
    mount();
    drop([dirEntry('Акты', Array.from({ length: 12 }, (_, i) => fileEntry(`Акты/${i}.txt`)))]);
    await waitFor(() => expect(screen.getByTestId('ucard-remove')).toBeTruthy());
    fireEvent.click(screen.getByTestId('ucard-remove'));
    expect(screen.queryByTestId('upload-card')).toBeNull();
    const n = calls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(calls.length).toBeLessThanOrEqual(n + 5);
  });
});

describe('выбор папки и архив', () => {
  it('кнопка «Выбрать папку» и input webkitdirectory: webkitRelativePath становится именем', async () => {
    mount();
    const inp = screen.getByTestId('folder-input') as HTMLInputElement;
    expect(inp.hasAttribute('webkitdirectory')).toBe(true);
    expect(screen.getByTestId('pick-folder').getAttribute('aria-label')).toBe('Выбрать папку');
    const a = f('a.txt', 'a'), b = f('b.txt', 'b');
    Object.defineProperty(a, 'webkitRelativePath', { value: 'Договоры/a.txt' });
    Object.defineProperty(b, 'webkitRelativePath', { value: 'Договоры/подпапка/b.txt' });
    await act(async () => { fireEvent.change(inp, { target: { files: [a, b] } }); });
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls.map((c) => c.path).sort()).toEqual(['Договоры/a.txt', 'Договоры/подпапка/b.txt']);
    expect(screen.getByTestId('upload-card').textContent).toContain('Папка «Договоры»');
  });
  it('zip: серверу на распаковку, потом файлы из архива по staged; причины пропуска от сервера в строке; карточка «Архив»', async () => {
    mount();
    const z = new File(['PK'], 'Договоры.zip');
    await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: [z] } }); });
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.kind).toBe('zip'));
    expect(screen.getByTestId('upload-card').textContent).toContain('Архив «Договоры.zip»');
    await waitFor(() => expect(calls.filter((c) => c.staged).length).toBe(3));
    expect(calls[0]).toMatchObject({ url: '/api/files/archive', archive: 'Договоры.zip' });
    expect(calls.filter((c) => c.staged).map((c) => `${c.staged}:${c.n}`).sort()).toEqual(['sid-9:1', 'sid-9:2', 'sid-9:3']);
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.phase).toBe('idle'));
    expect(screen.getByTestId('ucard-skipped').textContent).toBe('Пропущено 2: служебные файлы (1), ссылки (1)');
    expect(screen.getByTestId('ucard-sub').textContent).toContain('3 файла');
  });
  it('обычный выбор нескольких файлов — чипами, как раньше; больше 12 сразу — одна карточка «Набор файлов»', async () => {
    mount();
    await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: [f('один.txt', '1'), f('два.txt', '2')] } }); });
    await waitFor(() => expect(document.querySelectorAll('[data-testid=up-chip]').length).toBe(2));
    expect(screen.queryByTestId('upload-card')).toBeNull();
    cleanup();
    calls = [];
    mount();
    await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: Array.from({ length: 15 }, (_, i) => f(`ф${i}.txt`, `текст ${i}`)) } }); });
    await waitFor(() => expect(screen.getByTestId('upload-card').dataset.kind).toBe('files'));
    expect(screen.getByTestId('upload-card').textContent).toContain('Набор файлов');
    expect(document.querySelectorAll('[data-testid=up-chip]').length).toBe(0);
  });
});

describe('правка сообщения с отправленной папкой', () => {
  it('больше 12 файлов одной папки в ряду вложений — один чип «Папка …», крестик убирает все', async () => {
    const { UpRow } = await import('@/components/UpRow');
    const ups = [
      ...Array.from({ length: 30 }, (_, i) => ({ tmp: `e${i}`, name: `Акты/${i}.pdf`, size: 10, status: 'ready' as const, chip: { id: `f${i}`, name: `Акты/${i}.pdf`, size: 10 }, edit: true })),
      { tmp: 'z', name: 'реестр.xlsx', size: 5, status: 'ready' as const, chip: { id: 'z', name: 'реестр.xlsx', size: 5 }, edit: true },
    ];
    const removed: string[] = [];
    const { container } = render(createElement(UpRow, { items: ups, admin: false, onRemove: (u) => removed.push(u.tmp) }));
    const chips = [...container.querySelectorAll<HTMLElement>('[data-testid=up-chip]')];
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('Папка «Акты»');
    expect(chips[0].textContent).toContain('30 файлов');
    fireEvent.click(chips[0].querySelector('[data-testid=up-remove]')!);
    expect(removed.length).toBe(30);
    expect(chips[1].dataset.name).toBe('реестр.xlsx');
  });
});

describe('уборка кэшей просмотра', () => {
  it('старые записи и недоделанные .tmp- удаляются, свежие остаются; не чаще раза в час', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { sweepOld, KEEP_MS } = await import('@/lib/cacheSweep');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-sweep-'));
    const mk = (n: string, ageMs: number) => { const p = path.join(root, n); fs.mkdirSync(p); const t = (Date.now() - ageMs) / 1000; fs.utimesSync(p, t, t); };
    mk('fresh', 1000); mk('old', KEEP_MS + 86_400_000); mk('.tmp-new', 1000); mk('.tmp-stale', 2 * 3_600_000);
    sweepOld(root, Date.now(), true);
    expect(fs.readdirSync(root).sort()).toEqual(['.tmp-new', 'fresh']);
    mk('old2', KEEP_MS + 86_400_000);
    sweepOld(root);
    expect(fs.existsSync(path.join(root, 'old2'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
