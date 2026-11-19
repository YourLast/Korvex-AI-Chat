import { describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
const DOC = [
  'СЧЁТ-ФАКТУРА № 1452 от 03.11.2026',
  'Продавец: ООО «Ромашка», ИНН 7701234567, КПП 770101001',
  'Покупатель: ИП Сидоров Пётр Ильич',
  '| Наименование | Кол-во | Цена | Сумма | НДС |',
  '| Доставка груза Москва — Тверь | 2 | 15 400,00 | 30 800,00 | в т.ч. 5 133,33 |',
  'Итого: 30 800,00, в том числе НДС 20 % — 5 133,33',
  'Главный бухгалтер Кузнецова А. В.',
].join('\n');

describe('docLeak — данные из документа в памяти не остаются', () => {
  it.each([
    ['Из примера: таблица — Наименование, Кол-во, Цена, Сумма, НДС; итог внизу', false],
    ['НДС «в том числе» отдельной колонкой; суммы до копеек', false],
    ['Даты в формате ДД.ММ.ГГГГ; ставка НДС 20 %', false],
    ['Итог: 30 800,00', true],
    ['Счёт № 1452', true],
    ['ИНН продавца 7701234567', true],
    ['Продавец — Ромашка', true],
    ['Покупатель: Сидоров', true],
    ['Подпись — главный бухгалтер Кузнецова', true],
    ['Колонки: Наименование, Кол-во, Цена, Сумма, НДС — шапка как у него', false],
    ['Доставки по маршруту Москва — Тверь', true],
  ])('%s → утечка: %s', (rec, leak) => {
    return import('@/lib/memory').then((M) => expect(M.docLeak(rec as string, [DOC])).toBe(leak));
  });
  it('без вложений — ничего не отбрасывается', async () => {
    const M = await import('@/lib/memory');
    expect(M.docLeak('Счёт № 1452', [])).toBe(false);
  });
});

describe('заметка после примера', () => {
  it('приложил файл — «Понял формат: …» и «верно?», без следующей темы и без данных документа', async () => {
    const M = await import('@/lib/memory');
    const n = M.introNote([] as never, new Set(), ['Прикрепи пример отчёта, если удобно?'], 'ru', ['вот'], false, true);
    expect(n).toContain('«Понял формат: …»');
    expect(n).toContain('«верно?»');
    expect(n).toContain('Ни одной суммы, имени');
    expect(n).not.toContain('Ещё не знаешь');
    expect(M.introNote([] as never, new Set(), ['Attach a sample?'], 'en', ['here'], false, true)).toContain('"Got the format: …"');
  });
  it('ключи: method — rules, sample — style', async () => {
    const M = await import('@/lib/memory');
    expect(M.KEYS.method).toBe('rules');
    expect(M.KEYS.sample).toBe('style');
    expect(M.CURATOR_KEYS).toEqual(expect.arrayContaining(['method', 'sample']));
  });
  it('шаг «покажите пример» — в постоянной инструкции, по желанию, без уговоров', async () => {
    const M = await import('@/lib/memory');
    expect(M.INTRO_RULES).toContain('скрепкой у поля ввода');
    expect(M.INTRO_RULES).toContain('без уговоров');
  });
  it('предложение прикрепить пример без «?» — тоже «спросила» (не повторять)', async () => {
    const M = await import('@/lib/memory');
    expect(M.askedTopics(['Понял. Если удобно, прикрепите один-два типичных документа — посмотрю, в каком виде вы их делаете.']).has('sample')).toBe(true);
  });
  it('EN: «What do you do, and in what role» — вопрос о работе (не переспрашивать)', async () => {
    const M = await import('@/lib/memory');
    expect(M.askedTopics(['Got it. What do you do, and in what role — for yourself or for clients?']).has('work')).toBe(true);
  });
  it('шапка таблицы и заголовок — формат, ячейки данных и «Метка: значение» — данные (B 19.11, реестр A01)', async () => {
    const M = await import('@/lib/memory');
    const REG = ['              Реестр счетов за октябрь 2026', 'Итого: 1 689 657,03, в т. ч. НДС 304 692,25', '   № счета   Дата         Контрагент           ИНН          Сумма с НДС   НДС 22 %',
      '   333-01    24.10.2026   ООО «Пульсар»        0401750304   158 368,83    в т. ч. 28 558,31', '', 'Подготовил: Ершов К. Л.'].join('\n');
    expect(M.docLeak('Из примера: реестр счетов, итоговый блок вверху; колонки — № счета, дата, контрагент, ИНН, сумма с НДС, НДС «в т. ч.»; даты ДД.ММ.ГГГГ; до копеек', [REG])).toBe(false);
    expect(M.docLeak('Основной контрагент — Пульсар', [REG])).toBe(true);
    expect(M.docLeak('Подписывает Ершов', [REG])).toBe(true);
    expect(M.docLeak('Статусы задач: Готово, Ревью', ['Задача №564   Готово   1904   25.11.2026'])).toBe(false);
  });
});
