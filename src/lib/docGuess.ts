import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import { listMemory, similarity, SAME, type Section } from './memory';

export const HEAD_CHARS = 1500;
export const MAX_DOC_GUESSES = 3;
export type DocGuess = { section: Section; text: string };

const PROGRAMS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/1[СC][:\s«"]*Бухгалтери\S*(?:\s+предприятия)?(?:[,\s]+(?:редакция\s+)?(3\.0|8\.3|2\.0))?/iu, (m) => `1С:Бухгалтерия${m[1] ? ' ' + m[1] : ''}`],
  [/1[СC][:\s«"]*Зарплата\s+и\s+управление\s+персоналом|(?<![\p{L}])ЗУП(?![\p{L}])/iu, () => '1С:ЗУП'],
  [/1[СC][:\s«"]*Управление\s+торговлей/iu, () => '1С:Управление торговлей'],
  [/1[СC][:\s«"]*Комплексная\s+автоматизация/iu, () => '1С:Комплексная автоматизация'],
  [/1[СC][:\s«"]*Предприятие/iu, () => '1С'],
  [/Контур[.\s]*(Экстерн|Бухгалтерия)/iu, (m) => `Контур.${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`],
  [/(?<![\p{L}])СБИС(?![\p{L}])/u, () => 'СБИС'],
  [/Мо[её]\s+дело/iu, () => 'Моё дело'],
];
const REGIMES: [RegExp, string][] = [
  [/(автоматизированн\S*\s+упрощ\S*|(?<![\p{L}])АУСН(?![\p{L}]))/iu, 'АУСН'],
  [/доход\S*,?\s+уменьшенн\S*\s+на\s+(величину\s+)?расход|доходы\s+минус\s+расходы/iu, 'УСН «доходы минус расходы»'],
  [/(упрощ[её]нн\S*\s+систем\S*\s+налогообложени|(?<![\p{L}])УСН(?![\p{L}]))/iu, 'УСН'],
  [/(?<![\p{L}])(ЕСХН|единый\s+сельскохозяйственный\s+налог)/iu, 'ЕСХН'],
  [/патентн\S*\s+систем\S*\s+налогообложени|(?<![\p{L}])ПСН(?![\p{L}])/iu, 'патент'],
];
const KINDS: [RegExp, string][] = [
  [/оборотно-сальдов\S*\s+ведомост/iu, 'оборотно-сальдовые ведомости'],
  [/акт\S*\s+сверки/iu, 'акты сверки'],
  [/книг\S*\s+уч[её]та\s+доходов/iu, 'книга учёта доходов и расходов'],
  [/выписк\S*\s+(по|из|банк)/iu, 'банковские выписки'],
  [/(?<![\p{L}])УПД(?![\p{L}])|универсальн\S*\s+передаточн/iu, 'УПД'],
  [/сч[её]т-фактур/iu, 'счета-фактуры'],
  [/расч[её]тн\S*\s+ведомост|расч[её]тн\S*\s+листк/iu, 'расчётные ведомости по зарплате'],
  [/декларац\S*\s+по\s+(НДС|налогу)/iu, 'налоговые декларации'],
];

export function docGuesses(texts: string[]): DocGuess[] {
  const out: DocGuess[] = [];
  const add = (g: DocGuess) => { if (!out.some((x) => x.text === g.text)) out.push(g); };
  const heads = texts.map((t) => t.slice(0, HEAD_CHARS));
  for (const h of heads) { for (const [re, name] of PROGRAMS) { const m = h.match(re); if (m) { add({ section: 'work', text: `Ведёт учёт в ${name(m)}` }); break; } } }
  for (const h of heads) { for (const [re, name] of REGIMES) { if (re.test(h)) { add({ section: 'work', text: `Организация на ${name}` }); break; } } }
  const kinds = [...new Set(heads.flatMap((h) => KINDS.filter(([re]) => re.test(h)).map(([, k]) => k)))];
  if (kinds.length) add({ section: 'work', text: `Работает с документами: ${kinds.slice(0, 3).join(', ')}` });
  return out.slice(0, MAX_DOC_GUESSES);
}

export function writeDocGuesses(userId: string, fileIds: string[], ctx: { threadId: string; messageId: string }, now = Date.now()): { id: string; text: string; section: string }[] {
  if (!fileIds.length) return [];
  const db = getDb();
  const texts = db.select({ text: schema.files.text }).from(schema.files)
    .where(and(eq(schema.files.userId, userId), inArray(schema.files.id, fileIds.slice(0, 10)))).all().map((r) => r.text ?? '').filter(Boolean);
  const out: { id: string; text: string; section: string }[] = [];
  const rows = listMemory(userId);
  for (const g of docGuesses(texts)) {
    const twin = rows.find((r) => similarity(r.text, g.text) >= SAME);
    if (twin) { if (twin.sure === 0) db.update(schema.userMemory).set({ updatedAt: now }).where(eq(schema.userMemory.id, twin.id)).run(); continue; }
    const id = randomUUID();
    db.insert(schema.userMemory).values({ id, userId, section: g.section, key: null, text: g.text, origin: 'auto', sure: 0, threadId: ctx.threadId, messageId: ctx.messageId, createdAt: now, updatedAt: now }).run();
    out.push({ id, text: g.text, section: g.section });
  }
  if (out.length) console.log(`[memory] doc-guess user=${userId.slice(0, 8)} n=${out.length}`);
  return out;
}
