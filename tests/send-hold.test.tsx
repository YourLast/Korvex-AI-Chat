// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { HeldTurn, type HeldView } from '@/components/HeldTurn';
import { failedNote, fileErrKind, heldFiles, heldKind, holdState } from '@/lib/sendHold';
import { whyText } from '@/components/HeldTurn';
import { Batch } from '@/lib/upload/queue';
import type { FileChip } from '@/lib/types';
import { DICT } from '@/lib/i18n/dict';

vi.mock('@/lib/imgprep', () => ({ prepImage: async (f: File) => ({ blob: f as Blob, w: 10, h: 10, name: f.name }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

type Gate = { name: string; ok: (b?: Record<string, unknown>) => void; fail: (msg: string) => void };
let gates: Gate[];
let n = 0;
beforeEach(() => {
  gates = []; n = 0;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {};
  vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((res) => {
    const name = ((init?.body as FormData).get('file') as File).name;
    gates.push({
      name,
      ok: (b) => res({ ok: true, status: 200, json: async () => ({ id: `f-${++n}`, name, size: 5, mime: 'application/pdf', ...b }) } as Response),
      fail: (msg) => res({ ok: false, status: 422, json: async () => ({ error: msg }) } as Response),
    });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });
type Sent = { text: string; files: FileChip[] };

function Harness({ busy = false, sent, onSendResult }: { busy?: boolean; sent: Sent[]; onSendResult?: () => boolean }) {
  const [held, setHeld] = useState<HeldView[]>([]);
  const ref = { current: null as ComposerHandle | null };
  return createElement('div', null,
    createElement('div', { 'data-testid': 'feed' }, held.map((h) => createElement(HeldTurn, { key: h.id, h, onCancel: (id: string) => ref.current?.cancelHold(id) }))),
    createElement(Composer, { ref: (r: ComposerHandle | null) => { ref.current = r; }, busy, placeholder: 'Напишите', modelSlot: null, onStop: () => {}, onHolds: setHeld,
      onSend: (text: string, files: FileChip[]) => { sent.push({ text, files }); return onSendResult ? onSendResult() : true; } }));
}
const mount = (p: Parameters<typeof Harness>[0]) => render(createElement(Harness, p));
const attach = async (...fs: File[]) => { await act(async () => { fireEvent.change(screen.getByTestId('file-input'), { target: { files: fs } }); }); };
const type = (t: string) => fireEvent.change(screen.getByTestId('composer-input'), { target: { value: t } });
const send = () => fireEvent.click(screen.getByTestId('send'));
const answer = async (i: number, how: 'ok' | 'fail' = 'ok') => { await act(async () => { if (how === 'ok') gates[i].ok(); else gates[i].fail('битый скан'); await Promise.resolve(); }); };
const title = () => screen.getByTestId('held-title').textContent;
const count = () => screen.getByTestId('held-count').textContent;

describe('сообщение ждёт файлы и уходит само', () => {
  it('Отправить доступна, пока файл читается; в ленте «Читаю файлы · 0 из 2», строка на каждый файл, поле свободно', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'), pdf('b.pdf'));
    type('Сверь акты');
    expect((screen.getByTestId('send') as HTMLButtonElement).disabled).toBe(false);
    send();
    await waitFor(() => expect(screen.getByTestId('held-card')).toBeTruthy());
    expect(title()).toBe('Читаю файлы');
    expect(count()).toBe('0 из 2');
    expect(screen.getAllByTestId('held-file').map((r) => r.getAttribute('data-state'))).toEqual(['run', 'wait']);
    expect(screen.getByTestId('held-msg').textContent).toContain('Сверь акты');
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryAllByTestId('up-chip').length).toBe(0);
    expect(sent).toEqual([]);
  });

  it('файлы дочитаны — сообщение уходит само, одним вызовом, со всеми файлами; карточка исчезает', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'), pdf('b.pdf'));
    type('Сверь акты'); send();
    await answer(0);
    await waitFor(() => expect(count()).toBe('1 из 2'));
    expect(screen.getAllByTestId('held-file').map((r) => r.getAttribute('data-state'))).toEqual(['ok', 'run']);
    expect(sent).toEqual([]);
    await answer(1);
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].text).toBe('Сверь акты');
    expect(sent[0].files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    await waitFor(() => expect(screen.queryByTestId('held-card')).toBeNull());
  });

  it('все файлы читаются по одному, но сообщение ждёт и тех, что ещё не начались (все в ряду сразу)', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'));
    expect(screen.getAllByTestId('up-chip').length).toBe(3);
    type('x'); send();
    await waitFor(() => expect(count()).toBe('0 из 3'));
  });

  it('упавший файл не держит сообщение: уходит с готовыми, имя упавшего дописано в текст; в карточке «не удалось: 1»', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'), pdf('битый.pdf'));
    type('Сверь'); send();
    await answer(0);
    await answer(1, 'fail');
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].files.map((f) => f.name)).toEqual(['a.pdf']);
    expect(sent[0].text).toBe('Сверь\n\nНе удалось обработать файлы: битый.pdf');
  });

  it('ни один файл не прочитан и текста нет — слать нечего: ошибка в поле, ничего не уходит', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('битый.pdf'));
    send();
    await answer(0, 'fail');
    await waitFor(() => expect(screen.queryByTestId('held-card')).toBeNull());
    expect(sent).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('битый.pdf');
  });

  it('отмена: сообщение убрано из ленты, текст и файлы вернулись в поле, файл не потерян и дочитывается', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'));
    type('Сверь'); send();
    await waitFor(() => screen.getByTestId('held-cancel'));
    fireEvent.click(screen.getByTestId('held-cancel'));
    expect(screen.queryByTestId('held-card')).toBeNull();
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('Сверь');
    expect(screen.getAllByTestId('up-chip').map((c) => c.dataset.name)).toEqual(['a.pdf']);
    await answer(0);
    await waitFor(() => expect(screen.getByTestId('up-chip').dataset.status).toBe('ready'));
    expect(sent).toEqual([]);
  });

  it('занятый чат (идёт ответ): файлы готовы, но сообщение ждёт; чат освободился — уходит', async () => {
    const sent: Sent[] = [];
    const { rerender } = mount({ sent });
    await attach(pdf('a.pdf'));
    type('q'); send();
    rerender(createElement(Harness, { busy: true, sent }));
    await answer(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.length).toBe(0);
    rerender(createElement(Harness, { busy: false, sent }));
    await waitFor(() => expect(sent.length).toBe(1));
  });

  it('несколько сообщений подряд: уходят по порядку нажатия, каждое со своими файлами', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    await attach(pdf('a.pdf'));
    type('первое'); send();
    await attach(pdf('b.pdf'));
    type('второе'); send();
    await waitFor(() => expect(screen.getAllByTestId('held-card').length).toBe(2));
    await answer(1);
    expect(sent).toEqual([]);
    await answer(0);
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[0].text).toBe('первое');
    expect(sent[0].files.map((f) => f.name)).toEqual(['a.pdf']);
    expect(sent[1].text).toBe('второе');
    expect(sent[1].files.map((f) => f.name)).toEqual(['b.pdf']);
  });

  it('родитель не принял отправку (false) — текст и файлы возвращаются в поле', async () => {
    const sent: Sent[] = [];
    mount({ sent, onSendResult: () => false });
    await attach(pdf('a.pdf'));
    type('q'); send();
    await answer(0);
    await waitFor(() => expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('q'));
    expect(screen.getAllByTestId('up-chip').map((c) => c.dataset.name)).toEqual(['a.pdf']);
  });

  it('без чтения файлов отправка как прежде: сразу, без карточки', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    type('привет'); send();
    expect(sent).toEqual([{ text: 'привет', files: [] }]);
    expect(screen.queryByTestId('held-card')).toBeNull();
  });
});

describe('holdState и пачки (папка, архив)', () => {
  const fakeFetch = (fail: (p: string) => boolean = () => false, unpackFail = false) => (async (url: string, init?: RequestInit) => {
    if (url === '/api/files/archive') {
      if (unpackFail) return new Response(JSON.stringify({ error: 'не удалось распаковать' }), { status: 422 });
      return new Response(JSON.stringify({ sid: 's', entries: [{ n: 1, path: 'Акты/1.txt', size: 3 }, { n: 2, path: 'Акты/2.txt', size: 3 }], skipped: { byReason: {} } }));
    }
    const fd = init?.body as FormData;
    const p = (fd.get('path') as string | null) ?? `staged:${fd.get('n')}`;
    if (fail(p)) return new Response(JSON.stringify({ error: 'не читается' }), { status: 422 });
    return new Response(JSON.stringify({ id: `id-${p}`, name: p, size: 1 }));
  }) as unknown as typeof fetch;
  const dep = (f: typeof fetch) => ({ fetch: f, sha256: async (x: File) => `h:${await x.text()}` });

  it('архив: пока распаковывается — не готово (unpacking); потом считает файлы из архива, упавший попадает в failed', async () => {
    const b = new Batch('zip', 'Акты.zip', dep(fakeFetch((p) => p === 'staged:2')));
    const done = b.unpack(new File(['zz'], 'Акты.zip'));
    expect(holdState({ ups: [], batches: [b] })).toMatchObject({ settled: false, unpacking: true });
    await done;
    const st = holdState({ ups: [], batches: [b] });
    expect(st).toMatchObject({ settled: true, total: 2, ready: 1, failed: ['Акты/2.txt'], unpacking: false });
    expect(st.chips.length).toBe(1);
  });

  it('архив не распаковался — он сам в списке упавших', async () => {
    const b = new Batch('zip', 'x.zip', dep(fakeFetch(() => false, true)));
    await b.unpack(new File(['zz'], 'x.zip'));
    expect(holdState({ ups: [], batches: [b] })).toMatchObject({ settled: true, failed: ['x.zip'] });
  });

  it('failedNote: до 8 имён, остальные числом; пусто, если все прочитаны', () => {
    expect(failedNote([], 'Не удалось:', () => '')).toBe('');
    const many = Array.from({ length: 10 }, (_, i) => `f${i}`);
    expect(failedNote(many, 'Не удалось:', (n) => ` +${n}`)).toBe('Не удалось: f0, f1, f2, f3, f4, f5, f6, f7 +2');
  });

  it('сообщение с папкой: Composer ждёт всю пачку, потом отправляет чипы папки', async () => {
    const sent: Sent[] = [];
    mount({ sent });
    vi.stubGlobal('fetch', fakeFetch());
    const mk = (path: string) => { const f = new File([path], path.split('/').pop()!); Object.defineProperty(f, 'webkitRelativePath', { value: path }); return f; };
    await act(async () => { fireEvent.change(screen.getByTestId('folder-input'), { target: { files: [mk('Акты/1.txt'), mk('Акты/2.txt')] } }); });
    type('Проверь папку'); send();
    await waitFor(() => expect(sent.length).toBe(1), { timeout: 3000 });
    expect(sent[0].files.map((f) => f.name).sort()).toEqual(['Акты/1.txt', 'Акты/2.txt']);
  });
});

describe('HeldTurn и словарь', () => {
  const files: HeldView['files'] = [
    { key: '1', name: 'Акт_сверки.pdf', size: 120_000, kind: 'doc', state: 'ok' },
    { key: '2', name: 'Выписка.xlsx', size: 2_400_000, kind: 'table', state: 'run' },
    { key: '3', name: 'скан.pdf', size: 900_000, kind: 'doc', state: 'err', err: 'битый скан' },
    { key: '4', name: 'Договор.docx', size: 40_000, kind: 'doc', state: 'wait' },
  ];
  const v: HeldView = { id: 'h', text: 'вопрос', done: 12, total: 18, failed: 0, unpacking: false, files, at: Date.now() - 42_000 };

  it('A: «Читаю файлы · 12 из 18», время, строки файлов с состояниями; «распаковываю» без числа; «не удалось: 2»', () => {
    render(createElement(HeldTurn, { h: { ...v, at: Date.now() - 42_000 }, onCancel: () => {} }));
    expect(screen.getByTestId('held-card').getAttribute('data-variant')).toBe('a');
    expect(title()).toBe('Читаю файлы');
    expect(count()).toBe('12 из 18');
    expect(screen.getByTestId('held-card').textContent).toContain('42 с');
    expect(screen.getAllByTestId('held-file').map((r) => r.getAttribute('data-state'))).toEqual(['ok', 'run', 'err', 'wait']);
    expect(screen.getAllByTestId('held-file')[2].textContent).toContain('не прочитался');
    expect(screen.getAllByTestId('held-file')[3].textContent).toContain('в очереди');
    cleanup();
    render(createElement(HeldTurn, { h: { ...v, total: 0, done: 0, files: [], unpacking: true, failed: 2 }, onCancel: () => {} }));
    expect(title()).toBe('Распаковываю архив');
    expect(screen.queryByTestId('held-count')).toBeNull();
    expect(screen.getByTestId('held-failed').textContent).toContain('не удалось: 2');
  });

  it('B: файлы над пузырём со своими состояниями, подпись «Отправлю сам, когда прочитаю файлы · 12 из 18», «Отменить»', () => {
    const cancel = vi.fn();
    render(createElement(HeldTurn, { h: v, onCancel: cancel, variant: 'b' }));
    expect(screen.getByTestId('held-card').getAttribute('data-variant')).toBe('b');
    expect(title()).toBe('Отправлю сам, когда прочитаю файлы');
    expect(count()).toBe('· 12 из 18');
    expect(screen.getAllByTestId('held-file').map((r) => r.getAttribute('data-state'))).toEqual(['ok', 'run', 'err', 'wait']);
    fireEvent.click(screen.getByTestId('held-cancel'));
    expect(cancel).toHaveBeenCalledWith('h');
  });

  it('много файлов: видно 5, остальные одной строкой «ещё N файлов · готово M», по нажатию раскрываются', () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ key: String(i), name: `акт_${i + 1}.pdf`, size: 1000, kind: 'doc' as const, state: (i < 9 ? 'ok' : 'run') as 'ok' | 'run' }));
    render(createElement(HeldTurn, { h: { ...v, files: many }, onCancel: () => {} }));
    expect(screen.getAllByTestId('held-file').length).toBe(5);
    expect(screen.getByTestId('held-more').textContent).toBe('ещё 13 файлов · готово 4');
    fireEvent.click(screen.getByTestId('held-more'));
    expect(screen.getAllByTestId('held-file').length).toBe(18);
  });

  it('«не прочитался» по нажатию: причина без «Файл «имя» не прочитан:» и что сделать — по виду ошибки', () => {
    const err = 'Файл «скан.pdf» не прочитан: на страницах только сканы или рисунки, текст не распознан';
    render(createElement(HeldTurn, { h: { ...v, files: [{ key: 'e', name: 'скан.pdf', size: 1, kind: 'doc', state: 'err', err, errKind: 'scan' }] }, onCancel: () => {} }));
    expect(screen.queryByTestId('held-why')).toBeNull();
    const t = screen.getByTestId('held-why-toggle');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('held-why').textContent).toContain('на страницах только сканы или рисунки, текст не распознан');
    expect(screen.getByTestId('held-why').textContent).toContain('Пришлите скан почётче');
    expect(screen.getByTestId('held-why').textContent).not.toContain('Файл «скан.pdf»');
  });

  it('fileErrKind по ответу сервера (до перевода) и whyText', () => {
    expect(fileErrKind(413, 'Файл больше 100 МБ')).toBe('big');
    expect(fileErrKind(200, 'Файл «a.pdf» не прочитан: на страницах только сканы или рисунки, текст не распознан')).toBe('scan');
    expect(fileErrKind(422, 'Файл «a.txt» пустой')).toBe('empty');
    expect(fileErrKind(422, 'Скан не читается: страницы пустые')).toBe('empty');
    expect(fileErrKind(415, 'Служебный файл не загружается')).toBe('type');
    expect(fileErrKind(422, 'Тип «.xyz» не поддерживается')).toBe('type');
    expect(fileErrKind(200, 'Чтение файла заняло слишком долго')).toBe('slow');
    expect(fileErrKind(502, '')).toBe('net');
    expect(fileErrKind(422, 'что-то иное')).toBe('other');
    expect(whyText('Файл «a.pdf» не прочитан: битый PDF')).toBe('битый PDF');
    expect(whyText('The file “a.pdf” is empty')).toBe('The file “a.pdf” is empty');
  });

  it('heldFiles: одиночные файлы — по строке; папка и архив — одна строка «N из M»; вид по расширению', async () => {
    const ups = [
      { tmp: 't1', name: 'a.pdf', size: 5, status: 'uploading' as const },
      { tmp: 't2', name: 'b.xlsx', size: 5, status: 'ready' as const, chip: { id: 'f', name: 'b.xlsx', size: 5, mime: 'x' } as FileChip },
      { tmp: 't3', name: 'c.jpg', size: 5, status: 'error' as const, error: 'нет', img: true },
      { tmp: 't4', name: 'old.pdf', size: 5, status: 'ready' as const, edit: true },
      { tmp: 't5', name: 'next.pdf', size: 5, status: 'uploading' as const, started: false },
    ];
    expect(heldFiles({ ups, batches: [] }).map((f) => [f.name, f.kind, f.state])).toEqual([['a.pdf', 'doc', 'run'], ['b.xlsx', 'table', 'ok'], ['c.jpg', 'image', 'err'], ['next.pdf', 'doc', 'wait']]);
    expect([heldKind('x.CSV'), heldKind('скан.PNG'), heldKind('отчёт.docx')]).toEqual(['table', 'image', 'doc']);
  });

  it('все строки hold.* есть на русском, английском и сербском', () => {
    const keys = Object.keys(DICT).filter((k) => k.startsWith('hold.'));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) { const v = (DICT as Record<string, unknown[]>)[k]; expect(v.length, k).toBe(3); v.forEach((x) => expect(String(x).length).toBeGreaterThan(0)); }
  });
});
