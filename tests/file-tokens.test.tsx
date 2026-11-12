// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nProvider } from '@/lib/i18n/react';
import type { Lang } from '@/lib/i18n/core';
import { exactTokens, fileTok, setExactTokens, sumTok, tokText, type ExactTok } from '@/lib/fileTokens';
import { FileCard } from '@/components/Message';
import { UpRow, type Up } from '@/components/UpRow';
import { FolderCard } from '@/components/FolderCard';
import FileViewer from '@/components/FileViewer';
import { _resetFileView, closeFile, openFile, setChatFiles } from '@/lib/fileView';
import { groupByFolder } from '@/lib/upload/paths';
import type { FileChip, MemoryInfo } from '@/lib/types';

vi.mock('@/components/fileview/PdfView', () => ({ PdfView: () => null }));

const wrap = (lang: Lang, el: React.ReactElement) => createElement(I18nProvider, { lang, children: el });
const EX = (o: Record<string, number | null>, exact = true): ExactTok => ({ byName: new Map(Object.entries(o)), exact });
const mem = (file_list: MemoryInfo['file_list'], o: Partial<MemoryInfo> = {}): MemoryInfo => ({ total_tokens: 90000, files_tokens: 86016, files: 1, chat_tokens: 100, web_tokens: 0, limit_tokens: 5_767_168, remaining_tokens: 5_000_000, exact: true, file_list, ...o });
const ans = (memory: MemoryInfo | null) => ({ role: 'assistant', meta: { memory } });

beforeEach(() => {
  _resetFileView(); setExactTokens(EX({}, false)); setChatFiles([]);
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); closeFile(); setExactTokens(EX({}, false)); });

const PDF: FileChip = { id: 'p1', name: 'Договор/Соглашение PayPal.pdf', size: 1_153_434, mime: 'application/pdf', tokens: 86_016, info: { format: 'pdf', pages: 146 } };

describe('текст «≈ 84K ток.»', () => {
  it('оценка — с «≈», точное — без; три языка; коротко: 12K, 1,2M', () => {
    expect(tokText('en', { n: 86_016, exact: false })).toBe('≈ 84K tokens');
    expect(tokText('en', { n: 86_016, exact: true })).toBe('84K tokens');
    expect(tokText('ru', { n: 86_016, exact: false })).toBe('≈ 84K ток.');
    expect(tokText('sr', { n: 86_016, exact: true })).toBe('84K tokena');
    expect(tokText('en', { n: 12_288, exact: true })).toBe('12K tokens');
    expect(tokText('en', { n: 1_258_291, exact: false })).toBe('≈ 1.2M tokens');
    expect(tokText('ru', { n: 1_258_291, exact: false })).toBe('≈ 1,2M ток.');
    expect(tokText('sr', { n: 1_258_291, exact: true })).toBe('1,2M tokena');
    expect(tokText('en', { n: 850, exact: true })).toBe('850 tokens');
  });
});

describe('откуда число (fileTok / exactTokens)', () => {
  it('точное от серва главнее оценки; имя — без учёта регистра и формы Unicode; пометка exact берётся из сводки серва', () => {
    const f = { name: 'Договор/Соглашение PayPal.pdf', tokens: 70_000 };
    expect(fileTok(f)).toEqual({ n: 70_000, exact: false });
    expect(fileTok(f, EX({ 'договор/соглашение paypal.pdf': 86_016 }))).toEqual({ n: 86_016, exact: true });
    expect(fileTok(f, EX({ 'договор/соглашение paypal.pdf': 86_016 }, false))).toEqual({ n: 86_016, exact: false });
    expect(fileTok({ name: 'Й.pdf', tokens: 1 }, EX({ [('й.pdf').normalize('NFC')]: 50 }))).toEqual({ n: 50, exact: true });
  });
  it('картинка, файл «сохранён без разбора», нет ни оценки, ни числа от серва — не показываем', () => {
    expect(fileTok({ name: 'a.jpg', tokens: 0, mime: 'image/jpeg' })).toBeNull();
    expect(fileTok({ name: 'a.jpg', tokens: 500, mime: 'image/jpeg' })).toBeNull();
    expect(fileTok({ name: 'a.bin', tokens: 30, info: { unparsed: true } })).toBeNull();
    expect(fileTok({ name: 'a.pdf' })).toBeNull();
    expect(fileTok({ name: 'a.pdf', tokens: 0 })).toBeNull();
  });
  it('exactTokens: последний ответ, у которого есть file_list; картинки и нули пропускаются; два файла с одним именем — не угадываем', () => {
    const e = exactTokens([
      ans(mem([{ name: 'старый.pdf', tokens: 1, kind: 'file' }])),
      { role: 'user', meta: null },
      ans(mem([{ name: 'a.pdf', tokens: 86_016, kind: 'file' }, { name: 'p.png', tokens: 2257, kind: 'image' }, { name: 'z.txt', tokens: 0 }, { name: 'd.docx', tokens: 10 }, { name: 'D.docx', tokens: 20 }])),
      ans(null),
    ]);
    expect([...e.byName]).toEqual([['a.pdf', 86_016], ['d.docx', null]]);
    expect(e.exact).toBe(true);
    expect(fileTok({ name: 'd.docx', tokens: 15 }, e)).toEqual({ n: 15, exact: false });
    expect(exactTokens([ans(mem([{ name: 'a.pdf', tokens: 5 }], { exact: false }))]).exact).toBe(false);
    expect(exactTokens([]).byName.size).toBe(0);
    expect(exactTokens([ans(mem(undefined))]).byName.size).toBe(0);
  });
  it('сумма по папке: «≈», если хоть одно число — оценка', () => {
    const fs = [{ name: 'a.pdf', tokens: 100 }, { name: 'b.pdf', tokens: 200 }, { name: 'c.jpg', mime: 'image/jpeg', tokens: 0 }];
    expect(sumTok(fs)).toEqual({ n: 300, exact: false });
    expect(sumTok(fs, EX({ 'a.pdf': 150, 'b.pdf': 250 }))).toEqual({ n: 400, exact: true });
    expect(sumTok(fs, EX({ 'a.pdf': 150 }))).toEqual({ n: 350, exact: false });
    expect(sumTok([fs[2]])).toBeNull();
  });
});

describe('отправленный файл в сообщении', () => {
  const sub = () => document.querySelector('[data-testid=sent-file] small')!.textContent!.replace(/ /g, ' ');
  it('EN: «Договор · 1.1 MB · 146 pages · ≈ 84K tokens»; после ответа серва — «84K tokens» без «≈»', () => {
    render(wrap('en', createElement(FileCard, { f: PDF })));
    expect(sub()).toBe('Договор · 1.1 MB · 146 pages · ≈ 84K tokens');
    act(() => setExactTokens(EX({ 'договор/соглашение paypal.pdf': 86_016 })));
    expect(sub()).toBe('Договор · 1.1 MB · 146 pages · 84K tokens');
  });
  it('RU и SR', () => {
    render(wrap('ru', createElement(FileCard, { f: PDF })));
    expect(sub()).toContain('146 стр. · ≈ 84K ток.');
    cleanup();
    render(wrap('sr', createElement(FileCard, { f: PDF })));
    expect(sub()).toContain('146 str. · ≈ 84K tokena');
  });
  it('картинка и файл без оценки — как раньше, без токенов', () => {
    render(wrap('en', createElement(FileCard, { f: { id: 'x', name: 'scan.pdf', size: 2048 } })));
    expect(sub()).toBe('2 KB');
  });
});

describe('поле ввода до отправки (для всех, не только админа; чип узкий — размер и токены, без страниц)', () => {
  const up = (o: Partial<Up> = {}): Up => ({ tmp: 't1', name: 'Соглашение.pdf', size: 1_153_434, status: 'ready', chip: { id: 'p1', name: 'Соглашение.pdf', size: 1_153_434, mime: 'application/pdf', tokens: 86_016, info: { format: 'pdf', pages: 146 } }, ...o });
  const meta = () => document.querySelector('[data-testid=up-chip] small')!.textContent!.replace(/ /g, ' ');
  it('«1.1 MB · ≈ 84K tokens» (чип узкий — без страниц) — оценка, пока серв не прочитал файл', () => {
    render(wrap('en', createElement(UpRow, { items: [up()], onRemove: () => {} })));
    expect(meta()).toBe('1.1 MB · ≈ 84K tokens');
    act(() => setExactTokens(EX({ 'соглашение.pdf': 86_016 })));
    expect(meta()).toBe('1.1 MB · 84K tokens');
  });
  it('читается — «reading the file…», без числа; ошибка — её текст; оценки нет — только размер', () => {
    render(wrap('en', createElement(UpRow, { items: [up({ status: 'uploading', chip: undefined })], onRemove: () => {} })));
    expect(meta()).toBe('reading the file…');
    cleanup();
    render(wrap('en', createElement(UpRow, { items: [up({ chip: { id: 'p1', name: 'a.pdf', size: 2048 } })], onRemove: () => {} })));
    expect(meta()).toBe('1.1 MB');
  });
  it('картинка (миниатюра) токенов не показывает', () => {
    render(wrap('en', createElement(UpRow, { items: [up({ img: true, name: 'a.jpg', chip: { id: 'i', name: 'a.jpg', size: 100, mime: 'image/jpeg', tokens: 0 } })], onRemove: () => {} })));
    expect(document.body.textContent).not.toMatch(/tokens/);
  });
});

describe('карточка папки', () => {
  it('итог по файлам: «300 files · … · ≈ 12K tokens», у файла в списке — своё число', () => {
    const files: FileChip[] = Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, name: `Акты/акт_${i}.pdf`, size: 1000, tokens: 4096 }));
    const g = groupByFolder(files).groups[0];
    render(wrap('en', createElement(FolderCard, { g })));
    expect(screen.getByTestId('folder-toggle').textContent).toContain('≈ 12K tokens');
    fireEvent.click(screen.getByTestId('folder-toggle'));
    expect(screen.getAllByTestId('folder-file')[0].textContent).toContain('≈ 4K tokens');
  });
});

describe('шапка панели «Файл»', () => {
  it('«Договор · стр. … · 1.1 MB · ≈ 84K tokens»; серв ответил — без «≈»', async () => {
    setChatFiles([PDF]);
    render(wrap('en', createElement(FileViewer)));
    act(() => openFile({ id: PDF.id, name: PDF.name, at: { kind: 'page', page: 33 } as never }));
    const small = () => document.querySelector('.fv-title small')!.textContent!.replace(/ /g, ' ');
    expect(small()).toMatch(/1\.1 MB · ≈ 84K tokens$/);
    act(() => setExactTokens(EX({ 'договор/соглашение paypal.pdf': 86_016 })));
    expect(small()).toMatch(/1\.1 MB · 84K tokens$/);
    expect(small()).toContain('Договор');
  });
});
