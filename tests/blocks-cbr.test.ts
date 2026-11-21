import { describe, expect, it } from 'vitest';
import { tmpData } from './helpers';

tmpData();
const enc = (s: string) => {
  const map: Record<string, number> = {};
  for (let i = 0; i < 64; i++) map[String.fromCharCode(0x410 + i)] = 0xc0 + i;
  map['Ё'] = 0xa8; map['ё'] = 0xb8;
  return new Uint8Array([...s].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : map[c] ?? 0x3f))).buffer;
};
const daily = (date: string, aed: string, huf = '20,1234') => `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="${date}" name="Foreign Currency Market">`
  + `<Valute ID="R01230"><NumCode>784</NumCode><CharCode>AED</CharCode><Nominal>1</Nominal><Name>Дирхам ОАЭ</Name><Value>${aed}</Value><VunitRate>${aed}</VunitRate></Valute>`
  + `<Valute ID="R01135"><NumCode>348</NumCode><CharCode>HUF</CharCode><Nominal>100</Nominal><Name>Форинтов</Name><Value>${huf}</Value><VunitRate></VunitRate></Valute></ValCurs>`;
const SETS: Record<string, [string, string]> = {
  '20/11/2026': ['20.11.2026', '22,3088'], '21/11/2026': ['20.11.2026', '22,3088'], '22/11/2026': ['20.11.2026', '22,3088'], '23/11/2026': ['20.11.2026', '22,3088'],
  '19/11/2026': ['19.11.2026', '22,2676'], '18/11/2026': ['18.11.2026', '22,4500'], '17/11/2026': ['17.11.2026', '22,5000'], '16/11/2026': ['14.11.2026', '22,3600'], '15/11/2026': ['14.11.2026', '22,3600'],
  '14/11/2026': ['14.11.2026', '22,3600'], '13/11/2026': ['13.11.2026', '22,3000'],
};
function cbr() {
  const calls: string[] = [];
  let down = false;
  const fetcher = async (url: string) => {
    calls.push(url);
    if (down) throw new Error('ECONNRESET');
    const q = /date_req=([\d/]+)/.exec(url)?.[1] ?? '';
    if (url.includes('XML_dynamic')) return { ok: true, status: 200, bytes: enc('<ValCurs ID="R01230"><Record Date="18.11.2026" Id="R01230"><Nominal>1</Nominal><Value>22,4500</Value><VunitRate>22,45</VunitRate></Record><Record Date="19.11.2026" Id="R01230"><Nominal>1</Nominal><Value>22,2676</Value><VunitRate>22,2676</VunitRate></Record></ValCurs>') };
    const s = SETS[q];
    return s ? { ok: true, status: 200, bytes: enc(daily(s[0], s[1])) } : { ok: false, status: 500, bytes: new ArrayBuffer(0) };
  };
  return { calls, fetcher, setDown: (v: boolean) => { down = v; } };
}
const NOW = Date.parse('2026-11-20T12:00:00+03:00');

describe('курс ЦБ', () => {
  it('разбор XML: windows-1251, запятая, номинал 100 -> за 1', async () => {
    const { parseDaily } = await import('@/lib/blocks/cbr');
    const d = parseDaily(new TextDecoder('windows-1251').decode(enc(daily('20.11.2026', '22,3088'))))!;
    expect(d.setDate).toBe('2026-11-20');
    expect(d.rates.AED).toEqual({ id: 'R01230', name: 'Дирхам ОАЭ', nominal: 1, unit: '22.3088' });
    expect(d.rates.HUF.unit).toBe('0.201234');
  });
  it('на сегодня: дата из ответа, изменение к предыдущему установленному', async () => {
    const { rateFor, rateDelta } = await import('@/lib/blocks/cbr');
    const c = cbr();
    const r = await rateFor('aed', null, null, { fetcher: c.fetcher, now: NOW });
    expect(r).toMatchObject({ state: 'ok', code: 'AED', name: 'Дирхам ОАЭ', value: '22.3088', date: '2026-11-20', asked: '2026-11-20', prev: { value: '22.2676', date: '2026-11-19' } });
    expect(rateDelta(r.value!, r.prev!.value)).toBe('0.0412');
    expect(rateDelta('22.2676', '22.45')).toBe('-0.1824');
  });
  it('выходной — курс, установленный на пятницу; будущее — «ещё не установил»', async () => {
    const { rateFor } = await import('@/lib/blocks/cbr');
    const c = cbr();
    expect(await rateFor('AED', '2026-11-15', null, { fetcher: c.fetcher, now: NOW })).toMatchObject({ state: 'holiday', date: '2026-11-14', asked: '2026-11-15' });
    expect(await rateFor('AED', '2026-11-23', null, { fetcher: c.fetcher, now: NOW })).toMatchObject({ state: 'notYet', date: '2026-11-20', asked: '2026-11-23' });
  });
  it('кэш: прошедшая дата — без повторного запроса; сегодня — через 30 минут; сбой ЦБ — сохранённый (stale) или отказ', async () => {
    const { rateFor } = await import('@/lib/blocks/cbr');
    const c = cbr();
    await rateFor('AED', '2026-11-18', null, { fetcher: c.fetcher, now: NOW });
    const n = c.calls.length;
    await rateFor('AED', '2026-11-18', null, { fetcher: c.fetcher, now: NOW + 86400_000 });
    expect(c.calls.length).toBe(n);
    c.setDown(true);
    expect(await rateFor('AED', null, null, { fetcher: c.fetcher, now: NOW + 5 * 60_000 })).toMatchObject({ state: 'ok', value: '22.3088' });
    expect(await rateFor('AED', null, null, { fetcher: c.fetcher, now: NOW + 40 * 60_000 })).toMatchObject({ state: 'stale', value: '22.3088', date: '2026-11-20' });
    expect(await rateFor('AED', '2027-03-01', null, { fetcher: c.fetcher, now: NOW + 40 * 60_000 })).toMatchObject({ state: 'stale', date: '2026-11-20' });
    expect(await rateFor('XYZ', '2027-03-02', null, { fetcher: c.fetcher, now: NOW })).toMatchObject({ state: 'fail' });
  });
  it('неизвестная валюта и рубль; история за период', async () => {
    const { rateFor } = await import('@/lib/blocks/cbr');
    const c = cbr();
    expect(await rateFor('XYZ', '2026-11-19', null, { fetcher: c.fetcher, now: NOW })).toMatchObject({ state: 'unknown' });
    expect(await rateFor('RUB', null, null, { fetcher: c.fetcher, now: NOW })).toMatchObject({ state: 'unknown' });
    const h = await rateFor('AED', '2026-11-19', { from: '2026-11-18', to: '2026-11-19' }, { fetcher: c.fetcher, now: NOW });
    expect(h.history).toEqual([{ date: '2026-11-18', value: '22.45' }, { date: '2026-11-19', value: '22.2676' }]);
    expect(c.calls.some((u) => u.startsWith('https://www.cbr.ru/scripts/XML_dynamic.asp?') && u.includes('VAL_NM_RQ=R01230'))).toBe(true);
    expect(c.calls.every((u) => u.startsWith('https://www.cbr.ru/scripts/'))).toBe(true);
  });
});
