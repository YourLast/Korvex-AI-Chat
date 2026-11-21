import { z } from 'zod';

export const KX_VERSION = 1;
export const BLOCK_TYPES = ['table', 'kpi', 'rate', 'deadlines', 'chart', 'map', 'party', 'html'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const STAGE1_TYPES = ['table', 'kpi', 'rate', 'deadlines'] as const satisfies readonly BlockType[];

export const LIMITS = { fenceBytes: 2048, fileBytes: 2 * 1024 * 1024, rows: 5000, showRows: 1000, depth: 6, str: 2000, snapshotBytes: 256 * 1024 } as const;

const str = (max: number) => z.string().max(max);
export const SrcMarker = z.string().max(600).regex(/^\[\[src:[^\]\n]{1,580}\]\]$/, 'маркер источника [[src:файл|место]]');
const HttpUrl = z.string().max(2000).regex(/^https?:\/\/[^\s<>"']+$/i, 'ссылка http(s)');
export const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'дата ГГГГ-ММ-ДД');
export const Money = z.string().regex(/^-?\d{1,15}\.\d{2}$/, 'деньги строкой «1234.50»');
export const Num = z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/, 'число строкой «12.5»');

export const Source = z.strictObject({
  kind: z.enum(['calc', 'file', 'web', 'official']),
  basis: str(400).optional(),
  src: SrcMarker.optional(),
  url: HttpUrl.optional(),
  at: str(40).optional(),
}).superRefine((s, ctx) => {
  if (s.kind === 'calc' && !s.basis) ctx.addIssue({ code: 'custom', message: 'у расчёта нужно основание (basis)', path: ['basis'] });
  if (s.kind === 'file' && !s.src) ctx.addIssue({ code: 'custom', message: 'у файла нужен маркер источника (src)', path: ['src'] });
  if (s.kind === 'web' && !s.url) ctx.addIssue({ code: 'custom', message: 'у страницы нужен адрес (url)', path: ['url'] });
});

export const COL_KINDS = ['text', 'date', 'money', 'number', 'percent', 'status'] as const;
export const STATUS = ['pos', 'neg', 'warn', 'off', 'miss_our', 'miss_their', 'amount', ''] as const;
const ColKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'ключ столбца: латиница, цифры, _');
const RESERVED = new Set(['status', 'note', 'src', 'verified']);
export const Column = z.strictObject({
  key: ColKey.refine((k) => !RESERVED.has(k), 'ключ занят служебным полем строки'),
  title: str(60),
  kind: z.enum(COL_KINDS).default('text'),
  total: z.boolean().optional(),
});
export const Row = z.record(z.string(), z.union([z.string().max(LIMITS.str), z.boolean(), z.null()]));
export const Filter = z.strictObject({
  title: str(40),
  where: z.record(z.string(), z.array(str(60)).max(20)),
  default: z.boolean().optional(),
});
export const KpiItem = z.strictObject({
  label: str(60),
  value: Num,
  kind: z.enum(['money', 'number', 'percent']).default('number'),
  unit: str(12).optional(),
  delta: Num.optional(),
  deltaLabel: str(40).optional(),
  note: str(80).optional(),
  tone: z.enum(['pos', 'neg', 'warn', '']).optional(),
  basis: str(200).optional(),
  src: SrcMarker.optional(),
  verified: z.boolean().optional(),
});
export const TableData = z.strictObject({
  columns: z.array(Column).min(1).max(20),
  rows: z.array(Row).max(LIMITS.rows),
  preset: z.enum(['recon', 'postings', 'registry']).optional(),
  filters: z.array(Filter).max(8).optional(),
  totals: z.record(z.string(), Money).optional(),
  summary: z.array(KpiItem).max(4).optional(),
  more: z.number().int().min(0).optional(),
}).superRefine((d, ctx) => {
  const keys = new Map(d.columns.map((c) => [c.key, c.kind]));
  if (keys.size !== d.columns.length) ctx.addIssue({ code: 'custom', message: 'ключи столбцов повторяются', path: ['columns'] });
  const check: Record<string, (v: string) => boolean> = {
    date: (v) => IsoDate.safeParse(v).success, money: (v) => Money.safeParse(v).success,
    number: (v) => Num.safeParse(v).success, percent: (v) => Num.safeParse(v).success, status: (v) => (STATUS as readonly string[]).includes(v),
  };
  d.rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(r)) {
      if (k === 'verified') { if (typeof v !== 'boolean') ctx.addIssue({ code: 'custom', message: 'verified — true/false', path: ['rows', i, k] }); continue; }
      if (k === 'status') { if (v !== null && !(STATUS as readonly string[]).includes(String(v))) ctx.addIssue({ code: 'custom', message: 'статус: pos, neg, warn, off, miss_our, miss_their, amount', path: ['rows', i, k] }); continue; }
      if (k === 'src') { if (v !== null && !SrcMarker.safeParse(v).success) ctx.addIssue({ code: 'custom', message: 'маркер источника [[src:…]]', path: ['rows', i, k] }); continue; }
      if (k === 'note') { if (typeof v === 'boolean') ctx.addIssue({ code: 'custom', message: 'пометка — текстом', path: ['rows', i, k] }); continue; }
      const kind = keys.get(k);
      if (!kind) { ctx.addIssue({ code: 'custom', message: `лишнее поле строки «${k}»`, path: ['rows', i, k] }); continue; }
      if (v === null || v === '') continue;
      if (typeof v !== 'string') { ctx.addIssue({ code: 'custom', message: 'значение — строкой', path: ['rows', i, k] }); continue; }
      const ok = check[kind];
      if (ok && !ok(v)) ctx.addIssue({ code: 'custom', message: `«${v.slice(0, 30)}» не ${kind}`, path: ['rows', i, k] });
    }
  });
  for (const k of Object.keys(d.totals ?? {})) if (keys.get(k) !== 'money') ctx.addIssue({ code: 'custom', message: `итог по «${k}»: столбец не денежный`, path: ['totals', k] });
  for (const [fi, f] of (d.filters ?? []).entries()) for (const k of Object.keys(f.where)) if (!keys.has(k) && k !== 'status') ctx.addIssue({ code: 'custom', message: `отбор по неизвестному столбцу «${k}»`, path: ['filters', fi, 'where', k] });
});

export const KpiData = z.strictObject({ items: z.array(KpiItem).min(1).max(6) });

export const RateData = z.strictObject({
  code: z.string().regex(/^[A-Z]{3}$/, 'код валюты: три латинские буквы'),
  date: IsoDate.optional(),
  amount: Num.optional(),
  range: z.strictObject({ from: IsoDate, to: IsoDate }).optional(),
});

export const DeadlineItem = z.strictObject({
  date: IsoDate,
  orig: IsoDate.optional(),
  reason: str(120).optional(),
  what: str(200),
  basis: str(120).optional(),
  src: SrcMarker.optional(),
  verified: z.boolean().optional(),
});
export const DeadlinesData = z.strictObject({
  items: z.array(DeadlineItem).min(1).max(200),
  calendar: str(160).optional(),
});

const Later = z.unknown();

const base = {
  kx: z.literal(KX_VERSION),
  title: str(120),
  source: Source,
  unverified: z.number().int().min(0).max(1_000_000).optional(),
};
export const Block = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('table'), data: TableData }),
  z.strictObject({ ...base, type: z.literal('kpi'), data: KpiData }),
  z.strictObject({ ...base, type: z.literal('rate'), data: RateData }),
  z.strictObject({ ...base, type: z.literal('deadlines'), data: DeadlinesData }),
  z.strictObject({ ...base, type: z.literal('chart'), data: Later }),
  z.strictObject({ ...base, type: z.literal('map'), data: Later }),
  z.strictObject({ ...base, type: z.literal('party'), data: Later }),
  z.strictObject({ ...base, type: z.literal('html'), data: Later }),
]);
export type Block = z.infer<typeof Block>;
export type TableBlock = Extract<Block, { type: 'table' }>;
export type KpiBlock = Extract<Block, { type: 'kpi' }>;
export type RateBlock = Extract<Block, { type: 'rate' }>;
export type DeadlinesBlock = Extract<Block, { type: 'deadlines' }>;
export type Column = z.infer<typeof Column>;
export type KpiItem = z.infer<typeof KpiItem>;

export function blockJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Block, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
}
