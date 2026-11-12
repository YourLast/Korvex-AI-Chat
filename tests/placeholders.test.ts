import { describe, expect, it } from 'vitest';
import { countUnrecognized, judgeText, meaningfulChars, stripService, unreadableReason } from '@/lib/placeholders';

const SCAN = '[страница 1: скан без текстового слоя, текст не распознан]';
const real = 'Договор поставки № 017 от 01.09.2026 между ООО «Север» и ООО «Юг». Предмет договора: поставка труб.';

describe('служебные метки и заглушки', () => {
  it('метки места не считаются текстом: [page N], [sheet «…» rows a-b], [slide N], [section «…»], [колонтитул: …]', () => {
    const t = '[колонтитул: Договор № 5 / стр. 1]\n\n[page 1]\n[sheet «Лист1» rows 1-40]\n[sheet «Итоги»]\n[slide 3]\n[section «Введение»]';
    expect(meaningfulChars(t)).toBe(0);
    expect(stripService(t).replace(/\s+/g, '')).toBe('');
  });
  it('считает буквы и цифры, а не знаки', () => {
    expect(meaningfulChars('[page 1]\nАб 12 -- !!')).toBe(4);
  });
  it('находит все виды заглушек и считает их', () => {
    const t = [SCAN, '[слайд 2: скан без текстового слоя, текст не распознан]', '[страница 3: скан, ожидает распознавания]', '[страница 4: рисунок не описан]',
      '[лист «Данные»: повреждён, не прочитан]', '[страница: скан без текстового слоя, текст не распознан]'].join('\n');
    expect(countUnrecognized(t)).toBe(6);
    expect(meaningfulChars(t)).toBe(0);
  });
  it('пометки о качестве чтения смысла не несут', () => {
    expect(meaningfulChars('[распознано с низким качеством — проверьте цифры]')).toBe(0);
    expect(meaningfulChars('[проверьте: ИНН 10 цифр]')).toBe(0);
    expect(meaningfulChars('[текст обрезан — файл длиннее окна]')).toBe(0);
  });
  it('карточка «[Файл «X» не прочитан: …]» — причина достаётся', () => {
    expect(unreadableReason('[Файл «a.docx» не прочитан: файл повреждён]')).toBe('файл повреждён');
    expect(unreadableReason('Обычный текст')).toBeNull();
  });
});

describe('judgeText: можно ли принять файл', () => {
  it('одни сканы -> отказ с понятным текстом', () => {
    const v = judgeText(`[page 1]\n${SCAN}\n\n[page 2]\n${SCAN}`, 'scan.pdf');
    expect(v).toEqual({ ok: false, message: 'Файл «scan.pdf» не прочитан: на страницах только сканы или рисунки, текст не распознан' });
  });
  it('пустой текст -> «не нашлось текста»', () => {
    expect(judgeText('  \n', 'e.txt')).toEqual({ ok: false, message: 'В файле «e.txt» не нашлось текста' });
    expect(judgeText('[page 1]', 'e.pdf')).toEqual({ ok: false, message: 'В файле «e.pdf» не нашлось текста' });
  });
  it('metadata.unreadable или карточка «не прочитан» -> отказ с причиной серва', () => {
    expect(judgeText('[Файл «x.docx» не прочитан: пароль]', 'x.docx', true)).toEqual({ ok: false, message: 'Файл «x.docx» не прочитан: пароль' });
    expect(judgeText('[Файл «x.docx» не прочитан: пароль]', 'x.docx')).toEqual({ ok: false, message: 'Файл «x.docx» не прочитан: пароль' });
    expect(judgeText(real, 'x.docx', true).ok).toBe(false);
  });
  it('скан, чуть-чуть текста и заглушка: меньше 20 настоящих символов -> отказ', () => {
    expect(judgeText(`[page 1]\n№ 5\n\n[page 2]\n${SCAN}`, 'a.pdf').ok).toBe(false);
  });
  it('настоящий текст вместе с заглушками -> принят, число нераспознанного возвращается', () => {
    const t = `[page 1]\n${real}\n\n[page 2]\n${SCAN}\n\n[page 3]\n${SCAN}`;
    expect(judgeText(t, 'mix.pdf')).toEqual({ ok: true, unrecognized: 2 });
  });
  it('чистый текст -> принят без нераспознанного', () => {
    expect(judgeText(`[page 1]\n${real}`, 'ok.pdf')).toEqual({ ok: true, unrecognized: 0 });
  });
  it('короткий файл без заглушек (одна фраза в txt) принимается, как раньше', () => {
    expect(judgeText('Привет, мир', 'hi.txt')).toEqual({ ok: true, unrecognized: 0 });
  });
});
