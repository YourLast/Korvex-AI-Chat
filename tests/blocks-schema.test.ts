import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseBlock } from '@/lib/blocks/parse';
import { blockJsonSchema, LIMITS } from '@/lib/blocks/schema';
import { cmpBy, fmtDate, fmtKop, fmtMoney, fmtNum, fromKop, sumKop, toKop } from '@/lib/blocks/money';

const SRC = { kind: 'calc', basis: 'сверка по номеру, дате и сумме' };
const recon = {
  kx: 1, type: 'table', title: 'Сверка с ООО «Вектор», III кв. 2026', source: SRC, unverified: 1,
  data: {
    preset: 'recon',
    columns: [{ key: 'date', title: 'Дата', kind: 'date' }, { key: 'doc', title: 'Документ' }, { key: 'our', title: 'У нас, ₽', kind: 'money', total: true },
      { key: 'their', title: 'У них, ₽', kind: 'money', total: true }, { key: 'diff', title: 'Разница, ₽', kind: 'money', total: true }],
    rows: [
      { date: '2026-07-14', doc: 'УПД № 318', our: '96000.00', their: null, diff: '96000.00', status: 'neg', note: 'нет в акте контрагента', src: '[[src:УПД_318.pdf|с. 1]]', verified: true },
      { date: '2026-09-03', doc: 'УПД № 402', our: '72000.00', their: null, diff: '72000.00', status: 'warn', note: 'скан читается частично', verified: false },
      { date: '2026-07-01', doc: 'п/п № 1001', our: '10000.00', their: '10000.00', diff: '0.00', status: 'pos' },
    ],
    filters: [{ title: 'Только расхождения', where: { status: ['neg', 'warn'] }, default: true }],
    totals: { our: '178000.00' },
  },
};
const j = (o: unknown) => JSON.stringify(o);

describe('схема блоков', () => {
  it('верные блоки всех видов этапа 1 проходят (файл)', () => {
    expect(parseBlock(j(recon), 'file')).toMatchObject({ ok: true });
    expect(parseBlock(j({ kx: 1, type: 'kpi', title: 'НДС за III кв.', source: SRC, data: { items: [{ label: 'НДС к уплате', value: '184320.00', kind: 'money', unit: '₽', verified: true }, { label: 'Ставка', value: '20', kind: 'percent', verified: false }] } }), 'file')).toMatchObject({ ok: true });
    expect(parseBlock(j({ kx: 1, type: 'deadlines', title: 'Сроки', source: { kind: 'official', url: 'https://www.nalog.gov.ru/' }, data: { items: [{ date: '2026-11-30', orig: '2026-11-28', reason: 'суббота', what: 'Уплата НДС', basis: 'п. 7 ст. 6.1 НК' }] } }), 'file')).toMatchObject({ ok: true });
    expect(parseBlock(j({ kx: 1, type: 'rate', title: 'Курс ЦБ', source: { kind: 'official' }, data: { code: 'AED', amount: '15000' } }), 'fence')).toMatchObject({ ok: true });
  });
  it('вредные и кривые: теги и javascript: остаются текстом/отклоняются, лишние поля, без источника, чужая версия, неизвестный вид', () => {
    const bad = (o: unknown, via: 'file' | 'fence' = 'file') => parseBlock(typeof o === 'string' ? o : j(o), via);
    expect(bad('{oops')).toEqual({ ok: false, err: { code: 'json' } });
    expect(bad('[1,2]')).toEqual({ ok: false, err: { code: 'json' } });
    expect(bad({ ...recon, kx: 2 })).toMatchObject({ ok: false, err: { code: 'version' } });
    expect(bad({ ...recon, type: 'iframe' })).toMatchObject({ ok: false, err: { code: 'type' } });
    expect(bad({ ...recon, source: undefined })).toMatchObject({ ok: false, err: { code: 'schema' } });
    expect(bad({ ...recon, source: { kind: 'calc' } })).toMatchObject({ ok: false, err: { code: 'schema', detail: expect.stringContaining('basis') } });
    expect(bad({ ...recon, onload: 'x' })).toMatchObject({ ok: false, err: { code: 'schema' } });
    expect(bad({ ...recon, source: { kind: 'web', url: 'javascript:alert(1)' } })).toMatchObject({ ok: false, err: { code: 'schema' } });
    expect(bad({ ...recon, data: { ...recon.data, rows: [{ ...recon.data.rows[0], our: '96 000,00' }] } })).toMatchObject({ ok: false, err: { code: 'schema', detail: expect.stringContaining('money') } });
    expect(bad({ ...recon, data: { ...recon.data, rows: [{ ...recon.data.rows[0], hack: '<img onerror>' }] } })).toMatchObject({ ok: false, err: { code: 'schema', detail: expect.stringContaining('hack') } });
    expect(bad({ ...recon, data: { ...recon.data, rows: [{ ...recon.data.rows[0], src: 'javascript:1' }] } })).toMatchObject({ ok: false, err: { code: 'schema' } });
    expect(bad({ ...recon, title: '<script>alert(1)</script>' })).toMatchObject({ ok: true });
  });
  it('пределы: размер, глубина, длина строки, число строк', () => {
    expect(parseBlock('x'.repeat(LIMITS.fenceBytes + 1), 'fence')).toMatchObject({ ok: false, err: { code: 'size' } });
    let deep: unknown = 'x'; for (let i = 0; i < 10; i++) deep = [deep];
    expect(parseBlock(j({ ...recon, data: { ...recon.data, x: deep } }), 'file')).toMatchObject({ ok: false, err: { code: 'depth' } });
    expect(parseBlock(j({ ...recon, data: { ...recon.data, rows: [{ ...recon.data.rows[0], note: 'я'.repeat(LIMITS.str + 1) }] } }), 'file')).toMatchObject({ ok: false, err: { code: 'string' } });
    const many = Array.from({ length: LIMITS.rows + 1 }, () => ({ date: '2026-01-01' }));
    expect(parseBlock(j({ ...recon, data: { columns: [{ key: 'date', title: 'Д', kind: 'date' }], rows: many } }), 'file')).toMatchObject({ ok: false, err: { code: 'schema' } });
  });
  it('ограждение: только малые блоки без посчитанных чисел', () => {
    expect(parseBlock(j(recon), 'fence')).toMatchObject({ ok: false, err: { code: 'fence' } });
    const small = { kx: 1, type: 'table', title: 'Т', source: SRC, data: { columns: [{ key: 's', title: 'Сумма', kind: 'money' }], rows: [{ s: '1.00' }] } };
    expect(parseBlock(j(small), 'fence')).toMatchObject({ ok: false, err: { code: 'fence' } });
    expect(parseBlock(j({ ...small, data: { columns: [{ key: 'd', title: 'Дата', kind: 'date' }, { key: 'w', title: 'Что' }], rows: [{ d: '2026-11-25', w: 'Отчёт' }] } }), 'fence')).toMatchObject({ ok: true });
    expect(parseBlock(j({ kx: 1, type: 'kpi', title: 'K', source: SRC, data: { items: [{ label: 'a', value: '1' }] } }), 'fence')).toMatchObject({ ok: false, err: { code: 'fence' } });
  });
  it('JSON Schema для пакета навыка серва не отстала (src/lib/blocks/kxb.schema.json)', () => {
    const f = path.join(__dirname, '..', 'src/lib/blocks/kxb.schema.json');
    const want = JSON.stringify(blockJsonSchema(), null, 2) + '\n';
    if (process.env.KX_WRITE_SCHEMA === '1') fs.writeFileSync(f, want);
    expect(fs.readFileSync(f, 'utf8')).toBe(want);
  });
});

describe('деньги в копейках', () => {
  it('разбор, сложение без плавающей точки, большие суммы', () => {
    expect(toKop('96000.00')).toBe(9600000n);
    expect(toKop('-40000.5')).toBe(-4000050n);
    expect(toKop('96 000')).toBeNull();
    expect(fromKop(sumKop(['0.10', '0.20', '0.30']))).toBe('0.60');
    expect(fromKop(sumKop(['999999999999999.99', '0.01']))).toBe('1000000000000000.00');
    expect(fromKop(-5n)).toBe('-0.05');
  });
  it('показ по языку', () => {
    expect(fmtMoney('1204560', 'ru')).toBe('1 204 560,00');
    expect(fmtMoney('-40000', 'ru')).toBe('−40 000,00');
    expect(fmtMoney('9720', 'ru', true)).toBe('+9 720,00');
    expect(fmtMoney('0.00', 'ru', true)).toBe('0,00');
    expect(fmtMoney('1204560.5', 'en')).toBe('1,204,560.50');
    expect(fmtNum('22.3088', 'ru')).toBe('22,3088');
    expect(fmtKop(123456n, 'sr')).toBe('1.234,56');
    expect(fmtDate('2026-07-14', 'ru')).toBe('14.07.2026');
    expect(fmtDate('2026-07-14', 'en')).toBe('07/14/2026');
  });
  it('сортировка: деньги по величине, пустые в конце', () => {
    const c = cmpBy('money', 'ru');
    expect(['-40000.00', null, '96000.00', '9720.00'].sort(c)).toEqual(['-40000.00', '9720.00', '96000.00', null]);
    expect(['б', 'А', 'в'].sort(cmpBy('text', 'ru'))).toEqual(['А', 'б', 'в']);
  });
});
