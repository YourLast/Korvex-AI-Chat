import { describe, expect, it } from 'vitest';
import { Batch, PARALLEL, collectDropped, filterPicked, fromFileList, planBatches, skipLine, type Deps, type Picked } from '@/lib/upload/queue';
import { cleanRelPath, groupByFolder, isJunkPath, archiveKind, archiveStem } from '@/lib/upload/paths';

const file = (name: string, body = 'x') => new File([body], name.split('/').pop()!);
const pick = (path: string, body?: string): Picked => ({ file: file(path, body ?? path), path });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = async (f: File) => `h:${await f.text()}`;

type Call = { url: string; form?: Record<string, string>; file?: string; prefix?: string };
function fakeFetch(opts: { delay?: number; fail?: (path: string, n: number) => string | null; log?: Call[]; peak?: { cur: number; max: number } } = {}): typeof fetch {
  const tries = new Map<string, number>();
  let id = 0;
  return (async (url: string, init?: RequestInit) => {
    const peak = opts.peak;
    if (peak) { peak.cur++; peak.max = Math.max(peak.max, peak.cur); }
    try {
      const signal = init?.signal;
      await new Promise<void>((ok, bad) => {
        const t = setTimeout(ok, opts.delay ?? 5);
        signal?.addEventListener('abort', () => { clearTimeout(t); bad(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
      if (url === '/api/files/archive') {
        opts.log?.push({ url, prefix: (init?.headers as Record<string, string> | undefined)?.['X-Prefix'] });
        return new Response(JSON.stringify({ sid: 'sid-1', entries: [{ n: 1, path: 'Акты/a.txt', size: 3 }, { n: 2, path: 'Акты/б/б.txt', size: 4 }], skipped: { total: 3, byReason: { junk: 2, link: 1 } } }));
      }
      const fd = init?.body as FormData;
      const form: Record<string, string> = {};
      fd.forEach((v, k) => { if (typeof v === 'string') form[k] = v; });
      const p = form.path ?? `staged:${form.n}`;
      opts.log?.push({ url, form, file: (fd.get('file') as File | null)?.name });
      const n = (tries.get(p) ?? 0) + 1; tries.set(p, n);
      const err = opts.fail?.(p, n) ?? null;
      if (err) return new Response(JSON.stringify({ error: err }), { status: 422 });
      return new Response(JSON.stringify({ id: `id-${++id}`, name: p, size: 1, info: {} }));
    } finally { if (peak) peak.cur--; }
  }) as unknown as typeof fetch;
}
const deps = (f: typeof fetch): Deps => ({ fetch: f, sha256: sha, modelId: 'alpha' });
const done = async (b: Batch) => { await b.start(); };

describe('пути и мусор', () => {
  it('относительный путь: NFC, слэши, без «.»; «..» и абсолютные — отказ', () => {
    expect(cleanRelPath('Акты\\2026\\./акт_017.pdf')).toEqual({ ok: true, path: 'Акты/2026/акт_017.pdf' });
    expect(cleanRelPath('Акт и\u0306.pdf')).toEqual({ ok: true, path: 'Акт й.pdf'.replace(' й', ' й') });
    expect(cleanRelPath('../x')).toMatchObject({ ok: false, reason: 'traversal' });
    expect(cleanRelPath('a/../../x')).toMatchObject({ ok: false, reason: 'traversal' });
    expect(cleanRelPath('/etc/passwd')).toMatchObject({ ok: false, reason: 'absolute' });
    expect(cleanRelPath('C:\\x.txt')).toMatchObject({ ok: false, reason: 'absolute' });
    expect(cleanRelPath('')).toMatchObject({ ok: false });
  });
  it('длинный путь укорачивается слева, имя и расширение остаются', () => {
    const r = cleanRelPath(Array.from({ length: 12 }, (_, i) => 'папка_номер_' + i + '_' + 'я'.repeat(15)).join('/') + '/итог.xlsx');
    expect(r.ok && r.path.length <= 240 && r.path.endsWith('/итог.xlsx')).toBe(true);
  });
  it('служебные файлы', () => {
    for (const p of ['.DS_Store', 'a/Thumbs.db', 'a/desktop.ini', '__MACOSX/a/._x.pdf', 'a/~$Договор.docx', 'p/.git/HEAD', 'a/._x', 'a/.~lock.x.odt#']) expect(isJunkPath(p), p).toBe(true);
    for (const p of ['a/договор.docx', 'a/.env.txt', 'акты/~акт.pdf', 'notes/gitignore.txt']) expect(isJunkPath(p), p).toBe(false);
  });
  it('архивы по имени', () => {
    expect(['a.zip', 'a.7z', 'a.tar', 'a.tar.gz', 'a.TGZ', 'a.docx', 'zip'].map(archiveKind)).toEqual(['zip', '7z', 'tar', 'tgz', 'tgz', null, null]);
    expect(archiveStem('Акты 2026.tar.gz')).toBe('Акты 2026');
  });
});

describe('отбор файлов', () => {
  it('мусор, пустые, слишком большие и пути с «..» не грузятся; причины считаются', () => {
    const big = { file: Object.defineProperty(file('big.bin'), 'size', { value: 101 * 1024 * 1024 }), path: 'big.bin' } as Picked;
    const { keep, skipped } = filterPicked([pick('Акты/a.pdf'), pick('Акты/.DS_Store'), pick('Акты/Thumbs.db'), pick('Акты/~$x.docx'), { file: new File([], 'пусто.txt'), path: 'Акты/пусто.txt' }, big, pick('../evil.txt'), pick('Акты/b.pdf')]);
    expect(keep.map((k) => k.path)).toEqual(['Акты/a.pdf', 'Акты/b.pdf']);
    expect(skipLine(skipped)).toBe('служебные файлы (3), пустые файлы (1), файл больше 100 МБ (1), небезопасный путь (1)');
  });
  it('больше 2000 файлов — лишние в «пропущено»', () => {
    const many = Array.from({ length: 2003 }, (_, i) => pick(`д/ф${i}.txt`));
    const { keep, skipped } = filterPicked(many);
    expect(keep.length).toBe(2000);
    expect(skipLine(skipped)).toBe('больше 2000 файлов (3)');
  });
  it('выбор папки: webkitRelativePath становится путём', () => {
    const f = file('акт.pdf'); Object.defineProperty(f, 'webkitRelativePath', { value: 'Акты/2026/акт.pdf' });
    expect(fromFileList([f])[0].path).toBe('Акты/2026/акт.pdf');
  });
  it('пачки: папка по первому каталогу, архив в корне отдельно, одиночные файлы — loose', () => {
    const p = planBatches([pick('Акты/a.pdf'), pick('Акты/б/b.pdf'), pick('Договоры/c.pdf'), pick('одинокий.txt'), pick('архив.zip')]);
    expect([...p.folders.keys()]).toEqual(['Акты', 'Договоры']);
    expect(p.loose.map((x) => x.path)).toEqual(['одинокий.txt']);
    expect(p.archives.map((x) => x.path)).toEqual(['архив.zip']);
  });
  it('перетаскивание папки: рекурсивно, readEntries до пустого ответа (по 100), путь без первого «/»', async () => {
    const mkFile = (full: string) => ({ isFile: true, isDirectory: false, name: full.split('/').pop()!, fullPath: full, file: (ok: (f: File) => void) => ok(file(full)) });
    const total = 250;
    const kids = Array.from({ length: total }, (_, i) => mkFile(`/Акты/2026/акт_${i}.pdf`));
    let pos = 0;
    const sub = { isFile: false, isDirectory: true, name: '2026', fullPath: '/Акты/2026', createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => { const part = kids.slice(pos, pos + 100); pos += 100; ok(part); } }) };
    const root = { isFile: false, isDirectory: true, name: 'Акты', fullPath: '/Акты', createReader: (() => { let used = false; return () => ({ readEntries: (ok: (e: unknown[]) => void) => { ok(used ? [] : [sub, mkFile('/Акты/реестр.xlsx')]); used = true; } }); })() };
    const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }], files: [] } as unknown as DataTransfer;
    const got = await collectDropped(dt);
    expect(got.length).toBe(total + 1);
    expect(got.map((g) => g.path)).toContain('Акты/2026/акт_249.pdf');
    expect(got.map((g) => g.path)).toContain('Акты/реестр.xlsx');
  });
});

describe('очередь', () => {
  it('300 файлов: не больше 5 одновременно, у каждого имя = путь, поле path и model в форме', async () => {
    const log: Call[] = [], peak = { cur: 0, max: 0 };
    const b = new Batch('folder', 'Акты', deps(fakeFetch({ log, peak, delay: 2 })));
    b.addPicked(Array.from({ length: 300 }, (_, i) => pick(`Акты/${i % 3}/акт_${i}.pdf`)), []);
    await done(b);
    const s = b.getSnap();
    expect(s).toMatchObject({ total: 300, ready: 300, failed: 0, queued: 0, running: 0, phase: 'idle' });
    expect(peak.max).toBe(PARALLEL);
    expect(log.length).toBe(300);
    expect(log[0].form).toMatchObject({ path: 'Акты/0/акт_0.pdf', model: 'alpha' });
    expect(b.chips().length).toBe(300);
    expect(s.types).toBe(1);
  });
  it('одинаковые имена в разных подпапках не сливаются', async () => {
    const b = new Batch('folder', 'Акты', deps(fakeFetch()));
    b.addPicked([pick('Акты/2025/акт.pdf', 'один'), pick('Акты/2026/акт.pdf', 'два')], []);
    await done(b);
    expect(b.chips().map((c) => c.name).sort()).toEqual(['Акты/2025/акт.pdf', 'Акты/2026/акт.pdf']);
  });
  it('дубли по содержимому загружаются один раз, пропуск считается', async () => {
    const log: Call[] = [];
    const b = new Batch('folder', 'д', deps(fakeFetch({ log })));
    b.addPicked([pick('д/а.txt', 'тот же'), pick('д/б.txt', 'тот же'), pick('д/в.txt', 'тот же'), pick('д/г.txt', 'другой')], []);
    await done(b);
    expect(log.length).toBe(2);
    expect(b.getSnap()).toMatchObject({ total: 2, ready: 2, dups: 2 });
    expect(skipLine(b.getSnap().skipped)).toBe('дубли (то же содержимое) (2)');
  });
  it('упавший файл: итог «загружено N, не принято M», причина у файла; повтор догружает только его', async () => {
    const log: Call[] = [];
    const b = new Batch('folder', 'д', deps(fakeFetch({ log, fail: (p, n) => (p === 'д/плохой.pdf' && n === 1 ? 'Файл «д/плохой.pdf» не прочитан: нет текста' : null) })));
    b.addPicked([pick('д/ок1.txt'), pick('д/плохой.pdf'), pick('д/ок2.txt')], []);
    await done(b);
    let s = b.getSnap();
    expect(s).toMatchObject({ ready: 2, failed: 1 });
    expect(s.jobs.find((j) => j.status === 'error')!.error).toContain('нет текста');
    log.length = 0;
    await b.retry();
    s = b.getSnap();
    expect(s).toMatchObject({ ready: 3, failed: 0 });
    expect(log.map((c) => c.form!.path)).toEqual(['д/плохой.pdf']);
  });
  it('отмена: идущие обрываются, ожидающие отменены, загруженные остаются; повтор продолжает', async () => {
    const b = new Batch('folder', 'д', deps(fakeFetch({ delay: 40 })));
    b.addPicked(Array.from({ length: 30 }, (_, i) => pick(`д/${i}.txt`)), []);
    const run = b.start();
    await sleep(90);
    b.cancel();
    await run;
    let s = b.getSnap();
    expect(s.cancelled).toBeGreaterThanOrEqual(15);
    expect(s.ready + s.cancelled + s.failed).toBe(30);
    expect(s.phase).toBe('idle');
    await b.retry();
    s = b.getSnap();
    expect(s).toMatchObject({ ready: 30, cancelled: 0 });
  });
  it('прогресс: байты загруженных и всего', async () => {
    const b = new Batch('folder', 'д', deps(fakeFetch({ delay: 20 })));
    b.addPicked([pick('д/а.txt', 'aaaa'), pick('д/б.txt', 'bb')], []);
    const snaps: number[] = [];
    b.subscribe(() => snaps.push(b.getSnap().bytesDone));
    await done(b);
    expect(b.getSnap()).toMatchObject({ bytesTotal: 6, bytesDone: 6 });
    expect(Math.max(...snaps)).toBe(6);
  });
  it('архив: сервер распаковывает, файлы грузятся по ссылке staged; причины пропуска от сервера в сводке', async () => {
    const log: Call[] = [];
    const b = new Batch('zip', 'Акты.zip', deps(fakeFetch({ log })));
    await b.unpack(new File(['PK'], 'Акты.zip'));
    expect(log[0].url).toBe('/api/files/archive');
    expect(log.slice(1).map((c) => c.form)).toEqual([{ staged: 'sid-1', n: '1', model: 'alpha' }, { staged: 'sid-1', n: '2', model: 'alpha' }]);
    const s = b.getSnap();
    expect(s).toMatchObject({ total: 2, ready: 2, phase: 'idle' });
    expect(skipLine(s.skipped)).toBe('служебные файлы (2), ссылки (1)');
  });
  it('архив внутри папки: папка грузится сразу, архив уходит на распаковку с X-Prefix (его подпапка), файлы идут в ту же карточку', async () => {
    const log: Call[] = [];
    const b = new Batch('folder', 'Акты', deps(fakeFetch({ log, delay: 8 })));
    b.addPicked([pick('Акты/а.txt'), pick('Акты/б.txt')], []);
    const run = b.start();
    const un = b.unpack(new File(['PK'], 'Архив документов.zip'), 'Акты/2026');
    expect(b.getSnap().phase).toBe('unpacking');
    await Promise.all([run, un]);
    expect(log.find((c) => c.url === '/api/files/archive')?.prefix).toBe(encodeURIComponent('Акты/2026'));
    const s = b.getSnap();
    expect(s).toMatchObject({ total: 4, ready: 4, phase: 'idle', queued: 0 });
    expect(log.filter((c) => c.form?.staged).length).toBe(2);
  });
  it('файлы, добавленные пока очередь допивалась, всё равно загружаются', async () => {
    const b = new Batch('folder', 'д', deps(fakeFetch({ delay: 20 })));
    b.addPicked([pick('д/а.txt')], []);
    const run = b.start();
    await sleep(35);
    b.addPicked([pick('д/в.txt', 'позже')], []);
    await Promise.all([run, b.start()]);
    expect(b.getSnap()).toMatchObject({ total: 2, ready: 2, queued: 0 });
  });
  it('сервер занят чужими архивами (429) — архив повторяется, пока не примут', async () => {
    let n = 0;
    const f = (async (url: string) => {
      if (url !== '/api/files/archive') return new Response(JSON.stringify({ id: 'i', name: 'x', size: 1 }));
      return n++ < 2 ? new Response(JSON.stringify({ error: 'занято' }), { status: 429 }) : new Response(JSON.stringify({ sid: 's', entries: [{ n: 1, path: 'a/б.txt', size: 1 }], skipped: { byReason: {} } }));
    }) as unknown as typeof fetch;
    const b = new Batch('zip', 'a.zip', { ...deps(f), retryMs: 5 });
    await b.unpack(new File(['PK'], 'a.zip'));
    expect(n).toBe(3);
    expect(b.getSnap()).toMatchObject({ total: 1, ready: 1, err: null });
  });
  it('ошибка распаковки архива видна в карточке', async () => {
    const f = (async () => new Response(JSON.stringify({ error: 'Архив защищён паролем' }), { status: 422 })) as unknown as typeof fetch;
    const b = new Batch('zip', 'a.zip', deps(f));
    await b.unpack(new File(['PK'], 'a.zip'));
    expect(b.getSnap()).toMatchObject({ err: 'Архив защищён паролем', total: 0, phase: 'idle' });
  });
});

describe('карточка папки в сообщении', () => {
  it('файлы с общей папкой — одна группа (число файлов, типов, объём); одиночные остаются', () => {
    const files = [
      { name: 'Акты/2026/a.pdf', size: 10 }, { name: 'Акты/2026/b.pdf', size: 20 }, { name: 'Акты/реестр.xlsx', size: 5 }, { name: 'Акты/читай.txt', size: 1 },
      { name: 'Договоры/один.docx', size: 7 }, { name: 'свободный.pdf', size: 3 },
    ];
    const { groups, rest } = groupByFolder(files);
    expect(groups.map((g) => [g.root, g.items.length, g.types, g.bytes, g.kind])).toEqual([['Акты', 4, 3, 36, 'folder']]);
    expect(rest.map((f) => f.name)).toEqual(['Договоры/один.docx', 'свободный.pdf']);
  });
  it('файлы из архива помечены zip', () => {
    const o = { origin: { kind: 'zip', root: 'Акты', archive: 'Акты.zip' } };
    expect(groupByFolder([{ name: 'Акты/a.txt', info: o }, { name: 'Акты/b.txt', info: o }]).groups[0].kind).toBe('zip');
  });
});

describe('ошибки загрузки на языке человека', () => {
  it('ответы сервера по загрузке файлов и архивов переводятся; 413 от прокси без тела — понятная фраза', async () => {
    const { errText } = await import('@/lib/i18n/errors');
    expect(errText('en', 'Архив защищён паролем')).toBe('The archive is password-protected');
    expect(errText('sr', 'Файл больше 100 МБ')).toBe('Fajl je veći od 100 MB');
    expect(errText('en', 'Архив не читается: bad header')).toBe('The archive can’t be read: bad header');
    expect(errText('ru', 'Архив защищён паролем')).toBe('Архив защищён паролем');
    const f = (async () => new Response('<html>413</html>', { status: 413 })) as unknown as typeof fetch;
    const b = new Batch('folder', 'д', { fetch: f, sha256: sha, errText: (e) => errText('en', e) });
    b.addPicked([pick('д/большой.bin')], []);
    await b.start();
    expect(b.getSnap().jobs[0].error).toBe('The file is larger than the server limit');
  });
});
