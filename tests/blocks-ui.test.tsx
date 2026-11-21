// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { Markdown } from '@/components/Markdown';
import { BlockEnvCtx, type BlockEnv } from '@/components/blocks/BlockEnv';
import { BlocksCfgProvider, DEFAULT_CFG, type BlocksCfg } from '@/components/blocks/BlocksCfg';
import { divRate, mulRate, parseAmount } from '@/components/blocks/RateBlock';
import { blocksAsLabels, blocksAsText } from '@/lib/blocks/text';
import { summarize } from '@/lib/summary';
import { plainText } from '@/lib/textsearch';
import type { RateView } from '@/lib/blocks/rateTypes';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const recon = {
  kx: 1, type: 'table', title: 'Сверка с ООО «Вектор»', source: { kind: 'calc', basis: 'сверка по номеру, дате и сумме' }, unverified: 1,
  data: {
    preset: 'recon',
    columns: [{ key: 'date', title: 'Дата', kind: 'date' }, { key: 'doc', title: 'Документ' }, { key: 'our', title: 'У нас, ₽', kind: 'money', total: true },
      { key: 'their', title: 'У них, ₽', kind: 'money', total: true }, { key: 'diff', title: 'Разница, ₽', kind: 'money', total: true }],
    rows: [
      { date: '2026-07-14', doc: 'УПД № 318', our: '96000.00', their: null, diff: '96000.00', status: 'neg', note: 'нет в акте контрагента', src: '[[src:УПД_318.pdf|с. 1]]' },
      { date: '2026-08-02', doc: 'п/п № 1147', our: null, their: '40000.00', diff: '-40000.00', status: 'neg', note: 'нет в нашей выписке' },
      { date: '2026-09-03', doc: 'УПД № 402', our: '72000.00', their: null, diff: '72000.00', status: 'warn', note: 'скан читается частично', verified: false },
      { date: '2026-07-01', doc: 'п/п № 1001', our: '0.10', their: '0.10', diff: '0.00', status: 'pos' },
      { date: '2026-07-02', doc: 'п/п № 1002', our: '0.20', their: '0.20', diff: '0.00', status: 'pos' },
    ],
    summary: [{ label: 'Операций', value: '5', note: 'совпало 2' }, { label: 'Сальдо у нас', value: '168000.30', kind: 'money' }],
    filters: [{ title: 'Только расхождения', where: { status: ['neg', 'warn'] }, default: true }],
    totals: { our: '168000.30', their: '40000.30', diff: '128000.00' },
  },
};
const fence = (o: unknown) => '```korvex\n' + JSON.stringify(o) + '\n```';
const HREF = '/out/0123456789abcdef0123456789abcdef/svod.kxb.json';
const nbsp = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

function mount(text: string, env: Partial<BlockEnv> = {}, cfg: BlocksCfg = DEFAULT_CFG) {
  const wrap = (children: ReactNode) => createElement(BlocksCfgProvider, { value: cfg, children: createElement(BlockEnvCtx.Provider, { value: { live: false, ...env } }, children) });
  return render(wrap(createElement(Markdown, { text })));
}

describe('таблица', () => {
  it('файл .kxb.json из снимка: сводка, отбор по умолчанию «Только расхождения», итог по показанным, пометки, источник', async () => {
    mount(`Сверил. 📎 [svod.kxb.json](${HREF}) (2 KB)`, { snap: { files: { [HREF]: recon as never } } });
    const t = await screen.findByTestId('kxb-table');
    expect(within(t).getByText('Сверка с ООО «Вектор»')).toBeTruthy();
    expect(within(t).getAllByTestId('kxb-kpi-card')).toHaveLength(2);
    expect(within(t).getAllByTestId('kxt-row')).toHaveLength(3);
    expect(nbsp(within(t).getByTestId('kxt-total').textContent)).toContain('168 000,00');
    expect(nbsp(within(t).getByTestId('kxb-shown').textContent)).toContain('Показано 3 из 5');
    expect(within(t).getByTestId('kxt-total-all')).toBeTruthy();
    expect(t.textContent).toContain('не сверено: скан читается частично');
    expect(within(t).getByTestId('kxb-unverified').textContent).toBe('⚠ 1 строка не сверена');
    expect(t.textContent).toContain('Расчёт кодом · сверка по номеру, дате и сумме');
    expect(t.querySelector('.kxt-neg')).toBeTruthy();
  });
  it('«Все» — итог в копейках без плавающей точки; сортировка по сумме', async () => {
    mount(fence({ ...recon, data: { ...recon.data, rows: recon.data.rows.slice(3), summary: undefined, filters: undefined, totals: undefined } }).replace('```korvex', '```korvex'), {}, DEFAULT_CFG);
    expect(await screen.findByTestId('kxb-err')).toBeTruthy();
    cleanup();
    mount(`📎 [svod.kxb.json](${HREF})`, { snap: { files: { [HREF]: recon as never } } });
    const t = await screen.findByTestId('kxb-table');
    fireEvent.click(within(t).getByTestId('kxt-filter-all'));
    expect(within(t).getAllByTestId('kxt-row')).toHaveLength(5);
    expect(nbsp(within(t).getByTestId('kxt-total').textContent)).toContain('168 000,30');
    fireEvent.click(within(t).getByTestId('kxt-sort-diff'));
    const first = within(t).getAllByTestId('kxt-row')[0];
    expect(first.textContent).toContain('п/п № 1147');
  });
  it('вид выключен в конфиге — простой вид; «Показать таблицей» на блоке', async () => {
    mount(`📎 [svod.kxb.json](${HREF})`, { snap: { files: { [HREF]: recon as never } } }, { ...DEFAULT_CFG, types: { ...DEFAULT_CFG.types, table: false } });
    expect(await screen.findByTestId('kxb-plainview')).toBeTruthy();
    expect(screen.queryByTestId('kxb-table')).toBeNull();
    cleanup();
    mount(`📎 [svod.kxb.json](${HREF})`, { snap: { files: { [HREF]: recon as never } } }, { ...DEFAULT_CFG, orgs: { org1: { table: false } } });
    expect(await screen.findByTestId('kxb-table')).toBeTruthy();
    cleanup();
    mount(`📎 [svod.kxb.json](${HREF})`, { snap: { files: { [HREF]: recon as never } }, folderId: 'org1' }, { ...DEFAULT_CFG, orgs: { org1: { table: false } } });
    expect(await screen.findByTestId('kxb-plainview')).toBeTruthy();
    cleanup();
    mount(`📎 [svod.kxb.json](${HREF})`, { snap: { files: { [HREF]: recon as never } } });
    fireEvent.click(await screen.findByTestId('kxb-menu'));
    fireEvent.click(await screen.findByTestId('kxb-plain'));
    expect(await screen.findByTestId('kxb-plainview')).toBeTruthy();
    fireEvent.click(screen.getByTestId('kxb-block'));
    expect(await screen.findByTestId('kxb-table')).toBeTruthy();
  });
  it('файл без снимка — читается по ссылке; чужой / нет — карточка «файл блока не открылся»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === HREF ? new Response(JSON.stringify(recon)) : new Response('', { status: 404 }))));
    mount(`📎 [svod.kxb.json](${HREF})`);
    expect(await screen.findByTestId('kxb-table')).toBeTruthy();
    cleanup();
    mount(`[x.kxb.json](/out/ffffffffffffffffffffffffffffffff/x.kxb.json)`);
    expect((await screen.findByTestId('kxb-err')).textContent).toContain('файл блока не открылся');
  });
});

describe('ограждение: пишется, ошибка, малые блоки', () => {
  it('ответ ещё пишется, JSON не дописан — заглушка с названием вида; готов и кривой — карточка с данными', async () => {
    mount('Смотрите:\n\n```korvex\n{"kx":1,"type":"rate","title":"Ку', { live: true });
    expect((await screen.findByTestId('kxb-hold')).textContent).toContain('курс ЦБ');
    cleanup();
    mount('```korvex\n{"kx":1,"type":"rate","title":"Ку\n```');
    const e = await screen.findByTestId('kxb-err');
    expect(e.textContent).toContain('Блок не показан: данные блока не разбираются');
    fireEvent.click(within(e).getByTestId('kxb-err-data'));
    expect(e.querySelector('.kxb-raw')?.textContent).toContain('"type":"rate"');
  });
  it('вредные строки — текстом: тег не становится разметкой', async () => {
    const t = { kx: 1, type: 'table', title: '<img src=x onerror=alert(1)>', source: { kind: 'calc', basis: 'b' }, data: { columns: [{ key: 'w', title: '<b>Что</b>' }], rows: [{ w: '<script>alert(1)</script>' }] } };
    const { container } = mount(fence(t));
    await screen.findByTestId('kxb-table');
    expect(container.querySelector('img, script, b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
  it('версия и вид следующих этапов', async () => {
    mount(fence({ kx: 2, type: 'table', title: 't', source: { kind: 'official' }, data: {} }));
    expect((await screen.findByTestId('kxb-err')).textContent).toContain('неизвестная версия блока (2)');
    cleanup();
    mount(fence({ kx: 1, type: 'map', title: 'Карта', source: { kind: 'official' }, data: { points: [] } }));
    expect((await screen.findByTestId('kxb-err')).textContent).toContain('этот вид блока появится позже');
  });
});

describe('итоговые числа и сроки', () => {
  const kpi = { kx: 1, type: 'kpi', title: 'НДС за III кв.', source: { kind: 'calc', basis: 'книга продаж − книга покупок' }, unverified: 1,
    data: { items: [{ label: 'НДС к уплате', value: '184320.00', kind: 'money', unit: '₽', verified: true, delta: '-1200.00', deltaLabel: 'к II кв.' }, { label: 'Вычеты', value: '1020240.00', kind: 'money', unit: '₽', verified: false }] } };
  it('карточки: значение по языку, изменение со знаком, «не сверено»', async () => {
    mount(`📎 [k.kxb.json](${HREF.replace('svod', 'k')})`, { snap: { files: { [HREF.replace('svod', 'k')]: kpi as never } } });
    const b = await screen.findByTestId('kxb-kpi');
    expect(nbsp(b.textContent)).toContain('184 320,00');
    expect(nbsp(b.textContent)).toContain('−1 200,00 к II кв.');
    expect(within(b).getAllByTestId('kxb-kpi-unverified')).toHaveLength(1);
  });
  it('сроки: по датам, перенос с причиной, «В календарь .ics»', async () => {
    const dl = { kx: 1, type: 'deadlines', title: 'Сроки', source: { kind: 'official', url: 'https://www.nalog.gov.ru/' },
      data: { items: [{ date: '2099-11-30', orig: '2099-11-28', reason: 'суббота', what: 'Уплата НДС', basis: 'п. 7 ст. 6.1 НК' }, { date: '2099-11-25', what: 'Уведомление по ЕНП', basis: 'п. 9 ст. 58 НК' }], calendar: 'Даты посчитаны кодом по производственному календарю' } };
    const ics = vi.fn(async () => new Response('BEGIN:VCALENDAR', { headers: { 'Content-Type': 'text/calendar' } }));
    vi.stubGlobal('fetch', ics);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    mount(`📎 [d.kxb.json](${HREF.replace('svod', 'd')})`, { snap: { files: { [HREF.replace('svod', 'd')]: dl as never } } });
    const b = await screen.findByTestId('kxb-deadlines');
    const rows = within(b).getAllByTestId('kxd-row');
    expect(rows[0].textContent).toContain('Уведомление по ЕНП');
    expect(rows[1].textContent).toContain('перенесено с 28 ноября — суббота');
    expect(b.textContent).toContain('Даты посчитаны кодом');
    await act(async () => { fireEvent.click(within(b).getByTestId('kxb-ics')); });
    expect(ics).toHaveBeenCalledWith('/api/blocks/ics', expect.objectContaining({ method: 'POST' }));
  });
});

describe('курс ЦБ', () => {
  const rate = { kx: 1, type: 'rate', title: 'Курс ЦБ РФ · дирхам ОАЭ', source: { kind: 'official', url: 'https://www.cbr.ru/' }, data: { code: 'AED', amount: '15000' } };
  const view: RateView = { state: 'ok', code: 'AED', name: 'Дирхам ОАЭ', nominal: 1, value: '22.3088', date: '2026-11-20', asked: '2026-11-20', prev: { value: '22.2676', date: '2026-11-19' } };
  it('снимок из meta — без запроса, «На сегодня» — по нажатию; конвертер в обе стороны до копеек', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ...view, value: '22.5000', date: '2026-11-21' })));
    vi.stubGlobal('fetch', f);
    mount(fence(rate), { snap: { rates: { 'AED:': view } } });
    const b = await screen.findByTestId('kxb-rate');
    expect(nbsp(within(b).getByTestId('kxb-rate-value').textContent)).toBe('22,3088 ₽');
    expect(nbsp(within(b).getByTestId('kxb-rate-delta').textContent)).toBe('↑ 0,0412 к 19 ноября');
    expect(b.textContent).toContain('Курс на момент ответа');
    expect(f).not.toHaveBeenCalled();
    await waitFor(() => expect(nbsp((within(b).getByTestId('kxb-rate-rub') as HTMLInputElement).value)).toBe('334 632,00'));
    fireEvent.change(within(b).getByTestId('kxb-rate-rub'), { target: { value: '1 000' } });
    await waitFor(() => expect(nbsp((within(b).getByTestId('kxb-rate-amt') as HTMLInputElement).value)).toBe('44,83'));
    await act(async () => { fireEvent.click(within(b).getByTestId('kxb-rate-today')); });
    await waitFor(() => expect(nbsp(within(b).getByTestId('kxb-rate-value').textContent)).toBe('22,5000 ₽'));
  });
  it('без снимка — с сервера; выходной объясняется; сбой — честная строка и «Повторить»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...view, state: 'holiday', asked: '2026-11-22', date: '2026-11-20' }))));
    mount(fence(rate));
    const b = await screen.findByTestId('kxb-rate');
    await waitFor(() => expect(b.textContent).toContain('На 22 ноября курс не устанавливался — действует курс, установленный на 20 ноября.'));
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'fail', code: 'AED' }))));
    mount(fence(rate));
    const f = await screen.findByTestId('kxb-rate-fail');
    expect(f.textContent).toContain('Курс получить не удалось, проверьте на cbr.ru.');
    expect(within(f).getByTestId('kxb-rate-retry')).toBeTruthy();
  });
  it('конвертер: точная арифметика и ввод человека', () => {
    expect(mulRate('15000', '22.3088')).toBe('334632.00');
    expect(mulRate('0.01', '22.3088')).toBe('0.22');
    expect(divRate('1000', '22.3088')).toBe('44.83');
    expect(mulRate('1', '0.201234')).toBe('0.20');
    expect(parseAmount('15 000,50')).toBe('15000.50');
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('блок как текст', () => {
  it('копирование ответа — текстовой таблицей; уведомление и поиск — подписью', () => {
    const md = `Сверил.\n\n📎 [svod.kxb.json](${HREF}) (2 KB)\n\n${fence({ kx: 1, type: 'rate', title: 'Курс ЦБ', source: { kind: 'official' }, data: { code: 'AED' } })}`;
    const t = blocksAsText(md, 'ru', { files: { [HREF]: recon as never } });
    expect(t).toContain('**Сверка с ООО «Вектор»**');
    expect(t).toContain('| Дата | Документ | У нас, ₽ | У них, ₽ | Разница, ₽ | |');
    expect(nbsp(t)).toContain('| 14.07.2026 | УПД № 318 | 96 000,00 | — | 96 000,00 | нет в акте контрагента |');
    expect(t).toContain('скан читается частично (не сверено)');
    expect(blocksAsLabels(md, 'ru', { files: { [HREF]: recon as never } })).toContain('[таблица: Сверка с ООО «Вектор», 5 строк]');
    expect(blocksAsLabels(md, 'ru')).toContain('[блок: svod]');
    expect(blocksAsLabels(md, 'en')).toContain('[CBR rate: Курс ЦБ AED]');
    expect(summarize(`${fence({ kx: 1, type: 'rate', title: 'Курс ЦБ', source: { kind: 'official' }, data: { code: 'AED' } })}`)).toBe('[курс ЦБ: Курс ЦБ AED]');
    expect(plainText(fence({ kx: 1, type: 'rate', title: 'Курс ЦБ', source: { kind: 'official' }, data: { code: 'AED' } }))).not.toContain('"kx"');
  });
});
