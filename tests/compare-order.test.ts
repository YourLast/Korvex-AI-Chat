import { describe, expect, it } from 'vitest';
import { orderByNames, orderByTexts, shortLabels } from '@/lib/compareOrder';

describe('порядок по именам файлов (-1 — как есть, 1 — поменять, 0 — не определить)', () => {
  it('год в имени', () => {
    expect(orderByNames('Положение_ред_2025.pdf', 'Положение_ред_2026.pdf')).toBe(-1);
    expect(orderByNames('Положение_ред_2026.pdf', 'Положение_ред_2025.pdf')).toBe(1);
    expect(orderByNames('Акты/Положение 2026.docx', 'Положение 2024.docx')).toBe(1);
  });
  it('номер редакции и версии: «ред_2», «редакция 3», «v2», «rev 10» (числа сравниваются как числа)', () => {
    expect(orderByNames('Положение_ред_3.docx', 'Положение_ред_2.docx')).toBe(1);
    expect(orderByNames('Устав редакция 2.pdf', 'Устав редакция 3.pdf')).toBe(-1);
    expect(orderByNames('договор_v10.docx', 'договор_v2.docx')).toBe(1);
    expect(orderByNames('spec rev 2.pdf', 'spec rev 10.pdf')).toBe(-1);
  });
  it('дата в имени: дд.мм.гггг, гггг-мм-дд', () => {
    expect(orderByNames('Приказ от 12.12.2025.pdf', 'Приказ от 03.03.2026.pdf')).toBe(-1);
    expect(orderByNames('Приказ от 03.03.2026.pdf', 'Приказ от 12.12.2025.pdf')).toBe(1);
    expect(orderByNames('report_2026-03-01.pdf', 'report_2025-12-31.pdf')).toBe(1);
  });
  it('различия без чисел или одинаковые имена — порядок не определить', () => {
    expect(orderByNames('Договор А.pdf', 'Договор Б.pdf')).toBe(0);
    expect(orderByNames('a.pdf', 'b.pdf')).toBe(0);
    expect(orderByNames('Акт.pdf', 'Акт.pdf')).toBe(0);
  });
});

describe('порядок по датам в начале текста', () => {
  const t25 = 'ПОЛОЖЕНИЕ\nУтверждено приказом генерального директора № 17-ОД от 12.12.2024\nРедакция № 1, действует с 01.01.2025\nОбщие положения';
  const t26 = 'ПОЛОЖЕНИЕ\nУтверждено приказом генерального директора № 21-ОД от 11.12.2025\nРедакция № 2, действует с 01.01.2026\nОбщие положения';
  it('номер редакции, «действует с», «от»', () => {
    expect(orderByTexts(t25, t26)).toBe(-1);
    expect(orderByTexts(t26, t25)).toBe(1);
    expect(orderByTexts(t26.replace('Редакция № 2, ', ''), t25.replace('Редакция № 1, ', ''))).toBe(1);
    expect(orderByTexts('Приказ от 11.12.2025', 'Приказ от 12.12.2024')).toBe(1);
    expect(orderByTexts('Договор от 5 марта 2026 г.', 'Договор от 20 июля 2025 г.')).toBe(1);
  });
  it('нет дат или они совпадают — не определить', () => {
    expect(orderByTexts('Текст без дат', 'Другой текст')).toBe(0);
    expect(orderByTexts('от 01.01.2026', 'от 01.01.2026')).toBe(0);
  });
});

describe('подпись колонки — только отличающаяся часть', () => {
  it('«ред. 2025» / «ред. 2026»', () => {
    expect(shortLabels('Положение_о_первичных_документах_ред_2025.pdf', 'Положение_о_первичных_документах_ред_2026.pdf')).toEqual(['ред. 2025', 'ред. 2026']);
    expect(shortLabels('Акты/Устав редакция 2.docx', 'Акты/Устав редакция 3.docx')).toEqual(['ред. 2', 'ред. 3']);
    expect(shortLabels('договор_v2.docx', 'договор_v10.docx')).toEqual(['v2', 'v10']);
  });
  it('без слова-метки — само различие; нечего сократить — полное имя без расширения', () => {
    expect(shortLabels('Приказ 2025 итог.pdf', 'Приказ 2026 итог.pdf')).toEqual(['2025', '2026']);
    expect(shortLabels('Договор А.pdf', 'Договор Б.pdf')).toEqual(['А', 'Б']);
    expect(shortLabels('Акт.pdf', 'Акт.pdf')).toEqual(['Акт', 'Акт']);
    expect(shortLabels('Акт.pdf', 'Акт_исправленный_и_дополненный_вариант_для_подписи.pdf')).toEqual(['Акт', 'Акт_исправленный_и_дополненный_вариант_для_подписи']);
  });
});
