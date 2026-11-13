import { describe, expect, it } from 'vitest';
import { classifyDoc, inPeriod, parseDate } from '@/lib/docType';

const KL_TO_1C = `1CClientBankExchange
ВерсияФормата=1.03
Кодировка=Windows
Отправитель=Бухгалтерия предприятия
ДатаСоздания=02.11.2026
ДатаНачала=01.10.2026
ДатаКонца=31.10.2026
РасчСчет=40702810900000000001
СекцияРасчСчет
ДатаНачала=01.10.2026
КонецРасчСчет
СекцияДокумент=Платежное поручение
Номер=118
Дата=05.10.2026
Сумма=15000.00
ПлательщикИНН=7701234567
КонецДокумента
КонецФайла`;

describe('тип документа', () => {
  it('выписка в формате обмена 1С: тип и период', () => {
    expect(classifyDoc('kl_to_1c.txt', KL_TO_1C)).toMatchObject({ type: 'statement', from: '2026-10-01', to: '2026-10-31', date: '2026-10-31' });
  });
  it('выписка банка PDF: «Выписка по счёту … за период с … по …»', () => {
    const t = 'ПАО Банк\nВыписка по счёту 40702810900000000001\nза период с 01.09.2026 по 30.09.2026\nВходящий остаток 120 000,00';
    expect(classifyDoc('statement_sep.pdf', t)).toMatchObject({ type: 'statement', from: '2026-09-01', to: '2026-09-30', date: '2026-09-30' });
  });
  it('УПД: номер, дата, ИНН, сумма', () => {
    const t = 'Универсальный передаточный документ\nСчёт-фактура № 245 от 14.10.2026\nПродавец: ООО «Ромашка» ИНН 7701234567\nПокупатель: ООО «Лютик» ИНН 7809876543\nВсего к оплате: 118 000,00';
    expect(classifyDoc('doc.pdf', t)).toMatchObject({ type: 'upd', date: '2026-10-14', number: '245', inn: ['7701234567', '7809876543'], sum: 118000 });
  });
  it('акт и акт сверки', () => {
    expect(classifyDoc('a.pdf', 'Акт № 17 от 3 октября 2026 г.\nоказанных услуг').type).toBe('act');
    expect(classifyDoc('a.pdf', 'Акт № 17 от 3 октября 2026 г.')).toMatchObject({ type: 'act', date: '2026-10-03' });
    expect(classifyDoc('b.pdf', 'Акт сверки взаимных расчётов за период с 01.01.2026 по 30.09.2026')).toMatchObject({ type: 'act', from: '2026-01-01', to: '2026-09-30' });
  });
  it('счёт на оплату — не счёт-фактура и не «по счёту»', () => {
    expect(classifyDoc('x.pdf', 'Счёт на оплату № 77 от 20.10.2026\nИтого: 5 400,00')).toMatchObject({ type: 'invoice', date: '2026-10-20', sum: 5400 });
    expect(classifyDoc('x.pdf', 'Счет-фактура № 9 от 01.10.2026').type).toBe('upd');
  });
  it('выгрузки 1С: ОСВ и карточка счёта', () => {
    expect(classifyDoc('osv.xlsx', 'Оборотно-сальдовая ведомость\nПериод: 3 квартал 2026 г.').type).toBe('export1c');
    expect(classifyDoc('k.xlsx', 'Карточка счета 51 за период с 01.10.2026 по 31.10.2026')).toMatchObject({ type: 'export1c', from: '2026-10-01', to: '2026-10-31' });
    expect(classifyDoc('1c_to_kl.txt', '1CClientBankExchange\nСекцияДокумент=Платежное поручение').type).toBe('export1c');
  });
  it('скан без текста — по имени файла; дата из имени', () => {
    expect(classifyDoc('Сканы/УПД_245_2026-10-14.jpg', '')).toMatchObject({ type: 'upd', date: '2026-10-14' });
    expect(classifyDoc('akt_17.png', '').type).toBe('act');
    expect(classifyDoc('Контракт.pdf', '').type).toBe('other');
    expect(classifyDoc('Счет_77_20.10.2026.pdf', '')).toMatchObject({ type: 'invoice', date: '2026-10-20' });
  });
});

describe('даты и период', () => {
  it('разбор дат', () => {
    expect(parseDate('05.10.2026')).toBe('2026-10-05');
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('«3» октября 2026')).toBe('2026-10-03');
    expect(parseDate('31.02.2026')).toBeNull();
  });
  it('в период: документ по дате, выписка — пересечением', () => {
    expect(inPeriod({ date: '2026-10-14', from: null, to: null }, '2026-10-01', '2026-10-31')).toBe(true);
    expect(inPeriod({ date: '2026-11-01', from: null, to: null }, '2026-10-01', '2026-10-31')).toBe(false);
    expect(inPeriod({ date: '2026-10-31', from: '2026-10-01', to: '2026-10-31' }, '2026-10-15', '2026-11-15')).toBe(true);
    expect(inPeriod({ date: null, from: null, to: null }, '2026-10-01', null)).toBe(false);
    expect(inPeriod({ date: null, from: null, to: null }, null, null)).toBe(true);
  });
});

describe('дата «от» без номера и период без слова «период»', () => {
  it('«Договор … от 1 сентября 2026 г.» и «с … по …» внутри строки', () => {
    expect(classifyDoc('x.pdf', 'Приложение к договору поставки от 1 сентября 2026 г.').date).toBe('2026-09-01');
    expect(classifyDoc('x.pdf', 'Сверка расчётов с 01.07.2026 по 30.09.2026')).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
  });
});

describe('кодировка выгрузок 1С', () => {
  it('Windows-1251 читается кириллицей, UTF-8 и UTF-8 с BOM — как есть; выписка распознаётся', async () => {
    const { decodeText } = await import('@/lib/extractNode');
    const src = '1CClientBankExchange\nКодировка=Windows\nДатаНачала=01.10.2026\nДатаКонца=31.10.2026\nСекцияРасчСчет\nКонецРасчСчет\n';
    const cp = Buffer.from(new Uint8Array([...src].map((ch) => { const c = ch.charCodeAt(0); return c < 128 ? c : c === 0x401 ? 0xa8 : c === 0x451 ? 0xb8 : c - 0x410 + 0xc0; })));
    expect(decodeText(cp)).toBe(src);
    expect(decodeText(Buffer.from(src, 'utf8'))).toBe(src);
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(src, 'utf8')]))).toBe(src);
    expect(classifyDoc('kl_to_1c.txt', decodeText(cp))).toMatchObject({ type: 'statement', from: '2026-10-01', to: '2026-10-31' });
  });
});
