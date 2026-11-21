import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { RateView } from './rateTypes';
import { countBlock } from './usage';

export const CBR_BASE = 'https://www.cbr.ru/scripts/';
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;
type Day = { setDate: string; rates: Record<string, { id: string; name: string; nominal: number; unit: string }> };
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; bytes: ArrayBuffer }>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rates-client)' }, cache: 'no-store' });
  return { ok: r.ok, status: r.status, bytes: await r.arrayBuffer() };
};

export function todayMsk(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const isoOf = (d: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
export const addDays = (iso: string, n: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const num = (s: string) => s.trim().replace(/\s/g, '').replace(',', '.');
const decode = (b: ArrayBuffer) => new TextDecoder('windows-1251').decode(b);
const tag = (x: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(x)?.[1] ?? '';

export function parseDaily(xml: string): Day | null {
  const d = /<ValCurs[^>]*\sDate="(\d{2}\.\d{2}\.\d{4})"/.exec(xml)?.[1];
  const setDate = d ? isoOf(d) : null;
  if (!setDate) return null;
  const rates: Day['rates'] = {};
  for (const m of xml.matchAll(/<Valute\s+ID="([^"]+)">([\s\S]*?)<\/Valute>/g)) {
    const body = m[2], code = tag(body, 'CharCode');
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const nominal = Number(tag(body, 'Nominal')) || 1;
    const vu = tag(body, 'VunitRate');
    let unit = vu ? num(vu) : '';
    if (!unit) { const v = Number(num(tag(body, 'Value'))); if (Number.isFinite(v)) unit = (v / nominal).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); }
    if (!/^\d+(\.\d+)?$/.test(unit)) continue;
    rates[code] = { id: m[1], name: tag(body, 'Name'), nominal, unit };
  }
  return Object.keys(rates).length ? { setDate, rates } : null;
}

export function parseDynamic(xml: string): { date: string; value: string }[] {
  const out: { date: string; value: string }[] = [];
  for (const m of xml.matchAll(/<Record\s+Date="(\d{2}\.\d{2}\.\d{4})"[^>]*>([\s\S]*?)<\/Record>/g)) {
    const date = isoOf(m[1]); if (!date) continue;
    const nominal = Number(tag(m[2], 'Nominal')) || 1;
    const vu = tag(m[2], 'VunitRate');
    const value = vu ? num(vu) : (Number(num(tag(m[2], 'Value'))) / nominal).toFixed(4);
    if (/^\d+(\.\d+)?$/.test(value)) out.push({ date, value });
  }
  return out;
}

type Opts = { fetcher?: Fetcher; now?: number };

async function dayFor(asked: string, o: Opts): Promise<{ day: Day; fresh: boolean } | null> {
  const db = getDb(), now = o.now ?? Date.now();
  const row = db.select().from(schema.cbrRates).where(eq(schema.cbrRates.asked, asked)).get();
  const past = asked < todayMsk(now);
  if (row && (past || now - row.fetchedAt < TTL_MS)) return { day: { setDate: row.setDate, rates: row.rates }, fresh: true };
  try {
    const r = await (o.fetcher ?? defaultFetch)(`${CBR_BASE}XML_daily.asp?date_req=${dmy(asked)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const day = parseDaily(decode(r.bytes));
    if (!day) throw new Error('bad xml');
    countBlock('rate', 'cbr');
    db.insert(schema.cbrRates).values({ asked, setDate: day.setDate, rates: day.rates, fetchedAt: now })
      .onConflictDoUpdate({ target: schema.cbrRates.asked, set: { setDate: day.setDate, rates: day.rates, fetchedAt: now } }).run();
    return { day, fresh: true };
  } catch {
    return row ? { day: { setDate: row.setDate, rates: row.rates }, fresh: false } : null;
  }
}

function lastCached(code: string): { setDate: string; rate: Day['rates'][string] } | null {
  const rows = getDb().select().from(schema.cbrRates).all().sort((a, b) => (a.setDate < b.setDate ? 1 : -1));
  for (const r of rows) if (r.rates[code]) return { setDate: r.setDate, rate: r.rates[code] };
  return null;
}

export async function rateFor(code0: string, date?: string | null, range?: { from: string; to: string } | null, o: Opts = {}): Promise<RateView> {
  const code = code0.toUpperCase();
  const now = o.now ?? Date.now();
  const today = todayMsk(now);
  const asked = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  if (code === 'RUB') return { state: 'unknown', code, asked };
  const got = await dayFor(asked, o);
  if (!got) {
    const c = lastCached(code);
    return c ? { state: 'stale', code, name: c.rate.name, nominal: c.rate.nominal, value: c.rate.unit, date: c.setDate, asked, at: now } : { state: 'fail', code, asked };
  }
  const r = got.day.rates[code];
  if (!r) return { state: 'unknown', code, asked };
  const set = got.day.setDate;
  const state: RateView['state'] = !got.fresh ? 'stale' : set === asked ? 'ok' : asked > today ? 'notYet' : 'holiday';
  let prev: RateView['prev'] = null;
  const p = await dayFor(addDays(set, -1), o);
  if (p && p.day.setDate < set && p.day.rates[code]) prev = { value: p.day.rates[code].unit, date: p.day.setDate };
  const out: RateView = { state, code, name: r.name, nominal: r.nominal, value: r.unit, date: set, asked, prev, at: now };
  if (range && range.from <= range.to) {
    try {
      const resp = await (o.fetcher ?? defaultFetch)(`${CBR_BASE}XML_dynamic.asp?date_req1=${dmy(range.from)}&date_req2=${dmy(range.to)}&VAL_NM_RQ=${encodeURIComponent(r.id)}`);
      if (resp.ok) { out.history = parseDynamic(decode(resp.bytes)).slice(-400); countBlock('rate', 'cbr'); }
    } catch {  }
  }
  return out;
}

export function rateDelta(v: string, prev: string): string {
  const k = (s: string) => { const [i, f = ''] = s.split('.'); return BigInt(i) * 10000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };
  const d = k(v) - k(prev), a = d < 0n ? -d : d;
  return `${d < 0n ? '-' : ''}${a / 10000n}.${String(a % 10000n).padStart(4, '0')}`;
}
