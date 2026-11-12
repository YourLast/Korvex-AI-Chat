import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { extractArchive, has7z, skipSummary, LIMITS } from '@/lib/upload/archive';
import { decodeZipName } from '@/lib/upload/zipnames';
import { encodeCp, makeTar, makeZip, type ZipItem } from './archive-helpers';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-arch-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function put(name: string, data: Buffer): { file: string; dest: string } {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  const dest = path.join(dir, 'out-' + name.replace(/\W/g, '_'));
  fs.mkdirSync(dest);
  return { file, dest };
}
async function unzip(items: ZipItem[], name = 'Акты.zip', limits: Partial<typeof LIMITS> = {}) {
  const { file, dest } = put(name.replace(/[^\w.]/g, '_'), makeZip(items));
  const r = await extractArchive(file, name, dest, limits);
  return { r, dest };
}
const paths = (r: Awaited<ReturnType<typeof extractArchive>>) => (r.ok ? r.entries.map((e) => e.path).sort() : []);
const reasons = (r: Awaited<ReturnType<typeof extractArchive>>) => (r.ok ? r.skipped.map((s) => `${s.path}:${s.reason}`).sort() : []);

describe('zip: пути, мусор, дубли', () => {
  it('подпапки сохраняются, у содержимого без общей корневой папки спереди имя архива', async () => {
    const { r } = await unzip([
      { name: '2026/акт_017.txt', data: 'акт 17' },
      { name: '2026/акт_018.txt', data: 'акт 18' },
      { name: 'реестр.txt', data: 'реестр' },
      { name: '2026/', dir: true },
    ]);
    expect(paths(r)).toEqual(['Акты/2026/акт_017.txt', 'Акты/2026/акт_018.txt', 'Акты/реестр.txt']);
    if (r.ok) { expect(r.entries.every((e) => fs.statSync(e.file).size === e.size)).toBe(true); expect(r.totalBytes).toBeGreaterThan(0); }
  });
  it('единая корневая папка в архиве не задваивается («Акты.zip» с папкой «Акты/»)', async () => {
    const { r } = await unzip([{ name: 'Акты/a.txt', data: 'a' }, { name: 'Акты/б/б.txt', data: 'б' }]);
    expect(paths(r)).toEqual(['Акты/a.txt', 'Акты/б/б.txt']);
  });
  it('мусор, пустые файлы и дубли по содержимому пропускаются и считаются', async () => {
    const { r } = await unzip([
      { name: 'Акты/a.txt', data: 'одинаковое' },
      { name: 'Акты/копия.txt', data: 'одинаковое' },
      { name: 'Акты/.DS_Store', data: 'x' },
      { name: '__MACOSX/Акты/._a.txt', data: 'x' },
      { name: 'Акты/Thumbs.db', data: 'x' },
      { name: 'Акты/~$a.docx', data: 'x' },
      { name: 'Акты/.git/config', data: 'x' },
      { name: 'Акты/пустой.txt', data: '' },
      { name: 'Акты/b.txt', data: 'другое' },
    ]);
    expect(paths(r)).toEqual(['Акты/a.txt', 'Акты/b.txt']);
    if (!r.ok) throw new Error('x');
    const s = skipSummary(r.skipped);
    expect(s.byReason).toMatchObject({ junk: 5, empty: 1, duplicate: 1 });
    expect(s.total).toBe(7);
  });
});

describe('архив внутри папки', () => {
  it('prefixDir: файлы архива — внутри папки, где он лежал («Акты/2026/<имя архива>/…» или внутри единой корневой папки)', async () => {
    const z1 = makeZip([{ name: 'а.txt', data: 'один' }, { name: 'б/б.txt', data: 'два' }]);
    const { file, dest } = put('Архив.zip', z1);
    const r = await extractArchive(file, 'Архив документов.zip', dest, {}, 'Акты/2026');
    expect(paths(r)).toEqual(['Акты/2026/Архив документов/а.txt', 'Акты/2026/Архив документов/б/б.txt']);
    const z2 = makeZip([{ name: 'Корень/а.txt', data: 'один' }, { name: 'Корень/в.txt', data: 'три' }]);
    const p2 = put('Архив2.zip', z2);
    expect(paths(await extractArchive(p2.file, 'Архив2.zip', p2.dest, {}, 'Акты'))).toEqual(['Акты/Корень/а.txt', 'Акты/Корень/в.txt']);
  });
});

describe('zip: имена без флага UTF-8', () => {
  it('CP866 (русский Windows)', async () => {
    const { r } = await unzip([{ name: encodeCp('Договоры/Договор №5.txt', '866'), data: 'д', utf8Flag: false }, { name: encodeCp('Договоры/Акт.txt', '866'), data: 'а', utf8Flag: false }]);
    expect(paths(r)).toEqual(['Договоры/Акт.txt', 'Договоры/Договор №5.txt']);
    if (r.ok) expect(r.names.cp866).toBe(2);
  });
  it('CP1251 — когда CP866 даёт псевдографику', async () => {
    const { r } = await unzip([{ name: encodeCp('Отчёты/Выгрузка октябрь.txt'.replace('ё', 'е'), '1251'), data: 'в', utf8Flag: false }, { name: encodeCp('Отчёты/Итог.txt'.replace('ё', 'е'), '1251'), data: 'и', utf8Flag: false }]);
    expect(paths(r)).toEqual(['Отчеты/Выгрузка октябрь.txt', 'Отчеты/Итог.txt']);
  });
  it('UTF-8 без флага узнаётся строгим разбором', () => {
    expect(decodeZipName(Buffer.from('Файл.txt'), false)).toEqual({ name: 'Файл.txt', enc: 'utf8' });
  });
  it('NFD (macOS) приводится к NFC: «й» остаётся одной буквой', async () => {
    const nfd = 'Акт и\u0306юль.txt';
    const { r } = await unzip([{ name: nfd, data: 'x' }, { name: 'b.txt', data: 'y' }]);
    expect(paths(r).some((p) => p.includes('й'))).toBe(true);
    expect(paths(r).every((p) => p === p.normalize('NFC'))).toBe(true);
  });
});

describe('zip: защита', () => {
  it('обход путей и абсолютные пути не пишутся; на диске только пронумерованные файлы внутри dest', async () => {
    const { r, dest } = await unzip([
      { name: '../../evil.txt', data: 'e1' },
      { name: 'a/../../evil2.txt', data: 'e2' },
      { name: '/etc/cron.d/x', data: 'e3' },
      { name: 'C:\\Windows\\x.txt', data: 'e4' },
      { name: '..\\..\\evil5.txt', data: 'e5' },
      { name: 'ok/хороший.txt', data: 'ok' },
      { name: 'ok/второй.txt', data: 'ok2' },
    ]);
    expect(paths(r)).toEqual(['ok/второй.txt', 'ok/хороший.txt']);
    expect(reasons(r).filter((x) => /traversal|absolute/.test(x)).length).toBe(5);
    expect(fs.readdirSync(dest).every((n) => /^\d{6}$/.test(n))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(dir), 'evil.txt'))).toBe(false);
  });
  it('ссылки, устройства и записи с паролем пропускаются', async () => {
    const { r } = await unzip([
      { name: 'x/link', data: '/etc/passwd', mode: 0o120777 },
      { name: 'x/dev', data: '', mode: 0o060644 },
      { name: 'x/секрет.txt', data: 'зашифровано', encrypted: true },
      { name: 'x/обычный.txt', data: 'текст', mode: 0o100644 },
      { name: 'x/второй.txt', data: 'текст 2' },
    ]);
    expect(paths(r)).toEqual(['x/второй.txt', 'x/обычный.txt']);
    expect(reasons(r)).toEqual(['x/dev:device', 'x/link:link', 'x/секрет.txt:encrypted']);
  });
  it('предел числа файлов', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `д/ф${i}.txt`, data: `файл ${i}` }));
    const { r } = await unzip(items, 'Много.zip', { maxFiles: 5 });
    expect(r.ok && r.entries.length).toBe(5);
    expect(r.ok && r.skipped.filter((s) => s.reason === 'limit-files').length).toBe(7);
  });
  it('предел объёма на загрузку и размера файла', async () => {
    const big = Buffer.alloc(300, 65);
    const { r } = await unzip([{ name: 'д/один.txt', data: Buffer.from(big.map((_, i) => 65 + (i % 17))) }, { name: 'д/два.txt', data: Buffer.from(big.map((_, i) => 70 + (i % 13))) }, { name: 'д/три.txt', data: Buffer.from(big.map((_, i) => 80 + (i % 11))) }], 'Т.zip', { maxTotalBytes: 650, maxFileBytes: 400 });
    expect(r.ok && r.entries.length).toBe(2);
    expect(reasons(r)).toEqual(['д/три.txt:limit-total']);
    const { r: r2 } = await unzip([{ name: 'д/один.txt', data: Buffer.alloc(500, 66) }, { name: 'д/два.txt', data: 'мал' }, { name: 'д/три.txt', data: 'мал 2' }], 'Т2.zip', { maxFileBytes: 400 });
    expect(reasons(r2)).toEqual(['д/один.txt:too-big']);
  });
  it('бомба: запись с отношением сжатия выше предела пропускается', async () => {
    const { r } = await unzip([{ name: 'д/нули.bin', data: Buffer.alloc(3_000_000, 0) }, { name: 'д/норм.txt', data: 'нормальный текст' }, { name: 'д/ещё.txt', data: 'ещё один' }], 'Б.zip', { entryRatioFrom: 100_000, entryRatio: 100 });
    expect(reasons(r)).toEqual(['д/нули.bin:bomb']);
    expect(r.ok && r.entries.length).toBe(2);
  });
  it('бомба: весь архив раздувается — отказ целиком, ничего не остаётся на диске', async () => {
    const { r, dest } = await unzip([{ name: 'д/нули1.bin', data: Buffer.alloc(3_000_000, 1) }, { name: 'д/нули2.bin', data: Buffer.alloc(3_000_000, 2) }, { name: 'д/х.txt', data: 'x' }], 'Б2.zip', { entryRatio: 1e9, totalRatioFrom: 1_000_000, totalRatio: 50 });
    expect(r).toMatchObject({ ok: false, error: 'bomb' });
    expect(fs.readdirSync(dest)).toEqual([]);
  });
  it('заголовок лжёт о размере (заявлено 10 байт, в потоке больше) — запись не принимается', async () => {
    const { r } = await unzip([{ name: 'д/лжец.txt', data: Buffer.alloc(5000, 65), declaredSize: 10 }, { name: 'д/честный.txt', data: 'честный текст' }, { name: 'д/второй.txt', data: 'второй' }]);
    expect(r.ok && r.entries.map((e) => e.path).sort()).toEqual(['д/второй.txt', 'д/честный.txt']);
    expect(reasons(r).length).toBe(1);
  });
  it('битый zip — понятная ошибка, а не исключение', async () => {
    const { file, dest } = put('bad.zip', Buffer.from('это совсем не zip, просто текст'));
    expect(await extractArchive(file, 'bad.zip', dest)).toMatchObject({ ok: false, error: 'corrupt' });
  });
});

describe('вложенные архивы — один уровень', () => {
  it('zip внутри zip раскрывается своей папкой, zip внутри вложенного остаётся файлом', async () => {
    const deepest = makeZip([{ name: 'г.txt', data: 'глубоко' }]);
    const inner = makeZip([{ name: 'в.txt', data: 'внутри' }, { name: 'глубже.zip', data: deepest, store: true }]);
    const { r } = await unzip([{ name: 'верх/вложение.zip', data: inner, store: true }, { name: 'верх/сверху.txt', data: 'сверху' }]);
    expect(paths(r)).toEqual(['верх/сверху.txt', 'верх/вложение/в.txt', 'верх/вложение/глубже.zip'].sort());
  });
  it('вложенный архив, который не раскрылся, остаётся файлом', async () => {
    const { r } = await unzip([{ name: 'а/плохой.zip', data: 'не zip' }, { name: 'а/b.txt', data: 'b' }]);
    expect(paths(r)).toEqual(['а/b.txt', 'а/плохой.zip']);
  });
});

describe('tar и tar.gz', () => {
  it('ustar с prefix, pax с кириллицей и GNU longname; ссылки и устройства пропускаются; путь внутри dest', async () => {
    const long = 'очень/длинная/папка/' + 'я'.repeat(30) + '/' + 'ф'.repeat(60) + '.txt';
    const tar = makeTar([
      { name: 'Папка/а.txt', data: 'один' },
      { name: 'Папка/Договор №7.txt', data: 'два', pax: true },
      { name: long, data: 'три', gnuLong: true },
      { name: 'Папка/ссылка', type: '2', link: '/etc/passwd' },
      { name: 'Папка/устр', type: '3' },
      { name: '../побег.txt', data: 'побег' },
      { name: 'Папка/', type: '5' },
    ]);
    const { file, dest } = put('Т.tar', tar);
    const r = await extractArchive(file, 'Т.tar', dest);
    expect(r.ok).toBe(true);
    expect(paths(r)).toContain('Т/Папка/Договор №7.txt');
    expect(paths(r)).toContain('Т/' + long);
    expect(paths(r)).toContain('Т/Папка/а.txt');
    expect(reasons(r)).toEqual(['../побег.txt:traversal', 'Папка/устр:device', 'Папка/ссылка:link'].sort());
    expect(fs.readdirSync(dest).every((n) => /^\d{6}$/.test(n))).toBe(true);
    if (r.ok) expect(fs.readFileSync(r.entries.find((e) => e.path.endsWith('Договор №7.txt'))!.file, 'utf8')).toBe('два');
  });
  it('tar.gz и tgz читаются; мусор вместо tar — ошибка', async () => {
    const tar = makeTar([{ name: 'к/а.txt', data: 'один' }, { name: 'к/б.txt', data: 'два' }]);
    for (const nm of ['a.tar.gz', 'a.tgz']) {
      const { file, dest } = put(nm, zlib.gzipSync(tar));
      expect(paths(await extractArchive(file, nm, dest))).toEqual(['к/а.txt', 'к/б.txt']);
    }
    const { file, dest } = put('мусор.tar', Buffer.from('x'.repeat(2048)));
    expect(await extractArchive(file, 'мусор.tar', dest)).toMatchObject({ ok: false, error: 'corrupt' });
  });
  it('gzip-бомба: распаковано несоизмеримо больше архива — отказ', async () => {
    const tar = makeTar([{ name: 'к/нули.bin', data: Buffer.alloc(3_000_000, 0) }, { name: 'к/нули2.bin', data: Buffer.alloc(3_000_000, 1) }]);
    const { file, dest } = put('b.tgz', zlib.gzipSync(tar));
    expect(await extractArchive(file, 'b.tgz', dest, { totalRatioFrom: 1_000_000, totalRatio: 50 })).toMatchObject({ ok: false, error: 'bomb' });
  });
});

describe.skipIf(!has7z())('7z (внешний 7z на хосте)', () => {
  it('файлы и подпапки читаются, имена с кириллицей', async () => {
    const src = path.join(dir, 'src'); fs.mkdirSync(path.join(src, 'Папка'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Папка', 'Акт №1.txt'), 'акт один');
    fs.writeFileSync(path.join(src, 'Папка', 'два.txt'), 'два');
    const arc = path.join(dir, 'a.7z');
    const bin = spawnSync('sh', ['-c', 'command -v 7z || command -v 7za || command -v 7zr']).stdout.toString().trim();
    spawnSync(bin, ['a', '-bso0', '-bsp0', arc, 'Папка'], { cwd: src });
    const dest = path.join(dir, 'o7'); fs.mkdirSync(dest);
    const r = await extractArchive(arc, 'Данные.7z', dest);
    expect(r.ok).toBe(true);
    expect(paths(r)).toEqual(['Папка/Акт №1.txt', 'Папка/два.txt']);
  });
  it('архив со ссылкой отклоняется', async () => {
    const src = path.join(dir, 'src2'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    fs.symlinkSync('/etc/passwd', path.join(src, 'link'));
    const arc = path.join(dir, 'l.7z');
    const bin = spawnSync('sh', ['-c', 'command -v 7z || command -v 7za || command -v 7zr']).stdout.toString().trim();
    spawnSync(bin, ['a', '-snl', '-bso0', '-bsp0', arc, '.'], { cwd: src });
    const dest = path.join(dir, 'o8'); fs.mkdirSync(dest);
    const r = await extractArchive(arc, 'л.7z', dest);
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});
