
export const DOC_TYPES = ['statement', 'upd', 'act', 'invoice', 'export1c', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type DocInfo = {
  type: DocType;
  date: string | null;
  from: string | null;
  to: string | null;
  number: string | null;
  inn: string[];
  sum: number | null;
};

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(d: number, m: number, y: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
export function parseDate(s: string): string | null {
  let m = /^\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = /^\s*[«"]?\s*(\d{1,2})\s*[»"]?\s+([а-яё]+)\s+(\d{4})/i.exec(s);
  if (m) { const k = Object.keys(MONTHS).find((x) => m![2].toLowerCase().startsWith(x)); if (k) return ymd(+m[1], MONTHS[k], +m[3]); }
  return null;
}
const DATE = String.raw`(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|[«"]?\d{1,2}[»"]?\s+[а-яё]+\s+\d{4})`;

function money(s: string): number | null {
  const v = Number(s.replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

type Rule = { type: DocType; text?: RegExp; name?: RegExp };
const Б = '(?<![а-яёa-z0-9])', К = '(?![а-яёa-z])', Л = '[а-яё]';
const re = (s: string) => new RegExp(s.replace(/Б/g, Б).replace(/К/g, К).replace(/Л/g, Л), 'i');
const RULES: Rule[] = [
  { type: 'statement',
    text: re('1CClientBankExchange[\\s\\S]*СекцияРасчСчет|выпискЛ*\\s+(по|из|операций\\s+по)\\s+(лицевЛ*|расч[её]тнЛ*|сч[её]тЛ*|картЛ*)|выпискЛ*\\s+операций'),
    name: re('выпискЛ*|vypisk|statement|kl_to_1c') },
  { type: 'export1c',
    text: re('1CClientBankExchange|оборотно-сальдовЛ*\\s+ведомостЛ*|карточкЛ*\\s+сч[её]тЛ*|журналЛ*\\s+проводок|анализЛ*\\s+сч[её]тЛ*|КоммерческаяИнформация|EnterpriseData'),
    name: re('БосвК|osv|оборотно|карточкЛ*[\\s_-]*сч|журналЛ*[\\s_-]*провод|1c_to_kl|выгрузкЛ*[\\s_-]*1с|1c[-_ ]?export') },
  { type: 'upd',
    text: re('универсальнЛ*\\s+передаточнЛ*\\s+документ|БУПДК|сч[её]т-фактурЛ*|товарнЛ*\\s+накладнЛ*|ТОРГ-12'),
    name: re('БупдК|(^|[^a-z])upd([^a-z]|$)|сч[её]т[-_ ]?фактур|(^|[^a-z])sf_|накладн|torg-?12') },
  { type: 'act',
    text: re('БактК\\s*(№|n(?![a-z])|сверки|выполненных|оказанных|при[её]ма|о\\s+при[её]мке)'),
    name: re('БактК|(^|[^a-z])akt([^a-z]|$)|act[-_ ]?sverki|reconciliation') },
  { type: 'invoice',
    text: re('сч[её]т\\s+на\\s+оплату|Бсч[её]т\\s*(№|n(?![a-z]))\\s*\\S+\\s+от|сч[её]т-оферт'),
    name: re('Бсч[её]т(?![-_ ]?фактур)|schet|invoice|(^|[^a-z])bill') },
];

export function classifyDoc(name: string, text: string): DocInfo {
  const head = text.slice(0, 6000);
  const base = name.split('/').pop() ?? name;
  let type: DocType = 'other';
  for (const r of RULES) if (r.text?.test(head)) { type = r.type; break; }
  if (type === 'other') for (const r of RULES) if (r.name?.test(base)) { type = r.type; break; }

  let from: string | null = null, to: string | null = null;
  const per = new RegExp(String.raw`(?<![а-яёa-z])с\s*${DATE}\s*(?:г\.?\s*)?по\s*${DATE}`, 'i').exec(head);
  if (per) { from = parseDate(per[1]); to = parseDate(per[2]); }
  const d1 = /ДатаНачала=(\d{2}\.\d{2}\.\d{4})/.exec(head), d2 = /ДатаКонца=(\d{2}\.\d{2}\.\d{4})/.exec(head);
  if (d1 && d2) { from = parseDate(d1[1]); to = parseDate(d2[1]); }

  let date: string | null = null;
  const own = new RegExp(String.raw`(?:№|N)\s*[\w/-]+\s+от\s+${DATE}`, 'i').exec(head) ?? new RegExp(String.raw`(?<![а-яёa-z0-9])от\s+${DATE}`, 'i').exec(head);
  if (own) date = parseDate(own[1]);
  if (!date && (type === 'statement' || type === 'export1c') && to) date = to;
  if (!date) { const any = new RegExp(DATE, 'i').exec(head); if (any) date = parseDate(any[1]); }
  if (!date) {
    const n = /(\d{4}-\d{2}-\d{2}|\d{1,2}[._]\d{1,2}[._]\d{4})/.exec(base);
    if (n) date = parseDate(n[1].replace(/_/g, '.'));
  }
  if (type === 'statement' && to) date = to;

  const num = /(?:№|N\b)\s*([A-Za-zА-Яа-я0-9/_-]{1,20})/.exec(head);
  const inn = [...new Set([...head.matchAll(/ИНН\s*:?\s*(\d{10}|\d{12})(?!\d)/g)].map((m) => m[1]))].slice(0, 4);
  const s = /(?:всего\s+к\s+оплате|итого\s+к\s+оплате|итого|всего|сумма\s+(?:документа|к\s+оплате))\s*[:\-–]?\s*(?:руб\.?\s*)?(\d[\d\s ]*[.,]\d{2})/i.exec(head);
  return { type, date, from, to, number: num ? num[1] : null, inn, sum: s ? money(s[1]) : null };
}

export function inPeriod(d: Pick<DocInfo, 'date' | 'from' | 'to'>, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const a = d.from ?? d.date, b = d.to ?? d.date;
  if (!a && !b) return false;
  const lo = a ?? b!, hi = b ?? a!;
  return (!to || lo <= to) && (!from || hi >= from);
}
